/**
 * Safe work before the permit: people and their competence cards, scaffolds
 * and cranes with their inspections, JSAs, and a permit's crew.
 *
 * Every rule is lib/hse/safework.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  COMPETENCES, EQUIPMENT_KINDS, cardValidOn, cardState, competenceRule, competenceRuleProblems, crewCheck,
  equipmentState, equipmentCoverage, jsaApprovalProblems, jsaStepProblems, jsaCheck, jsaRequiredProblems, score,
} from "../../hse/safework.mjs";
import { PERMIT_TYPES } from "../../hse/hse.mjs";

const SETTINGS = ["hse_scaffold_inspection_days", "hse_crane_inspection_days", "hse_risk_max_residual",
  "hse_competence_rules", "hse_jsa_required_types"];

export async function safeWorkSettings(db, projectId) {
  const { rows: [p] } = await db.query(`SELECT ${SETTINGS.join(", ")} FROM project WHERE id = $1`, [projectId]);
  return p;
}

/** The project's competence matrix and JSA-required types. null clears (= not stated); [] states "none". */
export async function setSafeWorkRules(db, { projectId, competenceRules, jsaRequiredTypes }) {
  const sets = [], vals = [];
  if (competenceRules !== undefined) {
    const p = competenceRuleProblems(competenceRules, PERMIT_TYPES);
    if (p.length) throw bad(p.join(" · "));
    vals.push(competenceRules === null ? null : JSON.stringify(competenceRules)); sets.push(`hse_competence_rules = $${vals.length}`);
  }
  if (jsaRequiredTypes !== undefined) {
    const p = jsaRequiredProblems(jsaRequiredTypes, PERMIT_TYPES);
    if (p.length) throw bad(p.join(" · "));
    vals.push(jsaRequiredTypes === null ? null : JSON.stringify(jsaRequiredTypes)); sets.push(`hse_jsa_required_types = $${vals.length}`);
  }
  if (!sets.length) return safeWorkSettings(db, projectId);
  vals.push(projectId);
  await db.query(`UPDATE project SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`, vals);
  return safeWorkSettings(db, projectId);
}

// ── people and cards ─────────────────────────────────────────────────────

export async function upsertPerson(db, { projectId, idNo, fullName, contractorId = null, trade = null }) {
  if (!blank(idNo) || !blank(fullName)) throw bad("شمارهٔ شناسایی و نام لازم است.");
  const { rows: [p] } = await db.query(
    `INSERT INTO hse_person (project_id, id_no, full_name, contractor_id, trade) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (project_id, id_no) DO UPDATE SET full_name = EXCLUDED.full_name, contractor_id = EXCLUDED.contractor_id,
        trade = EXCLUDED.trade RETURNING *`,
    [projectId, blank(idNo), blank(fullName), contractorId || null, blank(trade)]);
  return p;
}

