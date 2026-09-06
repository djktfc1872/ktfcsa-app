/**
 * The deck's numbers, frozen to a file.
 *
 * The deck is presented from a laptop in a pub, and its headline figures come
 * from Supabase at render time. On a bad connection the consultation slide
 * renders "Numbers unavailable" in front of the room, which is the one failure
 * this presentation cannot absorb: the whole argument is the data.
 *
 * So the figures are written out here and shipped as a file the service worker
 * precaches. Live still wins when it answers; this is what the deck falls back
 * to when it does not. Run it immediately before leaving.
 *
 *     node scripts/build-deck-snapshot.mjs
 */
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL_BASE = "https://fgbvbenxiyclkujuabgx.supabase.co/rest/v1";
const KEY = "sb_publishable_hGdWCAq4JkzLn---P185Iw_TDSjtzTg";
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "deck-snapshot.json");

async function get(path) {
  const res = await fetch(`${URL_BASE}/${path}`, { headers: { apikey: KEY } });
  if (!res.ok) throw new Error(`${path} responded ${res.status}`);
  return res.json();
}

const [summary, confidence, choices, representation, questions, board, meeting] =
  await Promise.all([
    get("consultation_summary?select=*"),
    get("consultation_confidence?select=*"),
    get("consultation_choices?select=*"),
    get("consultation_representation?select=*"),
    get("consultation_questions_public?select=id,label,origin,asked_at,replied_at,answered_at&order=sort"),
    get("meeting_question_board?select=id,kind,body,backers,helpers,author_name"),
    get("meeting_counts?select=*"),
  ]);

const payload = {
  built: new Date().toISOString(),
  note:
    "Written by scripts/build-deck-snapshot.mjs. The deck falls back to this when the " +
    "database cannot be reached, so that a bad connection in a function room does not " +
    "empty the slides. Live figures win whenever they answer.",
  results: {
    summary: summary[0] || null,
    confidence, choices, representation,
  },
  questions,
  board,
  meeting: meeting[0] || null,
};

await writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");

const answered = questions.filter((q) => q.answered_at).length;
console.log(`Wrote ${OUT}`);
console.log(`  ${summary[0]?.responses} responses, ${questions.length} questions ` +
            `(${answered} answered), ${board.length} on the board`);
