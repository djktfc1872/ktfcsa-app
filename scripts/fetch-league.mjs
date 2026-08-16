/**
 * Pulls the live Premier Central table and every Kettering Town fixture from the
 * Southern League's own public API, then writes data/league.json.
 *
 * The league API only allows browser requests from its own domain, so the fetch
 * happens here (in GitHub Actions) rather than in the app. The app just reads
 * the JSON file this produces, which is served from the same origin.
 *
 * Run locally with:  node scripts/fetch-league.mjs
 */
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../assets/js/data.js";

const BASE = "https://api.southern-football-league.co.uk";
const TENANT = "sfl";
const COMPETITION_ID = "69d0bdbab616bafb97331d40"; // SFL - Premier Central
const TEAM_ID = "6a0adf9eda5d0d0847a023f0"; // Kettering Town first team
const SEASON_FROM = "2026-07-01";
const SEASON_TO = "2027-06-30";
/* The feed goes back to August 2018 and the request below already returns all
   of it, so the archive costs nothing extra. Coverage is uneven — the club was
   outside this league between 2019 and 2023 — which is fine, because nothing
   reads it as a complete record. */
const ARCHIVE_FROM = "2018-07-01";
const LOGO_BASE = "https://www.southern-football-league.co.uk/img";

const DATA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const OUT = resolve(DATA_DIR, "league.json");
const ARCHIVE_OUT = resolve(DATA_DIR, "archive.json");

async function get(path) {
  const res = await fetch(BASE + path, {
    headers: {
      "x-tenant-id": TENANT,
      accept: "application/json",
      "user-agent": "KTFCSA-app/1.0 (+supporters association fixture mirror)",
    },
  });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

/* Crests tidied by scripts/fetch-crests.py, so they are transparent, small and
   served from our own domain. Falls back to the league's copy if one is missing. */
const CREST_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "assets", "crests");
const localCrests = existsSync(CREST_DIR) ? readdirSync(CREST_DIR) : [];

const slugify = (s) =>
  String(s).toLowerCase().replace(/'/g, "").replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function crestFor(slug, name, logo) {
  const key = slugify(slug || name);
  const hit = localCrests.find((f) => f.replace(/\.(png|svg)$/, "") === key);
  if (hit) return `assets/crests/${hit}`;
  return logo ? `${LOGO_BASE}/${logo}` : null;
}

/* ------------------------------------------------------- squad reconciliation */

/* The club confirms a squad; the league feed names whoever played. The two
   spell people differently ("Jason Alxander" for Alexander, "Ismael Botelho
   Fatadjo" for Fatadjo, "Edward" for Eddie) and shirt numbers move between
   seasons. Ratings are stored against a name, so left alone one player would
   collect marks under two spellings. Every feed name is resolved back to the
   club's spelling before it reaches the app. */

const SQUAD_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "squad.json");
const squad = existsSync(SQUAD_PATH)
  ? JSON.parse(readFileSync(SQUAD_PATH, "utf8")).players || []
  : [];

/** Lower case, no accents, no punctuation: a form safe to compare. */
const plain = (s) =>
  String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();

const surname = (name) => plain(name).split(" ").pop() || "";

/** Edit distance, stopping early once it passes the limit we care about. */
function distance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/**
 * The club's spelling of a player the feed has named, or null if they are not
 * in the confirmed squad, which is how a new signing is spotted.
 */
