/**
 * The workspace's Validation tab: ONE list of what the existing checks already say, nothing new decided here.
 *
 * Sources (each is a function that already runs on the page):
 *   register   the typed list's problems (lib/register/weld-list.mjs) — block saving
 *   sheet      duplicate / missing numbers (markup.problems) and marks not yet placed on the drawing (notOnSheet)
 *   weld parts weld components against the BOM (componentChecks)
 *   equipment  installation equipment against the BOM, welds and spools (equipmentChecks)
 *   bom        a row named by more welds than it has ends (allocationChecks); rows without PT / description / qty (bom-table rowIssues)
 *   cut        the cut table against the sheet (cutChecks) and against the BOM (cutVsBom)
 *
 * A finding carries `ref` (a mark's persistent uid, else its legacy id — markRef) ONLY when it can be pointed at exactly:
 * the unnumbered / duplicated / unplaced marks, and the checks whose message starts «سرجوش <no>:» or «تجهیز <no>:» for a
 * number that is on the sheet once. Anything else is listed without a link — never guessed.
 */
import { KINDS, isPlaced, markRef, problems as sheetProblems } from "../sheet/markup.mjs";
import { componentChecks, equipmentChecks } from "../sheet/markup.mjs";
import { allocationChecks } from "./bom-allocation.mjs";
import { rowIssues } from "./bom-table.mjs";
import { cutChecks } from "./cut-model.mjs";
import { cutVsBom } from "./cut-bom.mjs";

const text = (v) => String(v ?? "").trim();

/** The mark a message about «سرجوش 3:» / «تجهیز E1:» is about, when that number is on the sheet exactly once. */
export function refFromMessage(items, message) {
  const m = /^(سرجوش|تجهیز) (.+?): /.exec(text(message));
  if (!m) return null;
  const cls = m[1] === "سرجوش" ? "weld" : "equipment";
  const hit = (items || []).filter((x) => KINDS[x.kind]?.cls === cls && text(x.no) === m[2]);
  return hit.length === 1 ? markRef(hit[0]) : null;
}

/**
 * @param {{ items?: object[], bom?: object[], bomRows?: object[], cutRows?: object[], cutLengths?: object[], registerProblems?: string[] }} o
 * @returns {{ findings: Array<{ source: string, level: "error"|"warn", message: string, ref: string|null }>, counts: object, total: number }}
 */
export function collectFindings({ items = [], bom = [], bomRows = [], cutRows = [], cutLengths = [], registerProblems = [] } = {}) {
  const out = [];
  const add = (source, level, message, ref = null) => out.push({ source, level, message, ref });

  for (const p of registerProblems) add("register", "error", p);

  // sheet marks: pointed at exactly
  const seen = new Map();
  for (const m of items) {
    const label = KINDS[m.kind]?.label || m.kind;
    if (!text(m.no)) { add("sheet", "error", `یک ${label} شماره ندارد`, markRef(m)); continue; }
    const k = `${KINDS[m.kind]?.cls}|${m.no}`;
    if (seen.has(k)) { add("sheet", "error", `${label} «${m.no}» دو بار روی نقشه هست`, markRef(m)); }
    seen.set(k, true);
    if (!isPlaced(m)) add("sheet", "warn", `${label} «${m.no}» هنوز روی نقشه جا ندارد`, markRef(m));
  }
  // keep sheetProblems in step: a message it raises that the loop above did not is still shown (without a link)
  const have = new Set(out.filter((f) => f.source === "sheet").map((f) => f.message));
  for (const p of sheetProblems(items)) if (!have.has(p)) add("sheet", "error", p);

  for (const p of componentChecks(items, bom)) add("weld parts", "warn", p, refFromMessage(items, p));
  for (const p of equipmentChecks(items, bom)) add("equipment", "warn", p, refFromMessage(items, p));
  for (const p of allocationChecks(items, bom)) add("bom", "warn", p);
  bomRows.forEach((r) => { for (const p of rowIssues(r, bomRows)) add("bom", "warn", `BOM PT ${text(r?.pt) || "؟"}: ${p}`); });
  for (const p of cutChecks(cutRows, items)) add("cut", "warn", p);
  for (const p of cutVsBom(cutLengths, bom).problems) add("cut", "warn", p);

  const counts = {};
  for (const f of out) counts[f.source] = (counts[f.source] || 0) + 1;
  return { findings: out, counts, total: out.length };
}
