/**
 * The engineering validation engine (pure; runs in the page on the DRAFT and on the server on the SAVED state — same code, different input).
 * docs/audit/phase-7-engineering-validation.md.
 *
 * It is not a data source. Its input is what already exists: the payload (typed weld list, sheet marks, BOM, cut table) seen through the
 * weld projection (lib/sheet/weld-projection.mjs), and — when the revision has been saved — the server's equipment register, BOM ledger and
 * warnings. It reuses the existing rules (register problems, BOM row checks, capacity and demand, equipment→weld resolution, cut checks)
 * and gives every finding the same shape, an identity (the persistent uid, never the printed number) and a place to go:
 *
 *   { id, code, category, severity, entityType, entityUid, entityNumber, title, message, suggestedAction, source, revision,
 *     resolved, blocking, detail }
 *
 *   severity   error | warning | info
 *   category   identity | geometry | weld | bom | allocation | equipment | spool | support | revision | data-integrity
 *   blocking   the server would REFUSE the save/approval because of it (the same refusal, found early) — never a style point
 *   resolved   only a stored warning (sheet_mark_warning) can be resolved; every computed finding is open until its cause is gone
 *   source     draft:<area> (the page's current state, a live preview) | saved:<area> (the server's stored state, authoritative)
 *
 * Nothing is repaired here and nothing is guessed: a finding says what is wrong, where, and which existing form fixes it.
 */
import { KINDS, isPlaced, accessoriesOf, plainNo, bomSnapshot, sizesOf, weldsOf, weldRefsOf, equipmentWelds } from "../sheet/markup.mjs";
import { projectWelds } from "../sheet/weld-projection.mjs";
import { isUid } from "../sheet/mark-identity.mjs";
import { modelFromWeldList } from "../register/weld-list.mjs";
import { usage, rowCapacity, pieceUsage, ledgerDemands } from "../register/bom-allocation.mjs";
import { rowIssueCodes } from "../register/bom-table.mjs";
import { cutChecks } from "../register/cut-model.mjs";
import { cutVsBom } from "../register/cut-bom.mjs";

const text = (v) => String(v ?? "").trim();
const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const isWeld = (m) => KINDS[m?.kind]?.cls === "weld";
const cls = (m) => KINDS[m?.kind]?.cls;
const keyOf = (m) => (isUid(m?.uid) ? m.uid : text(m?.id));

export const SEVERITIES = ["error", "warning", "info"];
export const CATEGORIES = ["identity", "geometry", "weld", "bom", "allocation", "equipment", "spool", "support", "revision", "data-integrity"];

