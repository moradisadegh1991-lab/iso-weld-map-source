/**
 * Concrete acceptance: the civil module's deterministic engine.
 *
 * This is to civil what lib/engine.js is to piping. Nothing here reads a
 * drawing and nothing here guesses: it takes cylinder breaks as a lab
 * reports them and says whether the concrete of a class is acceptable, by
 * ACI 318 (§26.12, "Evaluation and acceptance of concrete").
 *
 * THE RULES, AS THE CODE STATES THEM
 *
 *   A strength test is the average of at least two 150×300 mm cylinders, or
 *   at least three 100×200 mm cylinders, from the same sample, broken at 28
 *   days or at the age designated for f′c.                       (§26.12.1.1)
 *
 *   The strength level of a CLASS of concrete is satisfactory when
 *     (a) every average of any three consecutive strength tests ≥ f′c, and
 *     (b) no strength test falls below f′c by more than 3.5 MPa when
 *         f′c ≤ 35 MPa, or by more than 0.10·f′c when f′c > 35 MPa.
 *                                                                (§26.12.3.1)
 *
 * Note what (a) is about: CONSECUTIVE tests of one class, in the order they
 * were made — across every pour of that class on the project, not within
 * one foundation. A foundation is judged by its own test under (b), and by
 * every three-test window its test belongs to under (a).
 *
 * WHERE THIS REFUSES TO ANSWER
 *
 * The same discipline as the rest of this repository (F-10): a check fed
 * something it cannot judge returns no verdict rather than a wrong one.
 *
 *   - cube results. Cube strength runs higher than cylinder strength for the
 *     same concrete, and cube conformity is a different rule set (EN 206).
 *     Judging cubes against a cylinder f′c would pass weak concrete.
 *   - a "test" of one 150 mm cylinder. It is a specimen, not a test.
 *   - specimens of mixed size or mixed age averaged together.
 *   - breaks at an age other than the one f′c is specified at. A 7-day
 *     result is information about early strength, not an acceptance test.
 *
 * Paragraph numbers are from ACI 318-19. Check them against the edition
 * your contract names.
 */

export const SPECIMENS = {
  cyl150: { title: "استوانه ۱۵۰×۳۰۰", family: "cylinder", minPerTest: 2 },
  cyl100: { title: "استوانه ۱۰۰×۲۰۰", family: "cylinder", minPerTest: 3 },
  cube150: { title: "مکعب ۱۵۰", family: "cube", minPerTest: 3 },
  cube100: { title: "مکعب ۱۰۰", family: "cube", minPerTest: 3 },
};

/** The lowest an individual test may be, by §26.12.3.1(b). */
export function individualLimit(fc) {
  const f = Number(fc);
  if (!Number.isFinite(f) || f <= 0) return null;
  return f <= 35 ? round1(f - 3.5) : round1(f * 0.9);
}

/**
 * One strength test from the specimens of one sample.
 *
 * @param {Array<{type: string, ageDays: number, mpa: number}>} specimens
 * @param {{ ageDays?: number }} spec  the age f′c is specified at (28 by default — the code's own default)
 * @returns {{valid: boolean, mpa?: number, n?: number, reason?: string}}
 */
export function strengthTest(specimens, { ageDays = 28 } = {}) {
  const list = (specimens || []).filter((s) => s && Number.isFinite(Number(s.mpa)));
  if (!list.length) return { valid: false, reason: "هیچ نتیجه‌ای ثبت نشده" };

  const types = new Set(list.map((s) => s.type));
  if (types.size > 1) return { valid: false, reason: "نمونه‌های با اندازهٔ متفاوت با هم میانگین گرفته نمی‌شوند" };
  const type = SPECIMENS[[...types][0]];
  if (!type) return { valid: false, reason: `نوع نمونهٔ «${[...types][0]}» شناخته نشد` };
  if (type.family !== "cylinder") {
    return { valid: false, reason: "نتیجهٔ مکعبی با معیار استوانه‌ای ACI 318 سنجیده نمی‌شود" };
  }

  const ages = new Set(list.map((s) => Number(s.ageDays)));
  if (ages.size > 1) return { valid: false, reason: "نمونه‌های با سن متفاوت با هم میانگین گرفته نمی‌شوند" };
  const age = [...ages][0];
  if (age !== Number(ageDays)) {
    return { valid: false, early: age < Number(ageDays),
      reason: `شکست ${age} روزه، آزمون پذیرش نیست (f′c در ${ageDays} روز تعریف شده)` };
  }

  if (list.length < type.minPerTest) {
    return { valid: false,
      reason: `یک آزمون مقاومت دست‌کم ${type.minPerTest} ${type.title} لازم دارد؛ ${list.length} ثبت شده` };
  }
  const mpa = round1(list.reduce((a, s) => a + Number(s.mpa), 0) / list.length);
  return { valid: true, mpa, n: list.length };
}

