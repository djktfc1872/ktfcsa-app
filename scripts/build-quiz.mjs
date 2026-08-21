/**
 * Builds data/quiz-bank.json: every Poppies Daily question, and the calendar
 * saying which five are asked on which day.
 *
 * Why this runs here and not in the browser
 * ----------------------------------------
 * "Everyone gets the same five questions" is the whole feature. Done on the
 * client it is a property you have to trust two JavaScript engines to agree
 * on, and any selection that indexes into the bank shifts the moment the bank
 * grows - which it does every time a match is played. A supporter running
 * yesterday's service-worker-cached copy would then quietly get different
 * questions from the person stood next to them, and nothing in testing would
 * show it. Done here, it is a fact in a committed file.
 *
 * The answer key ships to the browser as a result. That is a decision, not an
 * oversight: this is a supporters' club quiz, and the alternative costs an
 * edge function and breaks both offline play and playing before you sign in.
 *
 * Run locally with:  node scripts/build-quiz.mjs
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { QUIZ_EPOCH, dayNumber, dateForDay, londonToday, rngFor, seededShuffle } from "../assets/js/quiz.js";

const DATA = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data");
const OUT = resolve(DATA, "quiz-bank.json");

/** Questions in a day. */
const PER_DAY = 5;
/**
 * How many days ahead the calendar is written. Kept comfortably inside what
 * the bank can fill without repeating: the build runs on every data sync, so
 * the horizon rolls forward on its own as new matches add new questions.
 */
const HORIZON = 140;
/** A question cannot come round again inside this many days. */
const COOLDOWN = 120;
/**
 * At most this many of one kind in a day. A cap rather than a fixed running
 * order: demanding one shirt-number question every day when only 48 exist
 * forced a repeat every third day, while the four big types sat unused.
 */
const MAX_PER_TYPE = 2;

const read = (name, fallback = null) => {
  const path = resolve(DATA, name);
  if (!existsSync(path)) {
    if (fallback === null) throw new Error(`${name} is missing. Run scripts/fetch-league.mjs first.`);
    return fallback;
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

/* ------------------------------------------------------------------ helpers */

const NBSP_FREE = (s) => String(s).replace(/\s+/g, " ").trim();

/** "Saturday 27 April 2019". Formatted in UTC so it cannot drift by a day. */
const longDate = (iso) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(`${iso}T12:00:00Z`)).replace(/^(\w+),/, "$1");

const commas = (n) => Number(n).toLocaleString("en-GB");

/**
 * A stable id. Derived from what the question actually asks, so a rebuild
 * reissues the same id, and a question whose wording changes becomes a new
 * question rather than silently swapping under a day somebody has played.
 */
function idFor(type, ...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join("|")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return `${type.slice(0, 2)}-${(h >>> 0).toString(16).padStart(8, "0").slice(0, 6)}`;
}

/**
 * Shuffle the options with a seed tied to the question, not the day, so the
 * order is the same for everyone and stays the same if the question moves.
 * People screenshot these and compare "I picked B".
 */
function finish(type, stem, correct, wrong, note) {
  const opts = [correct, ...wrong].map(String).map(NBSP_FREE);
  const id = idFor(type, stem, String(correct));
  const shuffled = seededShuffle(opts, rngFor(`opt:${id}`));
  return {
    id, type,
    q: NBSP_FREE(stem),
    a: shuffled,
    c: shuffled.indexOf(NBSP_FREE(String(correct))),
    note: note ? NBSP_FREE(note) : undefined,
  };
}

/* ------------------------------------------------------------- the archive */

const archive = read("archive.json");
const facts = read("club-facts.json");
const squad = read("squad.json");
const extra = read("quiz-extra.json", { questions: [] });
const P = archive.players;

/**
 * Matches worth asking about. Friendlies are not memorable, and seven old
 * records have no opponent name at all - the feed stored the other club as
 * "P" and the archive leaves those blank rather than pass a placeholder on.
 */
const QUIZZABLE = archive.matches.filter(
  (m) => (m.competition || "").toLowerCase() !== "friendly" && m.opponent
);

/** season -> playerIndex -> { apps, starts, shirts: Map<number, count> } */
const bySeason = new Map();
for (const m of QUIZZABLE) {
  if (!bySeason.has(m.season)) bySeason.set(m.season, new Map());
  const s = bySeason.get(m.season);
  for (const [pi, shirt] of m.lineup) {
    if (!s.has(pi)) s.set(pi, { apps: 0, shirts: new Map() });
    const r = s.get(pi);
    r.apps += 1;
    if (shirt != null) r.shirts.set(shirt, (r.shirts.get(shirt) || 0) + 1);
  }
}

/** Every season a player appears in, so squad distractors can keep their distance. */
const seasonsOf = new Map();
for (const [season, players] of bySeason) {
  for (const pi of players.keys()) {
    if (!seasonsOf.has(pi)) seasonsOf.set(pi, new Set());
    seasonsOf.get(pi).add(season);
  }
}
/** Appearances across every season, used to keep distractors recognisable. */
const totalApps = new Map();
for (const players of bySeason.values()) {
  for (const [pi, r] of players) totalApps.set(pi, (totalApps.get(pi) || 0) + r.apps);
}

const seasonYear = (s) => Number(s.slice(0, 4));

const where = (m) => (m.venue === "Home" ? "Latimer Park" : `${m.opponent}`);
const versus = (m) =>
  m.venue === "Home" ? `Kettering Town v ${m.opponent}` : `${m.opponent} v Kettering Town`;

/* ------------------------------------------------------- question builders */

const questions = [];
const push = (q) => { if (q) questions.push(q); };

/* --- 1. scoreline ------------------------------------------------------- */

const DELTAS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [2, 0], [0, 2], [-1, 1], [1, -1], [2, 1], [0, 3]];
const outcome = (a, b) => (a > b ? "W" : a < b ? "L" : "D");