/** The catalog: every code, what it means and which existing form clears it (docs/audit/phase-7-engineering-validation.md §6). */
export const CATALOG = {
  // identity
  ID_NO_UID: ["identity", "warning", "ردیف تایپ‌شده شناسهٔ پایدار ندارد", "weld-form"],
  ID_DUP_UID: ["identity", "error", "یک شناسهٔ پایدار روی بیش از یک نشان/ردیف است", "weld-form"],
  ID_WARNING: ["identity", "warning", "هشدار هویت حل‌نشده (تطبیق نشانه‌ها مبهم بود)", "warnings"],
  // weld
  W_NO_NUMBER: ["weld", "error", "شمارهٔ جوش خالی است", "weld-form"],
  W_DUP_NUMBER: ["weld", "error", "شمارهٔ جوش تکراری است", "weld-form"],
  W_BAD_LOC: ["weld", "error", "محل جوش کارگاه/سایت نیست", "weld-form"],
  W_NO_KIND: ["weld", "error", "نوع جوش خالی است", "weld-form"],
  W_NO_NPS: ["weld", "error", "قطر جوش مشخص نیست", "weld-form"],
  W_SHOP_NO_SPOOL: ["weld", "error", "جوش کارگاهی اسپول ندارد", "weld-form"],
  W_NO_COMPONENT: ["weld", "info", "برای این سرجوش قطعهٔ BOM انتخاب نشده (چیزی رزرو نمی‌کند)", "weld-form"],
  W_ONE_COMPONENT: ["weld", "info", "فقط یک قطعهٔ BOM برای این سرجوش انتخاب شده", "weld-form"],
  W_PT_MISSING: ["weld", "error", "سرجوش PT‌ای را نام برده که در BOM این رویژن نیست", "weld-form"],
  W_PT_CHANGED: ["weld", "warning", "ردیف BOM از وقتی انتخاب شد عوض شده", "weld-form"],
  W_SIZE_MISMATCH: ["weld", "warning", "قطر سرجوش با قطر قطعه نمی‌خواند", "weld-form"],
  W_UNLINKED: ["weld", "warning", "نشان سرجوش روی نقشه به هیچ ردیف لیست جوش وصل نیست", "drawing"],
  W_DUP_REPRESENTATION: ["allocation", "info", "همین سرجوش هم ردیف لیست است هم نشان روی نقشه؛ یک بار شمرده می‌شود", "drawing"],
  // geometry
  G_NOT_PLACED: ["geometry", "info", "این سرجوش هنوز روی نقشه جا ندارد", "drawing"],
  G_MARK_NOT_PLACED: ["geometry", "info", "این نشان هنوز روی نقشه جا ندارد", "drawing"],
  // bom
  B_NO_PT: ["bom", "error", "ردیف BOM شمارهٔ PT ندارد", "bom-form"],
  B_DUP_PT: ["bom", "error", "شمارهٔ PT در BOM تکراری است", "bom-form"],
  B_NO_DESC: ["bom", "warning", "ردیف BOM شرح ندارد", "bom-form"],
  B_QTY_UNREAD: ["bom", "warning", "تعداد ردیف BOM خوانده نشده", "bom-form"],
  B_QTY_INVALID: ["bom", "error", "تعداد ردیف BOM عدد ≥ ۰ نیست", "bom-form"],
  B_BAD_UNIT: ["bom", "error", "واحد ردیف BOM نه عدد است نه متر", "bom-form"],
  B_NO_SIZE: ["bom", "warning", "ردیف جوشی‌شدنی BOM قطر (N.S.) ندارد", "bom-form"],
  // allocation
  A_OVER_CAPACITY: ["allocation", "error", "سرجوش‌ها بیش از سرهای جوشی‌شدنی این PT از آن خواسته‌اند (پیش‌نمایش صفحه)", "weld-form"],
  A_PREVIEW_DIFF: ["allocation", "info", "پیش‌نمایش صفحه با تخصیص ذخیره‌شدهٔ سرور فرق دارد", "save"],
  A_SAVED_OVER: ["allocation", "error", "تخصیص ذخیره‌شده از ظرفیت ردیف بیشتر است (سرور)", "ledger"],
  A_INSTALLED_OVER: ["allocation", "error", "مقدار نصب‌شده از ظرفیت ردیف بیشتر است (سرور)", "ledger"],
  A_ROW_HELD: ["allocation", "info", "این ردیف BOM تخصیص فعال دارد", "bom-form"],
  A_ROW_GONE: ["allocation", "error", "ردیف BOM حذف شده ولی هنوز در دفتر تخصیص نگه داشته شده", "bom-form"],
  A_ROW_SHRUNK: ["allocation", "error", "ظرفیت جدید ردیف BOM از تخصیص ثبت‌شده کمتر است", "bom-form"],
  A_INSTALLED_OWNER_GONE: ["allocation", "error", "خط نصب‌شده صاحبی ندارد (سرجوش/تجهیز حذف شده)", "ledger"],
  A_DUP_LINE: ["data-integrity", "error", "خط تخصیص فعال تکراری برای یک صاحب و یک PT", "ledger"],
  // equipment
  E_NO_UID: ["equipment", "warning", "تجهیز شناسهٔ پایدار ندارد", "equipment-form"],
  E_DUP_ID: ["equipment", "error", "شناسهٔ تجهیز تکراری است", "equipment-form"],
  E_NO_TAG: ["equipment", "info", "تجهیز تگ ندارد", "equipment-form"],
  E_NO_TYPE: ["equipment", "info", "نوع تجهیز مشخص نیست", "equipment-form"],
  E_NO_PT: ["equipment", "warning", "ردیف BOM تجهیز انتخاب نشده", "equipment-form"],
  E_BAD_PT: ["equipment", "error", "ردیف BOM تجهیز در BOM این رویژن نیست", "equipment-form"],
  E_NO_WELD: ["equipment", "warning", "تجهیز به هیچ سرجوشی وصل نیست", "equipment-form"],
  E_WELD_DANGLING: ["equipment", "error", "تجهیز به سرجوشی وصل است که روی برگ نیست", "equipment-form"],
  E_WELD_AMBIGUOUS: ["equipment", "warning", "شمارهٔ قدیمی سرجوش نام چند سرجوش است", "equipment-form"],
  E_WELD_UNKNOWN_NO: ["equipment", "warning", "شمارهٔ قدیمی سرجوش روی برگ نیست", "equipment-form"],
  E_WELD_DUP_REF: ["equipment", "info", "یک سرجوش چند بار در فهرست اتصال تجهیز آمده", "equipment-form"],
  E_NO_ACC: ["equipment", "info", "تجهیز متعلقاتی ندارد", "equipment-form"],
  E_ACC_PT: ["equipment", "warning", "متعلق تجهیز ردیفی از BOM نیست", "equipment-form"],
  E_ACC_QTY: ["equipment", "error", "تجهیزات و متعلقات بیش از تعداد BOM می‌خواهند", "equipment-form"],
  E_STATE_SOURCE: ["equipment", "error", "تجهیز نصب/تست‌شده در دفتر هست ولی نشانش روی برگ نیست", "equipment-form"],
  E_STATE_DRIFT: ["equipment", "info", "وضعیت تجهیز در پیش‌نویس با وضعیت ذخیره‌شده فرق دارد", "equipment-form"],
  E_LEGACY_WARNING: ["equipment", "warning", "پیوند قدیمی تجهیز به سرجوش حل‌نشده (هشدار ثبت‌شده)", "warnings"],
  // spool / support
  SP_NO_NUMBER: ["spool", "error", "نشان اسپول شماره ندارد", "spool-form"],
  SP_DUP: ["spool", "error", "شمارهٔ اسپول تکراری است", "spool-form"],
  SP_WELD_UNKNOWN: ["spool", "warning", "سرجوش اسپولی را نام برده که نشانش روی برگ نیست", "weld-form"],
  SP_SHOP_NONE: ["spool", "warning", "سرجوش کارگاهی اسپول ندارد", "weld-form"],
  SP_EMPTY: ["spool", "info", "اسپول روی برگ هست ولی هیچ سرجوشی در آن نیست", "spool-form"],
  SP_EQUIPMENT_UNKNOWN: ["spool", "warning", "تجهیز اسپولی را نام برده که روی برگ نیست", "equipment-form"],
  SUP_NO_NUMBER: ["support", "error", "نشان ساپورت شماره ندارد", "support-form"],
  SUP_DUP: ["support", "error", "شمارهٔ ساپورت تکراری است", "support-form"],
  SUP_NO_TYPE: ["support", "warning", "نوع ساپورت مشخص نیست", "support-form"],
  // revision / data
  REV_APPROVED: ["revision", "info", "رجیستر این رویژن تأیید شده؛ تغییر با رویژن جدید است", "new-revision"],
  REV_UNSAVED: ["revision", "info", "این برگ هنوز ذخیره نشده؛ بررسی‌های وابسته به سرور اجرا نشد", "save"],
  REV_NO_SOURCE: ["revision", "warning", "برای این رویژن رویژن مبدأ ثبت نشده (رویژن‌های قدیمی‌تر همین برگ هست)", "revisions"],
  REV_BAD_LINEAGE: ["revision", "error", "رویژن مبدأ ثبت‌شده در این برگ پیدا نمی‌شود", "revisions"],
  REV_DUP_RELATION: ["revision", "error", "بیش از یک رویژن از این رویژن ساخته شده است", "revisions"],
  REV_UNRESOLVED_MAP: ["identity", "warning", "تطبیقِ پیشنهادیِ رویژن قبلی هنوز تأیید نشده", "revisions"],
  REV_AMBIGUOUS_MAP: ["identity", "warning", "تطبیق با رویژن قبلی مبهم است و تعیین تکلیف نشده", "revisions"],
  REV_BAD_PT_MAP: ["bom", "error", "مورد نگاشت‌شده به PT‌ای ارجاع می‌دهد که در BOM این رویژن نیست", "bom-form"],
  REV_HIST_DEMAND: ["allocation", "error", "تخصیص رویژن قبلی به‌عنوان تقاضای رویژن جدید ثبت شده", "ledger"],
  REV_STALE_SOURCE: ["revision", "warning", "رویژن مبدأ بعد از آخرین انتقال تغییر کرده است", "revisions"],
  REV_INCOMPLETE_CARRY: ["revision", "info", "انتقال از رویژن قبلی ناقص است: هنوز مواردی قابل انتقال مانده", "revisions"],
  DI_CUT: ["data-integrity", "warning", "جدول برش با برگ ناسازگار است", "cut-form"],
  DI_CUT_BOM: ["data-integrity", "warning", "جدول برش با BOM ناسازگار است", "bom-form"],
};

