/**
 * Pulls the club's YouTube uploads and ties them to fixtures where it can.
 *
 * The channel puts out three sorts of thing: live commentary on a match, a
 * highlights package afterwards, and interviews. All three are worth having,
 * and the commentary is worth pointing at while a game is on.
 *
 * The RSS feed needs no API key and no quota, which is why it is used instead
 * of the Data API. It has one catch: it only ever returns the fifteen most
 * recent videos. So data/videos.json accumulates. Each run merges what the
 * feed is showing into what is already stored and never drops anything, which
 * is how the archive grows past that window instead of being stuck at fifteen.
 *
 * Run locally with:  node scripts/fetch-youtube.mjs
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CHANNEL = "UCuLzmVVp_1S_hgTNI_d_LJg"; // Kettering Town FC
const FEED = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL}`;

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "..", "data", "videos.json");
const LEAGUE = resolve(HERE, "..", "data", "league.json");

/** A form of a club name safe to compare: no punctuation, no FC, no case. */
const plain = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\b(f\.?c\.?|football club|afc|town|united|sporting)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/**
 * What sort of video this is, worked out from the title. The channel is
 * consistent enough for this: a commentary stream is named after the fixture
 * and nothing else, a highlights package carries a headline and a pipe.
 */
function kindOf(title) {
  const t = String(title || "");
  if (/\binterview\b|\bq&a\b/i.test(t)) return "interview";
  if (t.includes("|")) return "highlights";
  if (/\bvs?\.?\b/i.test(t)) return "commentary";
  return "other";
}

/**
 * The opponent named in a title. The channel writes fixtures three ways:
 *
 *   Kettering Town VS Alvechurch                        a commentary stream
 *   THE CAMPAIGN BEGINS | Kettering Town 1-0 Alvechurch  a highlights package
 *   Post Match Interview | Kettering Town 1-0 Alvechurch an interview
 *
 * So the two sides are split on either "vs" or a scoreline, and whatever is
 * left after the headline and the date is the pair of clubs.
 */
function opponentIn(title) {
  /* Titles carry up to three parts, as in
     "THE CAMPAIGN BEGINS | Kettering Town 1-0 Alvechurch (08/08/2026) | HIGHLIGHTS".
     Take the part naming us rather than the last one, which is a label. */
  const parts = String(title || "").split("|");
  const body = (parts.find((x) => /kettering/i.test(x)) || parts[parts.length - 1])
    .replace(/\(.*?\)/g, "");
  const sides = body.split(/\s+vs?\.?\s+|\s+\d{1,2}\s*-\s*\d{1,2}\s+/i);
  if (sides.length < 2) return null;
  const cleaned = sides.map((s) => plain(s));
  const ours = cleaned.findIndex((s) => s.includes("kettering"));
  if (ours === -1) return null;
  return cleaned[ours === 0 ? 1 : 0] || null;
}

/** A date written into the title, like "(08/08/2026)", as a timestamp. */
function dateIn(title) {
  const m = String(title || "").match(/\((\d{1,2})\/(\d{1,2})\/(\d{4})\)/);
  if (!m) return null;
  const [, d, mo, y] = m;
  return Date.parse(`${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}T15:00:00Z`);
}

/**
 * The fixture a video belongs to, or null. Matching is on the opponent name
 * and then the nearest kick-off, because the published time cannot be trusted
 * to sit inside the match: the Alvechurch stream is stamped 04:29 the morning
 * after a three o'clock kick-off.
 */
function fixtureFor(title, published, fixtures) {
  const opponent = opponentIn(title);
  const dated = dateIn(title);

  /* An interview often names nobody but carries the date, as in "George Akhtar
     and Fabian Forde Interview (08/08/2026)". A date with a game on it is
     enough on its own. */
  if (!opponent) {
    if (dated === null) return null;
    const sameDay = fixtures.filter(
      (f) => Math.abs(Date.parse(`${f.date}T15:00:00Z`) - dated) < 43200000,
    );
    return sameDay.length === 1 ? sameDay[0].id : null;
  }

  /* A date in the title beats the published time every time: an interview put
     up days later still says which game it belongs to. */
  const when = dated ?? Date.parse(published);
  let best = null;
  let bestGap = Infinity;

  for (const f of fixtures) {
    if (!plain(f.opponent).includes(opponent) && !opponent.includes(plain(f.opponent))) continue;
    const kickoff = Date.parse(`${f.date}T${f.kickoff || "15:00"}:00Z`);
    const gap = Math.abs(kickoff - when);
    if (gap < bestGap) {
      bestGap = gap;
      best = f;
    }
  }

  /* A fortnight either side. Wide enough for a highlights package posted days
     later, tight enough that the reverse fixture months away cannot win. */
  return best && bestGap < 14 * 86400000 ? best.id : null;
}

function parseFeed(xml) {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => {
    const pick = (tag) => (entry.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1] || "";
    return {
      videoId: pick("yt:videoId"),
      title: decode(pick("title")),
      published: pick("published"),
    };
  }).filter((v) => v.videoId);
}

const decode = (s) =>
  s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");

async function main() {
  const res = await fetch(FEED, {
    headers: { "user-agent": "KTFCSA-app/1.0 (+supporters association video mirror)" },
  });
  if (!res.ok) throw new Error(`YouTube feed responded ${res.status}`);
  const fresh = parseFeed(await res.text());

  const fixtures = existsSync(LEAGUE)
    ? JSON.parse(await readFile(LEAGUE, "utf8")).fixtures || []
    : [];

  /* Everything already known, so nothing is lost when it drops out of the
     feed's fifteen. */
  const kept = existsSync(OUT)
    ? (JSON.parse(await readFile(OUT, "utf8")).videos || [])
    : [];
  const byId = new Map(kept.map((v) => [v.videoId, v]));

  let added = 0;
  for (const v of fresh) {
    const existing = byId.get(v.videoId);
    const row = {
      videoId: v.videoId,
      title: v.title,
      published: v.published,
      kind: kindOf(v.title),
      fixtureId: fixtureFor(v.title, v.published, fixtures) || existing?.fixtureId || null,
    };
    if (!existing) added += 1;
    byId.set(v.videoId, row);
  }

  const videos = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published));

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify({
    updated: new Date().toISOString(),
    source: "Kettering Town FC on YouTube",
    channel: `https://www.youtube.com/channel/${CHANNEL}`,
    videos,
  }, null, 2) + "\n", "utf8");

  const tied = videos.filter((v) => v.fixtureId).length;
  console.log(`Videos: ${videos.length} known (${added} new this run), ${tied} tied to a fixture.`);
}

main().catch((err) => {
  console.error("Video update failed:", err.message);
  process.exit(1);
});
