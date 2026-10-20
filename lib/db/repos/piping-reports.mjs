/**
 * The rows behind the piping reports (lib/piping/reports.mjs) and the spool
 * loads they ship on. Read from the governing registers (reporting.current_run)
 * — a superseded revision's welds are not in any report. Call inside
 * `withProject`.
 *
 * Joins that are made on a printed number rather than an id, and why:
 *   transmittal  an isometric (document) and its MDR entry (mdr_document)
 *                share only the drawing number and revision; the report
 *                shows the latest outgoing transmittal that carried them
 */
import { weldCompliance } from "./piping-hub.mjs";
import { STATUS } from "../../ndt/compliance.mjs";
import { NDT_METHODS, STATUS_EN, weldLog, billOfMaterials, ndtMetrics, progress, packingList } from "../../piping/reports.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const num = (v) => (v == null ? null : Number(v));

async function projectOf(db, projectId) {
  const { rows: [p] } = await db.query("SELECT code, name FROM project WHERE id = $1", [projectId]);
  return p;
}

/** The governing drawings, optionally one drawing number. */
async function drawings(db, { projectId, drawingNo = null }) {
  const { rows } = await db.query(
    `SELECT d.id, d.doc_no, d.sheet_no, d.revision, r.id AS run_id, r.payload->'bom' AS bom,
            (SELECT t.transmittal_no FROM mdr_document m
               JOIN mdr_revision mr ON mr.mdr_id = m.id AND mr.revision = d.revision
               JOIN transmittal_item ti ON ti.revision_id = mr.id
               JOIN transmittal t ON t.id = ti.transmittal_id AND t.direction = 'out'
              WHERE m.project_id = d.project_id AND m.doc_no = d.doc_no
              ORDER BY t.sent_on DESC, t.created_at DESC LIMIT 1) AS transmittal
       FROM reporting.current_run c JOIN extraction_run r ON r.id = c.run_id JOIN document d ON d.id = r.document_id
      WHERE r.project_id = $1 AND ($2::text IS NULL OR d.doc_no = $2)
      ORDER BY d.doc_no, d.sheet_no`, [projectId, drawingNo]);
  return rows;
}

/** Every governing weld with what the Weld Log, NDT and Progress reports need of it. */
async function weldRows(db, { projectId, drawingNo = null }) {
  const status = new Map((await weldCompliance(db, { projectId })).map((w) => [w.weld_uid, w.ndt.status]));
  const { rows } = await db.query(
    `SELECT w.weld_uid, w.weld_no, w.shop_field::text AS shop_field, w.weld_kind, w.nps, w.schedule AS weld_schedule,
            w.ndt_requirement, d.doc_no, d.sheet_no, l.line_no, sp.spool_no, pc.material_spec,
            cs.od_mm, cs.wall_thickness_mm, cs.schedule AS class_schedule,
            e.welded_at, wl.stamp_no, wp.wps_no, ld.load_no
       FROM reporting.current_run c JOIN weld w ON w.extraction_run_id = c.run_id
       JOIN document d ON d.id = w.document_id
       LEFT JOIN line l ON l.id = w.line_id
       LEFT JOIN piping_class pc ON pc.id = l.piping_class_id
       LEFT JOIN piping_class_size cs ON cs.piping_class_id = pc.id AND cs.nps = w.nps
       LEFT JOIN spool sp ON sp.id = w.spool_id
       LEFT JOIN ship_load_spool ls ON ls.spool_id = sp.id
       LEFT JOIN ship_load ld ON ld.id = ls.load_id
       LEFT JOIN weld_execution e ON e.weld_uid = w.weld_uid AND e.project_id = w.project_id
       LEFT JOIN welder wl ON wl.id = e.welder_id
       LEFT JOIN wps wp ON wp.id = e.wps_id
      WHERE w.project_id = $1 AND ($2::text IS NULL OR d.doc_no = $2)
      ORDER BY d.doc_no, d.sheet_no, length(w.weld_no), w.weld_no`, [projectId, drawingNo]);
  // the latest cycle of each method on each weld
  const { rows: recs } = await db.query(
    `SELECT DISTINCT ON (weld_uid, method) weld_uid, method::text AS method, result::text AS result, report_no
       FROM ndt_record WHERE project_id = $1 ORDER BY weld_uid, method, repair_cycle DESC, created_at DESC`, [projectId]);
  const byUid = new Map();
  for (const r of recs) {
    if (!NDT_METHODS.includes(r.method)) continue;
    const m = byUid.get(r.weld_uid) || {};
    m[r.method] = { result: r.result, reportNo: r.report_no };
    byUid.set(r.weld_uid, m);
  }
  return rows.map((w) => {
    const st = status.get(w.weld_uid);
    return {
      uid: w.weld_uid, drawingNo: w.doc_no, sheet: w.sheet_no, weldNo: w.weld_no, spool: w.spool_no, shopField: w.shop_field,
      weldedAt: w.welded_at, welded: !!w.welded_at, nps: num(w.nps), odMm: num(w.od_mm), wallMm: num(w.wall_thickness_mm),
      kind: w.weld_kind, schedule: w.weld_schedule || w.class_schedule, material: w.material_spec, wps: w.wps_no,
      welder: w.stamp_no, requirement: w.ndt_requirement, byMethod: byUid.get(w.weld_uid) || {},
      status: st ? STATUS_EN[st] || st : null, ndtDone: st ? !!STATUS[st].done : false,
      line: w.line_no, load: w.load_no,
    };
  });
}

