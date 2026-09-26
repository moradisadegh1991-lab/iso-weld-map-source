/**
 * Performance test: the contract's guarantees, the tests run against them,
 * their measured results, and where each guarantee stands.
 *
 * Every rule is lib/completions/performance.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  DIRECTIONS, guaranteeProblems, judgeResult, hoursBetween, testProblems, signProblems, guaranteeStatus,
} from "../../completions/performance.mjs";

export async function upsertGuarantee(db, {
  projectId, code, parameter, unitId = null, uom, direction, guaranteedValue, minDurationH = null, basis,
}) {
  const p = guaranteeProblems({ code, parameter, uom, direction, guaranteedValue, basis, minDurationH });
  if (p.length) throw bad(p.join(" · "));
  if (unitId) await unitRow(db, projectId, unitId);
  const { rows: [prior] } = await db.query(
    `SELECT g.id, (SELECT count(*)::int FROM performance_result r WHERE r.guarantee_id = g.id) AS n
       FROM performance_guarantee g WHERE g.project_id = $1 AND g.code = $2`, [projectId, String(code).toUpperCase()]);
  if (prior?.n) {
    const { rows: [cur] } = await db.query("SELECT * FROM performance_guarantee WHERE id = $1", [prior.id]);
    const same = cur.direction === direction && Number(cur.guaranteed_value) === Number(guaranteedValue) && cur.uom === String(uom).trim()
      && (cur.unit_id || null) === (unitId || null) && (cur.min_duration_h === null ? null : Number(cur.min_duration_h)) === num(minDurationH);
    if (!same) throw bad(`تضمین ${cur.code} نتیجهٔ آزمون دارد؛ شرایطش عوض نمی‌شود — اصلاحیهٔ قرارداد، تضمین جدیدی است.`);
  }
  const { rows: [g] } = await db.query(
    `INSERT INTO performance_guarantee (project_id, code, parameter, unit_id, uom, direction, guaranteed_value, min_duration_h, basis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, code) DO UPDATE SET parameter = EXCLUDED.parameter, unit_id = EXCLUDED.unit_id, uom = EXCLUDED.uom,
        direction = EXCLUDED.direction, guaranteed_value = EXCLUDED.guaranteed_value, min_duration_h = EXCLUDED.min_duration_h,
        basis = EXCLUDED.basis
     RETURNING *`,
    [projectId, String(code).toUpperCase(), String(parameter).trim(), unitId || null, String(uom).trim(), direction,
     Number(guaranteedValue), num(minDurationH), String(basis).trim()]);
  return g;
}

/** The subsystems a test's scope covers, with whether each has an accepted RFSU. */
async function scopeOf(db, projectId, unitId) {
  const { rows } = await db.query(
    `SELECT s.code, (r.accepted_at IS NOT NULL) AS rfsu_accepted FROM subsystem s
       LEFT JOIN rfsu_certificate r ON r.subsystem_id = s.id
      WHERE s.project_id = $1 AND ($2::uuid IS NULL OR s.unit_id = $2::uuid) ORDER BY s.code`, [projectId, unitId || null]);
  return rows.map((r) => ({ code: r.code, rfsuAccepted: r.rfsu_accepted }));
}

