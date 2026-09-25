/**
 * Completions: piping test packages and mechanical completion (MC).
 *
 * TEST PRESSURE — ASME B31.3 (paragraph numbers from the 2020 edition;
 * check them against the edition the contract names):
 *
 *   hydrostatic  §345.4.2   PT = 1.5 · P · Rr,  Rr = ST / S ≤ 6.5
 *                ST, S = allowable stress at test and at design temperature.
 *                Rr is ENGINEERING INPUT per package — the platform holds
 *                no stress tables and does not assume Rr = 1, which is only
 *                true when the design temperature is low enough that the two
 *                allowables are equal. No Rr, no test pressure.
 *   pneumatic    §345.5.4   PT = 1.1 · P
 *   hold         §345.2.2(a) at least 10 minutes at test pressure.
 *
 *   P is the design pressure from each line's piping class. A package whose
 *   lines differ in design pressure is flagged: one test pressure cannot
 *   be right for all of them without an engineer saying so, and the
 *   package tests at the highest the lines require.
 *
 * READY TO TEST (the pre-test walkdown the data can answer) — every weld on
 * the package's lines made and examined, PWHT done where required, every
 * permanent support installed. A line with no welds in the register is not
 * "nothing to do"; it is unknown and holds the package.
 *
 * A TEST passes when the recorded pressure reaches PT, the hold reaches 10
 * minutes, the gauge's calibration certificate is named and no leak was
 * found. A pass is then ACCEPTED by someone other than the recorder; only
 * an accepted pass completes the package.
 *
 * MECHANICAL COMPLETION of a subsystem — nothing the certificate certifies
 * may be open: every tag with a precedence chain ready, every line in a
 * package whose test is accepted, every cable and instrument tested, no
 * open punch A, no open NCR. The platform prepares; a person signs, and a
 * second person (the client) accepts.
 */

export const B31_3 = { rrMax: 6.5, hydroFactor: 1.5, pneuFactor: 1.1, holdMin: 10 };
export const MEDIA = { hydrostatic: "هیدرواستاتیک", pneumatic: "پنوماتیک" };

/**
 * Minimum test pressure for a package.
 * @returns {{barg: number|null, reason?: string, basis?: string}}
 */
export function testPressure({ medium, designPressures, stressRatio }) {
  if (!MEDIA[medium]) return { barg: null, reason: "نوع تست تعیین نشده" };
  const ps = (designPressures || []).map(num);
  if (!ps.length) return { barg: null, reason: "پکیج خطی ندارد" };
  if (ps.some((p) => p === null)) return { barg: null, reason: "فشار طراحی کلاس لوله برای بعضی خطوط ثبت نشده" };
  if (ps.some((p) => p <= 0)) return { barg: null, reason: "فشار طراحی صفر یا منفی — تست فشار داخلی معنا ندارد" };
  const P = Math.max(...ps);
  if (medium === "pneumatic") {
    return { barg: r3(B31_3.pneuFactor * P), basis: `B31.3 §345.5.4: 1.1 × ${P}` };
  }
  const Rr = num(stressRatio);
  if (Rr === null) return { barg: null, reason: "نسبت تنش مجاز ST/S (Rr) برای این پکیج اعلام نشده" };
  if (!(Rr > 0 && Rr <= B31_3.rrMax)) return { barg: null, reason: `Rr باید بزرگ‌تر از صفر و حداکثر ${B31_3.rrMax} باشد` };
  return { barg: r3(B31_3.hydroFactor * P * Rr), basis: `B31.3 §345.4.2: 1.5 × ${P} × ${Rr}` };
}

/** Lines of a package whose design pressures differ — one test pressure needs an engineer's word. */
export const mixedPressures = (designPressures) =>
  new Set((designPressures || []).map(num).filter((p) => p !== null)).size > 1;

/**
 * What holds a package from its test, line by line.
 * @param {Array<{lineNo, welds, welded, examined, pwhtRequired, pwhtDone, supports, supportsInstalled}>} lines
 */
