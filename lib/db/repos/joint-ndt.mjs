/**
 * NDT of support, structural and equipment welds: the project's NDT matrix,
 * the joint register, samples, progressive draws, records, and what each
 * tag's chain reads. Rules: lib/ndt/joints.mjs. Call inside `withProject`.
 */
import { SCOPES, JOINT_TYPES, METHODS, ruleProblems, jointCompliance } from "../../ndt/joints.mjs";
import { lotVerdict, STATUS } from "../../ndt/compliance.mjs";
import { selectSample, drawFromPool } from "../../ndt/sampling.mjs";
import { DONE, IN_PROGRESS } from "../../platform/precedence.mjs";

// ── matrix ───────────────────────────────────────────────────────────────

export async function setRule(db, { projectId, scope, jointType, method, percent, extension = null, basis, userId = null }) {
  const r = { scope, jointType, method: String(method || "").toUpperCase(), percent: Number(percent), extension: extension || null, basis: blank(basis) };
  const p = ruleProblems(r);
  if (p.length) throw bad(p.join(" · "));
  const { rows: [row] } = await db.query(
    `INSERT INTO ndt_matrix_rule (project_id, scope, joint_type, method, percent, extension, basis, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (project_id, scope, joint_type, method) DO UPDATE SET percent = EXCLUDED.percent,
        extension = EXCLUDED.extension, basis = EXCLUDED.basis, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [projectId, r.scope, r.jointType, r.method, r.percent, r.percent < 100 ? r.extension : null, r.basis, userId]);
  return row;
}

export async function removeRule(db, { projectId, ruleId }) {
  const { rowCount } = await db.query("DELETE FROM ndt_matrix_rule WHERE id = $1 AND project_id = $2", [ruleId, projectId]);
  if (!rowCount) throw notFound("rule");
}

// ── joints ───────────────────────────────────────────────────────────────

export async function upsertJoint(db, {
  projectId, scope, jointNo, tagId = null, supportId = null, jointType, thicknessMm = null, drawingRef = null,
}) {
  if (!SCOPES[scope]) throw bad(`دامنهٔ «${scope}» شناخته نشد.`);
  if (!JOINT_TYPES[jointType]) throw bad(`نوع اتصال «${jointType}» شناخته نشد.`);
  if (!blank(jointNo)) throw bad("شمارهٔ جوش لازم است.");
  if (scope === "support") {
    if (!supportId) throw bad("ساپورت جوش را انتخاب کنید.");
    const { rows: [s] } = await db.query("SELECT id FROM pipe_support WHERE id = $1 AND project_id = $2", [supportId, projectId]);
    if (!s) throw notFound("support");
  } else {
    if (!tagId) throw bad("تگ سازه یا تجهیز را انتخاب کنید.");
    const want = scope === "structural" ? "structural" : "equipment";
    const { rows: [t] } = await db.query("SELECT discipline FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
    if (!t) throw notFound("tag");
    if (t.discipline !== want) throw bad(`جوش «${SCOPES[scope]}» روی تگ رشتهٔ ${t.discipline} ثبت نمی‌شود.`);
  }
  const { rows: [j] } = await db.query(
    `INSERT INTO weld_joint (project_id, scope, joint_no, tag_id, support_id, joint_type, thickness_mm, drawing_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (project_id, joint_no) DO UPDATE SET joint_type = EXCLUDED.joint_type,
        thickness_mm = EXCLUDED.thickness_mm, drawing_ref = COALESCE(EXCLUDED.drawing_ref, weld_joint.drawing_ref)
     RETURNING *`,
    [projectId, scope, blank(jointNo).toUpperCase(), scope === "support" ? null : tagId, scope === "support" ? supportId : null,
     jointType, num(thicknessMm), blank(drawingRef)]);
  return j;
}

export async function recordJointWeld(db, { projectId, jointId, welderId, weldedOn }) {
  if (!welderId || !weldedOn) throw bad("جوشکار و تاریخ جوشکاری لازم است.");
  const j = await jointRow(db, projectId, jointId);
  const { rows: [w] } = await db.query("SELECT id FROM welder WHERE id = $1 AND project_id = $2", [welderId, projectId]);
  if (!w) throw notFound("welder");
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM joint_ndt_record WHERE joint_id = $1", [j.id]);
  if (n && j.welder_id !== welderId) throw bad("این جوش NDT دارد؛ جوشکار آن عوض نمی‌شود — سابقهٔ نرخ تعمیر جوشکار به آن بسته است.");
  const { rows: [r] } = await db.query("UPDATE weld_joint SET welder_id = $2, welded_on = $3 WHERE id = $1 RETURNING *", [jointId, welderId, weldedOn]);
  return r;
}

/** An examination of a joint. The repair cycle is derived, not supplied. */
export async function recordJointNdt(db, {
  projectId, jointId, method, result, reportNo = null, defectType = null, inspectedOn = null, inspector = null, userId = null,
}) {
  const j = await jointRow(db, projectId, jointId);
  const m = String(method || "").toUpperCase();
  if (!METHODS.includes(m)) throw bad(`روش «${method}» شناخته نشد.`);
  if (!["accept", "reject", "pending"].includes(result)) throw bad("نتیجه: پذیرفته، رد یا در انتظار.");
  if (!j.welded_on) throw bad("جوشی که زده نشده NDT نمی‌شود.");
  if ((m === "RT" || m === "UT") && j.joint_type === "fillet") throw bad(`${m} برای جوش گوشه به کار نمی‌رود.`);
  if (result === "reject" && !blank(defectType)) throw bad("نوع عیب جوش ردشده را بنویسید.");
  const { rows: [prev] } = await db.query(
    "SELECT COALESCE(max(repair_cycle), -1) AS last FROM joint_ndt_record WHERE joint_id = $1 AND method = $2", [jointId, m]);
  const { rows: [r] } = await db.query(
    `INSERT INTO joint_ndt_record (project_id, joint_id, method, result, repair_cycle, report_no, defect_type, inspected_on, inspector, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, jointId, m, result, Number(prev.last) + 1, blank(reportNo), blank(defectType), inspectedOn || null, blank(inspector), userId]);
  return r;
}

// ── state ────────────────────────────────────────────────────────────────

/** Everything the rules need, for the project or for one tag / support. */
async function load(db, projectId, { tagId = null, supportId = null } = {}) {
  const { rows: matrix } = await db.query(
    "SELECT id, scope, joint_type, method::text AS method, percent::float8 AS percent, extension, basis FROM ndt_matrix_rule WHERE project_id = $1 ORDER BY scope, joint_type, method",
    [projectId]);
  const { rows: joints } = await db.query(
    `SELECT j.*, t.tag_no, s.support_no, s.line_id AS support_line, l.line_no, w.stamp_no
       FROM weld_joint j LEFT JOIN tag t ON t.id = j.tag_id LEFT JOIN pipe_support s ON s.id = j.support_id
       LEFT JOIN line l ON l.id = s.line_id LEFT JOIN welder w ON w.id = j.welder_id
      WHERE j.project_id = $1 AND ($2::uuid IS NULL OR j.tag_id = $2)
        AND ($3::uuid IS NULL OR s.line_id = (SELECT line_id FROM pipe_support WHERE id = $3) OR j.support_id = $3)
      ORDER BY j.joint_no`, [projectId, tagId, supportId]);
  const ids = joints.map((j) => j.id);
  const { rows: recs } = await db.query(
    `SELECT joint_id, method::text AS method, result::text AS result, repair_cycle, inspected_on, created_at
       FROM joint_ndt_record WHERE project_id = $1 AND joint_id = ANY($2::uuid[])`, [projectId, ids]);
  const { rows: sels } = await db.query(
    "SELECT group_key, joint_type, method::text AS method, selected_ids, drawn_at FROM joint_ndt_selection WHERE project_id = $1", [projectId]);
  const { rows: draws } = await db.query(
    "SELECT group_key, joint_type, method::text AS method, welder_id, tier, selected_ids FROM joint_progressive_draw WHERE project_id = $1", [projectId]);
  const input = {
    joints: joints.map((j) => ({ id: j.id, scope: j.scope, jointType: j.joint_type, group: groupOf(j), welderId: j.welder_id, welded: !!j.welded_on })),
    matrix: matrix.map((r) => ({ scope: r.scope, jointType: r.joint_type, method: r.method, percent: r.percent, extension: r.extension })),
    selections: sels.map((s) => ({ group: s.group_key, jointType: s.joint_type, method: s.method, selectedIds: s.selected_ids, createdAt: iso(s.drawn_at, true) })),
    records: recs.map((r) => ({ jointId: r.joint_id, method: r.method, result: r.result, repairCycle: r.repair_cycle,
      at: `${iso(r.inspected_on) || "9999-12-31"}|${iso(r.created_at, true)}` })),
    draws: draws.map((d) => ({ group: d.group_key, jointType: d.joint_type, method: d.method, welderId: d.welder_id, tier: d.tier, selectedIds: d.selected_ids })),
  };
  return { matrix, joints, input, status: jointCompliance(input) };
}

/** The lot's group: the tag; for supports, the line they are on (or the support alone). */
const groupOf = (j) => (j.tag_id ? `tag:${j.tag_id}` : j.support_line ? `line:${j.support_line}` : `support:${j.support_id}`);
const groupLabel = (j) => j.tag_no || (j.line_no ? `${j.line_no} (ساپورت‌ها)` : j.support_no);

export async function jointBoard(db, { projectId }) {
  const { matrix, joints, input, status } = await load(db, projectId);
  const rows = joints.map((j) => {
    const c = status.get(j.id);
    return { id: j.id, jointNo: j.joint_no, scope: j.scope, jointType: j.joint_type, parent: j.tag_no || j.support_no, group: groupOf(j),
      groupLabel: groupLabel(j), thicknessMm: num(j.thickness_mm), stamp: j.stamp_no, weldedOn: iso(j.welded_on),
      status: c.status, done: c.done, methods: c.methods.map((m) => ({ method: m.method, percent: m.percent, status: m.status, text: STATUS[m.status].text })) };
  });
  // Random rules with welded joints and no sample in their group yet.
  const needSample = [], lots = [];
  const seen = new Set();
  for (const j of rows) for (const m of j.methods) {
    const k = `${j.group}|${j.jointType}|${m.method}`;
    if (m.status === "sample_not_drawn" && !seen.has(k)) { seen.add(k); needSample.push({ group: j.group, groupLabel: j.groupLabel, jointType: j.jointType, method: m.method, percent: m.percent }); }
  }
  for (const j of joints) for (const m of status.get(j.id).methods) {
    const l = m.lot;
    if (!l || !["progressive", "full_examination", "extension_unknown"].includes(l.status)) continue;
    const k = `${l.lineId}|${l.method}|${l.welderId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const no = (id) => joints.find((x) => x.id === id)?.joint_no;
    lots.push({ group: groupOf(j), groupLabel: groupLabel(j), jointType: j.joint_type, method: l.method, welderId: l.welderId, stamp: j.stamp_no,
      status: l.status, tier: l.tier || null, defects: (l.defects || []).map(no), drawNeeded: l.drawNeeded?.count ?? null,
      drawn: (l.drawn || []).map(no), waiting: (l.waiting || []).map(no) });
  }
  return {
    matrix, joints: rows, needSample, lots,
    counts: { total: rows.length, welded: rows.filter((r) => r.weldedOn).length, done: rows.filter((r) => r.done).length,
      unknown: rows.filter((r) => r.status === "unknown").length },
    statusText: Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.text])),
  };
}

/**
 * Draw the random sample of a group for one joint type and method. The seed
 * is the population itself, so drawing again over the same welds gives the
 * same sample — redrawing cannot shop for a better one.
 */
export async function drawJointSample(db, { projectId, group, jointType, method, userId = null }) {
  if (!userId) throw bad("قرعه را یک شخص می‌کشد.");
  const { joints, matrix } = await load(db, projectId);
  const mine = joints.filter((j) => groupOf(j) === group && j.joint_type === jointType);
  if (!mine.length) throw notFound("group");
  const rule = matrix.find((r) => r.scope === mine[0].scope && r.joint_type === jointType && r.method === method);
  if (!rule || !(rule.percent < 100)) throw bad("برای این نوع اتصال و روش، قاعدهٔ درصد تصادفی در ماتریس NDT نیست.");
  const pop = mine.filter((j) => j.welded_on).sort((a, b) => a.joint_no.localeCompare(b.joint_no));
  if (!pop.length) throw bad("هنوز جوشی از این گروه زده نشده.");
  const seed = `${groupLabel(mine[0])}|${jointType}|${method}|${rule.percent}|${pop.map((j) => j.joint_no).join(",")}`;
  const s = selectSample(pop.map((j) => ({ weldUid: j.id, welderId: j.welder_id, weldNo: j.joint_no })), rule.percent, { seed });
  const { rows: [r] } = await db.query(
    `INSERT INTO joint_ndt_selection (project_id, group_key, joint_type, method, percent, seed, selected_ids, drawn_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, group, jointType, method, rule.percent, seed, s.selected.map((x) => x.weldUid), userId]);
  return { ...r, jointNos: s.selected.map((x) => x.weldNo) };
}

/** A progressive examination tier's additional joints, when the matrix rule says "progressive". */
export async function drawJointProgressive(db, { projectId, group, jointType, method, welderId, userId = null }) {
  if (!userId) throw bad("قرعه را یک شخص می‌کشد.");
  const { joints, input } = await load(db, projectId);
  const lotKey = `${group}|${jointType}`;
  const sel = input.selections.filter((s) => s.group === group && s.jointType === jointType && s.method === method)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!sel) throw bad("نمونهٔ تصادفی این گروه کشیده نشده.");
  const rule = input.matrix.find((r) => r.jointType === jointType && r.method === method
    && r.scope === joints.find((j) => groupOf(j) === group)?.scope);
  if (rule?.extension !== "progressive") throw bad("ماتریس NDT برای این قاعده بازرسی تدریجی تعیین نکرده.");
  const pct = Number(rule.percent);
  const lot = lotVerdict({
    welds: input.joints.filter((j) => j.jointType === jointType && `${j.group}|${j.jointType}` === lotKey)
      .map((j) => ({ uid: j.id, lineId: lotKey, welded: j.welded, welderId: j.welderId, requirement: `${method} ${pct}% random` })),
    selected: new Set(sel.selectedIds),
    records: input.records.filter((r) => r.method === method).map((r) => ({ uid: r.jointId, method, result: r.result, repairCycle: r.repairCycle, at: r.at })),
    draws: input.draws.filter((d) => `${d.group}|${d.jointType}` === lotKey && d.method === method)
      .map((d) => ({ lineId: lotKey, method, welderId: d.welderId, tier: d.tier, selectedUids: d.selectedIds })),
    extension: "progressive", lineId: lotKey, method, welderId,
  });
  if (!lot.drawNeeded) throw bad("این لات منتظر قرعهٔ بازرسی تدریجی نیست.");
  const d = lot.drawNeeded;
  const no = new Map(joints.map((j) => [j.id, j.joint_no]));
  const seed = `${lotKey}|${method}|${welderId}|${d.tier}|${d.defects.map((u) => no.get(u)).sort().join(",")}`;
  const picked = drawFromPool([...d.pool].sort((a, b) => no.get(a).localeCompare(no.get(b))), d.count, seed);
  const { rows: [r] } = await db.query(
    `INSERT INTO joint_progressive_draw (project_id, group_key, joint_type, method, welder_id, tier, defect_ids, selected_ids, seed, drawn_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, group, jointType, method, welderId, d.tier, d.defects, picked, seed, userId]);
  return { ...r, jointNos: picked.map((u) => no.get(u)) };
}

/**
 * The derived `weld_ndt` step of a structure or equipment tag. With no joint
 * registered the step does not apply — and says so, so an unregistered weld
 * is visible as a question rather than hidden as a pass.
 */
export async function deriveJointNdt(db, { projectId, tagId }) {
  const { joints, status } = await load(db, projectId, { tagId });
  if (!joints.length) {
    return { steps: { weld_ndt: "na" }, notes: { weld_ndt: { level: "info", text: "جوش میدانی برای این تگ ثبت نشده — اگر دارد، در صفحهٔ NDT جوش‌ها ثبت شود." } } };
  }
  const st = joints.map((j) => status.get(j.id));
  const done = st.filter((s) => s.done).length;
  const rejected = st.filter((s) => s.status === "rejected").length;
  const unknown = st.filter((s) => s.status === "unknown").length;
  const parts = [`${done} از ${joints.length} جوش NDT کامل`];
  if (rejected) parts.push(`${rejected} رد`);
  if (unknown) parts.push(`${unknown} بدون قاعده در ماتریس NDT`);
  const value = done === joints.length ? DONE : st.some((s) => s.status !== "not_welded") ? IN_PROGRESS : null;
  return { steps: { weld_ndt: value }, notes: { weld_ndt: value === DONE ? null : { level: rejected || unknown ? "bad" : "info", text: parts.join(" · ") } } };
}

/** Joints of a support whose NDT is not complete — a support is not inspected over them. */
export async function supportJointsOpen(db, { projectId, supportId }) {
  const { joints, status } = await load(db, projectId, { supportId });
  return joints.filter((j) => j.support_id === supportId && !status.get(j.id).done)
    .map((j) => ({ jointNo: j.joint_no, text: STATUS[status.get(j.id).status].text }));
}

async function jointRow(db, projectId, id) {
  const { rows: [j] } = await db.query("SELECT * FROM weld_joint WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!j) throw notFound("joint");
  return j;
}
const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const num = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (d, full = false) => (d instanceof Date ? (full ? d.toISOString() : d.toISOString().slice(0, 10)) : d == null ? null : String(d).slice(0, full ? 30 : 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
