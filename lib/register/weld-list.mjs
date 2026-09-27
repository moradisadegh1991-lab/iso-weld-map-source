/**
 * A weld register typed from a weld list — by hand, or from the designer's
 * or contractor's Excel — for a sheet the platform has no geometry for.
 *
 * The list is USER-PROVIDED DATA: each weld's number, spool, shop or field
 * and joint type are what the person entering it says the weld map says.
 * Nothing here decides where a weld goes; it checks that what was entered is
 * a register (numbers present and unique, every weld Shop or Field, a shop
 * weld in a spool, a size), refuses the whole list when it is not, and never
 * fills a blank with a guess. The NDT is the same provisional rule the
 * geometric engine uses, overwritten by the piping class like any other.
 *
 * There is no position: elevation, buried/above ground and the drawing view
 * stay unknown, and across revisions a weld is known by its number.
 */
import { normalizeLoc, normalizeKind, HEADER_PATTERNS } from "../truth/parse.mjs";
import { provisionalNdt, buildModel } from "../engine.js";

/** The columns a weld list is read by: the register's own, plus what a tie-in connects to. */
export const LIST_PATTERNS = {
  no: HEADER_PATTERNS.no,
  loc: HEADER_PATTERNS.loc,
  kind: HEADER_PATTERNS.kind,
  nps: HEADER_PATTERNS.nps,
  spool: HEADER_PATTERNS.spool,
  ref: [/\b(ref|reference|tie[\s_.-]*in[\s_.-]*(to|ref)|connect(s|ion)?(\s*to)?)\b/i, /مرجع|اتصال\s*به/],
};

/** One typed row as the form and the file reader both hand it over. */
const cell = (v) => String(v ?? "").trim();

/**
 * @param {{meta?: object, weldList: Array<{no, spool, loc, kind, nps, ref}>}} payload
 * @returns the same shape `buildModel` returns for a register — `register`,
 *   `spoolIds`, `totals`, `checks` — with `listed: true` and no `elements`;
 *   or `{ error, problems }` naming every row that is not a register row.
 */
export function modelFromWeldList(payload) {
  const meta = payload?.meta || {};
  const rows = Array.isArray(payload?.weldList) ? payload.weldList : [];
  if (!rows.length) return { error: "فهرست جوش خالی است.", problems: ["فهرست جوش خالی است."] };
  const defaultNps = Number(meta.nps) > 0 ? Number(meta.nps) : null;

  const problems = [];
  const seen = new Map();
  const register = rows.map((r, i) => {
    const at = `ردیف ${i + 1}${cell(r.no) ? ` (${cell(r.no)})` : ""}`;
    const no = cell(r.no);
    const loc = normalizeLoc(r.loc);
    const kind = cell(r.kind) ? normalizeKind(r.kind) : null;
    const typedNps = cell(r.nps) ? Number(cell(r.nps).replace(/[^\d.]/g, "")) : null;
    const nps = typedNps ?? defaultNps;
    const spool = cell(r.spool) || null;
    const ref = cell(r.ref) || null;

    if (!no) problems.push(`${at}: شمارهٔ جوش خالی است.`);
    else if (seen.has(no.toUpperCase())) problems.push(`${at}: شمارهٔ جوش ${no} تکراری است (همان ردیف ${seen.get(no.toUpperCase())}).`);
    else seen.set(no.toUpperCase(), i + 1);
    if (!loc) problems.push(`${at}: محل جوش «${cell(r.loc)}» نه کارگاه (Shop) است نه سایت (Field).`);
    if (!kind) problems.push(`${at}: نوع جوش (BW، SW، Tie-in، …) خالی است.`);
    if (!(nps > 0)) problems.push(`${at}: قطر (NPS) ندارد${defaultNps ? "" : " و قطر پیش‌فرض نقشه هم داده نشده"}.`);
    if (loc === "Shop" && !spool) problems.push(`${at}: جوش کارگاهی بدون شمارهٔ اسپول — کارگاه آن را در کدام اسپول بزند؟`);

    return {
      no, spool, loc, kind,
      // A tie-in is known by what it connects to, as the engine's are by the node's reference.
      role: ref || (kind === "Tie-in" ? "tie-in" : "—"),
      el: null, buried: null, at: null,
      ndt: provisionalNdt(loc),
      nps,
      size: `${nps || "?"}" ${meta.schedule || ""}`.trim(),
    };
  });
  if (problems.length) return { error: problems.join("\n"), problems };

  const spoolIds = [...new Set(register.map((w) => w.spool).filter(Boolean))];
  return {
    listed: true,
    register,
    spoolIds,
    elements: [],
    nps: defaultNps,
    checks: [
      { label: "منبع رجیستر", status: "warn",
        detail: "فهرست جوش واردشده توسط کاربر — از نقشه استخراج یا با هندسه کنترل نشده؛ با تأیید مهندس معتبر می‌شود." },
      { label: "موقعیت جوش‌ها", status: "skip",
        detail: "هندسه‌ای وارد نشده: تراز، زیرزمینی/روزمینی و نمای نقشه برای این جوش‌ها نامعلوم است." },
    ],
    totals: {
      welds: register.length,
      field: register.filter((w) => w.loc === "Field").length,
      shop: register.filter((w) => w.loc === "Shop").length,
      girth: null, buried: null, aboveGround: null,
      pipeLen: null, pupLen: null, clCalc: null,
    },
    gradeElevationMm: null,
  };
}

/** The tie-in references of a weld list — what its line connects to, for the spine. */
export const listTieInRefs = (payload) => (payload?.weldList || [])
  .filter((w) => normalizeKind(w.kind) === "Tie-in" && cell(w.ref))
  .map((w) => cell(w.ref));

/**
 * The register a stored payload stands for, whichever way it was entered:
 * a weld list, or geometry for the engine. Every place that recomputes a
 * register from a payload goes through here, so a typed list is never fed
 * to the geometric engine (which would call it "fewer than two nodes").
 */
export function modelFor(payload, options = {}) {
  return Array.isArray(payload?.weldList) ? modelFromWeldList(payload) : buildModel(payload, options);
}
