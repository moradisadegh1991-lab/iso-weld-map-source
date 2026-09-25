/**
 * Punch list and non-conformance: the rules, with no database in sight.
 *
 * PUNCH — an item found on a walkdown that is not as it should be.
 *
 *   A   blocks mechanical completion of its subsystem.
 *   B   does not block MC, blocks ready-for-start-up (RFSU).
 *   C   blocks neither; carried into handover.
 *
 *   open ─clear→ cleared ─verify→ closed
 *                   └─reject→ open           (the fix was not accepted)
 *
 *   The person who verifies is never the person who cleared: the one who
 *   did the work does not accept it. A change of category is a recorded
 *   event with a reason — "A downgraded to B the day before MC" is the
 *   single commonest way a punch list lies, so it is never silent.
 *
 * NCR — a product or process that does not meet a requirement.
 *
 *   open ─propose→ proposed ─approve→ approved ─implement→ implemented ─close→ closed
 *                     └─reject→ open
 *
 *   Disposition is one of use-as-is, repair, rework, reject. Use-as-is and
 *   repair leave the item different from the drawing, so they are
 *   concessions: their approval is an engineering signature (the caller
 *   checks the role), and the approver is never the proposer. Closure needs
 *   a root cause and a corrective action — an NCR closed without them is a
 *   fix, not a correction, and the next one is already on its way — and the
 *   person who closes did not implement.
 *
 * ESCALATION — by age against the NCR's own response date:
 *   0 on time · 1 overdue (to the responsible contractor's management) ·
 *   2 overdue by more than the project's stated escalation period (to the
 *   project manager). With no period stated, level 2 is never reached and
 *   the result says so; the platform does not pick a number of days.
 */

export const PUNCH_CATEGORIES = {
  A: "مانع MC",
  B: "مانع RFSU (راه‌اندازی)",
  C: "بدون توقف — به تحویل منتقل می‌شود",
};

export const DISPOSITIONS = {
  use_as_is: "استفاده به همین صورت (Use-as-is)",
  repair: "تعمیر (Repair)",
  rework: "دوباره‌کاری طبق نقشه (Rework)",
  reject: "مردود / جایگزینی (Reject)",
};
/** Dispositions that leave the item unlike its drawing: a concession, signed by engineering. */
export const CONCESSIONS = new Set(["use_as_is", "repair"]);

export const NCR_SEVERITY = { major: "عمده", minor: "جزئی" };

// ── punch ────────────────────────────────────────────────────────────────

/** Problems with a punch transition, or [] when it may go ahead. */
export function punchProblems(item, action, { actorId, note } = {}) {
  const out = [];
  const s = item.status;
  if (action === "clear") {
    if (s !== "open") out.push("فقط آیتم باز رفع می‌شود");
    if (!txt(note)) out.push("شرح کار انجام‌شده برای رفع لازم است");
  } else if (action === "verify") {
    if (s !== "cleared") out.push("فقط آیتمِ رفع‌شده تأیید می‌شود");
    if (actorId && item.clearedBy && actorId === item.clearedBy) out.push("کسی که رفع کرده، تأیید نمی‌کند");
  } else if (action === "reject") {
    if (s !== "cleared") out.push("فقط آیتمِ رفع‌شده برگشت می‌خورد");
    if (!txt(note)) out.push("دلیل نپذیرفتن رفع لازم است");
  } else if (action === "recategorise") {
    if (s === "closed") out.push("آیتم بسته دسته‌بندی دوباره نمی‌شود");
    if (!txt(note)) out.push("تغییر دسته بدون دلیل ثبت نمی‌شود");
  } else out.push(`اقدام «${action}» شناخته نشد`);
  return out;
}

export function punchState(item, today) {
  if (item.status === "closed") return "closed";
  if (item.status === "cleared") return "cleared";
  if (item.dueOn && String(item.dueOn) < String(today)) return "overdue";
  return "open";
}