for (const m of QUIZZABLE) {
  const correct = `${m.us}-${m.them}`;
  const rnd = rngFor(`sc:${m.id}`);
  const wrong = [];
  for (const [du, dt] of seededShuffle(DELTAS, rnd)) {
    const u = m.us + du, t = m.them + dt;
    if (u < 0 || t < 0 || u > 7 || t > 7) continue;
    const cand = `${u}-${t}`;
    if (cand === correct || wrong.includes(cand)) continue;
    wrong.push(cand);
    if (wrong.length === 3) break;
  }
  if (wrong.length < 3) continue;

  /* Make sure the four options are not all wins. Otherwise the question stops
     being "what was the score" and becomes "we won, so pick the win", and a
     lone draw among three victories gives itself away. */
  const outcomes = new Set([correct, ...wrong].map((s) => {
    const [a, b] = s.split("-").map(Number);
    return outcome(a, b);
  }));
  if (outcomes.size < 2) {
    const swap = [[m.us + 1, m.them + 1], [m.them, m.us], [m.us, m.us]]
      .map(([a, b]) => `${a}-${b}`)
      .find((s) => {
        const [a, b] = s.split("-").map(Number);
        return a >= 0 && b >= 0 && a <= 7 && b <= 7 && s !== correct && !wrong.includes(s) &&
          outcome(a, b) !== outcome(m.us, m.them);
      });
    if (!swap) continue;
    wrong[2] = swap;
  }

  const res = m.us > m.them ? "won" : m.us < m.them ? "lost" : "drew";
  push(finish(
    "scoreline",
    `How did this one finish? ${versus(m)}, ${longDate(m.date)}.`,
    correct, wrong,
    `Kettering ${res} ${correct}${m.att ? `, in front of ${commas(m.att)}` : ""}.`
  ));
}

/* --- 2. attendance ------------------------------------------------------ */

/** The coarsest of 1/5/10/50/100 that divides a figure exactly. */
const roundness = (n) => [100, 50, 10, 5, 1].find((r) => n % r === 0) || 1;
const MULTS = [0.58, 0.66, 0.74, 0.83, 1.19, 1.28, 1.41, 1.56, 1.72];

