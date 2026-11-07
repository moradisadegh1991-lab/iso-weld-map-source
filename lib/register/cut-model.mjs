/**
 * The sheet's cut pieces as a model (owner's request 2026-11-02, UID-first since Phase 9: docs/audit/phase-9-spool-cutlist.md).
 * A piece has a length, a cut angle, the weld at each end and the spool it goes to. It says where those disagree with the sheet's
 * own marks; it does not decide which is right.
 *
 * References are read UID-FIRST (lib/register/cut-identity.mjs): `fromUid` / `toUid` / `spoolUid` name the entity; the printed
 * `from` / `to` / `spool` are only read when the piece has no uid for that end (a legacy row), and then only if exactly one entity
 * of the sheet has that number. Nothing is inferred from geometry.
 *
 * `items` are the sheet's marks (lib/sheet/markup.mjs); for a typed weld list pass the effective items (lib/sheet/weld-projection.mjs).
 */
import { isUid } from "../sheet/mark-identity.mjs";
import { isPlaced } from "../sheet/markup.mjs";
import { indexItems, resolveRef } from "./cut-identity.mjs";

const text = (v) => String(v ?? "").trim();
const lc = (u) => String(u).toLowerCase();

/** The spool a weld belongs to: its spoolUid first, else its printed spool when exactly one spool has that number. */
function weldSpool(w, ix) {
  const r = resolveRef(ix.spools, { uid: w?.attrs?.spoolUid, label: w?.attrs?.spool });
  return r.mark ? r.mark : null;
}

/**
 * The spool MARKS the two ends of a piece say it belongs to, distinct by IDENTITY (never by printed number: two spools with one number
 * stay two). An end whose spool is unknown, unresolved or ambiguous contributes nothing — nothing is guessed.
 */
export function endSpoolMarks(cut, items = []) {
  const ix = indexItems(items), out = [];
  for (const [lab, key] of [["from", "fromUid"], ["to", "toUid"]]) {
    const r = resolveRef(ix.welds, { uid: cut?.[key], label: cut?.[lab] });
    const sp = r.mark ? weldSpool(r.mark, ix) : null;
    if (sp && !out.some((m) => m === sp || (isUid(m.uid) && isUid(sp.uid) && lc(m.uid) === lc(sp.uid)))) out.push(sp);
  }
  return out;
}

/** The spools the two ends of a piece say it belongs to (distinct, printed numbers) — kept for existing callers. */
export function endSpools(cut, items = []) {
  const out = [];
  for (const m of endSpoolMarks(cut, items)) if (!out.includes(text(m.no))) out.push(text(m.no));
  return out;
}

/**
 * Structured problems of the cut table: { code, level: "error"|"warning"|"info", piece, uid, field?, message, detail? }.
 * Codes are catalogued in lib/engineering/validation.mjs (CUT_*).
 */
