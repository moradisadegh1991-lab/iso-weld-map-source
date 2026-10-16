#!/usr/bin/env node
/**
 * Bring the old daily report's catalogue into a project.
 *
 *   node tools/load-daily-catalog.mjs [catalog.json] <project code>
 *
 * catalog.json defaults to data/daily-access/catalog.json (built by
 * tools/daily-access-catalog.mjs). Items the project already has are left as
 * they are; running it twice adds nothing the second time.
 */
import "./env.mjs";
import { readFile } from "node:fs/promises";
import { getDb } from "../lib/server/db.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { importCatalog } from "../lib/db/repos/catalog.mjs";

const args = process.argv.slice(2);
const code = args.pop();
const file = args[0] || new URL("../data/daily-access/catalog.json", import.meta.url).pathname;
if (!code) { console.error("usage: node tools/load-daily-catalog.mjs [catalog.json] <project code>"); process.exit(2); }
const c = JSON.parse(await readFile(file, "utf8"));
const db = await getDb();
const { rows: [p] } = await db.query("SELECT id FROM project WHERE code = $1", [code]);
if (!p) { console.error(`no project ${code}`); process.exit(1); }
const r = await withProject(db, p.id, () => importCatalog(db, { projectId: p.id, items: c.items, source: c.source }));
console.log(`${code}: ${r.added} added, ${r.kept} already there · ${c.problems.length} problems listed in ${file}`);
process.exit(0);
