/**
 * The furnace F-110 plan and PMS into a new project.
 *
 *   npm run furnace:load -- <your email> [--code F10] [--data-date YYYY-MM-DD]
 *
 * data/f10/F10.xml   the MS Project plan (F10.mpp saved as MSPDI XML; the
 *                    .mpp is kept beside it as handed over)
 * data/f10/pms.xlsx  the PMS: OLF1 and OLF2, 875 weighted steps
 *
 * The plan names one furnace (F-110) and no plant; the PMS has the furnace
 * in both OLF1 and OLF2. The owner decided (2026-10-10, lib/controls/f10.mjs):
 * the plan is OLF1's, the PMS is measured as of the day it is applied (or
 * --data-date), and the Secondary TLE is E-1110. On a project already loaded,
 * only those decisions are applied.
 */
import "./env.mjs";
import { readFile } from "node:fs/promises";
import { getDb } from "../lib/server/db.mjs";
import { createProject, addMember } from "../lib/db/repos/projects.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { importSchedule, importPms } from "../lib/db/repos/pms.mjs";
import { proposeAssumption } from "../lib/db/repos/assumptions.mjs";
import { applyF10Decisions } from "../lib/controls/f10.mjs";

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const code = opt("--code") || "F10";
// The owner's decision: the PMS is measured as of the day it is applied.
const dataDate = opt("--data-date") || new Date().toISOString().slice(0, 10);
const [email] = args;
if (!email) { console.error("usage: npm run furnace:load -- <email> [--code F10] [--data-date YYYY-MM-DD]"); process.exit(2); }

const NAME = "F10 — Ethylene Plant Expansion: Cracking Furnace F-110 (OLF1/OLF2)";
const xml = await readFile("data/f10/F10.xml");
const xls = await readFile("data/f10/pms.xlsx");

const db = await getDb();
const { rows: [me] } = await db.query("SELECT id FROM app_user WHERE lower(email) = lower($1)", [email]);
if (!me) { console.error(`no account for ${email} — run npm run auth:admin first`); process.exit(1); }
const { rows: [taken] } = await db.query("SELECT id FROM project WHERE code = $1", [code]);
if (taken) {
  // Already loaded: apply only the owner's decisions to it.
  const done = await withProject(db, taken.id, (tx) => applyF10Decisions(tx, { projectId: taken.id, userId: me.id, dataDate }));
  console.log(`PROJECT ${code} exists — owner's decisions:`);
  for (const d of done.length ? done : ["(already applied)"]) console.log(`  ${d}`);
  process.exit(0);
}

const project = await createProject(db, { code, name: NAME, ownerUserId: me.id });
await addMember(db, { projectId: project.id, userId: me.id, role: "admin" });
const r = await withProject(db, project.id, async (tx) => {
  const s = await importSchedule(tx, { projectId: project.id, userId: me.id, sourceName: "F10.mpp (as XML)", content: xml });
  const p = await importPms(tx, { projectId: project.id, userId: me.id, sourceName: "pms.xlsx", content: xls,
    linkWithin: "OLF1" });
  await proposeAssumption(tx, { projectId: project.id, userId: me.id, category: "برنامه‌ریزی",
    description: "برنامهٔ زمان‌بندی F10.mpp (کورهٔ F-110) برنامهٔ کورهٔ واحد OLF1 است و آیتم‌های PMS شاخهٔ OLF1 به آن پیوند داده شده‌اند.",
    value: "OLF1", source: "F10.mpp: عنوان «Ethylene Plant Expansion - Civil, Steel Structure & Furnaces Works»، فقط F-110؛ pms.xlsx: F110 در OLF1 و OLF2",
    owner: "کنترل پروژه", impact: "high",
    risk: "اگر برنامه مال OLF2 یا مشترک باشد، منحنی برنامه و مقایسه با پیشرفت برای شاخهٔ اشتباه حساب شده است؛ OLF2 هیچ برنامه‌ای ندارد." });
  const decisions = await applyF10Decisions(tx, { projectId: project.id, userId: me.id, dataDate });
  return { s, p, decisions };
});
console.log(`PROJECT ${code} — ${NAME}`);
console.log(`  schedule: ${r.s.tasks} tasks, ${r.s.links} links`);
console.log(`  PMS: ${r.p.steps} steps · stated ${(r.p.stated * 100).toFixed(4)}% · computed ${(r.p.computed * 100).toFixed(4)}% · ${r.p.problems} inconsistencies`);
console.log(`  linked to the plan: ${r.p.linked} of ${r.p.elements} OLF1 elements`);
for (const d of r.decisions) console.log(`  ${d}`);
process.exit(0);
