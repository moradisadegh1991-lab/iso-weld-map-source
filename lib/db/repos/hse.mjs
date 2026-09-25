/**
 * HSE: man-hours, incidents, rates, permits to work, gas tests, observations.
 *
 * Every rule is lib/hse/hse.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  CLASSES, TREATMENTS, classifyIncident, rates, PERMIT_TYPES, GAS_LIMITS, judgeGasTest, activationCheck,
  permitState, simops, OBSERVATION_KINDS, SEVERITIES, observationState,
} from "../../hse/hse.mjs";

const PROJECT_HSE = [...Object.keys(GAS_LIMITS), "hse_permit_max_hours"];

// ── man-hours ────────────────────────────────────────────────────────────

/** One contractor's hours for one day; a second entry for the day corrects the first. */
export async function recordManhours(db, { projectId, contractorId = null, workDate, hours, headcount = null, userId = null }) {
  if (!workDate) throw bad("تاریخ لازم است.");
  const h = Number(hours);
  if (!(h >= 0) || hours === "" || hours == null) throw bad("نفرساعت باید عدد نامنفی باشد.");
  if (h > 24 * Math.max(1, Number(headcount) || 0) && headcount != null)
    throw bad(`${h} نفرساعت برای ${headcount} نفر در یک روز ممکن نیست.`);
  const { rows } = await db.query(
    `INSERT INTO hse_manhours (project_id, contractor_id, work_date, hours, headcount, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (project_id, COALESCE(contractor_id, '00000000-0000-0000-0000-000000000000'::uuid), work_date)
     DO UPDATE SET hours = EXCLUDED.hours, headcount = EXCLUDED.headcount, recorded_by = EXCLUDED.recorded_by
     RETURNING *`,
    [projectId, contractorId || null, workDate, h, headcount === "" ? null : headcount, userId]);
  return rows[0];
}

// ── incidents ────────────────────────────────────────────────────────────


export async function reportIncident(db, {
  projectId, refNo, occurredAt, area = null, contractorId = null, description, injured = null, fatal = null,
  daysAway = null, restrictedDays = null, treatment = null, userId = null,
}) {
  if (!refNo || !occurredAt || !description) throw bad("شماره، زمان و شرح رویداد لازم است.");
  checkFacts({ treatment, daysAway, restrictedDays });
  const { rows } = await db.query(
    `INSERT INTO hse_incident (project_id, ref_no, occurred_at, area, contractor_id, description, injured, fatal,
                               days_away, restricted_days, treatment, reported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, refNo, occurredAt, area, contractorId || null, description, tri(injured), tri(fatal),
     int(daysAway), int(restrictedDays), treatment || null, userId]);
  return withClass(rows[0]);
}

/**
 * Change an incident's facts. A reason is required and the before/after is
 * kept, because the change that turns an LWC into an MTC moves the LTIF.
 */
export async function updateIncident(db, { projectId, incidentId, patch = {}, reason, userId = null }) {
  if (!String(reason || "").trim()) throw bad("دلیل تغییر لازم است.");
  const cur = await incidentRow(db, projectId, incidentId);
  const next = {};
  const map = { injured: tri, fatal: tri, daysAway: int, restrictedDays: int, treatment: (v) => v || null,
    area: (v) => v || null, description: (v) => v, contractorId: (v) => v || null, occurredAt: (v) => v };
  for (const [k, f] of Object.entries(map)) if (k in patch) next[snake(k)] = f(patch[k]);
  checkFacts({ treatment: next.treatment, daysAway: next.days_away, restrictedDays: next.restricted_days });
  if ("description" in next && !String(next.description || "").trim()) throw bad("شرح رویداد نمی‌تواند خالی شود.");
  const changed = Object.keys(next).filter((k) => String(cur[k] ?? "") !== String(next[k] ?? "")
    && !(cur[k] instanceof Date && new Date(next[k]).getTime() === cur[k].getTime()));
  if (!changed.length) return withClass(cur);
  const before = Object.fromEntries(changed.map((k) => [k, cur[k]]));
  const after = Object.fromEntries(changed.map((k) => [k, next[k]]));
  const sets = changed.map((k, i) => `${k} = $${i + 3}`).join(", ");
  const { rows } = await db.query(
    `UPDATE hse_incident SET ${sets}, updated_at = now() WHERE id = $1 AND project_id = $2 RETURNING *`,
    [incidentId, projectId, ...changed.map((k) => next[k])]);
  await db.query(
    `INSERT INTO hse_incident_revision (project_id, incident_id, before, after, reason, changed_by)
     VALUES ($1,$2,$3,$4,$5,$6)`, [projectId, incidentId, before, after, reason, userId]);
  return withClass(rows[0]);
}

export async function incidentHistory(db, { projectId, incidentId }) {
  const { rows } = await db.query(
    `SELECT r.*, u.display_name AS changed_by_name FROM hse_incident_revision r
       LEFT JOIN app_user u ON u.id = r.changed_by
      WHERE r.project_id = $1 AND r.incident_id = $2 ORDER BY r.created_at`, [projectId, incidentId]);
  return rows;
}

export async function listIncidents(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT i.*, c.code AS contractor_code FROM hse_incident i LEFT JOIN contractor c ON c.id = i.contractor_id
      WHERE i.project_id = $1 ORDER BY i.occurred_at DESC`, [projectId]);
  return rows.map(withClass);
}

