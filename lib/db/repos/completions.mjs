/**
 * Completions: test packages, their tests, and the MC certificate.
 *
 * Every rule is lib/completions/completions.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  MEDIA, testPressure, mixedPressures, packBlockers, judgeTest, mcReadiness,
} from "../../completions/completions.mjs";
import { tagStatus } from "./activities.mjs";
import { qualityBlocks } from "./quality.mjs";
import { createLoader } from "../loader.mjs";

// ── test packages ────────────────────────────────────────────────────────

export async function upsertPackage(db, { projectId, packNo, subsystemId = null, medium, stressRatio = null, description = null, userId = null }) {
  if (!String(packNo || "").trim()) throw bad("شمارهٔ پکیج تست لازم است.");
  if (!MEDIA[medium]) throw bad("نوع تست باید هیدرواستاتیک یا پنوماتیک باشد.");
  const rr = blankNum(stressRatio);
  if (rr !== null && !(rr > 0 && rr <= 6.5)) throw bad("Rr (ST/S) باید بزرگ‌تر از صفر و حداکثر 6.5 باشد (B31.3 §345.4.2).");
  const no = String(packNo).trim().toUpperCase();
  const { rows: [existing] } = await db.query("SELECT id FROM test_package WHERE project_id = $1 AND pack_no = $2", [projectId, no]);
  if (existing && await isAccepted(db, existing.id)) throw bad("تست این پکیج پذیرفته شده؛ مشخصاتش تغییر نمی‌کند.");
  const { rows: [p] } = await db.query(
    `INSERT INTO test_package (project_id, pack_no, subsystem_id, medium, stress_ratio, description, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (project_id, pack_no) DO UPDATE SET subsystem_id = EXCLUDED.subsystem_id, medium = EXCLUDED.medium,
        stress_ratio = EXCLUDED.stress_ratio, description = EXCLUDED.description
     RETURNING *`, [projectId, no, subsystemId || null, medium, rr, description || null, userId]);
  return p;
}

/** Put lines in a package. A line is tested in one package; an accepted package is closed. */
export async function addLines(db, { projectId, packageId, lineIds = [] }) {
  await packageRow(db, projectId, packageId);
  if (await isAccepted(db, packageId)) throw bad("تست این پکیج پذیرفته شده؛ خطی به آن اضافه نمی‌شود.");
  for (const lineId of lineIds) {
    const { rows: [other] } = await db.query(
      `SELECT p.pack_no FROM test_package_line l JOIN test_package p ON p.id = l.package_id
        WHERE l.project_id = $1 AND l.line_id = $2 AND l.package_id <> $3`, [projectId, lineId, packageId]);
    if (other) throw bad(`این خط در پکیج ${other.pack_no} است؛ هر خط در یک پکیج تست می‌شود.`);
    await db.query(
      `INSERT INTO test_package_line (project_id, package_id, line_id) VALUES ($1,$2,$3)
       ON CONFLICT (project_id, line_id) DO NOTHING`, [projectId, packageId, lineId]);
  }
  return packageStatus(db, { projectId, packageId });
}

export async function removeLine(db, { projectId, packageId, lineId }) {
  if (await isAccepted(db, packageId)) throw bad("تست این پکیج پذیرفته شده؛ خطی از آن برداشته نمی‌شود.");
  await db.query("DELETE FROM test_package_line WHERE project_id = $1 AND package_id = $2 AND line_id = $3", [projectId, packageId, lineId]);
  return packageStatus(db, { projectId, packageId });
}

