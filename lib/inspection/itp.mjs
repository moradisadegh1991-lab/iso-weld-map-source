/**
 * Inspection: the Inspection & Test Plan and the requests made against it,
 * with no database in sight.
 *
 * THE ITP — for one kind of work (a foundation, a spool, a cable…), the
 * inspections it passes, in order. For each: what is checked, against which
 * clause, what the acceptance criterion is, which record proves it, and how
 * each PARTY takes part:
 *
 *   H  Hold          the work stops here until that party has inspected and
 *                    accepted. Nobody can waive it but the party itself, by
 *                    coming and accepting.
 *   W  Witness       the party is notified; if it does not come after proper
 *                    notice, the work goes on without it.
 *   R  Review        the party reviews the records; the work does not wait.
 *   S  Surveillance  the party may look in at any time; nothing waits.
 *
 *   Parties: the contractor, the company (client), and a third-party
 *   inspector (TPI).
 *
 * An ITP is a controlled document: prepared, then approved by someone else,
 * and then fixed. A change is a new revision, which supersedes the old one
 * when it is approved. Only an approved revision is inspected against.
 *
 * AN ACTIVITY MAY NAME A STEP of the item's precedence chain
 * (lib/platform/precedence.mjs). Then the step is where the inspection
 * bites: a step with a Hold or a Witness on it is not recorded as done until
 * an inspection request for that item has been RELEASED. A project with no
 * approved ITP for a kind of work records its steps as before — the gate is
 * the project's own plan, never a rule this file invents.
 *
 * THE INSPECTION REQUEST (IR, also RFI) — "item X is ready for activity Y,
 * come at time T". Its state is never stored; it is read from the results:
 *
 *   rejected   any party rejected it. It is closed; the work is corrected
 *              and a new request (a re-inspection) is raised.
 *   released   every Hold party accepted, and every Witness party accepted
 *              or did not come after proper notice.
 *   awaiting   anything else.
 *   cancelled  withdrawn by the requester before it was decided.
 *
 * PROPER NOTICE is the project's stated number of hours between the request
 * and the inspection. With no number stated, notice cannot be judged, and a
 * Witness party's absence waives nothing: the platform does not pick a
 * number of hours.
 *
 * MATERIAL RECEIPT IS THREE KINDS OF WORK, NOT ONE. A pressure-retaining or
 * primary-structural item (pipe, fitting, flange, valve, plate, structural
 * steel, bolting — the categories lib/warehouse/stock.mjs already tracks
 * heat/MTC traceability for) is received under a different plan than a reel
 * of cable or a transmitter, which is different again from a box of gaskets.
 * One "material" ITP applying to every lot meant a PMI hold written for pipe
 * also stopped a cable delivery. So a lot's kind of work is derived from its
 * item's category (materialScopeOf below), and a project writes a separate
 * ITP — with its own hold points — for each of the three it cares about.
 */
import { TRACEABLE } from "../warehouse/stock.mjs";

export const PARTIES = { contractor: "پیمانکار", company: "کارفرما", tpi: "بازرس شخص ثالث (TPI)" };

export const POINTS = {
  H: "توقف (Hold)",
  W: "حضور (Witness)",
  R: "بررسی مدارک (Review)",
  S: "نظارت (Surveillance)",
};

export const OUTCOMES = {
  accepted: "پذیرفته",
  accepted_comments: "پذیرفته با ملاحظات",
  rejected: "رد",
  not_attended: "حاضر نشد",
};

const ELECTRICAL_CATEGORIES = new Set(["cable", "instrument"]);

/**
 * The kinds of work an ITP can be written for: a chain of
 * lib/platform/precedence.mjs, and what the item inspected is.
 *
 * The three `material_*` scopes share `item: "lot"` and are told apart by
 * `categories` — the material_item categories a lot of that scope is drawn
 * from. `material_general` has no set: it is whatever the other two do not
 * claim, computed by materialScopeOf, never listed twice.
 */
export const SCOPES = {
  foundation:   { title: "فونداسیون", item: "tag" },
  structure:    { title: "سازهٔ فلزی", item: "tag" },
  rotating:     { title: "تجهیز دوّار", item: "tag" },
  static:       { title: "تجهیز ثابت", item: "tag" },
  fired:        { title: "کوره / هیتر", item: "tag" },
  piping_spool: { title: "اسپول پایپینگ", item: "spool" },
  cable:        { title: "کابل", item: "cable" },
  instrument:   { title: "ابزار دقیق", item: "instrument" },
  coating:      { title: "رنگ و عایق", item: "coating_item" },
  material_pressure:   { title: "دریافت کالا — تحت فشار / سازه‌ای (با پیگرد ذوب)", item: "lot", categories: TRACEABLE },
  material_electrical: { title: "دریافت کالا — الکتریکال و ابزار دقیق", item: "lot", categories: ELECTRICAL_CATEGORIES },
  material_general:    { title: "دریافت کالا — عمومی و مصرفی", item: "lot" },
};