export async function addCompetence(db, {
  projectId, personId, kind, certNo = null, issuer = null, issuedOn, expiresOn = null, noExpiry = false, userId = null,
}) {
  if (!COMPETENCES[kind]) throw bad(`صلاحیت «${kind}» شناخته نشد.`);
  if (!issuedOn) throw bad("تاریخ صدور کارت لازم است.");
  const exp = blank(expiresOn);
  if (noExpiry && exp) throw bad("کارتی که تاریخ انقضا دارد «بدون انقضا» نیست.");
  if (exp && exp < issuedOn) throw bad("تاریخ انقضا پیش از تاریخ صدور است.");
  await personRow(db, projectId, personId);
  const { rows: [c] } = await db.query(
    `INSERT INTO hse_competence (project_id, person_id, kind, cert_no, issuer, issued_on, expires_on, no_expiry, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, personId, kind, blank(certNo), blank(issuer), issuedOn, exp, !!noExpiry, userId]);
  return c;
}

/** A card is never deleted; a wrong or withdrawn one is revoked, with the reason. */
export async function revokeCompetence(db, { projectId, competenceId, revokedOn, reason }) {
  if (!revokedOn || !blank(reason)) throw bad("تاریخ و دلیل ابطال لازم است.");
  const { rows: [c] } = await db.query("SELECT * FROM hse_competence WHERE id = $1 AND project_id = $2", [competenceId, projectId]);
  if (!c) throw notFound("competence");
  if (c.revoked_on) throw bad("این کارت قبلاً باطل شده.");
  if (revokedOn < day(c.issued_on)) throw bad("تاریخ ابطال پیش از تاریخ صدور است.");
  const { rows: [out] } = await db.query(
    "UPDATE hse_competence SET revoked_on = $1, revoked_reason = $2 WHERE id = $3 RETURNING *", [revokedOn, blank(reason), competenceId]);
  return out;
}

/** Cards per person, in the shape the rules read. */
async function cardsOf(db, projectId, personIds) {
  if (!personIds.length) return new Map();
  const { rows } = await db.query(
    "SELECT * FROM hse_competence WHERE project_id = $1 AND person_id = ANY($2::uuid[]) ORDER BY issued_on", [projectId, personIds]);
  const by = new Map(personIds.map((id) => [id, []]));
  for (const r of rows) by.get(r.person_id).push(asCard(r));
  return by;
}

export async function peopleBoard(db, { projectId, today }) {
  const { rows: people } = await db.query(
    `SELECT p.*, c.code AS contractor_code FROM hse_person p LEFT JOIN contractor c ON c.id = p.contractor_id
      WHERE p.project_id = $1 ORDER BY p.full_name`, [projectId]);
  const cards = await cardsOf(db, projectId, people.map((p) => p.id));
  return people.map((p) => ({
    ...p,
    cards: cards.get(p.id).map((c) => ({ ...c, title: COMPETENCES[c.kind], state: cardState(c, today) })),
  }));
}

// ── scaffolds and cranes ─────────────────────────────────────────────────

export async function registerEquipment(db, {
  projectId, kind, refNo, description = null, area = null, contractorId = null, capacityT = null,
}) {
  if (!EQUIPMENT_KINDS[kind]) throw bad(`نوع «${kind}» شناخته نشد.`);
  if (!blank(refNo)) throw bad("شمارهٔ برچسب / ثبت لازم است.");
  const cap = capacityT === "" || capacityT == null ? null : Number(capacityT);
  if (cap !== null && !(cap > 0)) throw bad("ظرفیت باید عدد مثبت باشد.");
  const { rows: [e] } = await db.query(
    `INSERT INTO hse_equipment (project_id, kind, ref_no, description, area, contractor_id, capacity_t)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, kind, blank(refNo).toUpperCase(), blank(description), blank(area), contractorId || null, cap]);
  return e;
}

export async function dismantleEquipment(db, { projectId, equipmentId, dismantledOn }) {
  if (!dismantledOn) throw bad("تاریخ برچیدن لازم است.");
  const e = await equipmentRow(db, projectId, equipmentId);
  if (e.dismantled_on) throw bad("قبلاً برچیده شده.");
  const { rows: [out] } = await db.query(
    "UPDATE hse_equipment SET dismantled_on = $1 WHERE id = $2 RETURNING *", [dismantledOn, equipmentId]);
  return out;
}

/**
 * Record an inspection. The inspector is a person on the register holding
 * the matching competence on the day; an inspection is not dated ahead of
 * `today`, and a fail says what was found.
 */