/**
 * The strength level of one class, test by test.
 *
 * @param {Array<{id: string, mpa: number, at: string}>} tests  valid strength tests of ONE class
 * @param {number} fc  specified compressive strength, MPa
 * @returns {{
 *   fc: number, limit: number,
 *   tests: Array<{id, mpa, at, individualOk, window?: number, windowOk?: boolean, verdict: string}>,
 *   satisfactory: boolean|null
 * }}
 *
 * Each test's verdict:
 *   "accepted"      — passes (b), and every three-test window it is part of passes (a)
 *   "provisional"   — passes (b), but the class has fewer than three tests so (a)
 *                     cannot be evaluated yet
 *   "low"           — fails (b): this test is below the individual limit
 *   "investigate"   — passes (b) but sits in a three-test window whose average is
 *                     below f′c; §26.12.4 low-strength investigation applies
 */
export function evaluateClass(tests, fc) {
  const f = Number(fc);
  const limit = individualLimit(f);
  if (limit === null) return { fc: null, limit: null, tests: [], satisfactory: null };

  const ordered = [...(tests || [])]
    .filter((t) => Number.isFinite(Number(t.mpa)))
    .sort((a, b) => String(a.at).localeCompare(String(b.at)) || String(a.id).localeCompare(String(b.id)));

  const out = ordered.map((t) => ({
    id: t.id, at: t.at, mpa: Number(t.mpa), individualOk: Number(t.mpa) >= limit,
  }));

  // Every window of three consecutive tests; a test belongs to up to three.
  const failedIn = new Set();
  for (let i = 2; i < out.length; i++) {
    const avg = round1((out[i - 2].mpa + out[i - 1].mpa + out[i].mpa) / 3);
    out[i].window = avg;
    out[i].windowOk = avg >= f;
    if (avg < f) {
      // Every test in the window carries the failing average — not only the
      // newest, which is where `window` lives. Otherwise the oldest test of a
      // failed window is held with no number to say why.
      for (const j of [i - 2, i - 1, i]) {
        failedIn.add(j);
        out[j].failedWindow = Math.min(out[j].failedWindow ?? Infinity, avg);
      }
    }
  }

  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    t.verdict = !t.individualOk ? "low"
      : failedIn.has(i) ? "investigate"
      : out.length < 3 ? "provisional"
      : "accepted";
  }

  return {
    fc: f, limit, tests: out,
    // Satisfactory only when there is enough to judge by (a) and nothing failed.
    satisfactory: out.length < 3 ? null : out.every((t) => t.verdict === "accepted"),
  };
}

/**
 * How many strength-test samples a pour needs.
 *
 * §26.12.2.1: at least once a day, and at least once for each 150 yd³ of a
 * class placed that day (about 115 m³ — the metric edition states its own
 * figure; set `perM3` from it). One pour is taken as one day's placing.
 * The slab/wall surface-area criterion is not applied: foundations are
 * governed by volume.
 */
export function samplesRequired(volumeM3, { perM3 = 114.7 } = {}) {
  const v = Number(volumeM3);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.max(1, Math.ceil(v / perM3));
}

/**
 * Has the specified curing period run out?
 *
 * @returns {boolean|null} null when the project has not stated a curing
 *   period — the duration is the project specification's to set, and a
 *   default here would decide when formwork comes off.
 */
export function curingComplete(pourDate, curingDays, today = new Date()) {
  if (!pourDate) return false;
  if (curingDays === null || curingDays === undefined || curingDays === "") return null;
  const d = Number(curingDays);
  if (!Number.isFinite(d) || d < 0) return null;
  const end = new Date(pourDate);
  end.setDate(end.getDate() + d);
  return new Date(today) >= end;
}

const round1 = (n) => Math.round(n * 10) / 10;