for (const m of QUIZZABLE) {
  if (!m.att || m.att < 100) continue;              // tiny gates make silly questions
  const A = m.att;
  const cls = roundness(A);
  const digits = String(A).length;
  const gap = Math.max(25, Math.round(A * 0.09));
  const rnd = rngFor(`at:${m.id}`);
  const wrong = [];

  for (const mult of seededShuffle(MULTS, rnd)) {
    /* Round the distractor to the same coarseness as the real figure. Without
       this, a real 1,247 sits beside three tidy multiples of 50 and the odd
       one out is the answer - which is the trap this type always falls into. */
    let v = Math.round((A * mult) / cls) * cls;
    if (v < A / 2.2 || v > A * 2.2) continue;
    if (String(v).length !== digits) continue;      // 986 next to 1,247 is a giveaway
    if (v === A) continue;
    if ([A, ...wrong].some((o) => Math.abs(o - v) < gap)) continue;
    wrong.push(v);
    if (wrong.length === 3) break;
  }
  if (wrong.length < 3) continue;

  /* Check the finished set rather than trusting the loop that built it.
     Three ways an attendance question gives itself away, and the last one is
     the one that survived the first pass: a gate of 555 sitting beside 660,
     320 and 710 is the only figure that is not a round ten. */
  const all = [A, ...wrong];
  const classes = wrong.map(roundness);
  const uniquelyRound = !classes.includes(cls) && new Set(classes).size === 1;
  const tooWide = Math.max(...all) / Math.min(...all) >= 3;
  const tooClose = all.some((x, i) => all.some((y, j) => i < j && Math.abs(x - y) < gap));
  if (uniquelyRound || tooWide || tooClose) continue;

  const stem = m.venue === "Home"
    ? `What was the gate at Latimer Park for ${versus(m)}, ${longDate(m.date)}?`
    : `Kettering were away at ${m.opponent} on ${longDate(m.date)}. What was the gate?`;
  push(finish("attendance", stem, commas(A), wrong.map(commas),
    `${commas(A)} were there. It finished ${m.us}-${m.them}.`));
}

/* --- 3. squad membership ------------------------------------------------ */

for (const [season, players] of bySeason) {
  const regulars = [...players.entries()].filter(([, r]) => r.apps >= 5).map(([pi]) => pi);
  if (regulars.length < 4) continue;
  const yr = seasonYear(season);

  for (const pi of regulars) {
    const rnd = rngFor(`sq:${season}:${pi}`);
    /* Distractors are real Poppies from other seasons, never invented names.
       Two filters: they must not have played in the season being asked about
       (otherwise the question has two right answers, which is the single most
       likely way this type ships something wrong), and they must be a couple
       of seasons clear, so a January signing is not a trick. */
    const pool = [...seasonsOf.keys()].filter((other) => {
      if (other === pi) return false;
      /* A name that turned out once is not a fair wrong answer, and half of
         them are half-written records anyway. */
      if ((totalApps.get(other) || 0) < 5) return false;
      const theirs = seasonsOf.get(other);
      if (theirs.has(season)) return false;
      return [...theirs].every((s) => Math.abs(seasonYear(s) - yr) >= 2);
    });
    if (pool.length < 3) continue;
    const wrong = seededShuffle(pool, rnd).slice(0, 3).map((x) => P[x]);
    const r = players.get(pi);
    push(finish("squad", `Which of these played for Kettering Town in ${season}?`, P[pi], wrong,
      `${P[pi]} made ${r.apps} appearance${r.apps === 1 ? "" : "s"} that season.`));
  }
}

/* --- 4. shirt number ---------------------------------------------------- */

/** Numbers cluster by role, and 9/10/11/1 hands you the goalkeeper. */
const band = (n) => (n === 1 ? 0 : n <= 6 ? 1 : n <= 11 ? 2 : 3);

