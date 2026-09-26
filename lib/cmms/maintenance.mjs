/**
 * Handover to maintenance, phase 2 — the maintenance plan, spare parts and
 * periodic calibration — with no database in sight.
 *
 * THE PLAN. A task on an equipment tag: what is done, by which craft, how
 * long it takes, and on which strategy (ISO 14224 / EN 13306 terms):
 *   time_based       preventive on a fixed interval (calendar or running hours)
 *   condition_based  monitoring on an interval (vibration route, oil sample),
 *                    the work itself triggered by what it finds
 *   run_to_failure   a decision NOT to maintain preventively — still a
 *                    decision, with its basis, and so still a task
 * Every task cites its SOURCE: the OEM's manual (and its section), an
 * RCM/FMEA study, a statute or the insurer, or a company standard. The
 * platform never proposes an interval — "every 3 months because pumps
 * usually are" is exactly the guess the master plan forbids.
 *
 * A task is prepared, then approved by someone else, and then fixed; a
 * change is a new revision of the same task code that supersedes the old one
 * when it is approved. What goes to the CMMS is only what is approved.
 *
 * SPARE PARTS come from the vendor's SPIR (spare parts interchangeability
 * record), per tag, in three classes: commissioning (consumed before
 * handover), operational (typically the vendor's two-year list) and capital
 * or insurance spares. The vendor recommends; the owner approves a quantity.
 * A part number shared by several tags is the SPIR's interchangeability —
 * read off the rows, not typed.
 *
 * PERIODIC CALIBRATION. An instrument's next calibration is its last
 * PASSING calibration plus the interval its plan states (company standard,
 * OEM, statute). No plan, no due date; no passing calibration on record, no
 * due date either — "never calibrated" is reported as such, not as due.
 */

export const STRATEGIES = {
  time_based: "زمانی (PM دوره‌ای)",
  condition_based: "وضعیت‌محور (پایش / CBM)",
  run_to_failure: "تا خرابی (RTF) — تصمیم آگاهانه",
};
export const UNITS = { day: "روز", week: "هفته", month: "ماه", year: "سال", run_hours: "ساعت کارکرد" };
export const SOURCES = {
  oem: "دستورالعمل سازنده (IOM)",
  rcm: "مطالعهٔ RCM / FMEA",
  statutory: "الزام قانونی / بیمه",
  company: "استاندارد شرکت",
};
export const CRAFTS = {
  mechanical: "مکانیک", electrical: "برق", instrument: "ابزار دقیق", operations: "بهره‌برداری", civil: "سیویل", other: "سایر",
};
export const SPARE_CATEGORIES = {
  commissioning: "راه‌اندازی",
  operational: "بهره‌برداری (دوساله)",
  capital: "سرمایه‌ای / بیمه‌ای",
};

const has = (v) => !!String(v ?? "").trim();
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));

/** Problems with a PM task as written, or []. */
export function taskProblems(t) {
  const out = [];
  if (!has(t.taskCode)) out.push("کد تسک لازم است (مثلاً PM-01)");
  if (!has(t.title)) out.push("شرح تسک لازم است");
  if (!STRATEGIES[t.strategy]) out.push("راهبرد باید زمانی، وضعیت‌محور یا تا خرابی باشد");
  const iv = num(t.intervalValue);
  if (t.strategy === "run_to_failure") {
    if (iv !== null || has(t.intervalUnit)) out.push("برای «تا خرابی» بازه ثبت نمی‌شود");
  } else if (STRATEGIES[t.strategy]) {
    if (!(iv > 0)) out.push("بازهٔ تسک باید عدد مثبت باشد");
    if (!UNITS[t.intervalUnit]) out.push("واحد بازه لازم است (روز، هفته، ماه، سال یا ساعت کارکرد)");
  }
  if (!SOURCES[t.source]) out.push("منبع بازه لازم است: دستورالعمل سازنده، RCM، الزام قانونی یا استاندارد شرکت");
  if (!has(t.sourceRef)) out.push("مرجع منبع لازم است (شمارهٔ دفترچه و بخش، گزارش RCM، بند مقررات) — پلتفرم بازه پیشنهاد نمی‌دهد");
  if (has(t.craft) && !CRAFTS[t.craft]) out.push(`تخصص «${t.craft}» شناخته نشد`);
  const d = num(t.durationH);
  if (d !== null && !(d > 0)) out.push("مدت تسک باید مثبت باشد");
  return out;
}

