/**
 * Safe work before the permit: competence, scaffold and crane inspection,
 * and the job safety analysis. The rules, with no database in sight.
 *
 * COMPETENCE
 *   A card is valid on a day when it was issued on or before it, has not
 *   been revoked by then, and either expires on or after it or states that
 *   it does not expire. A card with no expiry date and no such statement is
 *   not valid — the expiry is unknown, and "unknown" is not "forever".
 *   Which competences a permit type needs is the project's rule
 *   (hse_competence_rules). Once stated for a type, every crew member must
 *   hold each of them, valid for the whole permit window, and a permit with
 *   no crew named is not issued. An empty list is a statement: nothing is
 *   required. A type with no rule at all is reported, not assumed.
 *
 * SCAFFOLDS AND CRANES
 *   Fit for use until the last passing inspection plus the interval the
 *   project states for that kind — no default. The latest inspection
 *   decides: a fail after a pass is a red tag, whatever the pass said. A
 *   permit that names one is issued only if it is fit for the whole window.
 *   The inspector must hold the matching competence on the day.
 *
 * JSA / TRA
 *   Each step is scored likelihood × severity on 1–5 scales, before and
 *   after its controls. It is approved only when every step has controls
 *   and a residual score, no control raises the risk, and no residual score
 *   exceeds the highest the project accepts (hse_risk_max_residual — no
 *   default). The preparer does not approve; an approved JSA is fixed and a
 *   change is a new revision. Permit types the project lists
 *   (hse_jsa_required_types) are issued only against the approved, current
 *   revision of a JSA.
 */

export const COMPETENCES = {
  induction: "آموزش بدو ورود HSE",
  work_at_height: "کار در ارتفاع",
  confined_space: "ورود به فضای بسته",
  confined_space_attendant: "نگهبان فضای بسته",
  gas_tester: "تست گاز",
  hot_work: "کار گرم / Fire watch",
  rigger: "ریگر / علامت‌دهنده",
  crane_operator: "اپراتور جرثقیل",
  scaffolder: "داربست‌بند",
  scaffold_inspector: "بازرس داربست",
  lifting_inspector: "بازرس تجهیزات بالابر",
  electrical_isolation: "ایزولاسیون برقی (LOTO)",
  radiography: "رادیوگرافی (حفاظت پرتو)",
  first_aid: "امدادگر",
};

export const EQUIPMENT_KINDS = {
  scaffold: { title: "داربست", setting: "hse_scaffold_inspection_days", inspector: "scaffold_inspector", permitType: "work_at_height" },
  crane: { title: "جرثقیل / بالابر", setting: "hse_crane_inspection_days", inspector: "lifting_inspector", permitType: "lifting" },
};

// ── competence ───────────────────────────────────────────────────────────

/**
 * Is a card valid on `day` (YYYY-MM-DD)?
 * @returns {{ok: boolean|null, reason?: string}}  null = cannot be judged
 */
export function cardValidOn(card, day) {
  if (!card) return { ok: false, reason: "کارت ندارد" };
  if (card.issuedOn > day) return { ok: false, reason: `از ${card.issuedOn} معتبر است` };
  if (card.revokedOn && card.revokedOn <= day) return { ok: false, reason: `باطل شده (${card.revokedOn})` };
  if (card.noExpiry) return { ok: true };
  if (!card.expiresOn) return { ok: null, reason: "تاریخ انقضا ثبت نشده" };
  if (card.expiresOn < day) return { ok: false, reason: `منقضی (${card.expiresOn})` };
  return { ok: true };
}

/** The card of `kind` that covers the whole window [from, to], if any. */
export function coveringCard(cards, kind, from, to) {
  return cards.find((c) => c.kind === kind && cardValidOn(c, from).ok === true && cardValidOn(c, to).ok === true) || null;
}

/** A card's state today, for the register. */
export function cardState(card, today) {
  const v = cardValidOn(card, today);
  if (v.ok === true) return { code: "valid", text: card.noExpiry ? "معتبر — بدون انقضا" : `معتبر تا ${card.expiresOn}` };
  if (v.ok === null) return { code: "unknown", text: v.reason };
  return { code: card.revokedOn && card.revokedOn <= today ? "revoked" : card.issuedOn > today ? "future" : "expired", text: v.reason };
}

/**
 * The project's competence rule for a permit type: an array of kinds, or
 * null when the project has not stated one for that type.
 */
export function competenceRule(rules, type) {
  if (!rules || typeof rules !== "object" || !(type in rules)) return null;
  return Array.isArray(rules[type]) ? rules[type] : null;
}

/** Problems with a stated rule set, or []. */
export function competenceRuleProblems(rules, permitTypes) {
  if (rules === null) return [];
  if (typeof rules !== "object" || Array.isArray(rules)) return ["قاعدهٔ صلاحیت باید برای هر نوع مجوز فهرستی باشد"];
  const out = [];
  for (const [t, kinds] of Object.entries(rules)) {
    if (!permitTypes[t]) out.push(`نوع مجوز «${t}» شناخته نشد`);
    if (!Array.isArray(kinds)) { out.push(`قاعدهٔ «${t}» فهرست نیست`); continue; }
    for (const k of kinds) if (!COMPETENCES[k]) out.push(`صلاحیت «${k}» شناخته نشد`);
  }
  return out;
}

/**
 * The crew against the rule, over the permit window.
 * @param crew [{name, cards: [...]}]
 * @returns {{declared: boolean, reasons: string[]}}
 */