export async function inspectEquipment(db, {
  projectId, equipmentId, inspectedOn, result, inspectorId, certRef = null, findings = null, userId = null,
  today = new Date().toISOString().slice(0, 10),
}) {
  const e = await equipmentRow(db, projectId, equipmentId);
  if (!["pass", "fail"].includes(result)) throw bad("نتیجه: قبول یا رد.");
  if (!inspectedOn) throw bad("تاریخ بازرسی لازم است.");
  if (inspectedOn > today) throw bad("بازرسی به تاریخ آینده ثبت نمی‌شود.");
  if (e.dismantled_on && inspectedOn > day(e.dismantled_on)) throw bad("این تجهیز پیش از این تاریخ برچیده شده.");
  if (result === "fail" && !blank(findings)) throw bad("بازرسی رد بدون شرح ایراد ثبت نمی‌شود.");
  const need = EQUIPMENT_KINDS[e.kind].inspector;
  const inspector = await personRow(db, projectId, inspectorId);
  const cards = (await cardsOf(db, projectId, [inspector.id])).get(inspector.id);
  if (!cards.some((c) => c.kind === need && cardValidOn(c, inspectedOn).ok === true)) {
    throw bad(`${inspector.full_name} در ${inspectedOn} کارت معتبر «${COMPETENCES[need]}» ندارد.`);
  }
  const { rows: [i] } = await db.query(
    `INSERT INTO hse_equipment_inspection (project_id, equipment_id, inspected_on, result, inspector_id, cert_ref, findings, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, equipmentId, inspectedOn, result, inspectorId, blank(certRef), blank(findings), userId]);
  return i;
}

async function inspectionsOf(db, projectId, equipmentIds) {
  if (!equipmentIds.length) return new Map();
  const { rows } = await db.query(
    `SELECT i.*, p.full_name AS inspector_name FROM hse_equipment_inspection i JOIN hse_person p ON p.id = i.inspector_id
      WHERE i.project_id = $1 AND i.equipment_id = ANY($2::uuid[]) ORDER BY i.inspected_on, i.created_at`, [projectId, equipmentIds]);
  const by = new Map(equipmentIds.map((id) => [id, []]));
  for (const r of rows) by.get(r.equipment_id).push({ ...r, inspectedOn: day(r.inspected_on) });
  return by;
}

export async function equipmentBoard(db, { projectId, today }) {
  const settings = await safeWorkSettings(db, projectId);
  const { rows } = await db.query(
    `SELECT e.*, c.code AS contractor_code FROM hse_equipment e LEFT JOIN contractor c ON c.id = e.contractor_id
      WHERE e.project_id = $1 ORDER BY e.kind, e.ref_no`, [projectId]);
  const ins = await inspectionsOf(db, projectId, rows.map((e) => e.id));
  return rows.map((e) => {
    const inspections = ins.get(e.id);
    return { ...e, kindTitle: EQUIPMENT_KINDS[e.kind].title, inspections, last: inspections[inspections.length - 1] || null,
      state: equipmentState({ kind: e.kind, dismantledOn: day(e.dismantled_on), inspections }, settings, today) };
  });
}

// ── JSA ──────────────────────────────────────────────────────────────────

export async function createJsa(db, { projectId, jsaNo, revision = "0", title, area = null, contractorId = null, userId = null }) {
  if (!blank(jsaNo) || !blank(title)) throw bad("شماره و عنوان JSA لازم است.");
  const { rows: [j] } = await db.query(
    `INSERT INTO hse_jsa (project_id, jsa_no, revision, title, area, contractor_id, prepared_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, blank(jsaNo).toUpperCase(), blank(revision) || "0", blank(title), blank(area), contractorId || null, userId]);
  return j;
}