async function spoolRows(db, { projectId, drawingNo = null }) {
  const { rows } = await db.query(
    `SELECT sp.id, sp.spool_no, sp.length_mm, d.doc_no, d.sheet_no, d.revision,
            bool_or(a.code = 'released' AND a.status = 'done') AS released,
            bool_or(a.code = 'fit_up' AND a.status = 'done') AS fit_up,
            bool_or(a.code = 'erected' AND a.status = 'done') AS erected,
            bool_or(ld.status = 'delivered') AS delivered
       FROM reporting.current_run c JOIN spool sp ON sp.extraction_run_id = c.run_id
       JOIN extraction_run r ON r.id = sp.extraction_run_id JOIN document d ON d.id = r.document_id
       LEFT JOIN spool_activity a ON a.spool_id = sp.id
       LEFT JOIN ship_load_spool ls ON ls.spool_id = sp.id LEFT JOIN ship_load ld ON ld.id = ls.load_id
      WHERE sp.project_id = $1 AND ($2::text IS NULL OR d.doc_no = $2)
      GROUP BY sp.id, d.doc_no, d.sheet_no, d.revision
      ORDER BY d.doc_no, d.sheet_no, sp.spool_no`, [projectId, drawingNo]);
  return rows.map((s) => ({ id: s.id, spool: s.spool_no, lengthMm: num(s.length_mm), drawingNo: s.doc_no, sheet: s.sheet_no, rev: s.revision,
    released: !!s.released, fit_up: !!s.fit_up, erected: !!s.erected, delivered: !!s.delivered }));
}

export const REPORT_KINDS = ["weld-log", "bom", "ndt", "progress"];

/** One report as a workbook spec (`toXlsx` writes it). */
export async function pipingReport(db, { projectId, kind, drawingNo = null, now = new Date() }) {
  if (!REPORT_KINDS.includes(kind)) throw bad(`unknown report: ${kind}`);
  const p = await projectOf(db, projectId);
  const scope = drawingNo ? `Drawing ${drawingNo}` : "All Drawings";
  const base = { project: p.code, jobNo: null, scope, now };
  if (kind === "weld-log") {
    const ds = new Map((await drawings(db, { projectId, drawingNo })).map((d) => [`${d.doc_no}|${d.sheet_no}`, d.transmittal]));
    const welds = (await weldRows(db, { projectId, drawingNo })).map((w) => ({ ...w, transmittal: ds.get(`${w.drawingNo}|${w.sheet}`) }));
    return weldLog({ ...base, welds });
  }
  if (kind === "bom") {
    const ds = await drawings(db, { projectId, drawingNo });
    return billOfMaterials({ ...base, drawings: ds.map((d) => ({ drawingNo: d.doc_no, sheet: d.sheet_no, rev: d.revision,
      bom: (Array.isArray(d.bom) ? d.bom : []).map((b) => ({ qty: b.qty ?? null, uom: b.uom || null, diam: b.diam ?? null, description: b.description })) })) });
  }
  if (kind === "ndt") return ndtMetrics({ ...base, welds: await weldRows(db, { projectId, drawingNo }) });
  const ds = await drawings(db, { projectId, drawingNo });
  return progress({ ...base, drawings: ds.map((d) => ({ drawingNo: d.doc_no, sheet: d.sheet_no, transmittal: d.transmittal })),
    welds: await weldRows(db, { projectId, drawingNo }), spools: await spoolRows(db, { projectId, drawingNo }) });
}