export function crewCheck(rule, crew, from, to) {
  if (rule === null) return { declared: false, reasons: [] };
  if (!rule.length) return { declared: true, reasons: [] };
  if (!crew.length) return { declared: true, reasons: ["خدمهٔ مجوز ثبت نشده — صلاحیت کسی سنجیده نمی‌شود"] };
  const reasons = [];
  for (const p of crew) {
    const lacking = rule.filter((k) => !coveringCard(p.cards, k, from, to));
    if (lacking.length) reasons.push(`${p.name}: ${lacking.map((k) => COMPETENCES[k]).join("، ")} معتبر در تمام مدت مجوز ندارد`);
  }
  return { declared: true, reasons };
}

// ── scaffolds and cranes ─────────────────────────────────────────────────

/**
 * Fitness of a scaffold or crane on `day`.
 * @param inspections [{inspectedOn, result}] in any order
 * @returns {{code: 'valid'|'failed'|'expired'|'never'|'unknown'|'dismantled', validUntil: string|null, text: string}}
 */
export function equipmentState({ kind, dismantledOn = null, inspections }, project, day) {
  if (dismantledOn && dismantledOn <= day) return { code: "dismantled", validUntil: null, text: `برچیده شده (${dismantledOn})` };
  const done = inspections.filter((i) => i.inspectedOn <= day).sort((a, b) => (a.inspectedOn < b.inspectedOn ? -1 : a.inspectedOn > b.inspectedOn ? 1 : 0));
  if (!done.length) return { code: "never", validUntil: null, text: "بازرسی نشده" };
  const last = done[done.length - 1];
  if (last.result === "fail") return { code: "failed", validUntil: null, text: `رد در بازرسی ${last.inspectedOn} — برچسب قرمز` };
  const days = n(project?.[EQUIPMENT_KINDS[kind].setting]);
  if (days === null) return { code: "unknown", validUntil: null, text: "فاصلهٔ بازرسی در مشخصات پروژه تعیین نشده" };
  const validUntil = addDays(last.inspectedOn, days);
  if (validUntil < day) return { code: "expired", validUntil, text: `اعتبار بازرسی ${validUntil} تمام شده` };
  return { code: "valid", validUntil, text: `معتبر تا ${validUntil}` };
}

/** Reasons a scaffold/crane does not cover a permit window [from, to]. */
export function equipmentCoverage(eq, project, from, to) {
  const at = equipmentState(eq, project, from);
  if (at.code !== "valid") return [`${eq.refNo}: ${at.text}`];
  const end = equipmentState(eq, project, to);
  if (end.code !== "valid") return [`${eq.refNo}: بازرسی تا پایان مجوز (${to}) اعتبار ندارد — ${end.text}`];
  return [];
}

// ── JSA ──────────────────────────────────────────────────────────────────

export const score = (l, s) => (n(l) === null || n(s) === null ? null : n(l) * n(s));

/** Why a JSA cannot be approved; empty when it can. */
export function jsaApprovalProblems(steps, project) {
  const out = [];
  const max = n(project?.hse_risk_max_residual);
  if (max === null) out.push("حداکثر ریسک باقیماندهٔ پذیرفتنی در مشخصات پروژه تعیین نشده");
  if (!steps.length) out.push("JSA بدون گام تأیید نمی‌شود");
  for (const s of steps) {
    const tag = `گام ${s.seq}`;
    if (!String(s.controls || "").trim()) out.push(`${tag}: اقدام کنترلی ندارد`);
    const before = score(s.likelihood, s.severity), after = score(s.residualLikelihood, s.residualSeverity);
    if (after === null) { out.push(`${tag}: ریسک باقیمانده ارزیابی نشده`); continue; }
    if (before !== null && after > before) out.push(`${tag}: ریسک باقیمانده (${after}) از ریسک اولیه (${before}) بیشتر است`);
    if (max !== null && after > max) out.push(`${tag}: ریسک باقیمانده ${after} از حد پذیرفتنی پروژه (${max}) بیشتر است`);
  }
  return out;
}

/** Problems with one step as entered, or []. */
export function jsaStepProblems(s) {
  const out = [];
  if (!String(s.step || "").trim() || !String(s.hazard || "").trim()) out.push("گام و خطر لازم است");
  for (const [v, t] of [[s.likelihood, "احتمال"], [s.severity, "شدت"]])
    if (!inScale(v)) out.push(`${t} باید عددی از ۱ تا ۵ باشد`);
  for (const [v, t] of [[s.residualLikelihood, "احتمال باقیمانده"], [s.residualSeverity, "شدت باقیمانده"]])
    if (v !== null && v !== undefined && v !== "" && !inScale(v)) out.push(`${t} باید عددی از ۱ تا ۵ باشد`);
  return out;
}

/**
 * JSA reasons for a permit. `required` is null (the project has not said
 * which types need one), or whether this type needs one.
 */
export function jsaCheck({ required, jsa }) {
  const reasons = [];
  if (jsa) {
    if (jsa.status === "draft") reasons.push(`JSA ${jsa.jsaNo} Rev ${jsa.revision} تأیید نشده`);
    else if (jsa.status === "superseded") reasons.push(`JSA ${jsa.jsaNo} Rev ${jsa.revision} منسوخ شده؛ رویژن جاری را پیوست کنید`);
  } else if (required === true) reasons.push("این نوع مجوز JSA تأییدشده لازم دارد");
  return reasons;
}

/** Problems with a stated JSA-required list, or []. */
export function jsaRequiredProblems(list, permitTypes) {
  if (list === null) return [];
  if (!Array.isArray(list)) return ["فهرست انواع مجوز نیازمند JSA باید فهرست باشد"];
  return list.filter((t) => !permitTypes[t]).map((t) => `نوع مجوز «${t}» شناخته نشد`);
}

const inScale = (v) => Number.isInteger(Number(v)) && v !== "" && v !== null && Number(v) >= 1 && Number(v) <= 5;
const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
export function addDays(day, k) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(k));
  return d.toISOString().slice(0, 10);
}