export async function saveJsaStep(db, {
  projectId, jsaId, seq, step, hazard, controls = null, likelihood, severity, residualLikelihood = null, residualSeverity = null,
}) {
  const j = await jsaRow(db, projectId, jsaId);
  if (j.status !== "draft") throw bad(`JSA ${j.jsa_no} Rev ${j.revision} ${j.status === "approved" ? "تأیید شده" : "منسوخ است"}؛ تغییر یعنی رویژن جدید.`);
  const s = { step, hazard, likelihood, severity, residualLikelihood, residualSeverity };
  const p = jsaStepProblems(s);
  if (!(Number.isInteger(Number(seq)) && Number(seq) > 0)) p.push("شمارهٔ گام باید عدد صحیح مثبت باشد");
  if (p.length) throw bad(p.join(" · "));
  const int = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const { rows: [row] } = await db.query(
    `INSERT INTO hse_jsa_step (project_id, jsa_id, seq, step, hazard, controls, likelihood, severity, residual_likelihood, residual_severity)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (jsa_id, seq) DO UPDATE SET step = EXCLUDED.step, hazard = EXCLUDED.hazard, controls = EXCLUDED.controls,
        likelihood = EXCLUDED.likelihood, severity = EXCLUDED.severity, residual_likelihood = EXCLUDED.residual_likelihood,
        residual_severity = EXCLUDED.residual_severity
     RETURNING *`,
    [projectId, jsaId, Number(seq), blank(step), blank(hazard), blank(controls), int(likelihood), int(severity),
     int(residualLikelihood), int(residualSeverity)]);
  return row;
}

export async function removeJsaStep(db, { projectId, jsaId, seq }) {
  const j = await jsaRow(db, projectId, jsaId);
  if (j.status !== "draft") throw bad("گام JSA تأییدشده حذف نمی‌شود.");
  await db.query("DELETE FROM hse_jsa_step WHERE jsa_id = $1 AND seq = $2", [jsaId, Number(seq)]);
  return { removed: true };
}

/** Approve: every rule met, by someone other than the preparer; the previous approved revision is superseded. */
export async function approveJsa(db, { projectId, jsaId, userId, today = new Date().toISOString().slice(0, 10) }) {
  if (!userId) throw bad("تأیید JSA امضای یک شخص لازم دارد.");
  const j = await jsaRow(db, projectId, jsaId);
  if (j.status !== "draft") throw bad("فقط پیش‌نویس تأیید می‌شود.");
  if (j.prepared_by && j.prepared_by === userId) throw bad("تهیه‌کنندهٔ JSA آن را تأیید نمی‌کند.");
  const steps = await stepsOf(db, [jsaId]);
  const p = jsaApprovalProblems(steps.get(jsaId), await safeWorkSettings(db, projectId));
  if (p.length) throw Object.assign(bad(`JSA تأیید نشد: ${p.join(" · ")}`), { reasons: p });
  await db.query(`UPDATE hse_jsa SET status = 'superseded' WHERE project_id = $1 AND jsa_no = $2 AND status = 'approved'`,
    [projectId, j.jsa_no]);
  const { rows: [out] } = await db.query(
    "UPDATE hse_jsa SET status = 'approved', approved_by = $1, approved_on = $2 WHERE id = $3 RETURNING *", [userId, today, jsaId]);
  return out;
}

/** A new draft revision, starting from this one's steps. */
export async function reviseJsa(db, { projectId, jsaId, revision, userId = null }) {
  const j = await jsaRow(db, projectId, jsaId);
  if (!blank(revision)) throw bad("شمارهٔ رویژن جدید لازم است.");
  const { rows: [draft] } = await db.query(
    "SELECT jsa_no, revision FROM hse_jsa WHERE project_id = $1 AND jsa_no = $2 AND status = 'draft'", [projectId, j.jsa_no]);
  if (draft) throw bad(`رویژن ${draft.revision} این JSA هنوز پیش‌نویس است.`);
  const n = await createJsa(db, { projectId, jsaNo: j.jsa_no, revision, title: j.title, area: j.area, contractorId: j.contractor_id, userId });
  await db.query(
    `INSERT INTO hse_jsa_step (project_id, jsa_id, seq, step, hazard, controls, likelihood, severity, residual_likelihood, residual_severity)
     SELECT project_id, $1, seq, step, hazard, controls, likelihood, severity, residual_likelihood, residual_severity
       FROM hse_jsa_step WHERE jsa_id = $2`, [n.id, jsaId]);
  return n;
}

