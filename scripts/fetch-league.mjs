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
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TEAMS } from "../assets/js/data.js";

const BASE = "https://api.southern-football-league.co.uk";
const TENANT = "sfl";
const COMPETITION_ID = "69d0bdbab616bafb97331d40"; // SFL - Premier Central
const TEAM_ID = "6a0adf9eda5d0d0847a023f0"; // Kettering Town first team
const SEASON_FROM = "2026-07-01";
const SEASON_TO = "2027-06-30";
const LOGO_BASE = "https://www.southern-football-league.co.uk/img";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "league.json");

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

/** Turn the API's status codes into something we can show a supporter. */
function readStatus(raw) {
  const s = String(raw || "").toLowerCase();
  if (s === "fulltime" || s === "aet" || s === "afterpenalties") return "played";
  if (s === "postponed" || s === "abandoned" || s === "cancelled") return "off";
  if (s === "firsthalf" || s === "secondhalf" || s === "halftime" || s === "extratime") return "live";
  return "upcoming";
}

async function main() {
  const [tableRes, matchRes] = await Promise.all([
    get(`/competitions/league-table?competitionId=${COMPETITION_ID}`),
    get(`/matches?teamId=${TEAM_ID}&limit=400`),
  ]);

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
  }));

  const fixtures = (matchRes.items || [])
    .filter((m) => m.date >= SEASON_FROM && m.date <= SEASON_TO)
    .map((m) => {
      const homeName = m.homeTeam?.fullName || m.homeTeamName || "";
      const awayName = m.awayTeam?.fullName || m.awayTeamName || "";
      const isHome = /kettering/i.test(homeName);
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
      };
    })
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

  await pushToSupabase(fixtures);
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
