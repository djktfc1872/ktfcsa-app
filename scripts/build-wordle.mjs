/**
 * Writes data/wordle-bank.json for Poppies Wordle.
 *
 * Prebuilt rather than worked out in the browser, for the same reason Poppies
 * Daily is: everybody has to get the same word on the same day, and a word
 * chosen at runtime from a list that changes when the squad changes would not
 * be the same word for somebody who opened the app an hour later.
 *
 * The list is hand-written and stays that way. Generating it from squad data
 * was the obvious idea and the wrong one: it produces this-season-only surnames
 * that mean nothing to somebody who last came regularly in the nineties, and an
 * unguessable word is worse than no game. Everything here should be gettable by
 * a supporter of any age, with a clue if they need one.
 *
 * Lengths run 4 to 9. Plain Wordle is stuck on five; a football club has too
 * many good longer words to throw away for the sake of a square grid.
 *
 *    node scripts/build-wordle.mjs
 */
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

/* word, then a clue shown only after a wrong guess or two. */
const WORDS = [
  ["POPPY",     "The one on the badge"],
  ["POPPIES",   "Us"],
  ["LATIMER",   "The park we play at"],
  ["KETTERING", "The town itself"],
  ["NORTHANTS", "The county"],
  ["ROCKY",     "The road the old ground was on"],
  ["LION",      "It is on the crest"],

  ["TERRACE",   "Where you stand"],
  ["TURNSTILE", "You go through it to get in"],
  ["FLOODLIT",  "A Tuesday night, in a word"],
  ["DUGOUT",    "Where the manager sits"],
  ["PITCH",     "The grass"],
  ["STAND",     "Seats, under a roof"],
  ["CROWD",     "The number in the ground"],
  ["STEWARD",   "High-vis, points you to your seat"],
  ["PROGRAMME", "A quid or two on the way in"],
  ["SCARF",     "Held above the head"],
  ["SHIRT",     "You probably own too many"],
  ["BADGE",     "Sewn on the chest"],
  ["STRIPES",   "What we play in"],

  ["OFFSIDE",   "The linesman's flag goes up"],
  ["PENALTY",   "Twelve yards"],
  ["KEEPER",    "The only one allowed to handle it"],
  ["STRIKER",   "Paid to score"],
  ["WINGER",    "Hugs the touchline"],
  ["CAPTAIN",   "Wears the armband"],
  ["MANAGER",   "Takes the blame"],
  ["HEADER",    "Scored without feet"],
  ["CORNER",    "From the flag"],
  ["EQUALISER", "Makes it all square"],
  ["HATTRICK",  "Three in one game"],
  ["KICKOFF",   "Three o'clock, usually"],
  ["FIXTURE",   "A game on the list"],
  ["HALFTIME",  "Bovril and a queue"],
  ["EXTRATIME", "When ninety minutes was not enough"],

  ["LEAGUE",    "The table we are in"],
  ["SOUTHERN",  "The league's first name"],
  ["SEASON",    "August to May"],
  ["PROMOTION", "Going up"],
  ["TROPHY",    "Silverware"],
  ["DERBY",     "The one you cannot lose"],
  ["AWAY",      "The long trip"],
  ["HOME",      "The short one"],
  ["GOAL",      "The point of it all"],
  ["DRAW",      "A point each"],
  ["REPLAY",    "A cup tie that would not settle"],

  ["CORBY",     "Up the road, and not our friends"],
  ["DIAMONDS",  "Rushden and\u2026"],
  ["STEELMEN",  "What Corby call themselves"],

  ["SUPPORTER", "You"],
  ["COACH",     "How a lot of us travel"],
  ["TICKET",    "Do not lose it"],
  ["CHANT",     "Sung from the terrace"],
  ["ANTHEM",    "Before a cup final"],
  ["WHISTLE",   "Ends it"],
  ["REFEREE",   "Never wrong, apparently"],
  ["LINESMAN",  "Runs the line"],
  ["BOOKING",   "The yellow one"],
  ["SENDOFF",   "The red one"],
  ["CLEANSHE",  null],   /* trimmed below: too contrived */
];

/* A deterministic shuffle, so the order is fixed once and the same for
   everybody, but not alphabetical. Seeded by hand and never changed: reshuffle
   it and somebody mid-streak gets a word they have already had. */
function shuffle(list, seed) {
  const out = list.slice();
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const clean = WORDS
  .filter(([w, clue]) => clue !== null)
  .map(([w, clue]) => [w.replace(/[^A-Z]/g, ""), clue])
  .filter(([w]) => w.length >= 4 && w.length <= 9);

const seen = new Set();
const unique = clean.filter(([w]) => (seen.has(w) ? false : seen.add(w)));

const bank = {
  built: new Date().toISOString().slice(0, 10),
  note:
    "Hand-written, not generated. Lengths 4 to 9. The order is a fixed shuffle, " +
    "so day N is always the same word for everybody and no word comes round " +
    "again until the list has been through.",
  words: shuffle(unique, 1872).map(([word, clue]) => ({ word, clue, len: word.length })),
};

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "wordle-bank.json");
await writeFile(OUT, JSON.stringify(bank, null, 2) + "\n");
console.log(`wordle-bank.json: ${bank.words.length} words, ` +
  `lengths ${Math.min(...bank.words.map((w) => w.len))}-${Math.max(...bank.words.map((w) => w.len))}`);