async function stepsOf(db, jsaIds) {
  const by = new Map(jsaIds.map((id) => [id, []]));
  if (!jsaIds.length) return by;
  const { rows } = await db.query("SELECT * FROM hse_jsa_step WHERE jsa_id = ANY($1::uuid[]) ORDER BY seq", [jsaIds]);
  for (const r of rows) by.get(r.jsa_id).push({ id: r.id, seq: r.seq, step: r.step, hazard: r.hazard, controls: r.controls,
    likelihood: r.likelihood, severity: r.severity, residualLikelihood: r.residual_likelihood, residualSeverity: r.residual_severity,
    initial: score(r.likelihood, r.severity), residual: score(r.residual_likelihood, r.residual_severity) });
  return by;
}

export async function jsaBoard(db, { projectId }) {
  const settings = await safeWorkSettings(db, projectId);
  const { rows } = await db.query(
    `SELECT j.*, c.code AS contractor_code, up.display_name AS prepared_by_name, ua.display_name AS approved_by_name
       FROM hse_jsa j LEFT JOIN contractor c ON c.id = j.contractor_id
       LEFT JOIN app_user up ON up.id = j.prepared_by LEFT JOIN app_user ua ON ua.id = j.approved_by
      WHERE j.project_id = $1 ORDER BY j.jsa_no, j.created_at`, [projectId]);
  const steps = await stepsOf(db, rows.map((j) => j.id));
  return rows.map((j) => ({ ...j, steps: steps.get(j.id),
    problems: j.status === "draft" ? jsaApprovalProblems(steps.get(j.id), settings) : [] }));
}

// ── the permit ───────────────────────────────────────────────────────────

/** Replace a requested permit's crew. */
export async function setPermitCrew(db, { projectId, permitId, personIds = [] }) {
  const { rows: [p] } = await db.query("SELECT status FROM hse_permit WHERE id = $1 AND project_id = $2", [permitId, projectId]);
  if (!p) throw notFound("permit");
  if (p.status !== "requested") throw bad("خدمهٔ مجوزِ صادرشده تغییر نمی‌کند.");
  const ids = [...new Set(personIds.filter(Boolean))];
  if (ids.length) {
    const { rows } = await db.query("SELECT id FROM hse_person WHERE project_id = $1 AND id = ANY($2::uuid[])", [projectId, ids]);
    if (rows.length !== ids.length) throw bad("بعضی افراد در فهرست افراد پروژه نیستند.");
  }
  await db.query("DELETE FROM hse_permit_crew WHERE permit_id = $1", [permitId]);
  for (const id of ids) await db.query("INSERT INTO hse_permit_crew (project_id, permit_id, person_id) VALUES ($1,$2,$3)", [projectId, permitId, id]);
  return { crew: ids.length };
}

/** A permit's scaffold/crane must be of the kind its type works with. */
export async function checkPermitLinks(db, { projectId, type, equipmentId = null, jsaId = null }) {
  if (equipmentId) {
    const e = await equipmentRow(db, projectId, equipmentId);
    const want = EQUIPMENT_KINDS[e.kind].permitType;
    if (want !== type) throw bad(`${EQUIPMENT_KINDS[e.kind].title} ${e.ref_no} به مجوز «${PERMIT_TYPES[want].title}» مربوط است، نه «${PERMIT_TYPES[type]?.title ?? type}».`);
  }
  if (jsaId) await jsaRow(db, projectId, jsaId);
}

/**
 * Safe-work reasons for each permit (all at once, for the board), and notes
 * for what the project has not stated. Window days are UTC dates.
 * @returns Map(permitId → {reasons, notes, crew, equipment, jsa})
 */
