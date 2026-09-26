/**
 * Incoming transmittals — what the designer sends the project — and the
 * project's review of each document revision in them.
 *
 * RECEIPT      each item is a document revision with its file. The file is
 *              stored by its SHA-256; a "new revision" whose file is byte for
 *              byte an earlier revision's is refused — the revision block on
 *              it cannot be right. A document not on the MDR is registered
 *              and flagged: the MDR is the agreed list, and something outside
 *              it is a question for the designer, not silently accepted.
 * DUE DATE     received on + the contract's review period, as the project
 *              states it. With no period stated the due date is UNKNOWN —
 *              never a default; deemed-approval clauses turn on this date.
 * REVIEW       the document controller distributes a revision to the
 *              disciplines that must review it (inter-discipline check). Each
 *              discipline finishes with comments or none; a review may be
 *              waived only with a reason.
 * COMMENTS     belong to the document, not the revision: a comment raised on
 *              Rev A stays open on Rev B until the designer's reply is
 *              recorded and a reviewer closes it (comment resolution sheet).
 * REPLY CODE   a person sets it, and the platform refuses what contradicts
 *              the record:
 *                any assigned review still open             → no code yet
 *                1 approved       with any comment open on the document
 *                2 with comments  without a comment raised on this revision
 *                3 rejected       without an open comment saying why
 *              4 (information) needs neither.
 */

export const REVIEW_STATUS = { open: "در بررسی", done: "انجام شد", waived: "معاف (با دلیل)" };

const DAY = 86_400_000;
const toDay = (d) => Date.parse(String(d).slice(0, 10) + "T00:00:00Z");

/** The reply due date, or null when the project has not stated its review period. */
export function replyDue(receivedOn, reviewDays) {
  if (!receivedOn || reviewDays === null || reviewDays === undefined || reviewDays === "") return null;
  const n = Number(reviewDays);
  if (!Number.isInteger(n) || n <= 0) return null;
  return new Date(toDay(receivedOn) + n * DAY).toISOString().slice(0, 10);
}

/** An incoming item's state on a day. */
export function incomingState({ returnCode, dueOn, reviews = [] }, today) {
  if (returnCode) return { code: "replied", text: "پاسخ داده شد" };
  const open = reviews.filter((r) => r.status === "open").length;
  const late = dueOn && String(dueOn) < String(today);
  if (!reviews.length) return { code: late ? "overdue" : "received", text: late ? "مهلت پاسخ گذشته — توزیع نشده" : "دریافت شد — توزیع نشده" };
  if (open) return { code: late ? "overdue" : "in_review", text: `${late ? "مهلت پاسخ گذشته — " : ""}${open} رشته در حال بررسی` };
  return { code: late ? "overdue" : "ready", text: late ? "مهلت پاسخ گذشته — آمادهٔ پاسخ" : "بررسی تمام — آمادهٔ پاسخ" };
}

/**
 * Why this reply code cannot be given; empty when it can.
 *   reviews          the item's assignments
 *   openComments     comments still open on the DOCUMENT (any revision)
 *   raisedHere       comments raised on THIS revision (open or closed)
 */
export function replyProblems(code, { reviews = [], openComments = 0, raisedHere = 0 }) {
  const c = Number(code);
  if (![1, 2, 3, 4].includes(c)) return ["کد پاسخ ۱ تا ۴ است"];
  const out = [];
  const open = reviews.filter((r) => r.status === "open");
  if (open.length) out.push(`بررسی ${open.map((r) => r.discipline).join("، ")} هنوز باز است`);
  if (c === 1 && openComments > 0) out.push(`${openComments} کامنت باز روی این مدرک هست — کد ۱ یعنی بدون کامنت؛ کد ۲ بدهید یا کامنت‌ها را ببندید`);
  if (c === 2 && raisedHere === 0) out.push("کد ۲ (تأیید با کامنت) بدون کامنتی روی این رویژن معنی ندارد");
  if (c === 3 && openComments === 0) out.push("رد (کد ۳) بدون کامنت باز که دلیلش را بگوید ثبت نمی‌شود");
  return out;
}

/** Why a comment cannot be closed; empty when it can. */
export function closeProblems(comment, { designerReply }) {
  if (comment.status !== "open") return ["کامنت قبلاً بسته شده"];
  if (!String(designerReply || "").trim()) return ["پاسخ طراح (از شیت پاسخ کامنت‌ها) را ثبت کنید"];
  return [];
}

/** Comment resolution sheet rows, for CSV. */
export function crsRows(comments) {
  return comments.map((c, i) => ({
    no: i + 1, revision: c.revision, discipline: c.discipline, ref: c.ref || "", comment: c.text,
    designerReply: c.designerReply || "", status: c.status === "open" ? "OPEN" : "CLOSED", closedOn: c.closedRevision || "",
  }));
}
