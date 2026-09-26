/**
 * Pre-commissioning, Ready For Commissioning (RFC), commissioning and Ready
 * For Start-Up (RFSU), with no database in sight.
 *
 *   MC → pre-commissioning checklists → RFC → commissioning procedures → RFSU
 *
 * Both phases use the same machinery: the project declares its checklists
 * (a "B" ITR before RFC, a commissioning procedure / "C" ITR after it), each
 * owed on every item of its kind, a pass counting once someone else accepts
 * it. What differs is when a record is allowed and which certificate it
 * feeds.
 *
 * After mechanical completion a subsystem is prepared for its first process
 * fluid: lines flushed and dried, motors run solo, instrument loops checked
 * with the DCS, cables energised. Each is a CHECKLIST (the "B" ITR of most
 * completions systems) that the project declares — what applies to what —
 * and a record against each item it applies to.
 *
 *   A checklist applies to one kind of item: the subsystem itself (once),
 *   its rotating / static / fired equipment, its lines, cables, instruments
 *   or loops. The platform does not decide which checks a project runs; the
 *   project's commissioning procedure does, and declares them here.
 *
 *   An attempt is pass or fail. A fail says why. A pass counts once someone
 *   other than the performer accepts it. The latest attempt decides: a pass
 *   after a fail is the retest; a fail after a pass reopens the item.
 *
 *   Pre-commissioning is recorded on a subsystem whose MC has been accepted:
 *   before that, the system is still being built, and a flushing record on
 *   it records nothing about the system that will be handed over.
 *
 * RFC is signed when:
 *   · MC is accepted;
 *   · every declared pre-commissioning checklist is accepted on every item it
 *     applies to — and at least one is declared: with none, pre-commissioning
 *     is not "complete", it is undefined, and nothing is certified;
 *   · no punch item of category A is open;
 *   · no NCR on the subsystem is open.
 *
 * Commissioning procedures are recorded once RFC is ACCEPTED, and no
 * pre-commissioning record is added once RFC is signed — what RFC certified
 * stays what it certified.
 *
 * RFSU is signed when:
 *   · RFC is accepted;
 *   · every declared commissioning procedure is accepted on every item it
 *     applies to, at least one declared (same reason as RFC);
 *   · no punch item of category A or B is open (B is the RFSU category);
 *   · no NCR on the subsystem is open.
 * The signer of either certificate is never the one who accepts it.
 */

export const PHASES = { precom: "پیش‌راه‌اندازی (قبل از RFC)", commissioning: "راه‌اندازی (بین RFC و RFSU)" };

export const APPLIES = {
  subsystem: "ساب‌سیستم (یک بار)",
  rotating: "تجهیز دوّار",
  static: "تجهیز ثابت",
  fired: "کوره / هیتر",
  line: "خط",
  cable: "کابل",
  instrument: "ابزار",
  loop: "لوپ",
};

export const RESULTS = { pass: "قبول", fail: "رد" };

/** Problems with a checklist as declared, or []. */
export function templateProblems({ code, title, appliesTo, phase = "precom" }) {
  const out = [];
  if (!PHASES[phase]) out.push("مرحلهٔ چک‌لیست باید پیش‌راه‌اندازی یا راه‌اندازی باشد");
  if (!/^[A-Za-z0-9._-]{2,30}$/.test(String(code || ""))) out.push("کد چک‌لیست ۲ تا ۳۰ حرف و رقم لاتین است (مثلاً B-MEC-01)");
  if (!String(title || "").trim()) out.push("عنوان چک‌لیست لازم است");
  if (!APPLIES[appliesTo]) out.push("مشخص کنید چک‌لیست به چه چیزی اعمال می‌شود");
  return out;
}

/**
 * Every check a subsystem owes: each active checklist × each item it
 * applies to.
 * @param {Array} templates  [{ id, code, title, appliesTo, active }]
 * @param {Record<string, Array<{ref, label}>>} items  by kind; `subsystem` has the one subsystem
 */
export function expectedChecks(templates, items) {
  return templates.filter((t) => t.active !== false).flatMap((t) =>
    (items[t.appliesTo] || []).map((it) => ({ templateId: t.id, code: t.code, title: t.title, phase: t.phase || "precom",
      itemKind: t.appliesTo, itemRef: it.ref, label: it.label })));
}

/**
 * Where one check stands, from its attempts (oldest first).
 *   accepted · passed (awaiting acceptance) · failed · open (nothing yet)
 */
