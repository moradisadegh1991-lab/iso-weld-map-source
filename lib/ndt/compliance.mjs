/**
 * Has each weld had the examination it REQUIRES — ASME B31.3 §341.
 *
 * The requirement per weld is already decided (lib/ndt/requirement.mjs) and
 * stored as text: "RT 100%", "RT 10% random", "PT 100%". This answers the
 * next question, the one progress and handover turn on:
 *
 *   100%        the weld needs its own examination, latest result accept.
 *   random p%   a weld examined by the method answers for itself, in the
 *               sample or not. Otherwise the line's sample (ndt_selection,
 *               drawn with a seed) decides.
 *               A weld IN the sample needs its own accepted examination.
 *               A weld NOT in the sample is accepted by its welder's sample
 *               in that lot — once every sampled weld of that welder has
 *               been examined and none was rejected at its first shot.
 *
 * PROGRESSIVE EXAMINATION (§341.3.4). When a sampled weld of a welder is
 * rejected, the lot of that welder is not accepted by the sample:
 *   (a) two additional welds of the same welder, per defective weld, get
 *       the same examination; if all pass, the lot is accepted
 *   (b) if any of those is rejected, two further welds per defective one
 *   (c) if all of (b) pass, the lot is accepted
 *   (d) if any of (b) is rejected, every weld of the lot is examined.
 * Additional welds are the welder's unsampled welds in the lot that have an
 * examination of the method, taken in the order they were examined: the
 * first 2·r₀ are tier (a), the next 2·r₁ tier (b). The defective welds
 * themselves still need their repair accepted, as any sampled weld does.
 *
 * What cannot be known is said so, never assumed:
 *   no requirement set, no sample drawn, a weld with no welder recorded (it
 *   belongs to no lot), a welder with no weld in the sample.
 */

export const STATUS = {
  not_welded: { done: false, text: "جوش نشده" },
  unknown: { done: false, text: "الزام NDT تعیین نشده" },
  sample_not_drawn: { done: false, text: "نمونهٔ تصادفی خط کشیده نشده" },
  no_welder: { done: false, text: "جوشکار ثبت نشده — در هیچ لاتی نیست" },
  welder_unsampled: { done: false, text: "از کار این جوشکار نمونه‌ای در قرعه نیست" },
  awaiting: { done: false, text: "منتظر NDT" },
  awaiting_sample: { done: false, text: "منتظر NDT نمونه‌های لات" },
  rejected: { done: false, text: "رد — تعمیر و NDT مجدد" },
  progressive: { done: false, text: "بازرسی تدریجی (§341.3.4) در جریان" },
  full_examination: { done: false, text: "لات مردود — بازرسی کامل همهٔ جوش‌های لات (§341.3.4(d))" },
  accepted: { done: true, text: "پذیرفته" },
  accepted_by_sample: { done: true, text: "پذیرفته با نمونهٔ لات" },
};

/** "RT 10% random" → { method: "RT", percent: 10, random: true }; anything else → null. */
export function parseRequirement(text) {
  const m = /^(RT|UT|PT|MT|VT)\s+(\d+(?:\.\d+)?)%(\s+random)?$/.exec(String(text || "").trim());
  if (!m) return null;
  const percent = Number(m[2]);
  return { method: m[1], percent, random: percent < 100 };
}

/** A weld's own examination by one method: none | pending | accept | reject (latest cycle). */
export function ownResult(records, uid, method) {
  const mine = records.filter((r) => r.uid === uid && r.method === method);
  if (!mine.length) return "none";
  const last = Math.max(...mine.map((r) => r.repairCycle));
  const latest = mine.filter((r) => r.repairCycle === last);
  if (latest.some((r) => r.result === "reject")) return "reject";
  if (latest.some((r) => r.result === "pending")) return "pending";
  return "accept";
}

const firstShot = (records, uid, method) => records.find((r) => r.uid === uid && r.method === method && r.repairCycle === 0) || null;
const own = (res) => (res === "accept" ? "accepted" : res === "reject" ? "rejected" : "awaiting");

/**
 * Status of every weld.
 *   welds       [{ uid, lineId, welded, welderId, requirement }]   requirement is the stored text
 *   selections  [{ lineId, method, selectedUids, createdAt }]      the latest per line and method is used
 *   records     [{ uid, method, result, repairCycle, at }]
 * @returns Map uid → { status, method, percent, sampled?, lot? }
 */