/** Which material scope a stock item's category falls under. */
export function materialScopeOf(category) {
  for (const [k, v] of Object.entries(SCOPES)) if (v.categories?.has(category)) return k;
  return "material_general";
}

const ACCEPTED = new Set(["accepted", "accepted_comments"]);
const GATING = new Set(["H", "W"]);

/** The parties an activity involves, with their point. */
export function partiesOf(activity) {
  // Only a point that is one: a typed "X" is no party at all.
  return Object.keys(PARTIES).map((p) => ({ party: p, point: activity?.points?.[p] || null })).filter((x) => POINTS[x.point]);
}

/** Whether an activity stops the work: a Hold or a Witness for any party. */
export const gates = (activity) => partiesOf(activity).some((x) => GATING.has(x.point));

/**
 * Problems with one activity as written, or [].
 * @param {Array} chain  the scope's chain, to check a named step exists
 */
export function activityProblems(a, chain = null) {
  const out = [];
  if (!String(a?.title || "").trim()) out.push("شرح فعالیت بازرسی لازم است");
  if (!(Number.isInteger(a?.seq) && a.seq > 0)) out.push("شمارهٔ ردیف باید عدد صحیح مثبت باشد");
  for (const [p, v] of Object.entries(a?.points || {})) {
    if (!PARTIES[p]) out.push(`طرف «${p}» شناخته نشد`);
    else if (v && !POINTS[v]) out.push(`نقطهٔ «${v}» برای ${PARTIES[p]} شناخته نشد (H، W، R یا S)`);
  }
  if (!partiesOf(a).length) out.push("دست‌کم یک طرف باید نقطهٔ بازرسی داشته باشد");
  if (a?.stepCode && chain && !chain.some((s) => s.code === a.stepCode)) out.push(`مرحلهٔ «${a.stepCode}» در زنجیرهٔ این کار نیست`);
  return out;
}

/** Problems with an ITP revision about to be approved, or []. */
export function itpProblems({ activities = [], preparedBy = null }, { approverId = null, chain = null } = {}) {
  const out = [];
  if (!activities.length) out.push("ITP بدون فعالیت تأیید نمی‌شود");
  const seqs = activities.map((a) => a.seq);
  if (new Set(seqs).size !== seqs.length) out.push("شمارهٔ ردیف تکراری است");
  activities.forEach((a) => activityProblems(a, chain).forEach((p) => out.push(`ردیف ${a.seq ?? "?"}: ${p}`)));
  if (approverId && preparedBy && approverId === preparedBy) out.push("تهیه‌کنندهٔ ITP آن را تأیید نمی‌کند");
  return out;
}

/**
 * Was the notice proper? true / false, or null when the project has not
 * stated how much notice is due.
 */
export function noticeOk({ raisedAt, plannedAt, noticeHours }) {
  if (noticeHours === null || noticeHours === undefined || !Number.isFinite(Number(noticeHours))) return null;
  const given = (Date.parse(plannedAt) - Date.parse(raisedAt)) / 3_600_000;
  if (!Number.isFinite(given)) return null;
  return given >= Number(noticeHours);
}

/**
 * The state of a request, from its activity and the results recorded on it.
 *
 * @param {object} args
 * @param {object} args.activity   { points: {contractor, company, tpi} }
 * @param {Array}  args.results    [{ party, outcome }]
 * @returns {{ state, parties: Array<{party, point, outcome, satisfied, why}>, waitingOn: string[], notice }}
 */
export function irState({ activity, results = [], raisedAt, plannedAt, noticeHours = null, cancelled = false }) {
  const notice = noticeOk({ raisedAt, plannedAt, noticeHours });
  const byParty = Object.fromEntries(results.map((r) => [r.party, r.outcome]));
  const parties = partiesOf(activity).map(({ party, point }) => {
    const outcome = byParty[party] || null;
    let satisfied = true, why = null;
    if (point === "H") {
      satisfied = ACCEPTED.has(outcome);
      if (!satisfied) why = outcome === "not_attended" ? "نقطهٔ توقف با غیبت آزاد نمی‌شود" : "منتظر پذیرش";
    } else if (point === "W") {
      if (ACCEPTED.has(outcome)) satisfied = true;
      else if (outcome === "not_attended") {
        satisfied = notice === true;
        if (!satisfied) why = notice === null ? "مدت اطلاع‌رسانی پروژه اعلام نشده؛ غیبت چیزی را آزاد نمی‌کند"
          : "اطلاع‌رسانی کمتر از مدت اعلام‌شدهٔ پروژه بود";
      } else { satisfied = false; why = "منتظر حضور یا اعلام غیبت"; }
    }
    return { party, point, outcome, satisfied, why };
  });
  const rejected = results.some((r) => r.outcome === "rejected");
  const gating = parties.filter((x) => GATING.has(x.point));
  let state;
  if (cancelled) state = "cancelled";
  else if (rejected) state = "rejected";
  else if (gating.length ? gating.every((x) => x.satisfied) : results.some((r) => ACCEPTED.has(r.outcome))) state = "released";
  else state = "awaiting";
  const waitingOn = state === "awaiting" ? parties.filter((x) => !x.satisfied).map((x) => x.party) : [];
  return { state, parties, waitingOn, notice };
}