function canonicalName(name, number) {
  if (!squad.length) return null;
  const full = plain(name);
  const exact = squad.find((p) => plain(p.name) === full);
  if (exact) return exact.name;

  /* Surnames survive what forenames do not: Eddie for Edward, a middle name
     the feed keeps and the club drops. */
  const sur = surname(name);
  const initial = full.charAt(0);
  const bySurname = squad.filter((p) => surname(p.name) === sur);
  /* Sharing a surname is not enough on its own: a new signing called Panter is
     not Eddie Panter. The forename has to at least start the same way, which
     Eddie and Edward do. */
  if (bySurname.length === 1 && plain(bySurname[0].name).charAt(0) === initial) {
    return bySurname[0].name;
  }
  if (bySurname.length > 1) {
    const byNumber = bySurname.find((p) => p.number === number);
    if (byNumber) return byNumber.name;
    const forename = full.split(" ")[0];
    const byForename = bySurname.find((p) => plain(p.name).split(" ")[0].startsWith(forename.slice(0, 3)));
    if (byForename) return byForename.name;
  }

  /* Still nothing, so allow for a typo in the surname itself. Short surnames
     get one edit only: "Ranger" and "Panter" are two apart, and a departed
     player must not be quietly rewritten into a current one. A near surname
     also has to come with a matching forename before we trust it. */
  const forename = full.split(" ")[0];
  const allowed = sur.length >= 8 ? 2 : 1;
  const near = squad
    .map((p) => ({ p, d: distance(sur, surname(p.name)) }))
    .filter((x) => x.d <= allowed)
    .filter((x) => {
      const theirs = plain(x.p.name).split(" ")[0];
      return theirs === forename || distance(theirs, forename) <= 1;
    })
    .sort((a, b) => a.d - b.d);
  if (near.length && (near.length === 1 || near[0].d < near[1].d)) return near[0].p.name;

  return null;
}

/** The Kettering names on a team sheet, starters first then substitutes. */
/**
 * The feed uses the literal string "N/A" where it has no name — for every
 * historical goalscorer, and for 521 places in old team sheets. It is not a
 * player. This season's sheets are clean, but a rating or a quiz question
 * against "N/A" is the sort of thing that only shows up once it is live.
 */
const isRealName = (s) => {
  const n = String(s || "").trim();
  return n.length > 1 && !/^(n\/a|not found|tbc|unknown|-+)$/i.test(n);
};

/**
 * The players, out of a team sheet that is not only players.
 *
 * An old sheet is two blocks stuck together: the matchday squad numbered from
 * one, then the match officials and staff, whose numbering starts again. That
 * is how Malcolm Lewer, Michael Hunter, Tom Cherry, the Frys, Andrew Leese,
 * Richard King, Rachel Birks and Marcus Law - a manager, referees and
 * assistants - ended up in the player archive with eighty-odd appearances.
 *
 * The boundary cannot be found from the numbers: 2018's sheets run 1, 2, 5, 6,
 * 5, 10 and are not sorted at all. What does hold is that the squad comes
 * first, is never more than sixteen, and that the officials are separated from
 * it by placeholder rows. So: stop at the first placeholder, and never take
 * more than a matchday squad.
 *
 * Checked against every name Danny listed - all ten disappear - and against
 * Richard Lavery, who wore 14 in a clean 1-16 sheet and stays.
 */
const SQUAD_MAX = 16;
function squadOnly(entries) {
  const out = [];
  for (const p of entries) {
    if (!isRealName(p.personName)) break;
    out.push(p);
    if (out.length >= SQUAD_MAX) break;
  }
  return out;
}

/**
 * The 2023/24 records are shouted or whispered rather than written: "BEN WATTS",
 * "dan willis", "JAMES LE MEASIEUR". Left alone, a lower-case name sitting
 * among three properly cased ones in a quiz answers the question by itself.
 *
 * Only names that are entirely upper or entirely lower case are touched.
 * Anything already mixed is left exactly as it is, because that is where
 * "Lawson D'Ath", "McDonald" and "O'Brien" live and a naive title-case would
 * break every one of them.
 */
/**
 * One person recorded two ways. Spelled out rather than matched by similarity,
 * because Devon and Dion Kelly-Evans are twin brothers who both played, and
 * any threshold loose enough to catch "Alxander" merges them into one player.
 */
const NAME_FIXES = {
  "jason alxander": "Jason Alexander",
};

