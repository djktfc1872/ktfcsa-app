/**
 * Has the club's Officials page changed since we last looked?
 *
 * One of the questions put to the club is that its website is not maintained
 * and the Officials page is inaccurate. A claim like that is worth nothing
 * without a dated copy of what the page actually said, and worth a great deal
 * with one — so data/club-officials.json is a transcript, not a summary, and
 * this compares it against the page as it stands today.
 *
 *     node scripts/check-officials.mjs           # report differences
 *     node scripts/check-officials.mjs --write   # and record today's version
 *
 * Deliberately dumb about parsing. It pulls the visible text, strips it to
 * names and roles, and compares sets: a club redesigning its site should show
 * up as "everything changed" and prompt a human to look, rather than silently
 * matching nothing and reporting all clear.
 */
import { readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, "..", "data", "club-officials.json");

const stored = JSON.parse(await readFile(FILE, "utf8"));
const res = await fetch(stored.source, {
  headers: { "user-agent": "KTFCSA-app/1.0 (+supporters association; checking a published page)" },
});
if (!res.ok) {
  console.error(`${stored.source} responded ${res.status}. Nothing changed here.`);
  process.exit(1);
}
const html = await res.text();

/* Tags out, entities back, whitespace flattened. */
const text = html
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, "\n")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
  .replace(/&#8217;|&rsquo;/g, "’")
  .split("\n").map((l) => l.trim()).filter(Boolean).join("\n");

const namesOf = (s) => new Set(
  s.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w.length > 2));

const live = namesOf(text);
const known = stored.groups.flatMap((g) => g.rows);

/* A person counts as still on the page if any part of their surname is. The
   page's text is stripped to plain letters, so a double-barrelled surname
   arrives as two words and matching the hyphenated form against it found
   nothing — which reported a serving officer as departed. */
const surnameParts = (name) =>
  name.trim().split(/\s+/).pop().toLowerCase().split(/[^a-z]+/).filter(Boolean);

const missing = known.filter((r) => {
  if (r.who === "TBA") return false;
  return !r.who.split(/[,&]/).flatMap((n) => surnameParts(n)).some((part) => live.has(part));
});

console.log(`Recorded ${stored.checked} from ${stored.source}`);
console.log(`${known.length} roles on file, ${known.filter((r) => r.who === "TBA").length} of them TBA.\n`);

if (!missing.length) {
  console.log("Everyone on file is still named on the page.");
} else {
  console.log("On file but no longer found on the page:\n");
  missing.forEach((r) => console.log(`  ${r.role}: ${r.who}`));
  console.log("\nCheck it by eye before believing it — a site redesign looks the same as a clear-out.");
}

if (process.argv.includes("--write")) {
  stored.checked = new Date().toISOString().slice(0, 10);
  await writeFile(FILE, JSON.stringify(stored, null, 2) + "\n");
  console.log(`\nStamped as checked ${stored.checked}. The rows themselves are edited by hand,`);
  console.log("on purpose: this file is a transcript and a script should not rewrite one.");
}
