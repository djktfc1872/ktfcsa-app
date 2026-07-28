/**
 * Mirrors The Poppycast RSS feed into data/podcast.json.
 *
 * The feed allows cross-origin requests, so the app reads it live and stays
 * up to date between builds. This mirror is the fallback for when the feed is
 * slow or unreachable, and it means the app still shows episodes offline.
 *
 * Run locally with:  node scripts/fetch-podcast.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FEED = "https://anchor.fm/s/103d565e8/podcast/rss";
const MAX_EPISODES = 30;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "podcast.json");

const NAMED = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", hellip: "…", mdash: "-", ndash: "-", rsquo: "'", lsquo: "'", ldquo: '"', rdquo: '"' };

/** Decodes entities repeatedly, since feed text arrives encoded more than once. */
function decode(s) {
  let out = String(s);
  for (let i = 0; i < 3; i += 1) {
    const next = out
      .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
      .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
      .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
    if (next === out) break;
    out = next;
  }
  return out;
}

const strip = (s) =>
  decode((s || "").replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

const pick = (block, tag) => {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  return m ? strip(m[1]) : "";
};

const attr = (block, tag, name) => {
  const m = block.match(new RegExp(`<${tag}[^>]*\\b${name}="([^"]*)"`, "i"));
  return m ? m[1] : "";
};

async function main() {
  const res = await fetch(FEED, {
    headers: { "user-agent": "KTFCSA-app/1.0 (+supporters association podcast mirror)" },
  });
  if (!res.ok) throw new Error(`Feed responded ${res.status}`);
  const xml = await res.text();

  const channel = xml.split("<item>")[0];
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  const episodes = items.slice(0, MAX_EPISODES).map((block) => {
    const published = pick(block, "pubDate");
    return {
      title: pick(block, "title"),
      published,
      publishedISO: published ? new Date(published).toISOString() : null,
      duration: pick(block, "itunes:duration"),
      description: pick(block, "description").slice(0, 600),
      audio: attr(block, "enclosure", "url"),
      link: pick(block, "link") || attr(block, "enclosure", "url"),
      image: attr(block, "itunes:image", "href") || attr(channel, "itunes:image", "href"),
      episode: pick(block, "itunes:episode"),
    };
  });

  const payload = {
    updated: new Date().toISOString(),
    feed: FEED,
    title: pick(channel, "title") || "The Poppycast",
    description: pick(channel, "description").slice(0, 600),
    image: attr(channel, "itunes:image", "href"),
    link: pick(channel, "link"),
    episodes,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT}: ${episodes.length} episodes.`);
}

main().catch((err) => {
  console.error("Podcast update failed:", err.message);
  process.exit(1);
});