export function cutIssues(cuts = [], items = []) {
  const ix = indexItems(items), out = [];
  const list = Array.isArray(cuts) ? cuts : [];
  const anyWelds = ix.welds.list.length > 0, anySpools = ix.spools.list.length > 0;
  const uidCount = new Map(), pieceCount = new Map();
  for (const c of list) {
    if (isUid(c?.uid)) uidCount.set(lc(c.uid), (uidCount.get(lc(c.uid)) || 0) + 1);
    const p = text(c?.piece); if (p) pieceCount.set(p, (pieceCount.get(p) || 0) + 1);
  }
  for (const c of list) {
    const piece = text(c?.piece), id = `قطعهٔ برش <${piece}>`, uid = isUid(c?.uid) ? c.uid : null;
    const add = (code, level, message, o = {}) => out.push({ code, level, piece, uid, message: `${id}: ${message}`, ...o });
    if (!uid) add("CUT_NO_UID", "warning", "شناسهٔ پایدار ندارد؛ با ذخیره ساخته می‌شود.");
    else if (uidCount.get(lc(uid)) > 1) add("CUT_DUP_UID", "error", "شناسهٔ پایدارش روی قطعهٔ دیگری هم هست.");
    if (piece && pieceCount.get(piece) > 1) add("CUT_DUP_PIECE", "warning", `شمارهٔ قطعه ${piece} روی ${pieceCount.get(piece)} ردیف تکرار شده.`);
    const len = Number(c?.lengthMm);
    if (text(c?.lengthMm) && !(Number.isFinite(len) && len > 0)) add("CUT_LENGTH_INVALID", "error", `طول برش «${text(c?.lengthMm)}» عدد مثبت نیست.`);
    const angle = text(c?.angle);
    if (angle) { const a = Number(angle); if (!(a > 0 && a <= 90)) add("CUT_ANGLE_INVALID", "warning", `زاویهٔ برش «${angle}» باید عددی بین ۰ تا ۹۰ باشد.`); }

    const ends = {};
    for (const [lab, key, name] of [["from", "fromUid", "ابتدا"], ["to", "toUid", "انتها"]]) {
      const r = ends[lab] = resolveRef(ix.welds, { uid: c?.[key], label: c?.[lab] });
      const shown = text(c?.[lab]);
      if (r.state === "none") add("CUT_END_MISSING", "info", `سرجوش ${name} انتخاب نشده.`, { field: lab });
      else if (r.state === "dangling") add("CUT_END_DANGLING", "error", `سرجوش ${name} (${shown || r.uid}) در این رویژن نیست.`, { field: lab, detail: { ref: r.uid } });
      else if (r.state === "ambiguous") add("CUT_REF_AMBIGUOUS", "warning", `${name}ی قطعه سرجوش ${shown} است و چند سرجوش این شماره را دارند؛ یکی را صریح انتخاب کنید.`, { field: lab, detail: { candidates: r.candidates } });
      else if (r.state === "unresolved" && anyWelds) add("CUT_END_UNRESOLVED", "warning", `${name}ی قطعه سرجوش ${shown} است و روی این برگ نیست.`, { field: lab });
      else if (r.mark && !isPlaced(r.mark) && ix.welds.list.some(isPlaced)) add("CUT_END_UNPLACED", "info", `سرجوش ${name} (${text(r.mark.no)}) هنوز روی نقشه جا ندارد.`, { field: lab });
    }
    const a = ends.from, b = ends.to;
    const same = a.mark && b.mark ? a.mark === b.mark || (isUid(a.mark.uid) && lc(a.mark.uid) === lc(b.mark.uid))
      : text(c?.from) && text(c?.from) === text(c?.to) && a.state !== "ambiguous";
    if (same) add("CUT_SAME_END", "error", `ابتدا و انتها یک سرجوش است (${text(c?.from) || text(a.mark?.no)}).`);

    const s = resolveRef(ix.spools, { uid: c?.spoolUid, label: c?.spool }), sp = text(c?.spool);
    if (s.state === "dangling") add("CUT_SPOOL_DANGLING", "error", `اسپول ${sp || s.uid} در این رویژن نیست (اسپول منسوخ).`, { field: "spool", detail: { ref: s.uid } });
    else if (s.state === "ambiguous") add("CUT_REF_AMBIGUOUS", "warning", `اسپول ${sp} را چند اسپول دارند؛ یکی را صریح انتخاب کنید.`, { field: "spool", detail: { candidates: s.candidates } });
    else if (s.state === "unresolved" && anySpools) add("CUT_SPOOL_UNRESOLVED", "warning", `اسپول ${sp} روی این برگ علامت ندارد.`, { field: "spool" });
    if (s.mark) {
      const es = [...new Set([a.mark, b.mark].filter(Boolean).map((w) => weldSpool(w, ix)).filter(Boolean))];
      if (es.length && !es.some((m) => m === s.mark || (isUid(m.uid) && lc(m.uid) === lc(s.mark.uid)))) {
        add("CUT_SPOOL_MISMATCH", "warning", `اسپول ${text(s.mark.no)}، اما سرجوش‌های دو سرش در ${es.map((m) => text(m.no)).join("، ")} هستند.`, { field: "spool", detail: { spoolUid: s.mark.uid, endSpools: es.map((m) => m.uid) } });
      }
    }
  }
  return out;
}

/** @returns {string[]} problems (warning and worse), each naming its piece */
export function cutChecks(cuts = [], items = []) {
  return cutIssues(cuts, items).filter((i) => i.level !== "info" && i.code !== "CUT_NO_UID").map((i) => i.message);
}
