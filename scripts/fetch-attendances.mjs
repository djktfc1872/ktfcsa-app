/**
 * Every club's home league attendance last season, and what they drew when
 * Kettering came.
 *
 * The question underneath this is whether we take more supporters than the
 * clubs we visit are used to. Answering it needs two numbers a club's own site
 * never puts side by side: what they normally get, and what they got that day.
 *
 * Three things this has to get right, and all three are easy to get wrong:
 *
 *   - **League games only.** An FA Cup tie against a bigger club is not what a
 *     club normally draws, and neither is a play-off semi-final. Cups and
 *     play-offs are excluded and the exclusions are listed below rather than
 *     guessed at by keyword.
 *
 *   - **Whichever division they were in.** Four of this season's twenty two
 *     were somewhere else last season. Filtering on Premier Central would hand
 *     them an average of nothing. Each club is measured in the league it
 *     actually played in, and the division is recorded so the app can say so.
 *
 *   - **The season is worked out from the date.** The feed has no season on a
 *     match, only a seasonId that means nothing on its own. July to June.
 *
 *     node scripts/fetch-attendances.mjs
 */
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://api.southern-football-league.co.uk";
const TENANT = "sfl";
const COMPETITION_ID = "69d0bdbab616bafb97331d40"; // SFL - Premier Central
const KTFC = "6a0adf9eda5d0d0847a023f0";           // Kettering Town first team
const SEASON = "2025/26";

/* Not a league game. Anything whose competition is one of these is left out of
   a club's average, because none of them is a normal Saturday. */
const NOT_LEAGUE = [
  /cup/i,          // FA Cup, FA Trophy is caught below, county cups, Velocity
  /trophy/i,
  /play-?offs?/i,
  /friendly/i,
  /champions v champions/i,
  /vase/i,
];
const isLeague = (name) => Boolean(name) && !NOT_LEAGUE.some((r) => r.test(name));

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "attendances.json");

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: {
      "x-tenant-id": TENANT,
      accept: "application/json",
      "user-agent": "KTFCSA-app/1.0 (+supporters association attendance mirror)",
    },
  });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

/** July to June. The feed gives a date and no season worth reading. */
function seasonOf(date) {
  const y = Number(String(date).slice(0, 4));
  const m = Number(String(date).slice(5, 7));
  return m >= 7 ? `${y}/${String(y + 1).slice(2)}` : `${y - 1}/${String(y).slice(2)}`;
}