/**
 * LTIF / TRIR over a date range (inclusive), for the project and per
 * contractor. Days since the last LTI is counted to `today`.
 */
export async function statistics(db, { projectId, from = null, to = null, today }) {
  const inRange = (d) => (!from || d >= from) && (!to || d <= to);
  const incidents = (await listIncidents(db, { projectId })).filter((i) => inRange(day(i.occurred_at)));
  const { rows: hours } = await db.query(
    `SELECT m.contractor_id, c.code, sum(m.hours)::float8 AS hours, max(m.work_date) AS last_day
       FROM hse_manhours m LEFT JOIN contractor c ON c.id = m.contractor_id
      WHERE m.project_id = $1 AND ($2::date IS NULL OR m.work_date >= $2) AND ($3::date IS NULL OR m.work_date <= $3)
      GROUP BY m.contractor_id, c.code ORDER BY c.code NULLS FIRST`, [projectId, from, to]);
  const total = hours.reduce((a, h) => a + h.hours, 0);
  const byContractor = hours.map((h) => ({
    contractorId: h.contractor_id, code: h.code || "EPC",
    ...rates(incidents.filter((i) => (i.contractor_id || null) === (h.contractor_id || null)).map((i) => i.cls), h.hours),
  }));
  // Incidents of a contractor with no hours in range still count project-wide
  // and are shown, so a rate is never improved by forgetting to log hours.
  const orphan = incidents.filter((i) => !hours.some((h) => (h.contractor_id || null) === (i.contractor_id || null)));
  const allLti = (await listIncidents(db, { projectId })).filter((i) => i.cls && CLASSES[i.cls].lti);
  const lastLti = allLti.map((i) => day(i.occurred_at)).sort().pop() || null;
  return {
    from, to, ...rates(incidents.map((i) => i.cls), total), byContractor,
    incidentsWithoutHours: orphan.map((i) => i.ref_no),
    lastLti, daysSinceLti: lastLti && today ? Math.floor((Date.parse(today) - Date.parse(lastLti)) / 86_400_000) : null,
    byClass: Object.fromEntries(Object.keys(CLASSES).map((k) => [k, incidents.filter((i) => i.cls === k).length])),
  };
}

// ── permits ──────────────────────────────────────────────────────────────

export async function requestPermit(db, {
  projectId, permitNo, type, area, description, contractorId = null, requesterName = null, validFrom, validTo,
  attendant = null, isolationRef = null, userId = null,
}) {
  if (!PERMIT_TYPES[type]) throw bad(`نوع مجوز «${type}» شناخته نشد.`);
  if (!permitNo || !String(area || "").trim() || !description) throw bad("شماره، محدوده و شرح کار لازم است.");
  if (!validFrom || !validTo || new Date(validTo) <= new Date(validFrom)) throw bad("بازهٔ اعتبار مجوز درست نیست.");
  const { rows } = await db.query(
    `INSERT INTO hse_permit (project_id, permit_no, type, area, description, contractor_id, requested_by, requester_name,
                             valid_from, valid_to, attendant, isolation_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, permitNo, type, String(area).trim(), description, contractorId || null, userId, requesterName,
     validFrom, validTo, attendant || null, isolationRef || null]);
  return rows[0];
}

/** Record a gas test; the verdict comes back with it. */
export async function recordGasTest(db, {
  projectId, permitId, testedAt, o2Pct = null, lelPct = null, h2sPpm = null, coPpm = null,
  testerName = null, instrument = null, userId = null,
}) {
  const p = await permitRow(db, projectId, permitId);
  if (["closed", "cancelled"].includes(p.status)) throw bad("مجوز بسته یا لغو شده است.");
  if (!testedAt) throw bad("زمان تست گاز لازم است.");
  const { rows } = await db.query(
    `INSERT INTO hse_gas_test (project_id, permit_id, tested_at, o2_pct, lel_pct, h2s_ppm, co_ppm, tester_name,
                               instrument, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, permitId, testedAt, num(o2Pct), num(lelPct), num(h2sPpm), num(coPpm), testerName, instrument, userId]);
  const project = await projectLimits(db, projectId);
  return { test: rows[0], verdict: judgeGasTest(asGas(rows[0]), project) };
}

