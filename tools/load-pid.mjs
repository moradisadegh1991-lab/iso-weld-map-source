/**
 * A read P&ID set into a new project.
 *
 *   node tools/load-pid.mjs <registers.json> <your email> [--code K110] [--titles titles.json]
 *
 * registers.json is tools/pid-registers.mjs output. titles.json, optional,
 * maps a drawing number to its title as a person read it off the sheet —
 * the OCR joins words the drawing spaces ("CRACKINGFURNACES").
 *
 * The unit and its sections are the ones the set's own legend sheet prints
 * (K110-30-PID-0021-00-01, «PROCESS SECTION INCLUDED IN THE PLANT»).
 */
import "./env.mjs";
import { readFile } from "node:fs/promises";
import { getDb } from "../lib/server/db.mjs";
import { createProject, addMember } from "../lib/db/repos/projects.mjs";
import { withProject } from "../lib/db/scope.mjs";
import { loadPidSet } from "../lib/pid/load.mjs";
import { SECTIONS } from "../lib/pid/legend-k110.mjs";

export const K110 = {
  name: "K110 — Ethane Cracking Plant / Kavian Olefin Plant (P&ID as-built)",
  originator: "NARGAN Engineers & Constructors (contractor) · owner: Bakhtar / Kavian Petrochemical Co.",
  unit: { code: "30", name: "Ethane Cracking Plant" },
  sections: SECTIONS, // as printed on K110-30-PID-0021-00-01
};

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args.splice(i, 2)[1] : null; };
const code = opt("--code") || "K110";
const titlesFile = opt("--titles");
const [regFile, email] = args;
if (!regFile || !email) {
  console.error("usage: node tools/load-pid.mjs <registers.json> <your email> [--code K110] [--titles titles.json]");
  process.exit(2);
}
const reg = JSON.parse(await readFile(regFile, "utf8"));
const docTitles = titlesFile ? JSON.parse(await readFile(titlesFile, "utf8")) : {};

const db = await getDb();
const { rows: [me] } = await db.query("SELECT id FROM app_user WHERE lower(email) = lower($1)", [email]);
if (!me) { console.error(`no account for ${email} — run npm run auth:admin first`); process.exit(1); }
const { rows: [taken] } = await db.query("SELECT id FROM project WHERE code = $1", [code]);
if (taken) { console.error(`project ${code} already exists — pass --code for a new one`); process.exit(1); }

const project = await createProject(db, { code, name: K110.name, ownerUserId: me.id });
await addMember(db, { projectId: project.id, userId: me.id, role: "admin" });
const report = await withProject(db, project.id, (tx) =>
  loadPidSet(tx, { projectId: project.id, userId: me.id }, reg, { ...K110, docTitles }));

console.log(`PROJECT ${code} — ${K110.name}`);
console.log(`  sections ${report.sections} · drawings ${report.drawings} (revisions issued ${report.revisions}, not issued ${report.revisionsNotIssued.length})`);
console.log(`  equipment ${report.equipment.tags} (unclassified ${report.equipment.unclassified.length}, unfiled ${report.equipment.unfiled.length})`);
console.log(`  lines ${report.lines} · instruments ${report.instruments.imported} (ISA problems ${report.instruments.problems.length})`);
process.exit(0);
