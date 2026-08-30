/**
 * Does schema.sql work on a database that has never seen it?
 *
 * It runs top to bottom, and on Danny's database everything it needs is
 * already there from the last run, so an out-of-order file passes every time
 * it is used and fails the first time it actually matters: a fresh project, a
 * test instance, a restore.
 *
 * That has happened four times. A moderator function called by a policy three
 * hundred lines above where it is defined. A column added at the end of the
 * file and read by a view in the middle. Another one added below the view that
 * exposes it. A table read by an update written above the line that creates
 * it. Every one of them was found by eye, and only because somebody happened
 * to look.
 *
 *     node scripts/check-schema.mjs
 *
 * Exits non-zero with the line numbers if anything is used before it exists.
 */
import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "supabase", "schema.sql");

/** Comments and string literals are not code and must not count as a use. */
function strip(sql) {
  return sql
    .replace(/\$\$[\s\S]*?\$\$/g, (m) => "\n".repeat((m.match(/\n/g) || []).length))
    .replace(/--[^\n]*/g, "")
    .replace(/'(?:[^']|'')*'/g, "''");
}

/* Function bodies are dollar-quoted and Postgres does not resolve what is
   inside them until they run, so a function may safely call something defined
   later. They are blanked above, which is why. Everything outside one is
   resolved as the file is read, and is what this checks. */

function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

const raw = await readFile(FILE, "utf8");
const sql = strip(raw);

/** Where each thing comes into existence, by name, earliest wins. */
const defined = new Map();
const note = (name, index, kind) => {
  const key = name.toLowerCase();
  if (!defined.has(key)) defined.set(key, { index, kind });
};

for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
  note(m[1], m.index, "table");
}
for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?view\s+([a-z_][a-z0-9_]*)/gi)) {
  note(m[1], m.index, "view");
}
for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)/gi)) {
  note(m[1], m.index, "function");
}
/* Columns bolted on after the fact. The ones that have caused every incident:
   a plain column in a create table is fine, because the table has to exist
   before anything reads it anyway. */
const columns = new Map();

/* The body of each create table, so a column that is declared there and then
   re-added defensively with "if not exists" is not reported as arriving late.
   It arrived with the table. */
const tableBodies = new Map();
for (const m of sql.matchAll(
  /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)\s*\(([\s\S]*?)\n\);/gi)) {
  tableBodies.set(m[1].toLowerCase(), { body: m[2].toLowerCase(), index: m.index });
}

for (const m of sql.matchAll(
  /alter\s+table\s+([a-z_][a-z0-9_]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
  const table = m[1].toLowerCase();
  const col = m[2].toLowerCase();
  const key = `${table}.${col}`;
  if (columns.has(key)) continue;

  const t = tableBodies.get(table);
  if (t && new RegExp(`^\\s*${col}\\s`, "m").test(t.body)) continue;   // already in the table

  columns.set(key, { index: m.index, table, col });
}

const problems = [];

/* ---- a thing used before it exists --------------------------------------- */

const USES = [
  [/\bfrom\s+([a-z_][a-z0-9_]*)/gi, "read"],
  [/\bjoin\s+([a-z_][a-z0-9_]*)/gi, "joined"],
  [/\bupdate\s+([a-z_][a-z0-9_]*)/gi, "updated"],
  [/\binsert\s+into\s+([a-z_][a-z0-9_]*)/gi, "inserted into"],
  [/\bdelete\s+from\s+([a-z_][a-z0-9_]*)/gi, "deleted from"],
  [/\breferences\s+([a-z_][a-z0-9_]*)/gi, "referenced"],
  [/\balter\s+table\s+([a-z_][a-z0-9_]*)/gi, "altered"],
  [/\bon\s+([a-z_][a-z0-9_]*)\s+for\s+(?:select|insert|update|delete|all)/gi, "given a policy"],
];

for (const [re, verb] of USES) {
  for (const m of sql.matchAll(re)) {
    const name = m[1].toLowerCase();
    const def = defined.get(name);
    if (!def) continue;                       // not ours: auth.users, pg_catalog, a CTE
    if (m.index >= def.index) continue;
    problems.push(
      `line ${lineOf(sql, m.index)}: ${name} is ${verb} here, but the ${def.kind} is not ` +
      `created until line ${lineOf(sql, def.index)}`);
  }
}

/* Functions called outside a body: policies, defaults, view expressions. */
for (const [name, def] of defined) {
  if (def.kind !== "function") continue;
  const re = new RegExp(`\\b${name}\\s*\\(`, "gi");
  for (const m of sql.matchAll(re)) {
    if (m.index >= def.index) continue;
    /* The definition itself, and its own revoke/grant lines, are not calls. */
    const before = sql.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
    if (/(create|replace|revoke|grant|execute\s+on)\s*(function)?\s*$/.test(before)) continue;
    problems.push(
      `line ${lineOf(sql, m.index)}: ${name}() is called here, but is not defined ` +
      `until line ${lineOf(sql, def.index)}`);
  }
}

/* ---- a column read before it is added ------------------------------------ */

for (const [, c] of columns) {
  /* Only statements that mention the table: a bare column name like "points"
     or "origin" appears all over a file this size and would be all noise. */
  const stmts = sql.split(";");
  let at = 0;
  for (const stmt of stmts) {
    const start = at;
    at += stmt.length + 1;
    if (start >= c.index) continue;
    const s = stmt.toLowerCase();
    if (!s.includes(c.table)) continue;
    /* The alter itself, and dropping the column, are not reads. */
    if (/alter\s+table/.test(s) || /drop\s+column/.test(s)) continue;
    const hit = new RegExp(`\\b${c.col}\\b`).exec(s);
    if (!hit) continue;
    problems.push(
      `line ${lineOf(sql, start + hit.index)}: ${c.table}.${c.col} is used here, but the ` +
      `column is not added until line ${lineOf(sql, c.index)}`);
  }
}

/* ---- defined twice -------------------------------------------------------
   Not an ordering fault, so it does not fail the run, but a view written out
   twice means one of them is dead and nobody knows which is live without
   counting lines. admin_overview has been in that state for a while. */

const twice = new Map();
for (const m of sql.matchAll(/create\s+(?:or\s+replace\s+)?(view|table)\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi)) {
  const key = m[2].toLowerCase();
  twice.set(key, [...(twice.get(key) || []), lineOf(sql, m.index)]);
}
const dupes = [...twice].filter(([, lines]) => lines.length > 1);

/* ---- say so -------------------------------------------------------------- */

const seen = new Set();
const unique = problems.filter((p) => (seen.has(p) ? false : seen.add(p)));

if (dupes.length) {
  console.warn("Defined more than once. The last one wins and the rest are dead:\n");
  dupes.forEach(([name, lines]) => console.warn(`  ${name}: lines ${lines.join(", ")}`));
  console.warn("");
}

if (!unique.length) {
  console.log(
    `schema.sql: ${defined.size} tables, views and functions, ${columns.size} added columns. ` +
    `Nothing is used before it exists.`);
  process.exit(0);
}

console.error(`schema.sql would fail on a fresh database:\n`);
unique.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .forEach((p) => console.error(`  ${p}`));
console.error(`\n${unique.length} problem${unique.length === 1 ? "" : "s"}.`);
process.exit(1);