/**
 * Problems with a result about to be recorded, or [].
 *
 * @param {object} args
 * @param {string} args.party      the party the signer signs for (their membership's)
 * @param {string} args.at         when it is recorded (ISO)
 */
export function resultProblems({ activity, results = [], raisedAt, plannedAt, noticeHours = null, cancelled = false,
  party, outcome, at, signerId = null, raisedBy = null }) {
  const out = [];
  if (!PARTIES[party]) return ["برای ثبت نتیجهٔ بازرسی، طرف شما (پیمانکار، کارفرما یا TPI) باید در عضویت پروژه تعیین شده باشد"];
  if (!OUTCOMES[outcome]) out.push("نتیجه باید پذیرفته، پذیرفته با ملاحظات، رد یا حاضر نشد باشد");
  const point = activity?.points?.[party];
  if (!point) out.push(`${PARTIES[party]} در این فعالیت نقطهٔ بازرسی ندارد`);
  const s = irState({ activity, results, raisedAt, plannedAt, noticeHours, cancelled });
  if (s.state === "cancelled") out.push("درخواست لغو شده است");
  if (s.state === "rejected") out.push("درخواست رد شده و بسته است؛ برای بازرسی دوباره درخواست جدید ثبت کنید");
  if (results.some((r) => r.party === party)) out.push(`نتیجهٔ ${PARTIES[party]} قبلاً ثبت شده است`);
  if (Date.parse(at) < Date.parse(raisedAt)) out.push("نتیجه پیش از خود درخواست ثبت نمی‌شود");
  if (outcome === "not_attended") {
    // Absence is the contractor's statement about another party, made once
    // the appointment has passed. The contractor does not fail to attend
    // its own inspection.
    if (party === "contractor") out.push("غیبت را پیمانکار برای کارفرما یا TPI ثبت می‌کند، نه برای خودش");
    if (Date.parse(at) < Date.parse(plannedAt)) out.push("غیبت پیش از زمان بازرسی ثبت نمی‌شود");
  }
  // The inspecting party signs for itself: whoever raised the request does
  // not accept it on the company's or the TPI's behalf.
  if (party !== "contractor" && outcome !== "not_attended" && signerId && raisedBy && signerId === raisedBy) {
    out.push("درخواست‌دهنده نتیجهٔ کارفرما یا TPI را امضا نمی‌کند");
  }
  return out;
}

/**
 * Absence of another party is recorded by the contractor; the recorder's
 * party for a not_attended is therefore "contractor", and the party it is
 * ABOUT is named separately. This returns which party a result is about and
 * whether the signer may record it.
 */
export function resultParty({ signerParty, outcome, aboutParty = null }) {
  if (outcome === "not_attended") {
    if (signerParty !== "contractor") return { error: "غیبت یک طرف را پیمانکار ثبت می‌کند" };
    if (!aboutParty || aboutParty === "contractor") return { error: "طرفی که حاضر نشد را مشخص کنید (کارفرما یا TPI)" };
    return { party: aboutParty };
  }
  return { party: signerParty };
}

/**
 * The gate on a chain step: what stops it being recorded as done.
 *
 * @param {Array} activities  approved activities linked to this step
 * @param {Record<string, string>} released  activityId → state of the item's latest request
 * @returns {string[]} one line per unreleased Hold/Witness, or []
 */
export function stepGate(activities, latest = {}) {
  return activities.filter(gates).flatMap((a) => {
    const st = latest[a.id] || null;
    if (st === "released") return [];
    const who = partiesOf(a).filter((x) => GATING.has(x.point)).map((x) => `${x.point}: ${PARTIES[x.party]}`).join("، ");
    const now = !st ? "درخواست بازرسی ثبت نشده"
      : st === "rejected" ? "آخرین بازرسی رد شد؛ بازرسی دوباره لازم است"
      : st === "cancelled" ? "درخواست لغو شد" : "منتظر نتیجهٔ بازرسی";
    return [`ITP ${a.itpNo} ردیف ${a.seq} «${a.title}» (${who}) آزاد نشده — ${now}`];
  });
}
