/**
 * The cut table the sheet prints (CUT PIPE LENGTH) against the sheet's own BOM (owner's request of 2026-11-02, extended in Phase 9:
 * docs/audit/phase-9-spool-cutlist.md §5). Per pipe size — and, where BOTH sides say it, per material grade and schedule — how many
 * pieces, their total length, the metres the BOM lists as pipe, and what is theoretically left. It says what the numbers are and where
 * they disagree; it does not decide which is right.
 *
 *   over      the pieces add up to more than the compatible BOM pipe (more than the 0.05 m the sheets' own rounding gives)
 *   noBom     pieces of a size the BOM has no pipe row of in metres (a row counted in pieces is not metres; a fitting is not pipe)
 *   noSize    pieces whose size was not read
 *   material  / schedule   the piece names a grade / schedule and every pipe row of that size names a different one
 *
 * Compatibility: a piece with no material (schedule) is compatible with any row; a row with none is compatible with any piece; two
 * that both say it must say the same. Units: BOM metres ("m"; "mm" is converted); a row in any other unit is not a length.
 * A piece counted twice (same uid, or the same piece/length/size/ends with no uid) is counted once. More BOM than cut is normal and is
 * shown (remainingM), NOT treated as usable stock: whether leftover pipe may be used for another grade, line or sheet is a project rule.
 *
 * The result is a PREVIEW when computed from a draft; the server's saved BOM stays the authority (the Validation Center says which).
 */
import { sizesOf } from "./weld-marks.mjs";
import { gradeOf, scheduleOf } from "../sheet/markup.mjs";
import { isUid } from "../sheet/mark-identity.mjs";

const text = (v) => String(v ?? "").trim();
const norm = (v) => text(v).toUpperCase().replace(/[\s.]+/g, "");
const isPipe = (b) => /^PIPE\b/i.test(text(b?.group)) || /^PIPE\b/i.test(text(b?.description));
const TOL_M = 0.05;
const round3 = (n) => Math.round(n * 1000) / 1000;
const UNIT_TO_M = { m: 1, mm: 0.001 };
const metres = (b) => { const f = UNIT_TO_M[text(b?.qtyUnit).toLowerCase()]; const q = Number(b?.qty); return f != null && Number.isFinite(q) ? q * f : null; };
const compatible = (a, b) => !norm(a) || !norm(b) || norm(a) === norm(b);

/** The pieces that count: a positive length, each real piece once. */
function counted(cutLengths) {
  const seen = new Set(), out = [];
  for (const c of Array.isArray(cutLengths) ? cutLengths : []) {
    const len = Number(c?.lengthMm);
    if (!Number.isFinite(len) || len <= 0) continue;
    const key = isUid(c?.uid) ? `u:${c.uid.toLowerCase()}` : `p:${[c.piece, len, c.ns, c.from, c.to].map(text).join("|")}`;
    if (seen.has(key)) continue;
    seen.add(key); out.push({ c, len });
  }
  return out;
}