export function compliance({ welds, selections, records }) {
  const latestSel = new Map();
  for (const s of selections) {
    const k = `${s.lineId}|${s.method}`;
    const cur = latestSel.get(k);
    if (!cur || String(s.createdAt) > String(cur.createdAt)) latestSel.set(k, s);
  }
  const out = new Map();
  const lots = new Map();           // line|method|welder → verdict, computed once
  for (const w of welds) {
    const req = parseRequirement(w.requirement);
    const base = { method: req?.method ?? null, percent: req?.percent ?? null };
    if (!w.welded) { out.set(w.uid, { ...base, status: "not_welded" }); continue; }
    if (!req) { out.set(w.uid, { ...base, status: "unknown" }); continue; }
    if (!req.random) { out.set(w.uid, { ...base, status: own(ownResult(records, w.uid, req.method)) }); continue; }
    // A weld examined by the method answers for itself, sampled or not: an accepted film
    // meets the requirement, a rejected one needs its repair whatever the lot says.
    const r = ownResult(records, w.uid, req.method);
    const sel = latestSel.get(`${w.lineId}|${req.method}`);
    const selected = new Set(sel?.selectedUids || []);
    if (r === "accept" || r === "reject") { out.set(w.uid, { ...base, sampled: selected.has(w.uid), status: own(r) }); continue; }
    if (!sel) { out.set(w.uid, { ...base, status: "sample_not_drawn" }); continue; }
    if (selected.has(w.uid)) { out.set(w.uid, { ...base, sampled: true, status: "awaiting" }); continue; }
    if (!w.welderId) { out.set(w.uid, { ...base, status: "no_welder" }); continue; }
    const key = `${w.lineId}|${req.method}|${w.welderId}`;
    if (!lots.has(key)) lots.set(key, lotVerdict({ welds, selected, records, lineId: w.lineId, method: req.method, welderId: w.welderId }));
    const lot = lots.get(key);
    out.set(w.uid, { ...base, lot, status: lot.status });
  }
  return out;
}

/** One welder's lot in one line's random sample, by §341.3.4. */
export function lotVerdict({ welds, selected, records, lineId, method, welderId }) {
  const inLot = welds.filter((x) => x.lineId === lineId && x.welded && x.welderId === welderId
    && parseRequirement(x.requirement)?.method === method && parseRequirement(x.requirement)?.random);
  const sample = inLot.filter((x) => selected.has(x.uid));
  if (!sample.length) return { status: "welder_unsampled" };
  const shots = sample.map((x) => firstShot(records, x.uid, method));
  if (shots.some((s) => !s || s.result === "pending")) return { status: "awaiting_sample" };
  const r0 = shots.filter((s) => s.result === "reject").length;
  if (r0 === 0) return { status: "accepted_by_sample", r0 };
  const extra = inLot.filter((x) => !selected.has(x.uid)).map((x) => firstShot(records, x.uid, method))
    .filter((s) => s && s.result !== "pending").sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const tier1 = extra.slice(0, 2 * r0);
  if (tier1.length < 2 * r0) return { status: "progressive", r0, needed: 2 * r0 - tier1.length, tier: "a" };
  const r1 = tier1.filter((s) => s.result === "reject").length;
  if (r1 === 0) return { status: "accepted_by_sample", r0 };
  const tier2 = extra.slice(2 * r0, 2 * r0 + 2 * r1);
  if (tier2.length < 2 * r1) return { status: "progressive", r0, r1, needed: 2 * r1 - tier2.length, tier: "b" };
  const r2 = tier2.filter((s) => s.result === "reject").length;
  if (r2 === 0) return { status: "accepted_by_sample", r0, r1 };
  return { status: "full_examination", r0, r1, r2 };
}

/** Inch-dia: the sum of weld sizes (NPS, inches). Welds without a size are counted apart, never as zero. */
export function inchDia(welds) {
  const sized = welds.filter((w) => Number(w.nps) > 0);
  return { di: Math.round(sized.reduce((a, w) => a + Number(w.nps), 0) * 100) / 100, sized: sized.length, unsized: welds.length - sized.length };
}