export function packBlockers(lines) {
  const out = [];
  if (!lines.length) return [{ line: null, what: "پکیج خطی ندارد" }];
  for (const l of lines) {
    if (!l.welds) { out.push({ line: l.lineNo, what: "جوشی از این خط در رجیستر نیست — نامعلوم" }); continue; }
    if (l.welded < l.welds) out.push({ line: l.lineNo, what: `${l.welds - l.welded} جوش انجام نشده` });
    if (l.examined < l.welds) out.push({ line: l.lineNo, what: `${l.welds - l.examined} جوش بدون NDT پذیرفته‌شده` });
    if (l.pwhtDone < l.pwhtRequired) out.push({ line: l.lineNo, what: `${l.pwhtRequired - l.pwhtDone} جوش منتظر PWHT` });
    if (l.supportsInstalled < l.supports) out.push({ line: l.lineNo, what: `${l.supports - l.supportsInstalled} ساپورت نصب نشده` });
  }
  return out;
}

/**
 * The verdict on a recorded test.
 * @returns {{pass: boolean, reasons: string[]}}
 */
export function judgeTest({ requiredBarg, achievedBarg, holdMin, gaugeCert, leaks }) {
  const reasons = [];
  const req = num(requiredBarg), got = num(achievedBarg), hold = num(holdMin);
  if (req === null) reasons.push("فشار تست لازم معلوم نیست");
  if (got === null) reasons.push("فشار اعمال‌شده ثبت نشده");
  else if (req !== null && got < req) reasons.push(`فشار ${got} barg کمتر از حداقل ${req} barg است`);
  if (hold === null || hold < B31_3.holdMin) reasons.push(`نگه‌داشت کمتر از ${B31_3.holdMin} دقیقه (B31.3 §345.2.2)`);
  if (!String(gaugeCert || "").trim()) reasons.push("گواهی کالیبراسیون گیج ثبت نشده");
  if (leaks !== false) reasons.push(leaks === true ? "نشتی مشاهده شد" : "نتیجهٔ بازرسی نشتی ثبت نشده");
  return { pass: reasons.length === 0, reasons };
}

/**
 * Mechanical completion readiness for one subsystem.
 * @param {object} s
 * @param {Array<{tagNo, ready, pct}>} s.tags        tags with a precedence chain
 * @param {Array<{lineNo, packNo, accepted}>} s.lines lines filed in the subsystem
 * @param {{items, tested}} s.cables
 * @param {{items, tested}} s.instruments
 * @param {number} s.punchA   open punch A
 * @param {number} s.ncrOpen  open NCRs
 */
export function mcReadiness({ tags = [], lines = [], cables = { items: 0, tested: 0 },
  instruments = { items: 0, tested: 0 }, punchA = 0, ncrOpen = 0 }) {
  const blockers = [];
  const notReady = tags.filter((t) => !t.ready);
  if (notReady.length) blockers.push({ kind: "tags", count: notReady.length, detail: notReady.map((t) => `${t.tagNo} (${t.pct}%)`) });
  const noPack = lines.filter((l) => !l.packNo);
  if (noPack.length) blockers.push({ kind: "no_pack", count: noPack.length, detail: noPack.map((l) => l.lineNo) });
  const untested = lines.filter((l) => l.packNo && !l.accepted);
  if (untested.length) blockers.push({ kind: "untested", count: untested.length, detail: untested.map((l) => `${l.lineNo} (${l.packNo})`) });
  if (cables.tested < cables.items) blockers.push({ kind: "cables", count: cables.items - cables.tested, detail: [] });
  if (instruments.tested < instruments.items) blockers.push({ kind: "instruments", count: instruments.items - instruments.tested, detail: [] });
  if (punchA > 0) blockers.push({ kind: "punch_a", count: punchA, detail: [] });
  if (ncrOpen > 0) blockers.push({ kind: "ncr", count: ncrOpen, detail: [] });
  const scope = tags.length + lines.length + cables.items + instruments.items;
  // A subsystem with nothing filed under it is not complete; it is empty.
  if (!scope) blockers.push({ kind: "empty", count: 0, detail: [] });
  return { ready: blockers.length === 0, blockers, scope };
}

export const BLOCKER_FA = {
  tags: "تگ‌های آماده‌نشده", no_pack: "خط بدون پکیج تست", untested: "خط با تست پذیرفته‌نشده",
  cables: "کابل تست‌نشده", instruments: "ابزار آماده‌نشده", punch_a: "Punch A باز", ncr: "NCR باز",
  empty: "چیزی در این ساب‌سیستم ثبت نشده",
};

const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const r3 = (x) => Math.round(x * 1000) / 1000;