for (const [season, players] of bySeason) {
  const worn = new Map();                            // shirt -> who wore it
  for (const [pi, r] of players) for (const s of r.shirts.keys()) {
    if (!worn.has(s)) worn.set(s, new Set());
    worn.get(s).add(pi);
  }

  for (const [pi, r] of players) {
    if (r.apps < 20 || !r.shirts.size) continue;
    const [shirt, count] = [...r.shirts.entries()].sort((a, b) => b[1] - a[1])[0];
    /* The mode, not the only value: a player picks up an odd number when a
       shirt goes missing. Require it to be what they actually wore most weeks. */
    if (count / r.apps < 0.8) continue;

    const mine = new Set(r.shirts.keys());
    const rnd = rngFor(`sn:${season}:${pi}`);
    const sameBand = [...worn.keys()].filter((n) => !mine.has(n) && band(n) === band(shirt));
    const other = [...worn.keys()].filter((n) => !mine.has(n) && band(n) !== band(shirt));
    const wrong = [...seededShuffle(sameBand, rnd), ...seededShuffle(other, rnd)].slice(0, 3);
    if (wrong.length < 3) continue;

    push(finish("shirt", `What number did ${P[pi]} wear for the Poppies in ${season}?`,
      shirt, wrong, `Number ${shirt}, in ${r.apps} appearances that season.`));
  }
}

/* --- 5. who did we play ------------------------------------------------- */

const allOpponents = [...new Set(QUIZZABLE.map((m) => m.opponent))].filter(Boolean);
for (const m of QUIZZABLE) {
  if (!m.opponent) continue;
  const rnd = rngFor(`op:${m.id}`);
  const wrong = seededShuffle(allOpponents.filter((o) => o !== m.opponent), rnd).slice(0, 3);
  if (wrong.length < 3) continue;
  const stem = m.venue === "Home"
    ? `Who came to Latimer Park on ${longDate(m.date)}?`
    : `Where were the Poppies on ${longDate(m.date)}? Away at which club?`;
  push(finish("opponent", stem, m.opponent, wrong, `It finished ${m.us}-${m.them}.`));
}

/* --- 6. the record books ------------------------------------------------ */

/* Distractors always come from sibling entries, so a scoreline sits beside
   scorelines and a fee beside fees. Anything whose siblings do not match in
   shape is skipped rather than guessed at. */
const shapeOf = (v) => (/^\d+-\d+/.test(v) ? "score" : /£/.test(v) ? "money" : /^[\d,]+ v /.test(v) ? "gate" : "text");

for (const rec of facts.records || []) {
  const siblings = (facts.records || [])
    .filter((r) => r !== rec && shapeOf(r.value) === shapeOf(rec.value))
    .map((r) => r.value);
  if (siblings.length < 3) continue;
  const wrong = seededShuffle(siblings, rngFor(`rc:${rec.label}`)).slice(0, 3);
  push(finish("fact", `Kettering Town's ${rec.label.toLowerCase()} is…`, rec.value, wrong, rec.detail));
}

for (const h of facts.honours || []) {
  for (const win of h.wins || []) {
    const years = [...win.matchAll(/\b(19|20)\d{2}(?:-\d{2})?\b/g)].map((x) => x[0]);
    if (years.length !== 1) continue;                 // ambiguous, skip rather than guess
    const year = years[0];
    const others = (facts.honours || [])
      .flatMap((o) => o.wins || [])
      .flatMap((w) => [...w.matchAll(/\b(19|20)\d{2}(?:-\d{2})?\b/g)].map((x) => x[0]))
      .filter((y) => y !== year);
    if (new Set(others).size < 3) continue;
    const wrong = seededShuffle([...new Set(others)], rngFor(`hn:${h.competition}:${win}`)).slice(0, 3);
    const what = win.replace(/\s*\b(19|20)\d{2}(-\d{2})?\b\s*/g, " ").replace(/,\s*$/, "").trim();
    push(finish("fact", `${h.competition}: when were Kettering ${what.toLowerCase()}?`, year, wrong));
  }
}

for (const man of facts.managers?.notable || []) {
  const others = (facts.managers.notable || []).filter((o) => o.name !== man.name).map((o) => o.years);
  if (others.length < 3) continue;
  const wrong = seededShuffle([...new Set(others)], rngFor(`mg:${man.name}`)).slice(0, 3);
  if (wrong.length < 3) continue;
  push(finish("fact", `When did ${man.name} manage Kettering Town?`, man.years, wrong, man.detail));
}

