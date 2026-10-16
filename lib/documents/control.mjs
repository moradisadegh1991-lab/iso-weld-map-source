/**
 * Document control: the master document register (MDR), revisions, and
 * transmittals — the rules, with no database in sight.
 *
 * A REVISION is issued for a purpose:
 *
 *   IFR  issued for review        IFC  issued for construction
 *   IFA  issued for approval      AB   as-built
 *   VOID the document is withdrawn; nothing is issued after it
 *
 * Revisions are issued in date order, never back-dated behind the last
 * one: "which revision was in force on 12 March" has one answer only if
 * the issue dates say so.
 *
 * APPROVAL — a document the client must approve is not issued IFC until an
 * earlier revision came back from the client with code 1 or 2. A drawing
 * built from before its approval is the classic source of rework.
 *
 * ON A DATE —
 *   current      the latest revision issued on or before it, whatever its purpose
 *   construction the latest IFC or AB revision issued on or before it, and
 *                none at all once the document was voided
 *
 * A site record made from a drawing revision that was not the construction
 * revision on the day it was made is flagged: the register behind it may be
 * built from a superseded drawing.
 *
 * TRANSMITTALS — each item is returned with a code (1 approved, 2 approved
 * with comments, 3 rejected, 4 information); an item not returned by the
 * transmittal's response date is overdue.
 */

export const PURPOSES = {
  IFR: "برای بررسی (IFR)",
  IFA: "برای تأیید (IFA)",
  IFC: "برای ساخت (IFC)",
  AB: "چون‌ساخت (As-Built)",
  VOID: "باطل (VOID)",
};
export const RETURN_CODES = { 1: "کد ۱ — تأیید", 2: "کد ۲ — تأیید با کامنت", 3: "کد ۳ — رد", 4: "کد ۴ — برای اطلاع" };
const CONSTRUCTION = new Set(["IFC", "AB"]);

/**
 * Problems with issuing a new revision, or [].
 * @param {Array<{revision, purpose, issuedOn, approvedCode?}>} revisions  already issued, oldest first
 * @param {{revision, purpose, issuedOn}} next
 * @param {{approvalRequired: boolean}} doc
 */
export function issueProblems(revisions, next, doc = {}) {
  return issueChecks(revisions, next, doc).map((c) => c.text);
}

/**
 * The same checks, each with whether it is about the document itself (hard:
 * the revision cannot exist) or about the order things were done in (soft:
 * a revision received out of order is still a fact to record).
 */
export function issueChecks(revisions, next, { approvalRequired = false } = {}) {
  const out = [];
  const hard = (text) => out.push({ hard: true, text });
  const soft = (text) => out.push({ hard: false, text });
  if (!PURPOSES[next.purpose]) hard("هدف صدور را انتخاب کنید");
  if (!String(next.revision || "").trim()) hard("شمارهٔ رویژن لازم است");
  if (!next.issuedOn) hard("تاریخ صدور لازم است");
  if (revisions.some((r) => r.revision === next.revision)) hard(`رویژن ${next.revision} پیش‌تر صادر شده؛ رویژن تازه بدهید`);
  const last = revisions[revisions.length - 1];
  if (last?.purpose === "VOID") hard("مدرک باطل شده؛ رویژنی پس از آن صادر نمی‌شود");
  if (last && next.issuedOn && String(next.issuedOn) < String(last.issuedOn))
    soft(`تاریخ صدور پیش از رویژن قبلی (${last.issuedOn}) است — صدور به گذشته برده نمی‌شود`);
  if (next.purpose === "IFC" && approvalRequired && !revisions.some((r) => r.approvedCode === 1 || r.approvedCode === 2))
    soft("این مدرک تأیید کارفرما لازم دارد؛ تا رویژنی با کد ۱ یا ۲ برنگشته، IFC صادر نمی‌شود");
  return out;
}

/** The latest revision issued on or before a date, whatever its purpose. */
export function currentOn(revisions, date) {
  const upTo = revisions.filter((r) => r.issuedOn && String(r.issuedOn) <= String(date));
  return upTo.length ? upTo[upTo.length - 1] : null;
}

/** The revision construction was to use on a date; none once voided. */
export function constructionOn(revisions, date) {
  const c = currentOn(revisions, date);
  if (!c || c.purpose === "VOID") return null;
  const upTo = revisions.filter((r) => r.issuedOn && String(r.issuedOn) <= String(date) && CONSTRUCTION.has(r.purpose));
  return upTo.length ? upTo[upTo.length - 1] : null;
}

/**
 * A record made from `revision` on `date`: was that the construction revision then?
 * @returns {{ok: boolean|null, expected: string|null, reason?: string}}
 *   ok null — the register has no construction revision for that date, so
 *   nothing can be said either way.
 */
export function usedRevisionCheck(revisions, revision, date) {
  const c = constructionOn(revisions, date);
  if (!c) return { ok: null, expected: null, reason: "در آن تاریخ رویژن IFC نداشته" };
  if (c.revision === revision) return { ok: true, expected: c.revision };
  const known = revisions.find((r) => r.revision === revision);
  return { ok: false, expected: c.revision,
    reason: known ? `رویژن ${revision} (${known.purpose}) — رویژن ساخت در آن تاریخ ${c.revision} بود`
      : `رویژن ${revision} در رجیستر مدارک نیست — رویژن ساخت در آن تاریخ ${c.revision} بود` };
}

/** Planned IFC against actual: days late, or null when either is missing. */
export function ifcLateness({ plannedIfcOn }, revisions, today) {
  if (!plannedIfcOn) return { daysLate: null, issued: null };
  const first = revisions.find((r) => r.purpose === "IFC");
  if (first) return { daysLate: Math.max(0, days(plannedIfcOn, first.issuedOn)), issued: first.issuedOn };
  return { daysLate: Math.max(0, days(plannedIfcOn, today)), issued: null };
}

/** An item of a transmittal on a date. */
export function transmittalItemState({ returnCode, responseDue }, today) {
  if (returnCode) return Number(returnCode) === 3 ? "rejected" : "returned";
  if (responseDue && String(responseDue) < String(today)) return "overdue";
  return "awaiting";
}

const day = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 86_400_000);
const days = (from, to) => day(to) - day(from);