/** One package: its lines and what holds each, its test pressure, and its tests. */
export async function packageStatus(db, { projectId, packageId }) {
  const p = await packageRow(db, projectId, packageId);
  const { rows: lines } = await db.query(
    `SELECT l.id, l.line_no, l.piping_class,
            COALESCE(pc.design_press_barg, pcn.design_press_barg)::float8 AS design_barg,
            COALESCE(pc.code, pcn.code) AS class_code,
            (SELECT count(*) FROM reporting.fact_weld f WHERE f.line_key = l.id)::int AS welds,
            (SELECT count(*) FROM reporting.fact_weld f WHERE f.line_key = l.id AND f.is_welded)::int AS welded,
            -- Accepted, not merely examined: every method at its own latest
            -- repair cycle (fact_weld.is_accepted, F11).
            (SELECT count(*) FROM reporting.fact_weld f WHERE f.line_key = l.id AND f.is_accepted)::int AS examined,
            (SELECT count(*) FROM weld_execution e JOIN reporting.fact_weld f ON f.weld_uid = e.weld_uid
              WHERE f.line_key = l.id AND e.project_id = l.project_id AND e.pwht_required)::int AS pwht_required,
            (SELECT count(*) FROM weld_execution e JOIN reporting.fact_weld f ON f.weld_uid = e.weld_uid
              WHERE f.line_key = l.id AND e.project_id = l.project_id AND e.pwht_required AND e.pwht_report_no IS NOT NULL)::int AS pwht_done,
            (SELECT count(*) FROM pipe_support s WHERE s.line_id = l.id)::int AS supports,
            (SELECT count(*) FROM pipe_support s WHERE s.line_id = l.id AND s.installed_at IS NOT NULL)::int AS supports_installed
       FROM test_package_line tl
       JOIN line l ON l.id = tl.line_id
       LEFT JOIN piping_class pc ON pc.id = l.piping_class_id
       LEFT JOIN piping_class pcn ON l.piping_class_id IS NULL AND pcn.project_id = l.project_id AND pcn.code = l.piping_class
      WHERE tl.package_id = $1 ORDER BY l.line_no`, [packageId]);
  const shaped = lines.map((l) => ({ id: l.id, lineNo: l.line_no, classCode: l.class_code, designBarg: l.design_barg,
    welds: l.welds, welded: l.welded, examined: l.examined, pwhtRequired: l.pwht_required, pwhtDone: l.pwht_done,
    supports: l.supports, supportsInstalled: l.supports_installed }));
  const pressures = shaped.map((l) => l.designBarg);
  const pressure = testPressure({ medium: p.medium, designPressures: pressures, stressRatio: p.stress_ratio });
  const { rows: tests } = await db.query(
    `SELECT r.*, ur.display_name AS recorded_by_name, ua.display_name AS accepted_by_name
       FROM test_record r LEFT JOIN app_user ur ON ur.id = r.recorded_by LEFT JOIN app_user ua ON ua.id = r.accepted_by
      WHERE r.package_id = $1 ORDER BY r.created_at`, [packageId]);
  const accepted = tests.some((t) => t.verdict === "pass" && t.accepted_by);
  const blockers = accepted ? [] : packBlockers(shaped);
  return {
    package: p, lines: shaped, pressure, mixed: mixedPressures(pressures), blockers, tests, accepted,
    state: accepted ? "accepted" : tests.some((t) => t.verdict === "pass") ? "passed" : blockers.length ? "not_ready" : "ready",
  };
}

export async function packageBoard(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT p.id, s.code AS subsystem_code FROM test_package p LEFT JOIN subsystem s ON s.id = p.subsystem_id
      WHERE p.project_id = $1 ORDER BY p.pack_no`, [projectId]);
  const out = [];
  for (const r of rows) {
    const st = await packageStatus(db, { projectId, packageId: r.id });
    out.push({ ...st, subsystemCode: r.subsystem_code });
  }
  return out;
}

/**
 * Record a test. Refused while anything holds the package (the pre-test
 * walkdown), and once the package is accepted. The verdict is the engine's.
 */
export async function recordTest(db, { projectId, packageId, testedOn, achievedBarg, holdMin, gaugeCert = null, leaks = null, witness = null, userId = null }) {
  if (!testedOn) throw bad("تاریخ تست لازم است.");
  const st = await packageStatus(db, { projectId, packageId });
  if (st.accepted) throw bad("تست این پکیج پیش‌تر پذیرفته شده است.");
  if (st.blockers.length) throw bad(`پکیج آمادهٔ تست نیست: ${st.blockers.map((b) => `${b.line ? b.line + ": " : ""}${b.what}`).join(" · ")}`);
  if (st.pressure.barg === null) throw bad(`فشار تست معلوم نیست: ${st.pressure.reason}`);
  const leak = leaks === true || leaks === "true" ? true : leaks === false || leaks === "false" ? false : null;
  const v = judgeTest({ requiredBarg: st.pressure.barg, achievedBarg, holdMin, gaugeCert, leaks: leak });
  const { rows: [r] } = await db.query(
    `INSERT INTO test_record (project_id, package_id, tested_on, medium, required_barg, basis, achieved_barg, hold_min,
                              gauge_cert, leaks, witness, verdict, reasons, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [projectId, packageId, testedOn, st.package.medium, st.pressure.barg, st.pressure.basis, blankNum(achievedBarg), blankNum(holdMin),
     gaugeCert || null, leak, witness || null, v.pass ? "pass" : "fail", JSON.stringify(v.reasons), userId]);
  return r;
}