export function checkState(attempts = []) {
  const last = attempts[attempts.length - 1];
  if (!last) return "open";
  if (last.result === "fail") return "failed";
  return last.acceptedBy ? "accepted" : "passed";
}

/**
 * Problems with an attempt about to be recorded, or [].
 * A pre-commissioning record needs MC accepted and no RFC signed yet; a
 * commissioning record needs RFC accepted and no RFSU signed yet.
 */
export function attemptProblems({ phase = "precom", mcAccepted, rfcSigned = false, rfcAccepted = false, rfsuSigned = false,
  result, note, performedOn, today = null, applies = true }) {
  const out = [];
  if (phase === "commissioning") {
    if (!rfcAccepted) out.push("راه‌اندازی پس از پذیرش RFC ساب‌سیستم ثبت می‌شود");
    if (rfsuSigned) out.push("RFSU این ساب‌سیستم امضا شده است");
  } else {
    if (!mcAccepted) out.push("پیش‌راه‌اندازی پس از پذیرش MC ساب‌سیستم ثبت می‌شود");
    if (rfcSigned) out.push("RFC این ساب‌سیستم امضا شده است؛ آنچه تأیید کرده عوض نمی‌شود");
  }
  if (!applies) out.push("این چک‌لیست به این آیتم اعمال نمی‌شود");
  if (!RESULTS[result]) out.push("نتیجه باید قبول یا رد باشد");
  if (result === "fail" && !String(note || "").trim()) out.push("رد بدون شرح ثبت نمی‌شود");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(performedOn || ""))) out.push("تاریخ انجام لازم است");
  else if (today && performedOn > today) out.push("تاریخ انجام در آینده است");
  return out;
}

/** Problems with accepting an attempt, or []. */
export function acceptProblems({ attempt, latest, userId }) {
  const out = [];
  if (!attempt) return ["رکورد پیدا نشد"];
  if (attempt.result !== "pass") out.push("فقط رکورد قبول پذیرفته می‌شود");
  if (attempt.acceptedBy) out.push("این رکورد پیش‌تر پذیرفته شده است");
  if (latest && latest.id !== attempt.id) out.push("رکورد جدیدتری برای این آیتم ثبت شده؛ همان را بپذیرید");
  if (userId && attempt.performedBy === userId) out.push("انجام‌دهنده، کار خودش را نمی‌پذیرد");
  return out;
}

const owedBlocker = (checks) => {
  const owed = checks.filter((c) => c.state !== "accepted");
  return owed.length ? [{ kind: "checks", count: owed.length, detail: owed.slice(0, 20).map((c) => `${c.code} · ${c.label}`) }] : [];
};

/**
 * RFC readiness, over the pre-commissioning checks only.
 * @returns {{ ready, blockers: Array<{kind, count?, detail?}> }}
 */
export function rfcReadiness({ mcAccepted, templatesDeclared, checks = [], punchA = 0, ncrOpen = 0 }) {
  const blockers = [];
  if (!mcAccepted) blockers.push({ kind: "mc" });
  if (!templatesDeclared) blockers.push({ kind: "no_templates" });
  blockers.push(...owedBlocker(checks));
  if (punchA) blockers.push({ kind: "punch_a", count: punchA });
  if (ncrOpen) blockers.push({ kind: "ncr", count: ncrOpen });
  return { ready: blockers.length === 0, blockers };
}

/** RFSU readiness, over the commissioning procedures only. */
export function rfsuReadiness({ rfcAccepted, templatesDeclared, checks = [], punchAB = 0, ncrOpen = 0 }) {
  const blockers = [];
  if (!rfcAccepted) blockers.push({ kind: "rfc" });
  if (!templatesDeclared) blockers.push({ kind: "no_procedures" });
  blockers.push(...owedBlocker(checks));
  if (punchAB) blockers.push({ kind: "punch", count: punchAB });
  if (ncrOpen) blockers.push({ kind: "ncr", count: ncrOpen });
  return { ready: blockers.length === 0, blockers };
}

export const RFSU_BLOCKER_FA = {
  mc: "MC پذیرفته نشده",
  no_templates: "چک‌لیست پیش‌راه‌اندازی تعریف نشده — چیزی برای تأیید نیست",
  rfc: "RFC پذیرفته نشده",
  no_procedures: "روال راه‌اندازی تعریف نشده — چیزی برای تأیید نیست",
  checks: "چک‌لیست باز",
  punch_a: "Punch A باز",
  punch: "Punch A/B باز",
  ncr: "NCR باز",
};