/** What each `suggestedAction` key means for the UI (it opens an existing form or goes to an existing place). */
export const ACTIONS = {
  "weld-form": "ویرایش سرجوش", "equipment-form": "ویرایش تجهیز", "spool-form": "ویرایش اسپول", "support-form": "ویرایش ساپورت",
  "bom-form": "ویرایش ردیف BOM", "cut-form": "ویرایش جدول برش", drawing: "نمایش روی نقشه", ledger: "دفتر تخصیص BOM", warnings: "تاریخچهٔ هشدارها",
  save: "ذخیرهٔ رجیستر", "new-revision": "ثبت رویژن جدید", revisions: "نسخه‌ها: مقایسه و انتقال",
};

function make(ctx, code, o) {
  const [category, severity, title, action] = CATALOG[code];
  const entityUid = o.entityUid || null;
  return {
    id: `${code}:${entityUid || o.entityNumber || ""}${o.key ? `:${o.key}` : ""}`,
    code, category, severity: o.severity || severity, entityType: o.entityType || category, entityUid, entityNumber: o.entityNumber == null ? null : String(o.entityNumber),
    title, message: o.message || title, suggestedAction: o.action || action, source: `${ctx.source}:${o.area || category}`, revision: ctx.rev,
    resolved: Boolean(o.resolved), blocking: Boolean(o.blocking), detail: o.detail || null,
  };
}

/**
 * @param {object} input
 * @param {object} input.payload      weldList, weldMarkup, sheetMarkup, bom, cutLengths (the run's payload / the page's draft)
 * @param {object} [input.revision]   { documentId, docNo, rev, sheet, runId, status }
 * @param {object} [input.saved]      the server's stored state: { equipment, ledger: { rows, lines }, warnings } — absent for an unsaved draft
 * @param {"draft"|"saved"} [input.source]
 */
