/**
 * Shared bits of Poppies Daily.
 *
 * Imported by both the app and scripts/build-quiz.mjs, the same way
 * fetch-league.mjs imports TEAMS from data.js. One copy on purpose: two
 * copies of a "deterministic" shuffle are not deterministic, they are two
 * shuffles that happen to agree until somebody edits one of them.
 */

/**
 * Poppies Daily #1: Saturday 22 August 2026, Peterborough Sports at home.
 * A daily game wants the biggest possible first day and that is a matchday.
 *
 * Moving this renumbers every day that has already been played, so once the
 * first supporter has a streak it does not move. Before it, the app says the
 * game has not started rather than showing a negative number.
 */
export const QUIZ_EPOCH = "2026-08-22";

/* ------------------------------------------------------------------ dates */

/**
 * The date in Kettering, whatever the device thinks it is.
 *
 * app.js has todayISO(), which is device-local and right for everything else.
 * It is wrong here: a supporter in Spain would roll over an hour early, get
 * tomorrow's five questions, and post a score against a number nobody else
 * has reached yet. Same Intl.formatToParts approach the fetch scripts already
 * use for kick-off times.
 */
export function londonToday(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
    .formatToParts(d)
    .filter((p) => p.type !== "literal");
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/** An ISO date to a UTC midnight, used only for counting whole days apart. */
const utcNoonless = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

/**
 * Which Poppies Daily a date is. Counted between civil dates rather than by
 * subtracting two instants, so the clocks going back in October cannot hand
 * out two #12s or skip one. The 25-hour day never enters the arithmetic.
 */
export function dayNumber(iso, epoch = QUIZ_EPOCH) {
  return Math.round((utcNoonless(iso) - utcNoonless(epoch)) / 86400000) + 1;
}

/** The ISO date a given Poppies Daily number falls on. The inverse of above. */
export function dateForDay(n, epoch = QUIZ_EPOCH) {
  return new Date(utcNoonless(epoch) + (n - 1) * 86400000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------- randomness */

/**
 * xfnv1a: a string to a 32-bit seed. Hashing the whole seed string, rather
 * than seeding with a day number, means changing the epoch reshuffles cleanly
 * instead of sliding everything along by one.
 */
export function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * mulberry32. Small, fast, and identical in every JavaScript engine because it
 * only ever does 32-bit integer arithmetic and one divide at the end.
 * Math.random() would be fine for a shuffle and useless here: the whole point
 * is that two phones in two different pubs deal the same five questions.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against a seeded generator. Does not touch the input. */
export function seededShuffle(items, rnd) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A generator seeded from a string, which is how every caller wants it. */
export const rngFor = (key) => mulberry32(hashSeed(key));