const num = (v) => {
  const n = Number(String(v ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** A crowd that is a tenth or ten times what a club normally gets is a typo in
 *  somebody's admin, not a crowd. Kept out of the average and counted so the
 *  file says how many were dropped. */
function withoutOutliers(values) {
  if (values.length < 5) return { kept: values, dropped: [] };
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  const kept = [];
  const dropped = [];
  values.forEach((v) => {
    if (v < mid / 5 || v > mid * 5) dropped.push(v);
    else kept.push(v);
  });
  return { kept, dropped };
}

async function main() {
  const table = await get(`/competitions/league-table?competitionId=${COMPETITION_ID}`);
  /* The feed's club.slug is a real slug for most clubs and the full name for a
     few, so three of twenty two failed to join to our own club ids. Slugified
     from the name when it does not look like one, which fixes all three
     without a hand-written map that would rot. */
  const slugify = (v) => String(v || "").toLowerCase()
    .replace(/'/g, "").replace(/&/g, "and")
    .replace(/\bfc\b/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

  const teams = (table.data || []).map((row) => {
    const name = row.team?.club?.fullName || row.team?.fullName || "";
    const given = row.team?.club?.slug || "";
    return {
      id: row.team?.id,
      name,
      slug: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(given) ? given : slugify(name),
    };
  }).filter((t) => t.id);

  console.log(`${teams.length} clubs in the division`);

  const clubs = [];
  let ktfcAwayTotal = [];

  for (const team of teams) {
    const res = await get(`/matches?teamId=${team.id}&limit=1000`);
    const items = res.items || [];

    const home = items.filter((m) =>
      m.date &&
      seasonOf(m.date) === SEASON &&
      (m.homeTeam?.id || "") === team.id &&
      isLeague(m.competition?.name));

    const withAtt = home.filter((m) => num(m.attendance) !== null);
    const values = withAtt.map((m) => num(m.attendance));
    const { kept, dropped } = withoutOutliers(values);

    /* What they drew when we went. Their home game, our away day. */
    const ours = withAtt.filter((m) => (m.awayTeam?.id || "") === KTFC);
    const oursValues = ours.map((m) => num(m.attendance));

    const divisions = [...new Set(home.map((m) => m.competition?.name).filter(Boolean))];

    const avg = mean(kept);
    const vsUs = mean(oursValues);

    /* Their average with our visit taken out of it.
    
       A club's season average includes the day we came, so comparing our gate
       against it compares it partly against itself. The effect is about one per
       cent over twenty-odd home games, which is small enough to ignore and
       exactly the kind of thing somebody checks when they do not like the
       answer. The comparison is against what they draw when we are not there. */
    const oursSet = new Set(ours.map((m) => m.id || m._id));
    const withoutUs = withAtt
      .filter((m) => !oursSet.has(m.id || m._id))
      .map((m) => num(m.attendance))
      .filter((v) => kept.includes(v) || !dropped.includes(v));
    const avgWithoutUs = mean(withoutUs);

    if (oursValues.length && team.id !== KTFC) ktfcAwayTotal = ktfcAwayTotal.concat(oursValues);

    /* Two clubs came back with nothing, and a blank on a page invites the
       reader to assume a bug. They came down from National League North, so
       their league season is not in this feed at all: everything it holds for
       them last season is a single FA Cup tie. That is worth saying rather
       than leaving a gap. */
    const elsewhere = !withAtt.length && home.length === 0;

    clubs.push({
      name: team.name,
      slug: team.slug,
      division: divisions[0] || null,
      elsewhere,
      games: kept.length,
      missing: home.length - withAtt.length,
      dropped: dropped.length,
      average: avg,
      averageWithoutUs: avgWithoutUs,
      low: kept.length ? Math.min(...kept) : null,
      high: kept.length ? Math.max(...kept) : null,
      /* Only meaningful with a league average to compare against, and only
         where we actually went. */
      ktfcGames: oursValues.length,
      ktfcAverage: vsUs,
      sway: avgWithoutUs && vsUs
        ? Math.round(((vsUs - avgWithoutUs) / avgWithoutUs) * 1000) / 10 : null,
    });

    console.log(
      `  ${team.name.padEnd(22)}${elsewhere ? " played outside this league" : ""} ${
        String(kept.length).padStart(2)} games  ` +
      `avg ${String(avg ?? "-").padStart(5)}` +
      (vsUs ? `   without us ${String(avgWithoutUs).padStart(5)}  with us ${
        String(vsUs).padStart(5)}  ${avgWithoutUs
          ? (vsUs > avgWithoutUs ? "+" : "") +
            (Math.round(((vsUs - avgWithoutUs) / avgWithoutUs) * 1000) / 10) + "%" : ""}` : ""));

    await new Promise((r) => setTimeout(r, 400));
  }

  clubs.sort((a, b) => (b.average || 0) - (a.average || 0));

  /* The headline, and the only number that answers the question as asked:
     across every away ground we visited, what did they draw with us there
     against what those same clubs normally draw. Comparing like with like
     means using only the clubs we actually visited. */
  const visited = clubs.filter((c) => c.ktfcGames && c.averageWithoutUs);
  const theirNormal = mean(visited.map((c) => c.averageWithoutUs));
  const withUs = mean(ktfcAwayTotal);

  const payload = {
    built: new Date().toISOString(),
    season: SEASON,
    source: "Southern League (southern-football-league.co.uk)",
    note:
      "Home league games only: cups, the FA Trophy, county cups and play-offs are " +
      "left out, because none of them is a normal Saturday. Clubs promoted or " +
      "relegated into this division are measured in the league they actually " +
      "played in last season, which is named against each one. Two came down " +
      "from National League North, whose matches this feed does not carry, so " +
      "they have no figure at all rather than a misleading one.",
    swing: {
      grounds: visited.length,
      theirAverage: theirNormal,
      withKettering: withUs,
      percent: theirNormal && withUs
        ? Math.round(((withUs - theirNormal) / theirNormal) * 1000) / 10
        : null,
    },
    clubs,
  };

  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`\nWrote ${OUT}`);
  console.log(
    `Across ${visited.length} grounds: they normally draw ${theirNormal}, ` +
    `with Kettering there ${withUs} (${payload.swing.percent > 0 ? "+" : ""}${payload.swing.percent}%)`);
}

main().catch((err) => { console.error(err); process.exit(1); });