function tidyName(raw) {
  let n = String(raw || "").trim().replace(/\s+/g, " ");
  /* "Lathaniel Rowe -Turner" and "Lathaniel Rowe-Turner" are the same man. */
  n = n.replace(/\s*-\s*/g, "-");
  if (n !== n.toUpperCase() && n !== n.toLowerCase()) return NAME_FIXES[n.toLowerCase()] || n;
  n = n.toLowerCase().replace(/(^|[\s'\-])([a-z])/g, (_, pre, ch) => pre + ch.toUpperCase());
  return NAME_FIXES[n.toLowerCase()] || n;
}

function lineupFor(match, isHome) {
  const starters = (isHome ? match.homeLineup : match.awayLineup) || [];
  const subs = (isHome ? match.homeSubs : match.awaySubs) || [];
  const seen = new Set();
  return [...starters, ...subs]
    .map((p) => {
      const feedName = String(p.personName || "").trim();
      const number = p.number ?? null;
      const known = canonicalName(feedName, number);
      return {
        name: known || feedName,
        feedName: known && known !== feedName ? feedName : undefined,
        number,
        started: Boolean(p.hasStartedMatch),
        captain: Boolean(p.isCaptain),
        /* Not in the squad the club confirmed, so a new face rather than a
           spelling we failed to match. */
        newFace: known ? undefined : true,
      };
    })
    .filter((p) => {
      const key = p.name.toLowerCase();
      if (!isRealName(p.name) || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * Goals and cards for both sides. Our players are resolved to the club's
 * spelling; the opposition are left as the feed writes them, because we have
 * no squad list to check them against.
 *
 * The feed left every card's type null on the opening day, so a sending off is
 * worked out rather than read: a second card for the same player in the same
 * match is a second yellow. An explicit red still counts as one.
 */
function eventsFor(match, isHome) {
  const ourSide = isHome ? "home" : "away";

  const read = (key, ours) =>
    (match[key] || []).map((e) => {
      const raw = String(e.personName || "").trim();
      return {
        name: ours ? canonicalName(raw, e.number ?? null) || raw : raw,
        minute: typeof e.minute === "number" ? e.minute : null,
        ours,
        type: String(e.type || "").toLowerCase() || null,
      };
    }).filter((e) => e.name);

  const goals = [
    ...read(`${ourSide}Goals`, true),
    ...read(ourSide === "home" ? "awayGoals" : "homeGoals", false),
  ].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

  const cards = [
    ...read(`${ourSide}Cards`, true),
    ...read(ourSide === "home" ? "awayCards" : "homeCards", false),
  ].sort((a, b) => (a.minute ?? 999) - (b.minute ?? 999));

  /* Walk in order so the dismissal lands on the second card, not the first. */
  const seen = new Map();
  cards.forEach((c) => {
    const key = `${c.ours ? "us" : "them"}|${plain(c.name)}`;
    const before = seen.get(key) || 0;
    seen.set(key, before + 1);
    c.second = before > 0;
    c.dismissed = before > 0 || c.type === "red" || c.type === "redcard";
  });

  return { goals, cards };
}

/**
 * The last five results for every club in the table, as a string like "WWDLW".
 * One request each, run a few at a time so the league's server is not hammered.
 */
async function formByTeam(rows) {
  const out = {};
  const ids = rows.map((r) => r.team?.id).filter(Boolean);

  for (let i = 0; i < ids.length; i += 4) {
    const batch = ids.slice(i, i + 4);
    await Promise.all(batch.map(async (id) => {
      try {
        /* Not 400. The API returns oldest first with no way to sort, and a club
           with a long enough history fills 400 before it reaches this season:
           Leiston have 451 and came back with nothing but 2018 to 2026. */
        const res = await get(`/matches?teamId=${id}&limit=1000`);
        const played = (res.items || [])
          .filter((m) => m.date >= SEASON_FROM && m.date <= SEASON_TO)
          .filter((m) => readStatus(m.status) === "played")
          .sort((a, b) => (a.date + (a.time || "")).localeCompare(b.date + (b.time || "")));

        out[id] = played.slice(-5).map((m) => {
          const home = (m.homeTeam?.id || "") === id;
          const ours = home ? m.score?.current?.home : m.score?.current?.away;
          const theirs = home ? m.score?.current?.away : m.score?.current?.home;
          if (ours == null || theirs == null) return "";
          return ours > theirs ? "W" : ours < theirs ? "L" : "D";
        }).join("");
      } catch {
        out[id] = ""; /* one club failing must not cost the whole table */
      }
    }));
  }
  return out;
}

/** Turn the API's status codes into something we can show a supporter. */
function readStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "fulltime" || s === "aet" || s === "afterpenalties") return "played";
  if (s === "postponed" || s === "abandoned" || s === "cancelled") return "off";
  if (s === "firsthalf" || s === "secondhalf" || s === "halftime" || s === "extratime") return "live";
  return "upcoming";
}

/**
 * Is this Kettering's home game? Match on the team id: some records store the
 * team name as "P", so testing the name gets the wrong side.
 */
const weAreHome = (m) =>
  (m.homeTeam?.id || "") === TEAM_ID || /kettering/i.test(m.homeTeam?.fullName || m.homeTeamName || "");

/** One match from the feed, in the shape the app reads. */
function toFixture(m) {
  const homeName = m.homeTeam?.fullName || m.homeTeamName || "";
  const awayName = m.awayTeam?.fullName || m.awayTeamName || "";
  const isHome = weAreHome(m);
  const status = readStatus(m.status);
  const score = m.score?.current || {};
  return {
    id: m.id || m._id,
    date: m.date,
    kickoff: m.time || "",
    venue: isHome ? "Home" : "Away",
    opponent: isHome ? awayName : homeName,
    opponentCrest: crestFor(null, isHome ? awayName : homeName, isHome ? m.awayTeam?.logo : m.homeTeam?.logo),
    competition: m.competition?.shortName || m.competition?.name || "",
    competitionType: m.competition?.type || "",
    ground: m.stadium?.name || "",
    status,
    rawStatus: m.status || "",
    homeScore: status === "played" || status === "live" ? score.home ?? null : null,
    awayScore: status === "played" || status === "live" ? score.away ?? null : null,
    attendance: m.attendance || null,
    /* Who played, where the league recorded it. Coverage is patchy: two
       full seasons of lineups, then 2025/26 stopped in September. The app
       shows the squad and ratings only when there is something here. */
    lineup: lineupFor(m, isHome),
    events: eventsFor(m, isHome),
  };
}

/**
 * Was this actually played? The status alone is not enough looking backwards:
 * the league never updated 43 past matches off "NotKickedOff", which silently
 * cost the archive 37 of last season's 50 games.
 *
 * So a score plus something to corroborate it — an attendance or a team sheet —
 * counts too. That pairing matters: five records carry a score and nothing
 * else, and one of them is 999-999. A placeholder like that reaching the
 * question bank would be the most memorable bug this app ever shipped.
 */
function reallyPlayed(m) {
  const score = m.score?.current || {};
  const sane = (v) => typeof v === "number" && v >= 0 && v <= 20;
  if (!sane(score.home) || !sane(score.away)) return false;
  if (readStatus(m.status) === "played") return true;
  return Boolean(m.attendance) || Boolean((m.homeLineup || []).length || (m.awayLineup || []).length);
}

/** A club name we can actually show, or "" if the feed only gave a placeholder. */
const namedClub = (s) => {
  const n = String(s || "").trim();
  return n.length > 3 ? n : "";
};

/** Which season a date falls in, as supporters write it: "2024/25". */
function seasonOf(date) {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 7 ? y : y - 1;
  return `${start}/${String(start + 1).slice(2)}`;
}

/**
 * A past match, kept small. This feeds the Poppies Daily question bank and the
 * player archive, both of which want every season at once, so every byte here
 * is paid for 250 times over.
 *
 * Deliberately absent: goalscorer names. The feed records every historical
 * scorer as the literal string "N/A" — all 99 of Kettering's goals across
 * 2023/24 and 2024/25 — so there is nothing to store and nothing to build on.
 * Minutes are real. Names arrive only from 2026/27, through the season list
 * above. Please do not wire "N/A" in here to fill the gap.
 */
function toArchiveMatch(m, intern) {
  const isHome = weAreHome(m);
  const score = m.score?.current || {};
  const ours = isHome ? score.home : score.away;
  const theirs = isHome ? score.away : score.home;
  const side = isHome ? "home" : "away";

  const cards = (m[`${side}Cards`] || []);
  return {
    id: m.id || m._id,
    date: m.date,
    season: seasonOf(m.date),
    venue: isHome ? "Home" : "Away",
    /* Seven old records store the other club's name as the single letter "P".
       Empty here rather than a placeholder, so anything that names an opponent
       can skip the match instead of asking who "P" were. */
    opponent: namedClub(isHome ? m.awayTeam?.fullName || m.awayTeamName : m.homeTeam?.fullName || m.homeTeamName),
    competition: m.competition?.shortName || m.competition?.name || "",
    /* Kettering first, always, so nothing downstream has to redo the flip. */
    us: typeof ours === "number" ? ours : null,
    them: typeof theirs === "number" ? theirs : null,
    att: m.attendance || null,
    /* The whole matchday squad, not just the eleven: these old lineups run to
       25 names. Note there is no starter flag stored, because the feed's one
       cannot be trusted this far back - hasStartedMatch is true for all but 15
       of 3,943 entries, which cannot be right for squads that size. An
       appearance is honest, a start would not be.
       (`homeSubs` is no help either: it holds substitution events, with the
       player coming off recorded as "N/A".) */
    lineup: squadOnly(m[`${side}Lineup`] || [])
      /* A surname on its own ("LEWER", one appearance) is a half-written
         record, not somebody anyone could be asked to identify. */
      .filter((p) => tidyName(p.personName).includes(" "))
      .map((p) => [intern(p.personName), p.number ?? null])
      /* The same player twice in one sheet happens; keep the first. */
      .filter((row, i, all) => all.findIndex((o) => o[0] === row[0]) === i),
    /* Incomplete: in a quarter of the matches that have any goal records at
       all, there are fewer minutes here than we scored. Fine for "when did we
       score", useless for counting. Count goals from `us`, never from this. */
    goalMins: (m[`${side}Goals`] || [])
      .map((g) => (typeof g.minute === "number" ? g.minute : null))
      .filter((x) => x !== null)
      .sort((a, b) => a - b),
    cards: {
      y: cards.filter((c) => String(c.type || "").toLowerCase() !== "red").length,
      r: cards.filter((c) => String(c.type || "").toLowerCase() === "red").length,
    },
  };
}

async function main() {
  const [tableRes, matchRes] = await Promise.all([
    get(`/competitions/league-table?competitionId=${COMPETITION_ID}`),
    /* Same reason as the form fetch: 400 is not enough once a club has a few
       seasons behind it, and there is no way to ask for the newest first. */
    get(`/matches?teamId=${TEAM_ID}&limit=1000`),
  ]);

  /* Recent form, five games, oldest first so it reads left to right the way a
     supporter expects. The competition endpoint ignores every date and sort
     parameter it was offered and always returns 2018 first, so the only way to
     get current results is to ask club by club. Twenty two small requests, a
     couple of times a day, which is nothing. */
  const form = await formByTeam(tableRes.data || []);

  const table = (tableRes.data || []).map((row) => ({
    position: row.position,
    name: row.team?.club?.fullName || row.team?.fullName || "",
    short: row.team?.club?.shortName || row.team?.shortName || "",
    slug: row.team?.club?.slug || "",
    crest: crestFor(row.team?.club?.slug, row.team?.club?.fullName || row.team?.fullName, row.team?.club?.logo || row.team?.logo),
    played: row.total?.played ?? 0,
    won: row.total?.wins ?? 0,
    drawn: row.total?.draws ?? 0,
    lost: row.total?.losses ?? 0,
    for: row.total?.scored ?? 0,
    against: row.total?.conceded ?? 0,
    goalDifference: row.total?.goalDifference ?? 0,
    points: row.points ?? 0,
    deduction: (row.deductions || []).reduce((n, d) => n + (d.points || 0), 0),
    form: form[row.team?.id] || "",
  }));

  const fixtures = (matchRes.items || [])
    .filter((m) => m.date >= SEASON_FROM && m.date <= SEASON_TO)
    .map(toFixture)
    .sort((a, b) => (a.date + a.kickoff).localeCompare(b.date + b.kickoff));

  const payload = {
    updated: new Date().toISOString(),
    source: "Southern League (southern-football-league.co.uk)",
    season: "2026/27",
    competition: "Southern League Premier Central",
    table,
    fixtures,
  };

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT}: ${table.length} clubs, ${fixtures.length} fixtures.`);

  await writeArchive(matchRes.items || []);
  await pushToSupabase(fixtures);
}

/**
 * Every played match before this season, from the same response the fixtures
 * came out of. No extra requests: the API has no way to ask for one season, so
 * a club's whole history arrives whether we want it or not, and until now it
 * was filtered away and forgotten.
 */
async function writeArchive(items) {
  const players = [];
  const index = new Map();
  const intern = (name) => {
    const clean = tidyName(name);
    if (!index.has(clean)) {
      index.set(clean, players.length);
      players.push(clean);
    }
    return index.get(clean);
  };

  const matches = items
    .filter((m) => m.date >= ARCHIVE_FROM && m.date < SEASON_FROM)
    .filter(reallyPlayed)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((m) => toArchiveMatch(m, intern));

  const payload = {
    built: new Date().toISOString(),
    source: "Southern League (southern-football-league.co.uk)",
    note: "Goalscorer names are the string 'N/A' in the feed for every season before 2026/27, so no scorer is recorded here. The minutes are real.",
    players,
    matches,
  };

  /* Unpretty, unlike league.json next door. Nobody reads this one by hand and
     indenting it costs about 60KB on every visit that opens the archive. */
  await writeFile(ARCHIVE_OUT, JSON.stringify(payload) + "\n", "utf8");
  const seasons = new Set(matches.map((m) => m.season));
  console.log(
    `Wrote ${ARCHIVE_OUT}: ${matches.length} matches, ${players.length} players, ` +
    `${seasons.size} seasons (${[...seasons].sort()[0]} to ${[...seasons].sort().at(-1)}).`
  );
}

/* --------------------------------------------------------------- Supabase */

/** How far London is from UTC at a given instant, in milliseconds. */
function londonOffset(date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  })
    .formatToParts(date)
    .filter((p) => p.type !== "literal");
  const p = Object.fromEntries(parts.map((x) => [x.type, Number(x.value)]));
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - date.getTime();
}

/** A UK kick-off time turned into a real instant, British Summer Time included. */
function kickoffInstant(date, time) {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time || "15:00").split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, hh || 15, mm || 0);
  let guess = wall;
  for (let i = 0; i < 2; i += 1) guess = wall - londonOffset(new Date(guess));
  return new Date(guess).toISOString();
}

const milesFor = (opponent) => {
  const key = (s) => String(s).toLowerCase().replace(/\b(f\.?c\.?|football club|afc)\b/g, "").replace(/[^a-z0-9]/g, "");
  const k = key(opponent);
  const hit = TEAMS.find((t) => key(t.name) === k) ||
    TEAMS.find((t) => k.includes(key(t.name)) || key(t.name).includes(k));
  return hit?.distanceMiles ?? null;
};

/**
 * Mirrors fixtures into Supabase so the prediction league can be scored in the
 * database rather than trusting a browser. Skipped when the secrets are not
 * set, which is the case for anyone running this locally.
 */
async function pushToSupabase(fixtures) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log("Supabase secrets not set, skipping the database sync.");
    return;
  }

  const rows = fixtures.map((f) => ({
    id: f.id,
    match_date: f.date,
    kickoff: f.kickoff || null,
    kickoff_at: kickoffInstant(f.date, f.kickoff),
    venue: f.venue,
    opponent: f.opponent,
    opponent_slug: f.opponent.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    competition: f.competition,
    competition_type: f.competitionType,
    status: f.status,
    home_score: f.homeScore,
    away_score: f.awayScore,
    distance_miles: milesFor(f.opponent),
    updated_at: new Date().toISOString(),
  }));

  const res = await fetch(`${url.replace(/\/$/, "")}/rest/v1/fixtures?on_conflict=id`, {
    method: "POST",
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });

  if (!res.ok) {
    throw new Error(`Supabase sync failed (${res.status}): ${await res.text()}`);
  }
  console.log(`Synced ${rows.length} fixtures to Supabase.`);
}

main().catch((err) => {
  console.error("League update failed:", err.message);
  process.exit(1);
});
