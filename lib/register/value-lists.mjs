/**
 * The values a person picks rather than types on the isometric and weld-list
 * page (owner's request of 2026-11-01: «همه مقادیر ستون‌های جداول قابل انتخاب
 * باشد بغیر آنهایی که مقدارش را باید دستی وارد کرد»).
 *
 * Each list has built-in values (the usual ones), which a project replaces
 * with its own on the «مقادیر پیش‌فرض» page (/piping/defaults, saved in
 * value_list, db/migrations/096_value_list.sql). A list marked `fixed` is the
 * set the engine and the register understand and is not edited: a weld is
 * Shop or Field.
 *
 * Typed by hand, never a list: numbers that name a thing (weld, spool,
 * support, PT, drawing, sheet, revision, line), measured values (lengths,
 * quantities, pressures, temperatures, thicknesses) and free text
 * (description, note, stock code, Tie-in reference).
 *
 * A value read off a sheet that is not in the list is kept and shown as it
 * was read: a list offers values, it never changes one already given.
 */

export const NPS = ["1/2", "3/4", "1", "1.1/4", "1.1/2", "2", "2.1/2", "3", "3.1/2", "4", "5", "6", "8", "10", "12", "14", "16", "18",
  "20", "22", "24", "26", "28", "30", "32", "34", "36", "40", "42", "48", "52", "56", "60"];

/** key → { label, used: where it is picked, items: built-in values, fixed? } */
export const LISTS = {
  loc: { label: "محل جوش", used: "رجیستر جوش", items: ["Shop", "Field"], fixed: true },
  jointType: { label: "نوع اتصال", used: "رجیستر جوش، سرجوش‌های روی نقشه", items: ["BW", "SW", "Tie-in", "Closure", "Branch"] },
  nps: { label: "قطر (NPS)", used: "رجیستر جوش، نشان‌ها، BOM، قطر پیش‌فرض", items: NPS },
  schedule: { label: "Schedule / ضخامت", used: "رجیستر جوش، سرجوش‌ها، Schedule پیش‌فرض",
    items: ["5S", "10S", "10", "20", "30", "40S", "STD", "40", "60", "80S", "XS", "80", "100", "120", "140", "160", "XXS"] },
  material: { label: "جنس", used: "رجیستر جوش، سرجوش‌ها، اسپول‌ها",
    items: ["A106-B", "A53-B", "API 5L-B", "A333-6", "A335-P11", "A335-P22", "A312-TP304", "A312-TP304L", "A312-TP316", "A312-TP316L", "A790-S31803", "CuNi 90/10", "GRE", "HDPE"] },
  wps: { label: "WPS", used: "رجیستر جوش، سرجوش‌ها", items: [] },
  supportType: { label: "نوع ساپورت", used: "ساپورت‌ها", items: [] },
  pipingClass: { label: "کلاس لوله", used: "کلاس لوله، کلاس خط", items: [] },
  unit: { label: "واحد (Unit)", used: "مشخصات نقشه", items: [] },
  bomGroup: { label: "گروه BOM", used: "BOM", items: ["PIPE", "FITTINGS", "FLANGES", "GASKETS", "BOLTS", "VALVES", "SUPPORTS", "SPECIAL ITEMS"] },
  testFluid: { label: "سیال تست", used: "مشخصات خط", items: ["WATER", "FRESH WATER", "SEA WATER", "AIR", "N2"] },
  ndt: { label: "NDT", used: "مشخصات خط", items: ["100%RT", "10%RT", "5%RT", "10%RT+10%MT", "10%RT+10%PT", "100%RT+100%MT", "VT"] },
  pwht: { label: "PWHT", used: "مشخصات خط", items: ["YES", "NO", "-"] },
  paint: { label: "رنگ", used: "مشخصات خط", items: ["-"] },
  insulationType: { label: "نوع عایق", used: "مشخصات خط", items: ["-", "H", "P", "C"] },
};
export const LIST_KEYS = Object.keys(LISTS);

/** Which list a column picks from, by the column's own key (null: typed by hand). */
export const COLUMN_LIST = {
  loc: "loc", kind: "jointType", type: "jointType", nps: "nps", size: "nps", diam: "nps", schedule: "schedule", material: "material",
  wps: "wps", group: "bomGroup", pipingClass: "pipingClass", lineClass: "pipingClass", unit: "unit",
  testFluid: "testFluid", ndt: "ndt", pwht: "pwht", paint: "paint", insulationType: "insulationType",
};

const MAX_ITEMS = 300, MAX_LEN = 80;
const bad = (msg) => Object.assign(new Error(msg), { status: 400, code: "BAD_VALUE_LIST" });

/** A list's values as saved: trimmed, no empties, no repeats (case and spacing aside), in the order given. */
export function cleanItems(key, items) {
  if (!(key in LISTS)) throw bad(`فهرست ناشناخته: ${key}`);
  if (LISTS[key].fixed) throw bad(`فهرست «${LISTS[key].label}» ثابت است و موتور فقط همین مقادیر را می‌شناسد.`);
  if (!Array.isArray(items)) throw bad("مقادیر باید یک فهرست باشد.");
  const out = [], seen = new Set();
  for (const v of items) {
    const s = String(v ?? "").replace(/\s+/g, " ").trim();
    if (!s) continue;
    if (s.length > MAX_LEN) throw bad(`«${s.slice(0, 20)}…» بلندتر از ${MAX_LEN} نویسه است.`);
    const k = s.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
  }
  if (out.length > MAX_ITEMS) throw bad(`یک فهرست حداکثر ${MAX_ITEMS} مقدار دارد.`);
  return out;
}

/**
 * Every list as the page uses it: the project's own where it saved one,
 * else the built-in values. `saved` is { key: items[] }.
 */
export function resolveLists(saved = {}) {
  return Object.fromEntries(LIST_KEYS.map((k) => {
    const own = !LISTS[k].fixed && Array.isArray(saved?.[k]);
    return [k, { ...LISTS[k], items: own ? saved[k] : LISTS[k].items, own }];
  }));
}

/**
 * The options a picker shows: the list's values, and the current value first
 * when the list does not hold it (read off a sheet, or typed before the list
 * had it) — so picking never loses a value.
 */
export function optionsFor(items = [], current = "") {
  const cur = String(current ?? "").trim();
  const list = items.map(String);
  const known = !cur || list.some((v) => v.toUpperCase() === cur.toUpperCase());
  return { options: list, extra: known ? null : cur };
}
