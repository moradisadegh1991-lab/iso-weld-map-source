/**
 * Progress the platform can count, for earned value and for the trend.
 *
 * INSTALLED and TESTED are two milestones per item; the project's rule of
 * credit (lib/controls/evm.mjs) weights them. For three disciplines they come
 * from reporting.fact_progress, in SQL, because their facts are plain rows:
 *
 *   piping           welded · every NDT method's latest shot ACCEPTED (F-16:
 *                    examined is not accepted, any more than it was in F11)
 *   electrical       pulled · ready
 *   instrumentation  installed · ready
 *
 * For the other three the milestones are DERIVED — a pour judged against
 * ACI 318, a structure's plumb and bolting, a coat's DFT — and the engine that
 * derives them is JavaScript. Re-writing those rules in SQL would give two
 * answers to one question; so these are counted by the same engine the
 * screens use (a primed batch loader), and their history is kept by the
 * monthly snapshot rather than by a view:
 *
 *   civil       foundation · poured ("pour") · handed over ("ready", after
 *               strength acceptance and backfill)
 *   structural  structure · erected ("erection") · handed over ("ready",
 *               after plumb, bolting and grout)
 *   coating     coating item · coats applied ("coats", DFT judged) · handed
 *               over ("ready", after final inspection)
 *
 * "Tested" is the chain's ready step, as it is for cables and instruments:
 * everything that certifies the item is in. An item handed over is counted
 * installed too — ready cannot come before what it follows.
 */
import { DONE } from "../platform/precedence.mjs";

export const SQL_DISCIPLINES = {
  piping: "جوش‌های پایپینگ", electrical: "کابل‌ها", instrumentation: "ابزارها",
};
export const ENGINE_DISCIPLINES = {
  civil: { title: "فونداسیون‌ها", installed: "pour", tested: "ready" },
  structural: { title: "سازه‌های فلزی", installed: "erection", tested: "ready" },
  coating: { title: "آیتم‌های رنگ و عایق", installed: "coats", tested: "ready" },
};
export const PROGRESS_DISCIPLINES = {
  ...SQL_DISCIPLINES, ...Object.fromEntries(Object.entries(ENGINE_DISCIPLINES).map(([k, v]) => [k, v.title])),
};

/** Whether a step of an item's chain is done (not-applicable counts, as it does for what waits on it). */
export function stepDone(steps, code) {
  const s = (steps || []).find((x) => x.code === code);
  return !!s && (s.status === DONE || s.na === true);
}

/** Installed and tested for one item of an engine discipline. */
export function milestones(steps, spec) {
  const tested = stepDone(steps, spec.tested);
  return { installed: tested || stepDone(steps, spec.installed), tested };
}

/** Counts from items that carry `installed` and `tested`. */
export function countItems(items) {
  return {
    items: items.length,
    installed: items.filter((i) => i.installed).length,
    tested: items.filter((i) => i.tested).length,
  };
}