export function validate({ payload = {}, revision = {}, saved = null, source = "draft" } = {}) {
  const ctx = { source, rev: { documentId: revision.documentId || null, docNo: revision.docNo || null, rev: revision.rev ?? null, sheet: revision.sheet || null, runId: revision.runId || null } };
  const out = [];
  const add = (code, o) => out.push(make(ctx, code, o));
  const bom = Array.isArray(payload.bom) ? payload.bom : [];
  const items = Array.isArray(payload.sheetMarkup?.items) ? payload.sheetMarkup.items : [];
  const rows = Array.isArray(payload.weldList) ? payload.weldList : null;
  const proj = projectWelds(payload);
  const welds = proj.welds;
  const equipment = items.filter((m) => cls(m) === "equipment");
  const spools = items.filter((m) => m.kind === "spool");
  const supports = items.filter((m) => m.kind === "support");
  const effective = [...items.filter((m) => !isWeld(m)), ...welds];       // each weld once (what the ledger and the links read)
  const byPt = new Map(bom.filter((b) => b && b.pt != null && text(b.pt)).map((b) => [text(b.pt), b]));
  const draftLines = new Map();                                              // owner|pt → qty the draft wants (a PREVIEW)
  for (const d of ledgerDemands(effective, bom)) draftLines.set(`${d.ownerKind}|${d.ownerRef}|${d.pt}`, d);

  // ── revision ──────────────────────────────────────────────────────────
  if (revision.status === "approved") add("REV_APPROVED", { entityType: "revision", entityNumber: ctx.rev.docNo, key: "approved", area: "revision" });
  if (!revision.documentId || !saved) add("REV_UNSAVED", { entityType: "revision", entityNumber: ctx.rev.docNo, key: "unsaved", area: "revision" });

  // ── identity ──────────────────────────────────────────────────────────
  for (const r of proj.noIdentity) add("ID_NO_UID", { entityType: "weld", entityNumber: r.no, key: r.no, area: "identity", detail: { number: r.no } });
  // one uid on more than one typed row, or on more than one sheet mark, is a duplicate; the same weld as a typed row AND a sheet mark carries one uid by design (Phase 6)
  const dupBy = (list, label) => {
    const seen = new Map();
    for (const m of list) { const u = isUid(m?.uid) ? m.uid.toLowerCase() : null; if (u) seen.set(u, [...(seen.get(u) || []), m]); }
    for (const [u, ms] of seen) if (ms.length > 1) add("ID_DUP_UID", { entityType: label === "row" ? "weld" : cls(ms[0]) || "mark", entityUid: u, entityNumber: ms.map((m) => text(m.no)).join(" / "), key: `${label}:${u}`, area: "identity", detail: { numbers: ms.map((m) => text(m.no)), where: label } });
  };
  dupBy(proj.source === "weldList" ? welds : [], "row");
  dupBy(items, "mark");

  // ── weld (register rows: the existing problems, with the row they are about) ─
  if (rows) {
    const model = modelFromWeldList(payload);
    const map = { NO_NUMBER: "W_NO_NUMBER", DUP_NUMBER: "W_DUP_NUMBER", BAD_LOC: "W_BAD_LOC", NO_KIND: "W_NO_KIND", NO_NPS: "W_NO_NPS", SHOP_NO_SPOOL: "W_SHOP_NO_SPOOL" };
    for (const p of model.rowProblems || []) {
      const r = rows[p.index] || {};
      add(map[p.code], { entityType: "weld", entityUid: isUid(r.uid) ? r.uid : null, entityNumber: text(r.no) || `ردیف ${p.index + 1}`, message: p.message, key: String(p.index), area: "register", blocking: true });
    }
  } else {
    const dup = new Map();
    for (const w of welds) { const k = plainNo(w.no); if (k) dup.set(k, [...(dup.get(k) || []), w]); else add("W_NO_NUMBER", { entityType: "weld", entityUid: keyOf(w), entityNumber: "", severity: "warning", area: "marks", key: keyOf(w) }); }
    for (const [k, ws] of dup) if (ws.length > 1) for (const w of ws) add("W_DUP_NUMBER", { entityType: "weld", entityUid: keyOf(w), entityNumber: text(w.no), severity: "warning", area: "marks", key: keyOf(w), message: `شمارهٔ ${text(w.no)} روی ${ws.length} سرجوش است؛ شناسهٔ پایدار آن‌ها را از هم جدا نگه می‌دارد` });
    for (const w of welds) if (w.kind === "weld-shop" && !text(w.attrs?.spool)) add("SP_SHOP_NONE", { entityType: "weld", entityUid: keyOf(w), entityNumber: text(w.no), area: "marks", key: keyOf(w) });
  }

  // ── weld ↔ BOM ────────────────────────────────────────────────────────
  for (const w of welds) {
    const a = w.attrs || {}, uid = keyOf(w), no = text(w.no);
    const c = [["c1", "۱"], ["c2", "۲"]].map(([k, n]) => [k, n, text(a[k])]);
    const given = c.filter(([, , v]) => v);
    if (!given.length) add("W_NO_COMPONENT", { entityType: "weld", entityUid: uid, entityNumber: no, key: uid, area: "weld-bom" });
    else if (given.length === 1) add("W_ONE_COMPONENT", { entityType: "weld", entityUid: uid, entityNumber: no, key: uid, area: "weld-bom", message: `سرجوش ${no || "؟"}: فقط قطعهٔ ${given[0][1]} (PT ${given[0][2]}) انتخاب شده` });
    for (const [k, n, pt] of given) {
      const row = byPt.get(pt);
      if (!row) { add("W_PT_MISSING", { entityType: "weld", entityUid: uid, entityNumber: no, key: `${uid}:${k}`, area: "weld-bom", message: `سرجوش ${no || "؟"}: قطعهٔ ${n} (PT ${pt}) در BOM این رویژن نیست؛ چیزی رزرو نمی‌شود`, detail: { pt, slot: k } }); continue; }
      const snap = text(a[`${k}s`]);
      if (snap && snap !== bomSnapshot(row)) add("W_PT_CHANGED", { entityType: "weld", entityUid: uid, entityNumber: no, key: `${uid}:${k}`, area: "weld-bom", message: `سرجوش ${no || "؟"}: ردیف PT ${pt} از وقتی انتخاب شد عوض شده («${snap}» → «${bomSnapshot(row)}»)`, detail: { pt, slot: k } });
      const ws = sizesOf(a.size), cs = sizesOf(row.diam ?? row.size);
      if (ws.length && cs.length && !ws.some((s) => cs.includes(s))) add("W_SIZE_MISMATCH", { entityType: "weld", entityUid: uid, entityNumber: no, key: `${uid}:${k}`, area: "weld-bom", message: `سرجوش ${no || "؟"}: قطر ${a.size} با قطر قطعهٔ ${n} (PT ${pt}: ${text(row.diam ?? row.size)}) نمی‌خواند`, detail: { pt, slot: k } });
    }
  }

  // ── unlinked sheet marks / duplicate representation (the typed list is the register) ───────────
  if (rows) {
    for (const m of proj.unlinked) {
      const mk = items.find((x) => isWeld(x) && (x.uid || null) === m.uid && text(x.no) === m.no) || {};
      add("W_UNLINKED", { entityType: "sheet-weld-mark", entityUid: m.uid, entityNumber: m.no, key: m.uid || m.no, area: "marks",
        message: `نشان سرجوش «${m.no || "؟"}» روی نقشه به هیچ ردیف لیست جوش وصل نیست (شناسهٔ ${m.uid ? String(m.uid).slice(0, 8) : "ندارد"}). با شماره یا مختصات با ردیفی یکی دانسته نمی‌شود و چیزی رزرو نمی‌کند.`,
        detail: { attrs: mk.attrs || {}, placed: isPlaced(mk) } });
    }
    for (const m of items.filter(isWeld)) {
      const row = rows.find((r) => isUid(r.uid) && isUid(m.uid) && r.uid.toLowerCase() === m.uid.toLowerCase());
      if (row && (text(m.attrs?.c1) || text(m.attrs?.c2))) add("W_DUP_REPRESENTATION", { entityType: "weld", entityUid: row.uid, entityNumber: text(row.no), key: row.uid, area: "allocation" });
    }
  }

  // ── geometry (placement is not required by the register; only the half-done state is pointed out) ───────
  const placedAny = (payload.weldMarkup && (Object.keys(payload.weldMarkup.byUid || {}).length || Object.keys(payload.weldMarkup.marks || {}).length)) || welds.some((w) => isPlaced(w));
  if (placedAny) {
    const by = payload.weldMarkup?.byUid || {}, legacy = payload.weldMarkup?.marks || {};
    for (const w of welds) {
      const placed = isPlaced(w) || (w.uid && by[w.uid]) || (text(w.no) && legacy[text(w.no)]);
      if (!placed) add("G_NOT_PLACED", { entityType: "weld", entityUid: keyOf(w), entityNumber: text(w.no), key: keyOf(w), area: "placement" });
    }
  }
  for (const m of [...spools, ...supports, ...equipment]) if (!isPlaced(m)) add("G_MARK_NOT_PLACED", { entityType: cls(m), entityUid: keyOf(m), entityNumber: text(m.no), key: keyOf(m), area: "placement" });

  // ── BOM ───────────────────────────────────────────────────────────────
  const codeMap = { NO_PT: "B_NO_PT", DUP_PT: "B_DUP_PT", NO_DESC: "B_NO_DESC", QTY_UNREAD: "B_QTY_UNREAD", QTY_INVALID: "B_QTY_INVALID" };
  bom.forEach((row, i) => {
    const pt = text(row?.pt);
    for (const x of rowIssueCodes(row, bom)) add(codeMap[x.code], { entityType: "bom-row", entityNumber: pt ? `PT ${pt}` : `ردیف ${i + 1}`, key: `${pt}:${i}`, area: "bom", message: `BOM ${pt ? `PT ${pt}` : `ردیف ${i + 1}`}: ${x.message}`, detail: { pt, index: i } });
    const unit = text(row?.qtyUnit);
    if (unit && unit !== "pcs" && unit !== "m") add("B_BAD_UNIT", { entityType: "bom-row", entityNumber: `PT ${pt}`, key: `${pt}:${i}`, area: "bom", detail: { pt, unit } });
    const mode = rowCapacity(row).mode;
    if ((mode === "ends" || mode === "length") && !text(row?.diam ?? row?.size)) add("B_NO_SIZE", { entityType: "bom-row", entityNumber: `PT ${pt}`, key: `${pt}:${i}`, area: "bom", detail: { pt } });
  });

  // ── allocation: the live preview ──────────────────────────────────────
  for (const u of usage(effective, bom).values()) {
    if (!u.row || !u.used) continue;
    const over = u.cap.mode === "none" || (u.cap.capacity != null && u.used > u.cap.capacity);
    if (!over) continue;
    add("A_OVER_CAPACITY", { entityType: "bom-row", entityNumber: `PT ${u.pt}`, key: u.pt, area: "preview", blocking: true,
      message: u.cap.mode === "none" ? `PT ${u.pt}: سر جوشی‌شدنی ندارد ولی ${u.used} سرجوش آن را نام برده‌اند (${[...new Set(u.owners)].join("، ")})`
        : `PT ${u.pt}: ${u.used} سر خواسته شده ولی فقط ${u.cap.capacity} سر دارد (${[...new Set(u.owners)].join("، ")}) — این یک پیش‌نمایش صفحه است؛ سرور هنگام ذخیره رد می‌کند`, detail: { pt: u.pt, used: u.used, capacity: u.cap.capacity, owners: u.owners } });
  }
  for (const u of pieceUsage(effective, bom).values()) {
    if (u.total != null && u.used > u.total) add("E_ACC_QTY", { entityType: "bom-row", entityNumber: `PT ${u.pt}`, key: u.pt, area: "preview", blocking: true,
      message: `PT ${u.pt}: تجهیزات و متعلقات ${u.used} از آن خواسته‌اند ولی BOM فقط ${u.total} دارد (${[...new Set(u.owners)].join("، ")})`, detail: { pt: u.pt, used: u.used, total: u.total } });
  }

  // ── equipment ─────────────────────────────────────────────────────────
  const eqSeen = new Map();
  for (const e of equipment) { const k = keyOf(e); eqSeen.set(k, [...(eqSeen.get(k) || []), e]); }
  for (const e of equipment) {
    const a = e.attrs || {}, uid = keyOf(e), no = text(e.no), E = { entityType: "equipment", entityUid: uid, entityNumber: no, key: uid, area: "equipment" };
    if (!isUid(e.uid)) add("E_NO_UID", E);
    if (eqSeen.get(uid).length > 1) add("E_DUP_ID", { ...E, detail: { numbers: eqSeen.get(uid).map((x) => text(x.no)) } });
    if (!text(a.tag)) add("E_NO_TAG", E);
    if (!text(a.type)) add("E_NO_TYPE", E);
    if (!text(a.c1)) add("E_NO_PT", E); else if (!byPt.has(text(a.c1))) add("E_BAD_PT", { ...E, message: `تجهیز ${no || "؟"}: PT ${text(a.c1)} در BOM این رویژن نیست`, detail: { pt: text(a.c1) } });
    const ew = equipmentWelds(e, effective);
    if (!ew.joined.length && !ew.unresolved.length && !ew.dangling.length) add("E_NO_WELD", E);
    for (const u of ew.dangling) add("E_WELD_DANGLING", { ...E, key: `${uid}:${u}`, blocking: true, message: `تجهیز ${no || "؟"} هنوز به سرجوشی وصل است که روی این برگ نیست (${String(u).slice(0, 8)}) — سرور ذخیره را رد می‌کند؛ پیوند را در فرم تجهیز بردارید`, detail: { weldUid: u } });
    for (const x of ew.unresolved) add(x.reason === "ambiguous" ? "E_WELD_AMBIGUOUS" : "E_WELD_UNKNOWN_NO", { ...E, key: `${uid}:${x.no}`,
      message: x.reason === "ambiguous" ? `تجهیز ${no || "؟"}: «${x.no}» نام چند سرجوش است؛ به هیچ‌کدام وصل نشد — سرجوش درست را در فرم تجهیز انتخاب کنید` : `تجهیز ${no || "؟"}: سرجوش ${x.no} روی این برگ نیست`, detail: { weldNo: x.no } });
    const refsRaw = text(a.weldRefs).split(/[,،;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (refsRaw.length !== new Set(refsRaw).size || weldsOf(a.welds).length !== new Set(weldsOf(a.welds).map(plainNo)).size) add("E_WELD_DUP_REF", E);
    const acc = accessoriesOf(a.acc);
    if (!acc.length) add("E_NO_ACC", E);
    for (const x of acc) if (!byPt.has(text(x.pt))) add("E_ACC_PT", { ...E, key: `${uid}:${x.pt}`, message: `تجهیز ${no || "؟"}: متعلقِ PT ${x.pt} در BOM این رویژن نیست`, detail: { pt: x.pt } });
    if (text(a.spool) && !spools.some((s) => text(s.no) === text(a.spool))) add("SP_EQUIPMENT_UNKNOWN", { ...E, key: `${uid}:${a.spool}`, message: `تجهیز ${no || "؟"}: اسپول ${text(a.spool)} روی این برگ نیست` });
  }

  // ── spool / support ───────────────────────────────────────────────────
  const spoolNos = new Map();
  for (const s of spools) { const n = text(s.no); if (!n) add("SP_NO_NUMBER", { entityType: "spool", entityUid: keyOf(s), entityNumber: "", key: keyOf(s), area: "spool" }); else spoolNos.set(n, [...(spoolNos.get(n) || []), s]); }
  for (const [n, ss] of spoolNos) if (ss.length > 1) for (const s of ss) add("SP_DUP", { entityType: "spool", entityUid: keyOf(s), entityNumber: n, key: keyOf(s), area: "spool" });
  const named = new Set();
  for (const w of welds) { const sp = text(w.attrs?.spool); if (!sp) continue; named.add(sp);
    if (spools.length && !spoolNos.has(sp)) add("SP_WELD_UNKNOWN", { entityType: "weld", entityUid: keyOf(w), entityNumber: text(w.no), key: `${keyOf(w)}:${sp}`, area: "spool", message: `سرجوش ${text(w.no) || "؟"}: اسپول ${sp} را نام برده ولی نشانش روی برگ نیست`, detail: { spool: sp } }); }
  for (const [n, ss] of spoolNos) if (!named.has(n)) add("SP_EMPTY", { entityType: "spool", entityUid: keyOf(ss[0]), entityNumber: n, key: keyOf(ss[0]), area: "spool" });
  const supNos = new Map();
  for (const s of supports) {
    const n = text(s.no);
    if (!n) add("SUP_NO_NUMBER", { entityType: "support", entityUid: keyOf(s), entityNumber: "", key: keyOf(s), area: "support" }); else supNos.set(n, [...(supNos.get(n) || []), s]);
    if (!text(s.attrs?.type)) add("SUP_NO_TYPE", { entityType: "support", entityUid: keyOf(s), entityNumber: n, key: keyOf(s), area: "support" });
  }
  for (const [n, ss] of supNos) if (ss.length > 1) for (const s of ss) add("SUP_DUP", { entityType: "support", entityUid: keyOf(s), entityNumber: n, key: keyOf(s), area: "support" });

  // ── cut table (the existing checks, one finding each) ─────────────────
  const cutNo = (t) => (/<(.+?)>/.exec(t) || [])[1] || null;
  const cutRows = Array.isArray(payload.cutLengths) ? payload.cutLengths : [];
  for (const t of cutChecks(cutRows, effective)) add("DI_CUT", { entityType: "cut", entityNumber: cutNo(t), key: t, area: "cut", message: t });
  for (const t of cutVsBom(cutRows, bom).problems) add("DI_CUT_BOM", { entityType: "cut", entityNumber: null, key: t, area: "cut", message: t });

  // ── the saved state (the server's, authoritative) ─────────────────────
  if (saved) {
    const lines = saved.ledger?.lines || [], lrows = saved.ledger?.rows || [];
    // the ledger's own consistency and the draft against it
    for (const r of lrows) {
      const pt = String(r.pt), L = { entityType: "bom-row", entityNumber: `PT ${pt}`, key: pt, area: "ledger", detail: { pt: r.pt } };
      const wUsed = (r.weldReserved || 0) + (r.weldInstalled || 0), pUsed = (r.reserved || 0) + (r.installed || 0);
      if (r.weldEnds != null && wUsed > r.weldEnds) add("A_SAVED_OVER", { ...L, message: `PT ${pt}: ${wUsed} سر رزرو/نصب‌شده ولی ظرفیت ${r.weldEnds} است (سرور)`, detail: { pt: r.pt, used: wUsed, capacity: r.weldEnds } });
      if (r.qty != null && pUsed > r.qty) add("A_SAVED_OVER", { ...L, key: `${pt}:p`, message: `PT ${pt}: ${pUsed} عدد رزرو/نصب‌شده ولی تعداد ${r.qty} است (سرور)`, detail: { pt: r.pt, used: pUsed, capacity: r.qty } });
      if (r.weldEnds != null && (r.weldInstalled || 0) > r.weldEnds) add("A_INSTALLED_OVER", { ...L, key: `${pt}:wi`, message: `PT ${pt}: نصب‌شده ${r.weldInstalled} از ظرفیت ${r.weldEnds} بیشتر است (سرور)` });
      if (r.qty != null && (r.installed || 0) > r.qty) add("A_INSTALLED_OVER", { ...L, key: `${pt}:pi`, message: `PT ${pt}: نصب‌شده ${r.installed} از تعداد ${r.qty} بیشتر است (سرور)` });
      const holds = wUsed + pUsed;
      if (holds > 0) add("A_ROW_HELD", { ...L, message: `PT ${pt}: ${holds} در دفتر سرور رزرو/نصب‌شده است — تغییر یا حذف ردیف به آن‌ها احترام می‌گذارد`, detail: { pt: r.pt, reserved: (r.weldReserved || 0) + (r.reserved || 0), installed: (r.weldInstalled || 0) + (r.installed || 0) } });
    }
    const dup = new Map();
    for (const l of lines) { const k = `${l.pt}|${l.ownerKind}|${l.ownerRef}|${l.status}`; dup.set(k, (dup.get(k) || 0) + 1); }
    for (const [k, n] of dup) if (n > 1) { const [pt, kind, ref] = k.split("|"); add("A_DUP_LINE", { entityType: "allocation", entityUid: ref, entityNumber: `PT ${pt}`, key: k, area: "ledger", detail: { count: n, kind } }); }
    const owners = new Set(effective.map((m) => keyOf(m)));
    const heldPt = new Map();
    for (const l of lines) heldPt.set(String(l.pt), [...(heldPt.get(String(l.pt)) || []), l]);
    for (const [pt, ls] of heldPt) {
      const row = byPt.get(pt);
      if (!row) { add("A_ROW_GONE", { entityType: "bom-row", entityNumber: `PT ${pt}`, key: pt, area: "ledger", blocking: true, message: `PT ${pt} در BOM پیش‌نویس نیست ولی ${ls.length} خط تخصیص فعال دارد — سرور ذخیره را رد می‌کند (آزادسازی در دفتر تخصیص)`, detail: { pt, lines: ls.length } }); continue; }
      const cap = rowCapacity(row);
      const wHeld = ls.filter((l) => l.ownerKind === "weld").reduce((t, l) => t + Number(l.qty), 0), pHeld = ls.filter((l) => l.ownerKind !== "weld").reduce((t, l) => t + Number(l.qty), 0);
      const q = num(row.qty);
      if ((cap.capacity != null && wHeld > cap.capacity) || (q != null && pHeld > q))
        add("A_ROW_SHRUNK", { entityType: "bom-row", entityNumber: `PT ${pt}`, key: pt, area: "ledger", blocking: true, message: `PT ${pt}: ظرفیت پیش‌نویس (${cap.capacity ?? "؟"} سر / ${q ?? "؟"} عدد) از آنچه در دفتر نگه داشته شده (${wHeld} سر / ${pHeld} عدد) کمتر است — سرور رد می‌کند`, detail: { pt, wHeld, pHeld } });
    }
    for (const l of lines) if (l.status === "installed" && !owners.has(String(l.ownerRef)))
      add("A_INSTALLED_OWNER_GONE", { entityType: "allocation", entityUid: l.ownerRef, entityNumber: l.ownerNo || `PT ${l.pt}`, key: l.id, area: "ledger", blocking: true, message: `PT ${l.pt}: خط نصب‌شده برای «${l.ownerNo || "؟"}» صاحبی در پیش‌نویس ندارد — سرور ذخیره را رد می‌کند؛ ابتدا نصب را در دفتر برگردانید`, detail: { lineId: l.id } });
    // the preview against the saved ledger (labelled: the preview is the page's, the ledger is the server's)
    const savedMap = new Map(lines.map((l) => [`${l.ownerKind}|${l.ownerRef}|${l.pt}|${l.status}`, l]));
    const keys = new Set([...draftLines.keys(), ...lines.filter((l) => l.status === "reserved").map((l) => `${l.ownerKind}|${l.ownerRef}|${l.pt}`)]);
    for (const k of keys) {
      const want = Number(draftLines.get(k)?.qty || 0);
      const [kind, ref, pt] = k.split("|");
      const reserved = Number(savedMap.get(`${k}|reserved`)?.qty || 0), inst = Number(savedMap.get(`${k}|installed`)?.qty || 0);
      if (want !== reserved + inst) add("A_PREVIEW_DIFF", { entityType: kind === "weld" ? "weld" : "equipment", entityUid: ref, entityNumber: draftLines.get(k)?.ownerNo || savedMap.get(`${k}|reserved`)?.ownerNo || "", key: k, area: "preview-vs-saved",
        message: `PT ${pt}: پیش‌نمایش صفحه ${want} می‌خواهد، دفتر سرور ${reserved + inst} دارد (رزرو ${reserved}، نصب‌شده ${inst}) — با ذخیرهٔ رجیستر یکی می‌شود`, detail: { pt, preview: want, reserved, installed: inst } });
    }
    // equipment the server holds
    for (const se of saved.equipment || []) {
      const mark = equipment.find((m) => keyOf(m) === se.markId || keyOf(m) === se.legacyId);
      const held = se.status === "installed" || se.status === "tested" || (se.accessories || []).some((x) => x.status === "installed" || x.status === "tested");
      if (!mark && held) add("E_STATE_SOURCE", { entityType: "equipment", entityUid: se.markId, entityNumber: se.no, key: se.markId, area: "equipment", blocking: true, message: `تجهیز ${se.no || "؟"} در دفتر «${se.status}» (یا متعلق نصب‌شده دارد) ثبت است ولی نشانش در پیش‌نویس نیست — سرور ذخیره را رد می‌کند` });
      if (mark && text(mark.attrs?.status || "planned") !== se.status) add("E_STATE_DRIFT", { entityType: "equipment", entityUid: se.markId, entityNumber: se.no, key: se.markId, area: "equipment", message: `تجهیز ${se.no || "؟"}: وضعیت ذخیره‌شده «${se.status}» ولی پیش‌نویس «${text(mark.attrs?.status || "planned")}» است — وضعیت خودکار عوض نمی‌شود` });
    }
    // revision lineage and carry-forward (lib/db/repos/revision-lifecycle.mjs lineageFacts)
    const L = saved.lineage;
    if (L) {
      const R = { entityType: "revision", entityNumber: ctx.rev.docNo, area: "lineage" };
      if (L.hasParentColumn && !L.parent) add("REV_BAD_LINEAGE", { ...R, key: "badparent" });
      else if (!L.parent && (L.siblings || []).some((x) => x.older)) add("REV_NO_SOURCE", { ...R, key: "nosource", detail: { revisions: L.siblings.filter((x) => x.older).map((x) => x.revision) } });
      if ((L.children || []).length > 1) add("REV_DUP_RELATION", { ...R, key: "dup", detail: { children: L.children.map((c) => c.revision) } });
      for (const c of L.pending?.candidates || []) add("REV_UNRESOLVED_MAP", { entityType: c.cls, entityUid: c.toUid, entityNumber: c.no, key: c.toUid, area: "lineage", message: `${c.cls} «${c.no}»: در رویژن قبلی همین شمارهٔ چاپی یکتا هست ولی تطبیق تأیید نشده (شماره هویت نیست)`, detail: { fromUid: c.fromUid } });
      for (const c of L.pending?.ambiguous || []) add("REV_AMBIGUOUS_MAP", { entityType: c.cls, entityNumber: c.no, key: `${c.cls}:${c.no}`, area: "lineage" });
      const mappedTo = new Set((L.mappings || []).map((m) => String(m.toUid).toLowerCase()));
      for (const m of effective) {
        if (!mappedTo.has(keyOf(m).toLowerCase())) continue;
        const pts = cls(m) === "equipment" ? [text(m.attrs?.c1), ...accessoriesOf(m.attrs?.acc).map((x) => text(x.pt))] : [text(m.attrs?.c1), text(m.attrs?.c2)];
        for (const pt of pts.filter(Boolean)) if (!byPt.has(pt)) add("REV_BAD_PT_MAP", { entityType: cls(m), entityUid: keyOf(m), entityNumber: text(m.no), key: `${keyOf(m)}:${pt}`, area: "lineage", message: `${cls(m)} ${text(m.no) || "؟"} (منتقل‌شده از رویژن قبلی): PT ${pt} در BOM این رویژن نیست`, detail: { pt } });
      }
      for (const h of L.histAsDemand || []) add("REV_HIST_DEMAND", { entityType: "allocation", entityUid: h.ownerRef, entityNumber: `PT ${h.pt}`, key: `${h.ownerRef}:${h.pt}`, area: "lineage", blocking: false, detail: h });
      const last = (L.ops || []).at(-1);
      if (last && L.parentHash && last.fromHash !== L.parentHash) add("REV_STALE_SOURCE", { ...R, key: "stale", detail: { op: last.id } });
      if (last && (L.pending?.carryable || 0) > 0) add("REV_INCOMPLETE_CARRY", { ...R, key: "incomplete", detail: { remaining: L.pending.carryable } });
    }
    // stored warnings (history: resolved ones stay)
    for (const w of saved.warnings || []) {
      const d = w.detail || {}, resolved = Boolean(w.resolved_at), base = { key: w.id, area: "warnings", resolved, severity: resolved ? "info" : undefined, detail: { warningId: w.id, kind: w.kind, ...d, resolution: w.resolution || null, resolvedAt: w.resolved_at || null } };
      if (d.type === "equipment_weld") add("E_LEGACY_WARNING", { ...base, entityType: "equipment", entityUid: d.equipmentRef, entityNumber: d.equipmentNo, message: `تجهیز ${d.equipmentNo || "؟"}: شمارهٔ «${d.weldNo}» ${d.reason === "ambiguous" ? "نام چند سرجوش بود" : "روی برگ نبود"}؛ ${resolved ? `حل شد: ${w.resolution}` : "به هیچ سرجوشی وصل نشد"}` });
      else add("ID_WARNING", { ...base, entityType: "mark", entityUid: null, entityNumber: d.no || null, message: `تطبیق نشانهٔ «${d.no || "؟"}» مبهم بود (${(d.incoming || []).length} جدید، ${(d.previous || []).length} قبلی)؛ هیچ شناسه‌ای قرض داده نشد${resolved ? ` — حل شد: ${w.resolution}` : ""}` });
    }
  }
  return { findings: out, summary: summarize(out) };
}

/** Counts for the summary: unresolved by severity, blocking, resolved (stored warnings that were closed), per category. */
export function summarize(findings) {
  const open = findings.filter((f) => !f.resolved);
  const by = (k) => Object.fromEntries(CATEGORIES.map((c) => [c, open.filter((f) => f.category === c).length]).filter(([, n]) => n));
  return { total: findings.length, open: open.length, errors: open.filter((f) => f.severity === "error").length, warnings: open.filter((f) => f.severity === "warning").length,
    info: open.filter((f) => f.severity === "info").length, resolved: findings.length - open.length, blocking: open.filter((f) => f.blocking).length, byCategory: by("category") };
}