// ── loads ────────────────────────────────────────────────────────────────

const STATUSES = ["pending", "shipped", "delivered"];
const day = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : v ? String(v).slice(0, 10) : null);

export async function listLoads(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT l.*, (SELECT count(*)::int FROM ship_load_spool s WHERE s.load_id = l.id) AS spools,
            (SELECT count(*)::int FROM ship_load_item i WHERE i.load_id = l.id) AS items,
            (SELECT COALESCE(sum(sp.length_mm), 0)::float8 FROM ship_load_spool s JOIN spool sp ON sp.id = s.spool_id WHERE s.load_id = l.id) AS length_mm
       FROM ship_load l WHERE l.project_id = $1 ORDER BY l.created_at`, [projectId]);
  // spools of the governing registers that are on no load yet: what a new load can take
  const { rows: free } = await db.query(
    `SELECT sp.id, sp.spool_no, sp.length_mm::float8 AS length_mm, d.doc_no, d.sheet_no
       FROM reporting.current_run c JOIN spool sp ON sp.extraction_run_id = c.run_id
       JOIN extraction_run r ON r.id = sp.extraction_run_id JOIN document d ON d.id = r.document_id
      WHERE sp.project_id = $1 AND NOT EXISTS (SELECT 1 FROM ship_load_spool s WHERE s.spool_id = sp.id)
      ORDER BY d.doc_no, d.sheet_no, sp.spool_no`, [projectId]);
  return { loads: rows, freeSpools: free };
}

export async function loadDetail(db, { projectId, loadId }) {
  const { rows: [load] } = await db.query("SELECT * FROM ship_load WHERE id = $1 AND project_id = $2", [loadId, projectId]);
  if (!load) throw Object.assign(new Error("بار پیدا نشد."), { status: 404, code: "NOT_FOUND" });
  const { rows: spools } = await db.query(
    `SELECT sp.id, sp.spool_no, sp.length_mm::float8 AS length_mm, d.doc_no, d.sheet_no, d.revision,
            a.done_at AS fit_up_on, u.display_name AS fit_up_by
       FROM ship_load_spool s JOIN spool sp ON sp.id = s.spool_id
       JOIN extraction_run r ON r.id = sp.extraction_run_id JOIN document d ON d.id = r.document_id
       LEFT JOIN spool_activity a ON a.spool_id = sp.id AND a.code = 'fit_up' AND a.status = 'done'
       LEFT JOIN app_user u ON u.id = a.recorded_by
      WHERE s.load_id = $1 ORDER BY d.doc_no, d.sheet_no, sp.spool_no`, [loadId]);
  const { rows: items } = await db.query("SELECT * FROM ship_load_item WHERE load_id = $1 ORDER BY created_at", [loadId]);
  return { load, spools, items };
}

export async function createLoad(db, { projectId, userId, loadNo, destination = null, notes = null }) {
  if (!String(loadNo || "").trim()) throw bad("شمارهٔ بار لازم است.");
  const { rows: [r] } = await db.query(
    `INSERT INTO ship_load (project_id, load_no, destination, notes, created_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (project_id, load_no) DO NOTHING RETURNING *`,
    [projectId, String(loadNo).trim(), destination || null, notes || null, userId]);
  if (!r) throw bad(`بار ${loadNo} قبلاً ثبت شده است.`);
  return r;
}

/**
 * Move a load on: pending → shipped (leaves, with its date) → delivered
 * (arrives, not before it left). A load with nothing on it does not ship,
 * and a load that has left takes no more spools.
 */
export async function setLoadStatus(db, { projectId, loadId, status, on }) {
  if (!STATUSES.includes(status)) throw bad(`وضعیت نامعتبر: ${status}`);
  const { load, spools, items } = await loadDetail(db, { projectId, loadId });
  const at = day(on);
  if (status !== "pending" && !at) throw bad("تاریخ لازم است.");
  if (status === "shipped" && !spools.length && !items.length) throw bad("بار خالی ارسال نمی‌شود.");
  if (status === "delivered" && load.status !== "shipped") throw bad("باری تحویل می‌شود که ارسال شده باشد.");
  if (status === "delivered" && at < day(load.leave_on)) throw bad("تاریخ تحویل پیش از تاریخ ارسال است.");
  const { rows: [r] } = await db.query(
    `UPDATE ship_load SET status = $3,
            leave_on = CASE WHEN $3 = 'shipped' THEN $4::date WHEN $3 = 'pending' THEN NULL ELSE leave_on END,
            delivered_on = CASE WHEN $3 = 'delivered' THEN $4::date ELSE NULL END
      WHERE id = $1 AND project_id = $2 RETURNING *`, [loadId, projectId, status, at]);
  return r;
}

export async function addLoadSpools(db, { projectId, loadId, spoolIds, userId }) {
  const { load } = await loadDetail(db, { projectId, loadId });
  if (load.status !== "pending") throw bad("بار ارسال‌شده اسپول تازه نمی‌گیرد.");
  if (!Array.isArray(spoolIds) || !spoolIds.length) throw bad("اسپولی انتخاب نشده.");
  const { rows: taken } = await db.query(
    `SELECT sp.spool_no, l.load_no FROM ship_load_spool s JOIN spool sp ON sp.id = s.spool_id JOIN ship_load l ON l.id = s.load_id
      WHERE s.spool_id = ANY($1::uuid[])`, [spoolIds]);
  if (taken.length) throw bad(`این اسپول‌ها روی بار دیگری‌اند: ${taken.map((t) => `${t.spool_no} (${t.load_no})`).join("، ")}`);
  for (const id of spoolIds) {
    await db.query("INSERT INTO ship_load_spool (project_id, load_id, spool_id, added_by) VALUES ($1,$2,$3,$4)", [projectId, loadId, id, userId]);
  }
  return loadDetail(db, { projectId, loadId });
}

export async function removeLoadSpool(db, { projectId, loadId, spoolId }) {
  const { load } = await loadDetail(db, { projectId, loadId });
  if (load.status !== "pending") throw bad("اسپول از بار ارسال‌شده برداشته نمی‌شود.");
  await db.query("DELETE FROM ship_load_spool WHERE load_id = $1 AND spool_id = $2", [loadId, spoolId]);
  return loadDetail(db, { projectId, loadId });
}

export async function addLoadItem(db, { projectId, loadId, item }) {
  const { load } = await loadDetail(db, { projectId, loadId });
  if (load.status !== "pending") throw bad("بار ارسال‌شده قلم تازه نمی‌گیرد.");
  const qty = Number(item?.qty);
  if (!String(item?.description || "").trim()) throw bad("شرح قلم لازم است.");
  if (!(qty > 0)) throw bad("مقدار باید بیشتر از صفر باشد.");
  if (!String(item?.uom || "").trim()) throw bad("واحد لازم است.");
  await db.query(
    `INSERT INTO ship_load_item (project_id, load_id, drawing_ref, item_no, description, qty, uom, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [projectId, loadId, item.drawingRef || null, item.itemNo || null, String(item.description).trim(), qty, String(item.uom).trim(), item.notes || null]);
  return loadDetail(db, { projectId, loadId });
}

export async function packingListOf(db, { projectId, loadId, now = new Date() }) {
  const p = await projectOf(db, projectId);
  const { load, spools, items } = await loadDetail(db, { projectId, loadId });
  return packingList({ project: p.code, now,
    load: { loadNo: load.load_no, status: load.status, destination: load.destination, leaveOn: load.leave_on, deliveredOn: load.delivered_on, notes: load.notes },
    spools: spools.map((s) => ({ drawingNo: s.doc_no, sheet: s.sheet_no, rev: s.revision, spool: s.spool_no, lengthMm: s.length_mm,
      inspectedBy: s.fit_up_by, inspectedOn: s.fit_up_on })),
    items: items.map((i) => ({ drawingRef: i.drawing_ref, itemNo: i.item_no, description: i.description, qty: i.qty, uom: i.uom, notes: i.notes })) });
}

/** What a 4×2 in drawing label prints: each governing sheet, with the transmittal or load it travels on. */
export async function drawingLabels(db, { projectId, loadId = null, transmittal = null }) {
  if (loadId) {
    const { load, spools } = await loadDetail(db, { projectId, loadId });
    const seen = new Map();
    for (const s of spools) seen.set(`${s.doc_no}|${s.sheet_no}`, { header: load.load_no, drawingNo: s.doc_no, sheet: s.sheet_no, rev: s.revision });
    return [...seen.values()];
  }
  const ds = await drawings(db, { projectId });
  return ds.filter((d) => !transmittal || d.transmittal === transmittal)
    .map((d) => ({ header: d.transmittal || "", drawingNo: d.doc_no, sheet: d.sheet_no, rev: d.revision }));
}