/**
 * What a subsystem's punch list blocks. Anything not closed counts —
 * a cleared item nobody has verified is still open to the person signing.
 */
export function punchBlocks(items) {
  const live = items.filter((i) => i.status !== "closed");
  return {
    mc: live.filter((i) => i.category === "A").length,
    rfsu: live.filter((i) => i.category === "A" || i.category === "B").length,
    carried: live.filter((i) => i.category === "C").length,
  };
}

// ── NCR ──────────────────────────────────────────────────────────────────

const NEXT = { propose: ["open", "proposed"], approve: ["proposed", "approved"], rejectDisposition: ["proposed", "open"],
  implement: ["approved", "implemented"], close: ["implemented", "closed"] };

/**
 * Problems with an NCR transition, or [] when it may go ahead.
 * @param {object} n       the NCR as it stands (camelCase)
 * @param {string} action  propose | approve | rejectDisposition | implement | close
 * @param {object} input   the fields the action brings, and actorId / actorIsEngineer
 */
export function ncrProblems(n, action, input = {}) {
  const step = NEXT[action];
  if (!step) return [`اقدام «${action}» شناخته نشد`];
  const out = [];
  if (n.status !== step[0]) out.push(`در وضعیت «${n.status}» این اقدام ممکن نیست`);
  const actor = input.actorId;
  if (action === "propose") {
    if (!DISPOSITIONS[input.disposition]) out.push("نوع دیسپوزیشن را انتخاب کنید");
    if (!txt(input.dispositionNote)) out.push("شرح دیسپوزیشن لازم است");
  } else if (action === "approve") {
    if (actor && actor === n.proposedBy) out.push("پیشنهاددهندهٔ دیسپوزیشن آن را تأیید نمی‌کند");
    if (CONCESSIONS.has(n.disposition) && !input.actorIsEngineer)
      out.push("«استفاده به همین صورت» و «تعمیر» ارفاق‌اند و تأییدشان امضای مهندسی می‌خواهد");
  } else if (action === "rejectDisposition") {
    if (!txt(input.note)) out.push("دلیل رد دیسپوزیشن لازم است");
  } else if (action === "implement") {
    if (!txt(input.note)) out.push("شرح اجرای دیسپوزیشن لازم است");
  } else if (action === "close") {
    if (!txt(n.rootCause ?? input.rootCause)) out.push("علت ریشه‌ای ثبت نشده");
    if (!txt(n.correctiveAction ?? input.correctiveAction)) out.push("اقدام اصلاحی (جلوگیری از تکرار) ثبت نشده");
    if (actor && actor === n.implementedBy) out.push("اجراکننده، NCR را نمی‌بندد");
  }
  return out;
}

/** The status an action leads to. */
export const ncrAfter = (action) => NEXT[action]?.[1] ?? null;

/**
 * Escalation level on a date.
 * @returns {{level: 0|1|2, daysOverdue: number, capped: boolean}}
 *   capped — overdue, but the project states no escalation period, so
 *   level 2 cannot be decided.
 */
export function ncrEscalation(n, today, escalationDays) {
  if (n.status === "closed" || !n.responseDue) return { level: 0, daysOverdue: 0, capped: false };
  const d = days(n.responseDue, today);
  if (d <= 0) return { level: 0, daysOverdue: 0, capped: false };
  const e = escalationDays === null || escalationDays === undefined || escalationDays === "" ? null : Number(escalationDays);
  if (e === null || !Number.isFinite(e)) return { level: 1, daysOverdue: d, capped: true };
  return { level: d > e ? 2 : 1, daysOverdue: d, capped: false };
}

/** Open NCRs a subsystem's MC waits for: anything not closed. */
export const ncrBlocks = (ncrs) => ncrs.filter((n) => n.status !== "closed").length;

const txt = (v) => typeof v === "string" && v.trim().length > 0;
const day = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 86_400_000);
const days = (from, to) => day(to) - day(from);