/** "every 3 months", "every 4000 running hours", "run to failure". */
export function intervalText(t) {
  if (t.strategy === "run_to_failure") return "تا خرابی";
  const v = num(t.intervalValue);
  return v ? `هر ${Number.isInteger(v) ? v : v.toFixed(1)} ${UNITS[t.intervalUnit] || t.intervalUnit}` : "—";
}

/** Problems with a SPIR line, or []. */
export function spareProblems(s) {
  const out = [];
  if (!has(s.partNo)) out.push("شمارهٔ قطعهٔ سازنده لازم است");
  if (!has(s.description)) out.push("شرح قطعه لازم است");
  if (!SPARE_CATEGORIES[s.category]) out.push("دسته باید راه‌اندازی، بهره‌برداری یا سرمایه‌ای باشد");
  for (const [k, fa] of [["qtyInstalled", "نصب‌شده"], ["qtyRecommended", "پیشنهادی"], ["qtyApproved", "تأییدشده"]]) {
    const v = num(s[k]);
    if (v !== null && !(Number.isFinite(v) && v >= 0)) out.push(`مقدار ${fa} باید عدد نامنفی باشد`);
  }
  return out;
}

/**
 * Interchangeability, read off the rows: each part number (with its
 * manufacturer, when stated) and the tags that use it.
 */
export function interchangeability(parts) {
  const key = (p) => `${String(p.manufacturer || "").trim().toUpperCase()}|${String(p.partNo).trim().toUpperCase()}`;
  const groups = new Map();
  for (const p of parts) {
    const k = key(p);
    if (!groups.has(k)) groups.set(k, { partNo: p.partNo, manufacturer: p.manufacturer || null, description: p.description, tags: new Set() });
    groups.get(k).tags.add(p.tagNo);
  }
  return [...groups.values()].map((g) => ({ ...g, tags: [...g.tags].sort() })).filter((g) => g.tags.length > 1)
    .sort((a, b) => b.tags.length - a.tags.length || a.partNo.localeCompare(b.partNo));
}

/**
 * What stock covers of an approved quantity. `onHand` is the warehouse's
 * issuable balance of the linked item; no item linked, nothing to judge.
 */
export function spareCover({ qtyApproved, itemLinked, onHand }) {
  const need = num(qtyApproved);
  if (need === null) return { state: "not_decided" };
  if (!itemLinked) return { state: "not_stocked", need };
  const have = Number(onHand) || 0;
  return have >= need ? { state: "covered", need, have } : { state: "short", need, have, short: need - have };
}

/**
 * When an instrument is next calibrated.
 *
 * @param {object} args
 * @param {{intervalMonths:number}|null} args.plan
 * @param {string|null} args.lastPass   date of the last passing calibration
 * @param {boolean} args.lastFailed     the latest calibration on record failed
 * @param {string} args.today           ISO date
 * @param {number} [args.soonDays=30]   the "due soon" window — a view setting, not an engineering value
 */
export function calibrationDue({ plan, lastPass, lastFailed = false, today, soonDays = 30 }) {
  if (!plan) return { state: "no_plan" };
  if (lastFailed) return { state: "failed", text: "آخرین کالیبراسیون رد شده — تنظیم و کالیبراسیون دوباره" };
  if (!lastPass) return { state: "no_baseline", text: "هنوز کالیبراسیون قبول‌شده‌ای ثبت نشده" };
  const due = addMonths(lastPass, plan.intervalMonths);
  const days = Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000);
  return { state: days < 0 ? "overdue" : days <= soonDays ? "due_soon" : "ok", due, days };
}

/** Calendar months: 31 Jan + 1 month is 28/29 Feb, not 3 March. */
export function addMonths(isoDate, months) {
  const [y, m, d] = String(isoDate).slice(0, 10).split("-").map(Number);
  const total = y * 12 + (m - 1) + Number(months);
  const ny = Math.floor(total / 12), nm = total % 12;
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ny, nm, Math.min(d, last))).toISOString().slice(0, 10);
}