/* --- 7. this season's squad --------------------------------------------- */

const POSITIONS = ["Goalkeeper", "Defender", "Midfielder", "Striker"];
for (const p of squad.players || []) {
  const wrong = POSITIONS.filter((x) => x !== p.position);
  if (wrong.length !== 3) continue;
  push(finish("position", `What position does ${p.name} play?`, p.position, wrong,
    `${p.name} wears number ${p.number}.`));
}

/* Hand-written questions, for anything the data cannot reach. Same shape,
   same validation - a malformed one fails the build rather than shipping. */
for (const q of extra.questions || []) {
  if (!q.q || !Array.isArray(q.a) || q.a.length !== 4) {
    throw new Error(`quiz-extra.json: "${q.q || "(no question)"}" needs exactly four options.`);
  }
  const correct = q.a[q.c];
  if (correct === undefined) throw new Error(`quiz-extra.json: "${q.q}" has no valid answer index.`);
  push(finish(q.type || "extra", q.q, correct, q.a.filter((_, i) => i !== q.c), q.note));
}

/* ---------------------------------------------------------------- validate */

const problems = [];
const seen = new Map();
for (const q of questions) {
  const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
  if (q.a.length !== 4) problems.push(`${q.id} has ${q.a.length} options`);
  if (new Set(q.a.map(norm)).size !== 4) problems.push(`${q.id} has a duplicate option: ${q.a.join(" / ")}`);
  if (q.c < 0 || q.c > 3) problems.push(`${q.id} has no correct answer among its options`);
  if (q.a.some((o) => !o || /^(n\/a|tbc|unknown)$/i.test(o))) problems.push(`${q.id} has an empty or placeholder option`);
  if (seen.has(q.id) && seen.get(q.id) !== q.q) problems.push(`${q.id} is used by two different questions`);
  seen.set(q.id, q.q);
}
if (problems.length) {
  console.error("Refusing to write a bank with bad questions:");
  problems.slice(0, 20).forEach((p) => console.error(`  ${p}`));
  process.exit(1);
}

/* Same id generated twice from identical content is fine - dedupe silently. */
const generated = [...new Map(questions.map((q) => [q.id, q])).values()];

/* ------------------------------------------------- slots, frozen and stable */

const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : { questions: [], schedule: {}, nextSlot: 0 };
const oldSlots = new Map((previous.questions || []).map((q) => [q.id, q.slot]));
let nextSlot = previous.nextSlot || 0;

/**
 * A question that has already been asked stays in the bank even if it would no
 * longer be generated.
 *
 * The league does correct results, and a corrected score changes a question's
 * wording, which changes its id - so the old one simply stops being produced.
 * Without this, every published day pointing at it would dangle and the build
 * would refuse for good, twenty minutes at a time, until somebody noticed.
 *
 * Keeping it is also the truthful option: supporters answered the question as
 * it was put to them, and their score is against that. The correction belongs
 * in the days that have not happened yet.
 */
const todayForCarry = londonToday();
const publishedIds = new Set(
  Object.entries(previous.schedule || {})
    .filter(([iso]) => iso <= todayForCarry)
    .flatMap(([, ids]) => ids)
);
const madeNow = new Set(generated.map((q) => q.id));
const carried = (previous.questions || [])
  .filter((q) => publishedIds.has(q.id) && !madeNow.has(q.id))
  .map((q) => ({ ...q, retired: true }));

/* Carried questions keep their place in the bank but are never dealt again:
   the calendar below skips anything marked retired. */
const unique = [...generated, ...carried];

/* Slots are append-only. A question keeps the one it was given, and a new one
   gets a fresh number, so the ordering the calendar is built from never moves
   under a day that has already been published. */
for (const q of unique) {
  if (oldSlots.has(q.id)) q.slot = oldSlots.get(q.id);
  else { q.slot = nextSlot; nextSlot += 1; }
}
unique.sort((a, b) => a.slot - b.slot);
const byId = new Map(unique.map((q) => [q.id, q]));

/* ---------------------------------------------------------- the calendar */

