/**
 * The review workflow of a P&ID draft (pure). Extracted → Needs Review → Corrected → Approved, and Rejected / Unresolved / Ambiguous /
 * Superseded. Rules:
 *   · nothing is approved by extraction: a reader's items start `extracted`; approval is a person's explicit action, recorded (by, at);
 *   · a correction keeps the ORIGINAL value beside the corrected one (once: the first value is the extracted one) and yields audit edits;
 *   · an approved item is not changed by a correction (APPROVED_LOCKED): change after approval is a new revision, as for every register here;
 *   · an item that is ambiguous or unresolved cannot be approved until a person has resolved it (corrected it).
 */
const text = (v) => String(v ?? "").trim();
export const STATUS_FA = { extracted: "استخراج‌شده", needs_review: "نیازمند بازبینی", corrected: "اصلاح‌شده", approved: "تأییدشده", rejected: "ردشده", unresolved: "حل‌نشده", ambiguous: "مبهم", superseded: "جایگزین‌شده با رویژن" };
const EDITABLE = new Set(["tag", "symbol", "printed", "attrs", "page"]);

const fail = (status, code, message) => Object.assign(new Error(message), { status, code });

const ALLOWED = {
  flag: ["extracted", "corrected", "unresolved", "ambiguous", "rejected"],            // → needs_review
  correct: ["extracted", "needs_review", "corrected", "unresolved", "ambiguous", "rejected"],
  approve: ["extracted", "needs_review", "corrected"],
  reject: ["extracted", "needs_review", "corrected", "unresolved", "ambiguous"],
  unresolved: ["extracted", "needs_review", "corrected", "ambiguous"],
  ambiguous: ["extracted", "needs_review", "corrected", "unresolved"],
  reopen: ["rejected"],
};
const TO = { flag: "needs_review", correct: "corrected", approve: "approved", reject: "rejected", unresolved: "unresolved", ambiguous: "ambiguous", reopen: "needs_review" };

/**
 * @param {object} draft
 * @param {{ uid: string, action: string, value?: object, reason?: string, by: string, at?: string }} a   `value`: { tag?, symbol?, printed?, attrs? } for "correct"
 * @returns {{ draft, edits: Array<{ path, field, kind, before, after }> }}
 */
export function applyReview(draft, { uid, action, value = null, reason = null, by, at = new Date().toISOString() }) {
  if (!by) throw fail(400, "INVALID_INPUT", "the person who acts is required");
  if (!ALLOWED[action]) throw fail(400, "INVALID_ACTION", `unknown action «${action}»`);
  const list = draft.items.some((i) => i.uid === uid) ? "items" : draft.edges?.some((e) => e.uid === uid) ? "edges" : null;
  if (!list) throw fail(404, "NOT_FOUND", "no such item or edge in this draft");
  const idx = draft[list].findIndex((x) => x.uid === uid);
  const cur = draft[list][idx], st = cur.review?.status || "extracted";
  if (st === "approved" && action !== "reopen") throw fail(409, "APPROVED_LOCKED", "رکورد تأییدشده تغییر نمی‌کند؛ تغییر آن با رویژن جدید است");
  if (!ALLOWED[action].includes(st)) throw fail(409, "INVALID_TRANSITION", `از وضعیت «${st}» با «${action}» نمی‌شود`);
  if (action === "approve" && (cur.status === "ambiguous" || cur.status === "unresolved")) throw fail(409, "NEEDS_RESOLUTION", "ارتباط مبهم/حل‌نشده تا تعیین تکلیف تأیید نمی‌شود");
  if (action === "reject" && !text(reason)) throw fail(400, "REASON_REQUIRED", "دلیل ردکردن لازم است");
  const next = { ...cur, review: { ...(cur.review || {}) } }, edits = [];
  const base = `${list}[${idx}]`;
  if (action === "correct") {
    if (!value || typeof value !== "object") throw fail(400, "INVALID_INPUT", "the corrected value is required");
    const original = { ...(next.review.original || {}) }, corrected = { ...(next.review.corrected || {}) };
    for (const [k, v] of Object.entries(value)) {
      if (!EDITABLE.has(k) || list !== "items") throw fail(400, "FIELD_NOT_EDITABLE", `فیلد «${k}» قابل اصلاح نیست`);
      const before = cur[k];
      if (JSON.stringify(before) === JSON.stringify(v)) continue;
      if (!(k in original)) original[k] = before;                       // the first value is what the reader extracted: kept, never overwritten
      corrected[k] = v; next[k] = v;
      edits.push({ path: `${base}.${k}`, field: k, kind: "changed", before, after: v });
    }
    if (!edits.length) return { draft, edits: [] };
    next.review = { ...next.review, status: "corrected", original, corrected, by, at, reason: text(reason) || null };
  } else {
    next.review = { ...next.review, status: TO[action], by, at, ...(reason ? { reason: text(reason) } : {}) };
    if (action === "approve") delete next.review.reason;
    edits.push({ path: `${base}.review.status`, field: "review.status", kind: "changed", before: st, after: TO[action] });
  }
  const arr = draft[list].slice(); arr[idx] = next;
  return { draft: { ...draft, [list]: arr }, edits };
}

/** A draft can be signed off as a whole only when every item and edge has been decided by a person. */
export function undecided(draft) {
  return [...(draft.items || []), ...(draft.edges || [])].filter((x) => ["extracted", "needs_review", "unresolved", "ambiguous"].includes(x.review?.status || "extracted")).map((x) => x.uid);
}

export function summary(draft) {
  const by = {};
  for (const x of [...(draft.items || []), ...(draft.edges || [])]) { const s = x.review?.status || "extracted"; by[s] = (by[s] || 0) + 1; }
  return by;
}