/** Sign the permit active. Refused with every reason while anything is open. */
export async function activatePermit(db, { projectId, permitId, userId, now = new Date().toISOString() }) {
  if (!userId) throw bad("صدور مجوز امضای یک شخص لازم دارد.");
  const p = await permitRow(db, projectId, permitId);
  if (p.status !== "requested") throw bad(`مجوز در وضعیت «${p.status}» است و قابل صدور نیست.`);
  const project = await projectLimits(db, projectId);
  const check = activationCheck(asPermit(p), { issuerId: userId, now, latestGasTest: await latestGas(db, permitId), project });
  if (!check.ok) throw Object.assign(bad(`مجوز صادر نشد: ${check.reasons.join(" · ")}`), { reasons: check.reasons });
  const { rows } = await db.query(
    `UPDATE hse_permit SET status = 'active', issued_by = $1, issued_at = $2 WHERE id = $3 AND project_id = $4 RETURNING *`,
    [userId, now, permitId, projectId]);
  return rows[0];
}

export async function closePermit(db, { projectId, permitId, cancel = false, userId = null, now = new Date().toISOString() }) {
  const p = await permitRow(db, projectId, permitId);
  if (["closed", "cancelled"].includes(p.status)) throw bad("مجوز قبلاً بسته شده است.");
  if (!cancel && p.status !== "active") throw bad("فقط مجوز صادرشده بسته می‌شود؛ درخواست را لغو کنید.");
  const { rows } = await db.query(
    `UPDATE hse_permit SET status = $1, closed_by = $2, closed_at = $3 WHERE id = $4 AND project_id = $5 RETURNING *`,
    [cancel ? "cancelled" : "closed", userId, now, permitId, projectId]);
  return rows[0];
}

export async function listPermits(db, { projectId, now = new Date().toISOString() }) {
  const project = await projectLimits(db, projectId);
  const { rows } = await db.query(
    `SELECT p.*, c.code AS contractor_code, ui.display_name AS issued_by_name,
            (SELECT row_to_json(g) FROM (SELECT * FROM hse_gas_test g WHERE g.permit_id = p.id
                ORDER BY g.tested_at DESC, g.created_at DESC LIMIT 1) g) AS last_gas
       FROM hse_permit p LEFT JOIN contractor c ON c.id = p.contractor_id
       LEFT JOIN app_user ui ON ui.id = p.issued_by
      WHERE p.project_id = $1 ORDER BY p.valid_from DESC, p.permit_no`, [projectId]);
  const conflicts = simops(rows.map(asPermit), now);
  return rows.map((p) => {
    const gas = p.last_gas ? asGas(p.last_gas) : null;
    const state = permitState(asPermit(p), now);
    return {
      ...p, state, typeTitle: PERMIT_TYPES[p.type].title, needsGas: PERMIT_TYPES[p.type].gas,
      gasVerdict: gas ? judgeGasTest(gas, project) : null,
      readiness: state === "requested"
        ? activationCheck(asPermit(p), { issuerId: null, now, latestGasTest: gas, project }) : null,
      simopsWith: conflicts.filter((c) => c.includes(p.id)).map((c) => rows.find((r) => r.id === c.find((x) => x !== p.id)).permit_no),
    };
  });
}

// ── observations ─────────────────────────────────────────────────────────