const today = londonToday();
const startDay = 1;
const endDay = Math.max(dayNumber(today) + HORIZON, HORIZON);
const oldSchedule = previous.schedule || {};
const schedule = {};

const recentlyUsed = (iso) => {
  const n = dayNumber(iso);
  const out = new Set();
  for (let k = Math.max(1, n - COOLDOWN); k < n; k += 1) {
    (schedule[dateForDay(k)] || []).forEach((id) => out.add(id));
  }
  return out;
};

let recycled = 0;
for (let n = startDay; n <= endDay; n += 1) {
  const iso = dateForDay(n);

  /* Days already played are history. Copy them through untouched, and never
     mind that a better question exists now - somebody has that score. */
  if (iso <= today && oldSchedule[iso]) {
    schedule[iso] = oldSchedule[iso];
    continue;
  }

  const rnd = rngFor(`poppies-daily:${QUIZ_EPOCH}:${iso}`);
  const recent = recentlyUsed(iso);
  const picked = [];
  const used = new Map();

  for (let slot = 0; slot < PER_DAY; slot += 1) {
    const room = (q) => (used.get(q.type) || 0) < MAX_PER_TYPE;
    const live = unique.filter((q) => !q.retired);
    let pool = live.filter((q) => !recent.has(q.id) && !picked.includes(q.id) && room(q));
    /* Only one kind left within its cooldown: take it rather than repeat a
       question. A day of three scorelines beats a day that asks the same
       thing twice. */
    if (!pool.length) pool = live.filter((q) => !recent.has(q.id) && !picked.includes(q.id));
    /* Everything is inside its cooldown. The bank is genuinely exhausted from
       here, and the honest move is to say so in the build log rather than
       quietly serve the same five round again. */
    if (!pool.length) {
      pool = live.filter((q) => !picked.includes(q.id));
      recycled += 1;
    }
    if (!pool.length) break;
    const pick = seededShuffle(pool, rnd)[0];
    picked.push(pick.id);
    used.set(pick.type, (used.get(pick.type) || 0) + 1);
  }
  if (picked.length === PER_DAY) schedule[iso] = picked;
}

/* The real guarantee. Not the seeded shuffle - this. */
const changed = Object.keys(oldSchedule)
  .filter((iso) => iso <= today)
  .filter((iso) => (schedule[iso] || []).join(",") !== oldSchedule[iso].join(","));
if (changed.length) {
  console.error("Refusing to rewrite days that have already been played:");
  changed.slice(0, 10).forEach((iso) => console.error(`  ${iso}: was [${oldSchedule[iso]}], would become [${schedule[iso]}]`));
  console.error("A published question was edited or removed. Add a new one instead.");
  process.exit(1);
}

/* Every scheduled id must resolve, or a supporter gets a four-question quiz. */
const dangling = Object.entries(schedule).filter(([, ids]) => ids.some((id) => !byId.has(id)));
if (dangling.length) {
  console.error(`Refusing to write: ${dangling.length} day(s) reference a question that no longer exists.`);
  console.error(`  first: ${dangling[0][0]} -> ${dangling[0][1].filter((id) => !byId.has(id))}`);
  process.exit(1);
}

/* --------------------------------------------------------------- write it */

const payload = {
  built: new Date().toISOString(),
  epoch: QUIZ_EPOCH,
  nextSlot,
  note: "Built by scripts/build-quiz.mjs. Days on or before the build date are frozen and never rewritten.",
  questions: unique,
  schedule,
};
writeFileSync(OUT, JSON.stringify(payload) + "\n", "utf8");

const counts = unique.reduce((a, q) => ({ ...a, [q.type]: (a[q.type] || 0) + 1 }), {});
const days = Object.keys(schedule).length;
console.log(`Wrote ${OUT}`);
console.log(`  ${unique.length} questions: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}`);
console.log(`  ${days} days scheduled, ${Math.floor(unique.filter((q) => !q.retired).length / PER_DAY)} days' worth before anything repeats`);
if (recycled) console.log(`  ${recycled} slot(s) had to reuse a question early - the bank needs topping up`);
