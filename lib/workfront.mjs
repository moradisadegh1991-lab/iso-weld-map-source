/**
 * The work front: what can be started, where, and when — from what the
 * chains say is next and what the warehouse and the POs say about material.
 *
 * An item is on the front when its next step is open (every predecessor
 * done: lib/platform/precedence.mjs). WHEN it can start is its material:
 *
 *   ready / not needed      → today
 *   short, arriving ≤ 7 d   → this week
 *   short, arriving ≤ 30 d  → this month
 *   short, later or no PO   → later
 *   not known               → «نامعلوم» — listed apart, never guessed ready
 *
 * The horizons nest: this week's front includes today's, this month's
 * includes the week's. "All" is every item with work left, including those
 * still waiting on a predecessor.
 *
 * Fronts are the places work happens. Two fronts with open work are two
 * crews that can be working at the same time — the spool shop does not wait
 * for the foundations, because no chain puts one before the other.
 */
export const FRONTS = {
  shop:        "کارگاه پایپینگ (پیش‌ساخت اسپول)",
  civil:       "سایت — سیویل و سازه",
  equipment:   "سایت — نصب تجهیزات",
  piping_site: "سایت — پایپینگ (نصب، جوش سایت، تست)",
  ei:          "سایت — برق و ابزار دقیق",
  coating:     "رنگ و عایق",
};

export const HORIZONS = { day: "امروز", week: "این هفته (۷ روز)", month: "این ماه (۳۰ روز)", all: "کل کار باقی‌مانده" };

/** Spool steps done in the shop; the rest of the spool chain is site work. */
export const SHOP_STEPS = new Set(["released", "fit_up", "shop_weld", "shop_ndt"]);

const FRONT_OF_DISCIPLINE = { civil: "civil", structural: "civil", equipment: "equipment", piping: "piping_site",
  electrical: "ei", instrumentation: "ei", coating: "coating" };

/** The front a step of a chain is worked on. */
export function frontOf(kind, step) {
  if (kind === "spool") return SHOP_STEPS.has(step.code) ? "shop" : step.code === "painted" ? "coating" : "piping_site";
  if (kind === "cable" || kind === "instrument") return "ei";
  if (kind === "coating") return "coating";
  return FRONT_OF_DISCIPLINE[step.discipline] || "equipment";
}

/**
 * The step the item is waiting to have done next: the first open one (not
 * done, not blocked, not n/a) — else the first blocked one, with what it
 * waits on. A step already claimed or in progress is still the next step.
 */
export function nextStep(steps = []) {
  const live = steps.filter((s) => s.status !== "done" && !s.na);
  if (!live.length) return null;
  const open = live.find((s) => !s.blocked);
  if (open) return { step: open, open: true };
  return { step: live[0], open: false, waitingOn: (live[0].waitingOn || []).map((w) => w.title || w) };
}

const dayMs = 86_400_000;
export const daysBetween = (from, to) => Math.round((Date.parse(`${String(to).slice(0, 10)}T00:00:00Z`) - Date.parse(`${String(from).slice(0, 10)}T00:00:00Z`)) / dayMs);

/** When an open item can start, from its material; blocked items wait on their chain. */
export function horizonOf({ open, material }, today) {
  if (!open) return "blocked";
  const m = material || { state: "na" };
  if (m.state === "ready" || m.state === "na") return "day";
  if (m.state === "unknown") return "unknown";
  if (!m.eta) return "later";
  const d = daysBetween(today, m.eta);
  if (d <= 7) return "week";
  if (d <= 30) return "month";
  return "later";
}

const RANK = { day: 0, week: 1, month: 2, later: 3, unknown: 4, blocked: 5 };

/** Is an item on the front of this horizon (the horizons nest)? */
export function inHorizon(item, horizon) {
  if (horizon === "all") return true;
  const limit = { day: 0, week: 1, month: 2 }[horizon];
  return RANK[item.horizon] <= limit;
}

/** Per front: how many items each horizon holds, and the fronts that can work side by side today. */
export function summarize(items) {
  const fronts = Object.keys(FRONTS).map((key) => {
    const mine = items.filter((i) => i.front === key);
    const count = Object.fromEntries(Object.keys(HORIZONS).map((h) => [h, mine.filter((i) => inHorizon(i, h)).length]));
    return { key, title: FRONTS[key], count, unknown: mine.filter((i) => i.horizon === "unknown").length,
      blocked: mine.filter((i) => i.horizon === "blocked").length };
  }).filter((f) => f.count.all > 0);
  const parallel = Object.fromEntries(["day", "week", "month"].map((h) => [h, fronts.filter((f) => f.count[h] > 0).map((f) => f.key)]));
  return { fronts, parallel };
}