/** Accept a passing test: by someone other than the recorder. */
export async function acceptTest(db, { projectId, recordId, userId }) {
  const { rows: [r] } = await db.query("SELECT * FROM test_record WHERE id = $1 AND project_id = $2", [recordId, projectId]);
  if (!r) throw notFound("test record");
  if (r.verdict !== "pass") throw bad("تست مردود پذیرفته نمی‌شود.");
  if (r.accepted_by) throw bad("این تست پیش‌تر پذیرفته شده است.");
  if (userId && userId === r.recorded_by) throw bad("ثبت‌کنندهٔ تست، آن را نمی‌پذیرد.");
  if (await isAccepted(db, r.package_id)) throw bad("پکیج با تست دیگری پذیرفته شده است.");
  const { rows: [out] } = await db.query(
    "UPDATE test_record SET accepted_by = $2, accepted_at = clock_timestamp() WHERE id = $1 RETURNING *", [r.id, userId]);
  return out;
}

// ── mechanical completion ────────────────────────────────────────────────

/** MC readiness of one subsystem, from everything filed under it. */
export async function subsystemMc(db, { projectId, subsystemId, blocks = null, loader = null }) {
  const { rows: tagRows } = await db.query("SELECT id FROM tag WHERE project_id = $1 AND subsystem_id = $2 ORDER BY tag_no", [projectId, subsystemId]);
  const L = loader || createLoader(db, projectId);
  await L.prime(tagRows.map((t) => t.id));
  const tags = [];
  for (const { id } of tagRows) {
    const s = await tagStatus(db, { projectId, tagId: id, loader: L });
    if (!s.steps) continue;                     // no chain, no verdict — and nothing it certifies
    tags.push({ tagNo: s.tag.tag_no, ready: !!s.why.ready, pct: s.progress.pct });
  }
  const { rows: lines } = await db.query(
    `WITH ls AS (
       SELECT l.id FROM line l WHERE l.project_id = $1 AND l.subsystem_id = $2
       UNION
       SELECT f.line_key FROM reporting.fact_weld f
         JOIN line l ON l.id = f.line_key LEFT JOIN document d ON d.id = f.document_key
        WHERE f.project_key = $1 AND COALESCE(l.subsystem_id, d.subsystem_id) = $2
     )
     SELECT l.line_no, p.pack_no,
            EXISTS (SELECT 1 FROM test_record r WHERE r.package_id = p.id AND r.verdict = 'pass' AND r.accepted_by IS NOT NULL) AS accepted
       FROM ls JOIN line l ON l.id = ls.id
       LEFT JOIN test_package_line tl ON tl.line_id = l.id
       LEFT JOIN test_package p ON p.id = tl.package_id
      ORDER BY l.line_no`, [projectId, subsystemId]);
  const count = async (discipline) => (await db.query(
    `SELECT count(*)::int AS items, count(*) FILTER (WHERE is_tested)::int AS tested
       FROM reporting.fact_progress WHERE project_key = $1 AND subsystem_key = $2 AND discipline = $3`,
    [projectId, subsystemId, discipline])).rows[0];
  const q = (blocks || await qualityBlocks(db, { projectId }))[subsystemId] || { mc: 0, ncr: 0 };
  const r = mcReadiness({
    tags, lines: lines.map((l) => ({ lineNo: l.line_no, packNo: l.pack_no, accepted: l.accepted })),
    cables: await count("electrical"), instruments: await count("instrumentation"), punchA: q.mc, ncrOpen: q.ncr,
  });
  return { ...r, tags, lines };
}

