#!/usr/bin/env node
/**
 * The old Access daily report's list of roles, machines and materials, as a
 * catalogue the platform can import (lib/reports/catalog.mjs decides what
 * each row becomes, and what is wrong with it).
 *
 *   mdb-export "daily report.accdb" manp_list > manp_list.csv      (mdbtools)
 *   mdb-export "daily report.accdb" GRP_MANP  > GRP_MANP.csv
 *   node tools/daily-access-catalog.mjs <dir with those CSVs> <out.json>
 *
 * Only these two tables are read: names of roles and items, their groups and
 * units. Nothing about people (users, passwords, national IDs) is touched.
 */
import { readFile, writeFile } from "node:fs/promises";
import XLSX from "xlsx";
import { fromAccess, KIND } from "../lib/reports/catalog.mjs";

const [dir, out] = process.argv.slice(2);
if (!dir || !out) { console.error("usage: node tools/daily-access-catalog.mjs <csv dir> <out.json>"); process.exit(2); }
const csv = async (name) => {
  const wb = XLSX.read(await readFile(`${dir}/${name}.csv`, "utf8"), { type: "string", raw: true });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
};
const r = fromAccess(await csv("manp_list"), await csv("GRP_MANP"));
const byKind = Object.fromEntries(Object.keys(KIND).map((k) => [k, r.items.filter((i) => i.kind === k).length]));
await writeFile(out, JSON.stringify({ source: "daily report.accdb · manp_list", items: r.items, problems: r.problems,
  duplicates: r.duplicates, skipped: r.skipped }, null, 1) + "\n");
console.log(`${r.items.length} items ${JSON.stringify(byKind)} · ${r.duplicates} duplicate names merged · ${r.skipped} skipped · ${r.problems.length} problems`);
