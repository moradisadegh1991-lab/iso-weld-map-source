/**
 * Performance test against the contract's guarantees, with no database in
 * sight.
 *
 * A GUARANTEE is the contract's: a parameter, a unit of measure, a value
 * the plant (or one unit) must reach — at least it ("min": capacity,
 * product purity) or at most it ("max": specific energy, emissions) — and
 * the clause it comes from. A minimum test duration is part of it only
 * when the contract states one. No tolerance is applied that the contract
 * does not state: the guarantee is read as written.
 *
 * A TEST covers the plant or one unit, over a stated window. It may be
 * recorded only once every subsystem in its scope has an accepted RFSU —
 * a performance test before start-up is certified measures nothing the
 * owner is buying. A scope with no subsystem at all cannot be judged.
 *
 * A result is judged, never entered as a verdict. A test is signed when
 * every guarantee in its scope has a measured value, and accepted by
 * someone other than its signer. Where a guarantee stands is its latest
 * ACCEPTED test: met, not met, or not yet tested — a failed test is a
 * fact, and the retest is a new test, not an edit.
 */

export const DIRECTIONS = { min: "دست‌کم", max: "حداکثر" };

const has = (v) => v !== null && v !== undefined && String(v).trim() !== "";
const num = (v) => (has(v) && Number.isFinite(Number(v)) ? Number(v) : null);

/** Problems with a guarantee as declared, or []. */
export function guaranteeProblems({ code, parameter, uom, direction, guaranteedValue, basis, minDurationH = null }) {
  const out = [];
  if (!/^[A-Za-z0-9._-]{2,30}$/.test(String(code || ""))) out.push("کد تضمین ۲ تا ۳۰ حرف و رقم لاتین است (مثلاً PG-01)");
  if (!has(parameter)) out.push("پارامتر لازم است");
  if (!has(uom)) out.push("واحد اندازه‌گیری لازم است");
  if (!DIRECTIONS[direction]) out.push("جهت تضمین: دست‌کم یا حداکثر");
  if (num(guaranteedValue) === null) out.push("مقدار تضمین‌شده عدد نیست");
  if (!has(basis)) out.push("بند قرارداد (مبنا) لازم است");
  if (has(minDurationH) && !(num(minDurationH) > 0)) out.push("حداقل مدت آزمون باید عدد مثبت باشد");
  return out;
}

/** Hours between two instants. */
export const hoursBetween = (from, to) => (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;

/**
 * One measured value against its guarantee, over the test window.
 * @returns {{ok: boolean|null, reason?: string}}  null = not measured
 */
export function judgeResult(g, measured, durationH) {
  const m = num(measured);
  if (m === null) return { ok: null, reason: "اندازه‌گیری نشده" };
  const reasons = [];
  const min = num(g.minDurationH);
  if (min !== null && durationH < min) reasons.push(`مدت آزمون ${round(durationH)} ساعت؛ قرارداد دست‌کم ${min} ساعت می‌خواهد`);
  const v = Number(g.guaranteedValue);
  if (g.direction === "min" && m < v) reasons.push(`${m} ${g.uom} کمتر از ${v} تضمین‌شده`);
  if (g.direction === "max" && m > v) reasons.push(`${m} ${g.uom} بیشتر از ${v} تضمین‌شده`);
  return reasons.length ? { ok: false, reason: reasons.join(" · ") } : { ok: true };
}

/**
 * Can a test be recorded over this scope and window?
 * @param scope [{code, rfsuAccepted}] the subsystems of the plant or unit
 */
export function testProblems({ scope, startedAt, endedAt, now = null }) {
  const out = [];
  if (!startedAt || !endedAt || !(new Date(endedAt) > new Date(startedAt))) out.push("بازهٔ آزمون درست نیست");
  else if (now && new Date(endedAt) > new Date(now)) out.push("پایان آزمون در آینده است");
  if (!scope.length) out.push("این محدوده ساب‌سیستمی ندارد؛ آزمون عملکرد روی آن قضاوت‌پذیر نیست");
  const pending = scope.filter((s) => !s.rfsuAccepted).map((s) => s.code);
  if (pending.length) out.push(`RFSU پذیرفته نشده: ${pending.slice(0, 10).join("، ")}${pending.length > 10 ? ` و ${pending.length - 10} دیگر` : ""}`);
  return out;
}

/** Why a test cannot be signed: a guarantee in its scope with no measured value. */
export function signProblems({ guarantees, results }) {
  if (!guarantees.length) return ["در این محدوده تضمینی تعریف نشده؛ آزمون چیزی را اثبات نمی‌کند"];
  const missing = guarantees.filter((g) => !results.some((r) => r.guaranteeId === g.id));
  return missing.length ? [`اندازه‌گیری نشده: ${missing.map((g) => g.code).join("، ")}`] : [];
}

/**
 * Where each guarantee stands: its latest accepted test decides.
 * @param tests [{id, acceptedAt, startedAt, endedAt, results: [{guaranteeId, measured}]}]
 */
export function guaranteeStatus(guarantees, tests) {
  const accepted = tests.filter((t) => t.acceptedAt).sort((a, b) => new Date(a.endedAt) - new Date(b.endedAt));
  return guarantees.map((g) => {
    const last = [...accepted].reverse().find((t) => t.results.some((r) => r.guaranteeId === g.id));
    if (!last) return { guaranteeId: g.id, code: g.code, status: "untested" };
    const r = last.results.find((x) => x.guaranteeId === g.id);
    const v = judgeResult(g, r.measured, hoursBetween(last.startedAt, last.endedAt));
    return { guaranteeId: g.id, code: g.code, status: v.ok ? "met" : "not_met", testId: last.id, measured: Number(r.measured), reason: v.reason || null };
  });
}

const round = (x) => Math.round(x * 10) / 10;