/** @returns the old shape plus { remainingM, material, schedule } on each size and a top-level `issues` */
export function cutBomReport(cutLengths = [], bom = []) {
  const by = new Map();
  let noSize = 0;
  for (const { c, len } of counted(cutLengths)) {
    const size = sizesOf(c?.ns)[0] ?? null, material = text(c?.material), schedule = text(c?.schedule);
    const k = `${size == null ? "?" : size}|${norm(material)}|${norm(schedule)}`;
    const g = by.get(k) || { size, material, schedule, pieces: 0, cutM: 0, uids: [] };
    g.pieces += 1; g.cutM += len / 1000; if (isUid(c.uid)) g.uids.push(c.uid); by.set(k, g);
    if (size == null) noSize += 1;
  }
  const pipeRows = (size) => (bom || []).filter((b) => isPipe(b) && size != null && sizesOf(b.diam ?? b.size)[0] === size)
    .map((b) => ({ b, m: metres(b), material: gradeOf(b.description), schedule: scheduleOf(b.description) }));
  const sizes = [], issues = [], problems = [], found = [];
  for (const g of by.values()) {
    const rows = pipeRows(g.size);
    const inM = rows.filter((r) => r.m != null);
    const fit = inM.filter((r) => compatible(g.material, r.material) && compatible(g.schedule, r.schedule));
    const bomM = fit.length ? round3(fit.reduce((t, r) => t + r.m, 0)) : null;
    const cutM = round3(g.cutM);
    const status = g.size == null ? "noSize" : !inM.length ? "noBom" : !fit.length ? "mismatch" : cutM > bomM + TOL_M ? "over" : "ok";
    let why = null;
    if (status === "mismatch") why = inM.some((r) => compatible(g.material, r.material)) ? "schedule" : "material";
    sizes.push({ size: g.size, material: g.material, schedule: g.schedule, pieces: g.pieces, cutM, bomM, remainingM: bomM == null ? null : round3(bomM - cutM), status, why,
      pts: rows.map((r) => Number(r.b.pt)).filter(Number.isInteger), uids: g.uids });
  }
  sizes.sort((a, b) => (b.size ?? -1) - (a.size ?? -1) || norm(a.material).localeCompare(norm(b.material)) || norm(a.schedule).localeCompare(norm(b.schedule)));

  // one BOM row serves every group it is compatible with: the groups of one size together may not exceed the metres of ALL rows they can use
  for (const size of new Set(sizes.filter((s) => s.size != null).map((s) => s.size))) {
    const gs = sizes.filter((s) => s.size === size);
    if (gs.length < 2) continue;
    const rows = pipeRows(size).filter((r) => r.m != null && gs.some((g) => compatible(g.material, r.material) && compatible(g.schedule, r.schedule)));
    const total = round3(gs.reduce((t, g) => t + g.cutM, 0)), cap = round3(rows.reduce((t, r) => t + r.m, 0));
    if (rows.length && total > cap + TOL_M && gs.every((g) => g.status !== "over")) { issues.push({ code: "CUT_BOM_OVER", size, cutM: total, bomM: cap, scope: "size", uids: gs.flatMap((g) => g.uids) }); found.push({ kind: "over" }); problems.push(`قطر ${size}": مجموع برش‌ها ${total} m از لولهٔ سازگار BOM (${cap} m) بیشتر است`); }
  }
  const label = (s) => `${s.size == null ? "قطر نامعلوم" : `قطر ${s.size}"`}${s.material ? ` · ${s.material}` : ""}${s.schedule ? ` · ${s.schedule}` : ""}`;
  for (const s of sizes) {
    const n = label(s);
    if (s.status === "over") { problems.push(`${n}: ${s.pieces} قطعهٔ برش روی هم ${s.cutM} m است ولی BOM فقط ${s.bomM} m لوله دارد`); issues.push({ code: "CUT_BOM_OVER", size: s.size, material: s.material, schedule: s.schedule, cutM: s.cutM, bomM: s.bomM, scope: "group", uids: s.uids }); }
    if (s.status === "noBom") found.push({ kind: "noBom", text: `${n}: ${s.pieces} قطعهٔ برش (${s.cutM} m) هست ولی BOM ردیف لولهٔ متری‌ای برای این قطر ندارد` }), problems.push(`${n}: ${s.pieces} قطعهٔ برش (${s.cutM} m) هست ولی BOM ردیف لولهٔ متری‌ای برای این قطر ندارد`);
    if (s.status === "noSize") found.push({ kind: "noSize", text: `${s.pieces} قطعهٔ برش قطرش خوانده نشده — با BOM سنجیده نشد` }), problems.push(`${s.pieces} قطعهٔ برش قطرش خوانده نشده — با BOM سنجیده نشد`);
    if (s.status === "mismatch") {
      problems.push(`${n}: ${s.pieces} قطعهٔ برش ${s.why === "schedule" ? "Sch" : "جنس"}ی دارند که با هیچ ردیف لولهٔ هم‌قطر BOM نمی‌خواند`);
      issues.push({ code: s.why === "schedule" ? "CUT_SCHEDULE_MISMATCH" : "CUT_MATERIAL_MISMATCH", size: s.size, material: s.material, schedule: s.schedule, cutM: s.cutM, scope: "group", uids: s.uids });
    }
  }
  const all = [...sizes.map((s) => s)];
  return { sizes, problems, issues, found, pieces: sizes.reduce((t, s) => t + s.pieces, 0), totalM: round3(all.reduce((t, s) => t + s.cutM, 0)), noSize };
}

/** The shape every caller before Phase 9 reads. */
export function cutVsBom(cutLengths = [], bom = []) {
  const { issues: _issues, found: _found, ...r } = cutBomReport(cutLengths, bom);
  return r;
}
