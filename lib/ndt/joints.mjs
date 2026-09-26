/**
 * NDT of welds that are not piping: pipe-support attachments, structural
 * steel and equipment field welds.
 *
 * Unlike piping, where B31.3 sets a floor by fluid service, what these welds
 * need is the project's specification: the structural welding code (AWS
 * D1.1 or another) leaves non-visual testing to the contract documents, and
 * equipment field welds follow the vessel or tank code the designer applied.
 * So the requirement comes from the project's NDT MATRIX — scope × joint
 * type × method → percent, with the specification clause it came from —
 * and a joint no rule covers is UNKNOWN, never "needs nothing".
 *
 * A rule may ask for several methods on one joint (VT 100% + UT 10%); the
 * joint is complete when every method's requirement is met. Each method is
 * judged by the same engine as piping (lib/ndt/compliance.mjs): 100% on the
 * joint's own examination, a random percentage by the welder's sample in the
 * group (a tag, or a line's supports) for that joint type. What a rejected
 * sample leads to is the matrix rule's `extension`: "full" (every weld of the
 * lot), "progressive" (B31.3-style two per defect), or unstated — then the
 * lot is not accepted and says why.
 *
 * Volumetric methods need a groove: RT and UT are refused on fillet welds.
 */
import { compliance, STATUS } from "./compliance.mjs";

export const SCOPES = { support: "جوش اتصال ساپورت", structural: "جوش سازهٔ فلزی", equipment: "جوش میدانی تجهیزات" };
export const JOINT_TYPES = { cjp: "شیاری با نفوذ کامل (CJP)", pjp: "شیاری با نفوذ جزئی (PJP)", fillet: "گوشه (Fillet)" };
export const METHODS = ["VT", "PT", "MT", "UT", "RT"];
export const EXTENSIONS = { full: "بازرسی همهٔ جوش‌های لات", progressive: "تدریجی: دو جوش به ازای هر نقص (سبک B31.3)" };

/** Why this matrix rule cannot be stored; empty when it can. */
export function ruleProblems({ scope, jointType, method, percent, extension, basis }) {
  const out = [];
  if (!SCOPES[scope]) out.push(`دامنهٔ «${scope}» شناخته نشد`);
  if (!JOINT_TYPES[jointType]) out.push(`نوع اتصال «${jointType}» شناخته نشد`);
  if (!METHODS.includes(method)) out.push(`روش «${method}» شناخته نشد`);
  const p = Number(percent);
  if (!(p > 0 && p <= 100)) out.push("درصد باید بین ۰ و ۱۰۰ باشد");
  if ((method === "RT" || method === "UT") && jointType === "fillet") out.push(`${method} روش حجمی است و برای جوش گوشه به کار نمی‌رود — VT، MT یا PT`);
  if (p < 100 && extension && !EXTENSIONS[extension]) out.push(`گسترش «${extension}» شناخته نشد`);
  if (!String(basis || "").trim()) out.push("مرجع (بند مشخصات فنی یا کد) لازم است — درصد بی‌مرجع ثبت نمی‌شود");
  return out;
}

/** The rules that apply to a joint, one per method. */
export function rulesFor(joint, matrix) {
  return matrix.filter((r) => r.scope === joint.scope && r.jointType === joint.jointType);
}

/**
 * Compliance of every joint.
 *   joints      [{ id, scope, jointType, group, welderId, welded }]   group: the tag or line the lot belongs to
 *   matrix      [{ scope, jointType, method, percent, extension }]
 *   selections  [{ group, jointType, method, selectedIds, createdAt }]
 *   records     [{ jointId, method, result, repairCycle, at }]
 *   draws       [{ group, jointType, method, welderId, tier, selectedIds }]
 * @returns Map id → { status, done, methods: [{ method, percent, status, lot? }] }
 */
export function jointCompliance({ joints, matrix, selections = [], records = [], draws = [] }) {
  const perMethod = new Map(joints.map((j) => [j.id, []]));
  const lot = (j) => `${j.group}|${j.jointType}`;
  for (const rule of matrix) {
    const mine = joints.filter((j) => j.scope === rule.scope && j.jointType === rule.jointType);
    if (!mine.length) continue;
    const pct = Number(rule.percent);
    const res = compliance({
      welds: mine.map((j) => ({ uid: j.id, lineId: lot(j), welded: j.welded, welderId: j.welderId,
        requirement: `${rule.method} ${pct}%${pct < 100 ? " random" : ""}` })),
      selections: selections.filter((s) => s.method === rule.method && s.jointType === rule.jointType)
        .map((s) => ({ lineId: `${s.group}|${s.jointType}`, method: s.method, selectedUids: s.selectedIds, createdAt: s.createdAt })),
      records: records.filter((r) => r.method === rule.method)
        .map((r) => ({ uid: r.jointId, method: r.method, result: r.result, repairCycle: r.repairCycle, at: r.at })),
      draws: draws.filter((d) => d.method === rule.method && d.jointType === rule.jointType)
        .map((d) => ({ lineId: `${d.group}|${d.jointType}`, method: d.method, welderId: d.welderId, tier: d.tier, selectedUids: d.selectedIds })),
      extension: rule.extension || null,
    });
    for (const j of mine) perMethod.get(j.id).push({ method: rule.method, percent: pct, ...res.get(j.id) });
  }
  const out = new Map();
  for (const j of joints) {
    const m = perMethod.get(j.id);
    let status;
    if (!j.welded) status = "not_welded";
    else if (!m.length) status = "unknown";
    else status = m.find((x) => !STATUS[x.status].done)?.status ?? "accepted";
    out.set(j.id, { status, done: j.welded && m.length > 0 && m.every((x) => STATUS[x.status].done), methods: m });
  }
  return out;
}