export async function recordObservation(db, {
  projectId, observedOn, kind, severity = null, area = null, contractorId = null, description, action = null,
  dueOn = null, userId = null,
}) {
  if (!OBSERVATION_KINDS[kind]) throw bad(`نوع مشاهده «${kind}» شناخته نشد.`);
  if (!observedOn || !description) throw bad("تاریخ و شرح لازم است.");
  if (kind !== "good_practice") {
    if (!SEVERITIES[severity]) throw bad("شدت خطر را تعیین کنید.");
    if (!action || !dueOn) throw bad("مورد ناایمن بدون اقدام اصلاحی و مهلت ثبت نمی‌شود.");
    if (dueOn < observedOn) throw bad("مهلت اقدام پیش از تاریخ مشاهده است.");
  }
  const { rows } = await db.query(
    `INSERT INTO hse_observation (project_id, observed_on, kind, severity, area, contractor_id, description, action,
                                  due_on, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, observedOn, kind, kind === "good_practice" ? null : severity, area, contractorId || null,
     description, action, kind === "good_practice" ? null : dueOn, userId]);
  return rows[0];
}

export async function closeObservation(db, { projectId, observationId, closedOn, note }) {
  if (!closedOn || !String(note || "").trim()) throw bad("تاریخ و شرح اقدام انجام‌شده لازم است.");
  const { rows: [o] } = await db.query(
    "SELECT * FROM hse_observation WHERE id = $1 AND project_id = $2", [observationId, projectId]);
  if (!o) throw notFound("observation");
  if (o.closed_on) throw bad("این مورد قبلاً بسته شده.");
  if (closedOn < day(o.observed_on)) throw bad("تاریخ بستن پیش از تاریخ مشاهده است.");
  const { rows } = await db.query(
    "UPDATE hse_observation SET closed_on = $1, closed_note = $2 WHERE id = $3 RETURNING *", [closedOn, note, observationId]);
  return rows[0];
}

export async function listObservations(db, { projectId, today }) {
  const { rows } = await db.query(
    `SELECT o.*, c.code AS contractor_code FROM hse_observation o LEFT JOIN contractor c ON c.id = o.contractor_id
      WHERE o.project_id = $1 ORDER BY o.observed_on DESC, o.created_at DESC`, [projectId]);
  return rows.map((o) => ({ ...o, state: observationState({ kind: o.kind, dueOn: day(o.due_on), closedOn: day(o.closed_on) }, today) }));
}

/** Everything the HSE page shows. */
export async function hseBoard(db, { projectId, now = new Date().toISOString() }) {
  const today = now.slice(0, 10);
  const project = await projectLimits(db, projectId);
  const { rows: contractors } = await db.query("SELECT id, code, name FROM contractor WHERE project_id = $1 ORDER BY code", [projectId]);
  return {
    now, today, limits: project, limitTitles: { ...GAS_LIMITS, hse_permit_max_hours: "حداکثر مدت مجوز (ساعت)" },
    stats: await statistics(db, { projectId, today }),
    incidents: await listIncidents(db, { projectId }),
    permits: await listPermits(db, { projectId, now }),
    observations: await listObservations(db, { projectId, today }),
    contractors, classes: CLASSES, treatments: TREATMENTS, permitTypes: PERMIT_TYPES,
    observationKinds: OBSERVATION_KINDS, severities: SEVERITIES,
  };
}

// ── helpers ──────────────────────────────────────────────────────────────

function withClass(i) {
  const c = classifyIncident({ injured: i.injured, fatal: i.fatal, daysAway: i.days_away,
    restrictedDays: i.restricted_days, treatment: i.treatment });
  return { ...i, cls: c.cls, clsReason: c.reason || null, clsTitle: c.cls ? CLASSES[c.cls].title : null };
}
function checkFacts({ treatment, daysAway, restrictedDays }) {
  if (treatment && !TREATMENTS[treatment]) throw bad(`نوع درمان «${treatment}» شناخته نشد.`);
  for (const [v, t] of [[daysAway, "روزهای غیبت"], [restrictedDays, "روزهای کار محدود"]])
    if (v !== null && v !== undefined && v !== "" && !(Number.isInteger(Number(v)) && Number(v) >= 0))
      throw bad(`${t} باید عدد صحیح نامنفی باشد.`);
}
async function projectLimits(db, projectId) {
  const { rows: [p] } = await db.query(`SELECT ${PROJECT_HSE.join(", ")} FROM project WHERE id = $1`, [projectId]);
  return Object.fromEntries(PROJECT_HSE.map((k) => [k, p[k] === null ? null : Number(p[k])]));
}
async function latestGas(db, permitId) {
  const { rows: [g] } = await db.query(
    "SELECT * FROM hse_gas_test WHERE permit_id = $1 ORDER BY tested_at DESC, created_at DESC LIMIT 1", [permitId]);
  return g ? asGas(g) : null;
}
async function incidentRow(db, projectId, id) {
  const { rows: [i] } = await db.query("SELECT * FROM hse_incident WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!i) throw notFound("incident");
  return i;
}
async function permitRow(db, projectId, id) {
  const { rows: [p] } = await db.query("SELECT * FROM hse_permit WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!p) throw notFound("permit");
  return p;
}
const asPermit = (p) => ({ id: p.id, type: p.type, area: p.area, status: p.status, validFrom: p.valid_from,
  validTo: p.valid_to, requestedBy: p.requested_by, attendant: p.attendant, isolationRef: p.isolation_ref });
const asGas = (g) => ({ testedAt: g.tested_at, o2Pct: g.o2_pct, lelPct: g.lel_pct, h2sPpm: g.h2s_ppm, coPpm: g.co_ppm });
const tri = (v) => (v === true || v === "true" ? true : v === false || v === "false" ? false : null);
const int = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
const snake = (k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