export async function mcBoard(db, { projectId }) {
  const { rows: subs } = await db.query(
    `SELECT s.id, s.code, s.name, s.handover_seq, s.target_mc_date,
            m.signed_at, m.accepted_at, us.display_name AS signed_by_name, ua.display_name AS accepted_by_name,
            m.signed_by, m.accepted_by
       FROM subsystem s LEFT JOIN mc_certificate m ON m.subsystem_id = s.id
       LEFT JOIN app_user us ON us.id = m.signed_by LEFT JOIN app_user ua ON ua.id = m.accepted_by
      WHERE s.project_id = $1 ORDER BY s.handover_seq NULLS LAST, s.code`, [projectId]);
  const blocks = await qualityBlocks(db, { projectId });
  // One loader for the board: every tag's lookups in one query each, and a
  // foundation judged once even when its machine sits in another subsystem.
  const loader = createLoader(db, projectId);
  const { rows: all } = await db.query("SELECT id FROM tag WHERE project_id = $1", [projectId]);
  await loader.prime(all.map((t) => t.id));
  const out = [];
  for (const s of subs) {
    const r = await subsystemMc(db, { projectId, subsystemId: s.id, blocks, loader });
    out.push({ ...s, ...r,
      // Signed, but something it certified has since reopened (a new punch
      // A, an NCR). The certificate stands as signed; the board says so.
      reopened: !!s.signed_at && !r.ready });
  }
  return out;
}

/** Sign MC: refused while anything it certifies is open. The readiness is kept with the signature. */
export async function signMc(db, { projectId, subsystemId, userId }) {
  const { rows: [have] } = await db.query("SELECT id FROM mc_certificate WHERE project_id = $1 AND subsystem_id = $2", [projectId, subsystemId]);
  if (have) throw bad("MC این ساب‌سیستم پیش‌تر امضا شده است.");
  const r = await subsystemMc(db, { projectId, subsystemId });
  if (!r.ready) throw bad(`MC امضا نمی‌شود — باز: ${r.blockers.map((b) => `${b.kind}${b.count ? ` (${b.count})` : ""}`).join("، ")}`);
  const { rows: [m] } = await db.query(
    "INSERT INTO mc_certificate (project_id, subsystem_id, snapshot, signed_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [projectId, subsystemId, JSON.stringify({ tags: r.tags, lines: r.lines, scope: r.scope }), userId]);
  return m;
}

/** The client's acceptance: someone other than the signer. */
export async function acceptMc(db, { projectId, subsystemId, userId }) {
  const { rows: [m] } = await db.query("SELECT * FROM mc_certificate WHERE project_id = $1 AND subsystem_id = $2", [projectId, subsystemId]);
  if (!m) throw bad("MC هنوز امضا نشده است.");
  if (m.accepted_by) throw bad("MC پیش‌تر پذیرفته شده است.");
  if (userId === m.signed_by) throw bad("امضاکنندهٔ MC، آن را از طرف کارفرما نمی‌پذیرد.");
  const { rows: [out] } = await db.query(
    "UPDATE mc_certificate SET accepted_by = $2, accepted_at = clock_timestamp() WHERE id = $1 RETURNING *", [m.id, userId]);
  return out;
}

// ── helpers ──────────────────────────────────────────────────────────────

async function isAccepted(db, packageId) {
  const { rows: [r] } = await db.query(
    "SELECT EXISTS (SELECT 1 FROM test_record WHERE package_id = $1 AND verdict = 'pass' AND accepted_by IS NOT NULL) AS a", [packageId]);
  return r.a;
}
async function packageRow(db, projectId, id) {
  const { rows: [p] } = await db.query("SELECT * FROM test_package WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!p) throw notFound("test package");
  return p;
}
const blankNum = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