export async function safeWorkForPermits(db, projectId, permits) {
  const out = new Map();
  if (!permits.length) return out;
  const settings = await safeWorkSettings(db, projectId);
  const ids = permits.map((p) => p.id);
  const { rows: crewRows } = await db.query(
    `SELECT c.permit_id, p.id AS person_id, p.full_name FROM hse_permit_crew c JOIN hse_person p ON p.id = c.person_id
      WHERE c.permit_id = ANY($1::uuid[]) ORDER BY p.full_name`, [ids]);
  const cards = await cardsOf(db, projectId, [...new Set(crewRows.map((r) => r.person_id))]);
  const eqIds = [...new Set(permits.map((p) => p.equipment_id).filter(Boolean))];
  const { rows: eqs } = eqIds.length
    ? await db.query("SELECT * FROM hse_equipment WHERE id = ANY($1::uuid[])", [eqIds]) : { rows: [] };
  const ins = await inspectionsOf(db, projectId, eqIds);
  const jsaIds = [...new Set(permits.map((p) => p.jsa_id).filter(Boolean))];
  const { rows: jsas } = jsaIds.length
    ? await db.query("SELECT id, jsa_no, revision, status FROM hse_jsa WHERE id = ANY($1::uuid[])", [jsaIds]) : { rows: [] };
  const required = settings.hse_jsa_required_types;
  for (const p of permits) {
    const from = day(p.valid_from), to = day(p.valid_to);
    const crew = crewRows.filter((r) => r.permit_id === p.id).map((r) => ({ id: r.person_id, name: r.full_name, cards: cards.get(r.person_id) }));
    const reasons = [], notes = [];
    const rule = competenceRule(settings.hse_competence_rules, p.type);
    const cc = crewCheck(rule, crew, from, to);
    if (!cc.declared) notes.push("صلاحیت لازم برای این نوع مجوز در قواعد HSE پروژه تعیین نشده — سنجیده نشد");
    reasons.push(...cc.reasons);
    let equipment = null;
    if (p.equipment_id) {
      const e = eqs.find((x) => x.id === p.equipment_id);
      equipment = { id: e.id, refNo: e.ref_no, kind: e.kind };
      reasons.push(...equipmentCoverage({ kind: e.kind, refNo: e.ref_no, dismantledOn: day(e.dismantled_on), inspections: ins.get(e.id) },
        settings, from, to));
    }
    const j = p.jsa_id ? jsas.find((x) => x.id === p.jsa_id) : null;
    const jsa = j ? { id: j.id, jsaNo: j.jsa_no, revision: j.revision, status: j.status } : null;
    if (required === null || required === undefined) notes.push("لزوم JSA برای انواع مجوز در قواعد HSE پروژه تعیین نشده — سنجیده نشد");
    reasons.push(...jsaCheck({ required: Array.isArray(required) ? required.includes(p.type) : null, jsa }));
    out.set(p.id, { reasons, notes, crew: crew.map((c) => ({ id: c.id, name: c.name })), equipment, jsa });
  }
  return out;
}

export async function safeWorkBoard(db, { projectId, today }) {
  const settings = await safeWorkSettings(db, projectId);
  return {
    settings, competences: COMPETENCES, equipmentKinds: EQUIPMENT_KINDS,
    people: await peopleBoard(db, { projectId, today }),
    equipment: await equipmentBoard(db, { projectId, today }),
    jsas: await jsaBoard(db, { projectId }),
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

async function personRow(db, projectId, id) {
  const { rows: [p] } = await db.query("SELECT * FROM hse_person WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!p) throw notFound("person");
  return p;
}
async function equipmentRow(db, projectId, id) {
  const { rows: [e] } = await db.query("SELECT * FROM hse_equipment WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!e) throw notFound("equipment");
  return e;
}
async function jsaRow(db, projectId, id) {
  const { rows: [j] } = await db.query("SELECT * FROM hse_jsa WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!j) throw notFound("JSA");
  return j;
}
const asCard = (r) => ({ id: r.id, kind: r.kind, certNo: r.cert_no, issuer: r.issuer, issuedOn: day(r.issued_on),
  expiresOn: day(r.expires_on), noExpiry: r.no_expiry, revokedOn: day(r.revoked_on), revokedReason: r.revoked_reason });
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