export async function recordTest(db, { projectId, testNo, unitId = null, startedAt, endedAt, note = null, userId = null,
  now = new Date().toISOString() }) {
  if (!String(testNo || "").trim()) throw bad("شمارهٔ آزمون لازم است.");
  if (unitId) await unitRow(db, projectId, unitId);
  const p = testProblems({ scope: await scopeOf(db, projectId, unitId), startedAt, endedAt, now });
  if (p.length) throw bad(p.join(" · "));
  const { rows: [t] } = await db.query(
    `INSERT INTO performance_test (project_id, test_no, unit_id, started_at, ended_at, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, String(testNo).trim().toUpperCase(), unitId || null, startedAt, endedAt, note || null, userId]);
  return t;
}

/** A measured value for one guarantee of the test's own scope. */
export async function recordResult(db, { projectId, testId, guaranteeId, measured, method = null }) {
  const t = await testRow(db, projectId, testId);
  if (t.signed_at) throw bad("آزمون امضا شده؛ نتیجه‌هایش عوض نمی‌شوند — آزمون مجدد، آزمون جدیدی است.");
  const { rows: [g] } = await db.query("SELECT * FROM performance_guarantee WHERE id = $1 AND project_id = $2", [guaranteeId, projectId]);
  if (!g) throw notFound("guarantee");
  if ((g.unit_id || null) !== (t.unit_id || null)) throw bad(`تضمین ${g.code} در محدودهٔ این آزمون نیست.`);
  if (num(measured) === null) throw bad("مقدار اندازه‌گیری‌شده عدد نیست.");
  const { rows: [r] } = await db.query(
    `INSERT INTO performance_result (project_id, test_id, guarantee_id, measured, method) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (test_id, guarantee_id) DO UPDATE SET measured = EXCLUDED.measured, method = EXCLUDED.method RETURNING *`,
    [projectId, testId, guaranteeId, num(measured), method || null]);
  return r;
}

/** Sign: every guarantee in scope measured. The verdicts are the engine's, whatever they are. */
export async function signTest(db, { projectId, testId, userId }) {
  if (!userId) throw bad("امضای آزمون یک شخص لازم دارد.");
  const t = await testRow(db, projectId, testId);
  if (t.signed_at) throw bad("این آزمون پیش‌تر امضا شده است.");
  const { rows: guarantees } = await db.query(
    "SELECT id, code FROM performance_guarantee WHERE project_id = $1 AND unit_id IS NOT DISTINCT FROM $2::uuid", [projectId, t.unit_id]);
  const { rows: results } = await db.query("SELECT guarantee_id FROM performance_result WHERE test_id = $1", [testId]);
  const p = signProblems({ guarantees, results: results.map((r) => ({ guaranteeId: r.guarantee_id })) });
  if (p.length) throw bad(p.join(" · "));
  const { rows: [out] } = await db.query(
    "UPDATE performance_test SET signed_by = $2, signed_at = clock_timestamp() WHERE id = $1 RETURNING *", [testId, userId]);
  return out;
}

/** The owner's acceptance of a signed test: someone other than its signer. */
export async function acceptTest(db, { projectId, testId, userId }) {
  const t = await testRow(db, projectId, testId);
  if (!t.signed_at) throw bad("آزمون هنوز امضا نشده است.");
  if (t.accepted_at) throw bad("آزمون پیش‌تر پذیرفته شده است.");
  if (t.signed_by === userId) throw bad("امضاکنندهٔ آزمون، آن را از طرف کارفرما نمی‌پذیرد.");
  const { rows: [out] } = await db.query(
    "UPDATE performance_test SET accepted_by = $2, accepted_at = clock_timestamp() WHERE id = $1 RETURNING *", [testId, userId]);
  return out;
}

export async function performanceBoard(db, { projectId }) {
  const { rows: units } = await db.query("SELECT id, code, name FROM unit WHERE project_id = $1 ORDER BY code", [projectId]);
  const { rows: gs } = await db.query(
    `SELECT g.*, u.code AS unit_code FROM performance_guarantee g LEFT JOIN unit u ON u.id = g.unit_id
      WHERE g.project_id = $1 ORDER BY u.code NULLS FIRST, g.code`, [projectId]);
  const guarantees = gs.map(asGuarantee);
  const { rows: ts } = await db.query(
    `SELECT t.*, u.code AS unit_code, us.display_name AS signed_by_name, ua.display_name AS accepted_by_name
       FROM performance_test t LEFT JOIN unit u ON u.id = t.unit_id
       LEFT JOIN app_user us ON us.id = t.signed_by LEFT JOIN app_user ua ON ua.id = t.accepted_by
      WHERE t.project_id = $1 ORDER BY t.started_at DESC`, [projectId]);
  const { rows: rs } = await db.query("SELECT * FROM performance_result WHERE project_id = $1", [projectId]);
  const tests = ts.map((t) => {
    const dur = hoursBetween(t.started_at, t.ended_at);
    const results = rs.filter((r) => r.test_id === t.id).map((r) => {
      const g = guarantees.find((x) => x.id === r.guarantee_id);
      return { guaranteeId: r.guarantee_id, code: g.code, measured: Number(r.measured), method: r.method,
        verdict: judgeResult(g, r.measured, dur) };
    });
    return { id: t.id, testNo: t.test_no, unitId: t.unit_id, unitCode: t.unit_code, startedAt: t.started_at, endedAt: t.ended_at,
      durationH: Math.round(dur * 10) / 10, note: t.note, signedAt: t.signed_at, signedBy: t.signed_by, signedByName: t.signed_by_name,
      acceptedAt: t.accepted_at, acceptedByName: t.accepted_by_name, results };
  });
  const scopes = {};
  for (const u of [{ id: null }, ...units]) {
    const sc = await scopeOf(db, projectId, u.id);
    scopes[u.id || "plant"] = { subsystems: sc.length, rfsuAccepted: sc.filter((s) => s.rfsuAccepted).length };
  }
  return { units, guarantees, tests, status: guaranteeStatus(guarantees, tests), scopes, directions: DIRECTIONS };
}

// ── helpers ──────────────────────────────────────────────────────────────

const asGuarantee = (g) => ({ id: g.id, code: g.code, parameter: g.parameter, unitId: g.unit_id, unitCode: g.unit_code || null,
  uom: g.uom, direction: g.direction, guaranteedValue: Number(g.guaranteed_value),
  minDurationH: g.min_duration_h === null ? null : Number(g.min_duration_h), basis: g.basis });
async function testRow(db, projectId, id) {
  const { rows: [t] } = await db.query("SELECT * FROM performance_test WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!t) throw notFound("performance test");
  return t;
}
async function unitRow(db, projectId, id) {
  const { rows: [u] } = await db.query("SELECT id FROM unit WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!u) throw notFound("unit");
  return u;
}
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
