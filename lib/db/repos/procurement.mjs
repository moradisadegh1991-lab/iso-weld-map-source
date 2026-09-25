/**
 * Procurement: vendors, POs, expediting, FAT, shipments, receipt, VDRL.
 *
 * Every rule is lib/procurement/procurement.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  REVIEW_CODES, FAT_RESULTS, lineDates, lineStage, fatProblems, shipProblems, receiveProblems, docState, onOrder,
} from "../../procurement/procurement.mjs";
import { receiveLot } from "./warehouse.mjs";

export async function upsertVendor(db, { projectId, code, name, country = null }) {
  if (!String(code || "").trim() || !String(name || "").trim()) throw bad("کد و نام فروشنده لازم است.");
  const { rows: [v] } = await db.query(
    `INSERT INTO vendor (project_id, code, name, country) VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, code) DO UPDATE SET name = EXCLUDED.name, country = EXCLUDED.country RETURNING *`,
    [projectId, String(code).trim().toUpperCase(), name.trim(), country || null]);
  return v;
}

export async function createPo(db, { projectId, poNo, vendorId, title, currency = null, placedOn, userId = null }) {
  if (!String(poNo || "").trim() || !String(title || "").trim() || !placedOn) throw bad("شمارهٔ PO، عنوان و تاریخ لازم است.");
  if (!vendorId) throw bad("فروشنده را انتخاب کنید.");
  const { rows: [o] } = await db.query(
    `INSERT INTO purchase_order (project_id, po_no, vendor_id, title, currency, placed_on, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, String(poNo).trim().toUpperCase(), vendorId, title.trim(), currency || null, placedOn, userId]);
  return o;
}

/**
 * A line buys a stock item or a tagged item. A stock item's unit is the
 * item's; a different unit on the PO would make every receipt a conversion.
 */
export async function addPoLine(db, {
  projectId, poId, itemId = null, tagId = null, description = null, qty, uom = null, unitPrice = null,
  promisedOn = null, needOn = null, fatRequired = false,
}) {
  const po = await poRow(db, projectId, poId);
  if (po.status !== "placed") throw bad("PO لغوشده ردیف نمی‌گیرد.");
  if (!!itemId === !!tagId) throw bad("هر ردیف یا یک کالای انبار است یا یک تگ تجهیز — یکی از این دو.");
  if (!(Number(qty) > 0)) throw bad("مقدار باید مثبت باشد.");
  let unit = uom;
  if (itemId) {
    const { rows: [i] } = await db.query("SELECT uom FROM material_item WHERE id = $1 AND project_id = $2", [itemId, projectId]);
    if (!i) throw notFound("material item");
    if (uom && uom !== i.uom) throw bad(`واحد کالا ${i.uom} است؛ ردیف PO با واحد دیگر ثبت نمی‌شود.`);
    unit = i.uom;
  } else {
    const { rows: [t] } = await db.query("SELECT id FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
    if (!t) throw notFound("tag");
    unit = uom || "EA";
  }
  const { rows: [{ n }] } = await db.query("SELECT COALESCE(max(line_no), 0)::int AS n FROM po_line WHERE po_id = $1", [poId]);
  const { rows: [l] } = await db.query(
    `INSERT INTO po_line (project_id, po_id, line_no, item_id, tag_id, description, qty, uom, unit_price,
                          promised_on, need_on, fat_required)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [projectId, poId, n + 1, itemId || null, tagId || null, description || null, Number(qty), unit,
     blankNum(unitPrice), promisedOn || null, needOn || null, !!fatRequired]);
  return l;
}

/** An expediting forecast, with where it came from. The history is kept. */
export async function setForecast(db, { projectId, poLineId, forecastOn, source, userId = null }) {
  await lineRow(db, projectId, poLineId);
  if (!forecastOn || !String(source || "").trim()) throw bad("تاریخ پیش‌بینی و منبع آن لازم است.");
  await db.query(
    "INSERT INTO po_forecast (project_id, po_line_id, forecast_on, source, by_user) VALUES ($1,$2,$3,$4,$5)",
    [projectId, poLineId, forecastOn, source.trim(), userId]);
  const { rows: [l] } = await db.query("UPDATE po_line SET forecast_on = $2 WHERE id = $1 RETURNING *", [poLineId, forecastOn]);
  return l;
}

export async function recordFat(db, { projectId, poLineId, inspectedOn, result, irnNo = null, inspector = null, note = null, userId = null }) {
  const l = await lineRow(db, projectId, poLineId);
  if (!l.fat_required) throw bad("این ردیف بازرسی کارخانه ندارد.");
  if (!inspectedOn) throw bad("تاریخ بازرسی لازم است.");
  const docs = (await vendorDocs(db, { projectId, poId: l.po_id })).filter((d) => d.before_fat)
    .map((d) => ({ docCode: d.doc_code, code: d.last_code === null ? null : Number(d.last_code) }));
  const problems = fatProblems({ result, irnNo, note }, { docsBeforeFat: docs });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [f] } = await db.query(
    `INSERT INTO fat_record (project_id, po_line_id, inspected_on, result, irn_no, inspector, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [projectId, poLineId, inspectedOn, result, blank(irnNo), inspector || null, note || null, userId]);
  return f;
}

/** A shipment of some of a PO's lines. Every line is checked before anything is written. */
export async function createShipment(db, { projectId, shipmentNo, poId, shippedOn, etaOn = null, mode = null, lines = [], userId = null }) {
  if (!String(shipmentNo || "").trim() || !shippedOn) throw bad("شمارهٔ محموله و تاریخ حمل لازم است.");
  if (!lines.length) throw bad("محموله بدون ردیف ثبت نمی‌شود.");
  const board = await poStatus(db, { projectId, poId });
  const problems = [];
  for (const x of lines) {
    const l = board.lines.find((y) => y.id === x.poLineId);
    if (!l) { problems.push("ردیف از این PO نیست"); continue; }
    for (const p of shipProblems(l, x.qty)) problems.push(`ردیف ${l.lineNo}: ${p}`);
  }
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [s] } = await db.query(
    `INSERT INTO shipment (project_id, shipment_no, po_id, mode, shipped_on, eta_on, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, String(shipmentNo).trim().toUpperCase(), poId, mode || null, shippedOn, etaOn || null, userId]);
  for (const x of lines) {
    await db.query("INSERT INTO shipment_line (project_id, shipment_id, po_line_id, qty) VALUES ($1,$2,$3,$4)",
      [projectId, s.id, x.poLineId, Number(x.qty)]);
  }
  return s;
}

export async function arriveShipment(db, { projectId, shipmentId, arrivedOn }) {
  if (!arrivedOn) throw bad("تاریخ ورود لازم است.");
  const { rows: [s] } = await db.query(
    "UPDATE shipment SET arrived_on = $3 WHERE id = $1 AND project_id = $2 AND arrived_on IS NULL RETURNING *",
    [shipmentId, projectId, arrivedOn]);
  if (!s) throw bad("محموله پیدا نشد یا پیش‌تر وارد شده است.");
  return s;
}

/**
 * Receive a stock item against its PO line: into the warehouse as a lot
 * (MIR and MTC follow as for any lot), never beyond what was ordered.
 */
export async function receiveAgainstPo(db, {
  projectId, poLineId, receiptNo, receivedOn, qty, heatNo = null, mtcRef = null, location = null, userId = null,
}) {
  const st = await lineStatus(db, { projectId, poLineId });
  const problems = receiveProblems(st, { qty });
  if (problems.length) throw bad(problems.join(" · "));
  const lot = await receiveLot(db, { projectId, itemId: st.itemId, receiptNo, poRef: st.poNo, supplier: st.vendorName,
    receivedOn, heatNo, mtcRef, qtyReceived: qty, location, userId });
  const { rows: [out] } = await db.query("UPDATE material_lot SET po_line_id = $2 WHERE id = $1 RETURNING *", [lot.id, poLineId]);
  return out;
}

// ── VDRL ─────────────────────────────────────────────────────────────────

export async function addVendorDoc(db, { projectId, poId, docCode, title, dueOn = null, beforeFat = false }) {
  await poRow(db, projectId, poId);
  if (!String(docCode || "").trim() || !String(title || "").trim()) throw bad("کد و عنوان مدرک لازم است.");
  const { rows: [d] } = await db.query(
    `INSERT INTO vendor_document (project_id, po_id, doc_code, title, due_on, before_fat) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (po_id, doc_code) DO UPDATE SET title = EXCLUDED.title, due_on = EXCLUDED.due_on, before_fat = EXCLUDED.before_fat
     RETURNING *`, [projectId, poId, String(docCode).trim().toUpperCase(), title.trim(), dueOn || null, !!beforeFat]);
  return d;
}

/** A submission. Not while the previous one is still under review, and not after acceptance. */
export async function submitDoc(db, { projectId, docId, revision, submittedOn, userId = null }) {
  const last = await lastSubmission(db, projectId, docId);
  if (last && last.review_code === null) throw bad("ارسال قبلی هنوز در بررسی است.");
  if (last && last.review_code !== 3) throw bad("این مدرک پذیرفته شده؛ ارسال جدید رویژن تازه‌ای برای ثبت ندارد.");
  if (!String(revision || "").trim() || !submittedOn) throw bad("رویژن و تاریخ ارسال لازم است.");
  const { rows: [s] } = await db.query(
    `INSERT INTO vendor_doc_submission (project_id, doc_id, revision, submitted_on, recorded_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [projectId, docId, revision.trim(), submittedOn, userId]);
  return s;
}

/** The review: a code 1–4 on the latest submission. Code 3 needs a comment. */
export async function returnDoc(db, { projectId, docId, returnedOn, code, comment = null }) {
  const last = await lastSubmission(db, projectId, docId);
  if (!last || last.review_code !== null) throw bad("ارسالی در انتظار بررسی نیست.");
  const c = Number(code);
  if (!REVIEW_CODES[c]) throw bad("کد بررسی باید ۱ تا ۴ باشد.");
  if (c === 3 && !String(comment || "").trim()) throw bad("رد (کد ۳) بدون کامنت ثبت نمی‌شود.");
  if (!returnedOn || returnedOn < iso(last.submitted_on)) throw bad("تاریخ برگشت پیش از تاریخ ارسال است.");
  const { rows: [s] } = await db.query(
    "UPDATE vendor_doc_submission SET returned_on = $2, review_code = $3, comment = $4 WHERE id = $1 RETURNING *",
    [last.id, returnedOn, c, comment || null]);
  return s;
}

export async function vendorDocs(db, { projectId, poId = null, today = null }) {
  const d = today || todayIso();
  const { rows: [p] } = await db.query("SELECT vdrl_resubmit_days FROM project WHERE id = $1", [projectId]);
  const { rows } = await db.query(
    `SELECT f.*, f.doc_key AS id, d.po_id, d.before_fat
       FROM reporting.fact_vendor_document f JOIN vendor_document d ON d.id = f.doc_key
      WHERE f.project_key = $1 AND ($2::uuid IS NULL OR d.po_id = $2) ORDER BY f.po_no, f.doc_code`, [projectId, poId]);
  return rows.map((r) => ({ ...r, ...docState({ dueOn: iso(r.due_on), lastSubmittedOn: iso(r.last_submitted_on),
    lastCode: r.last_code, lastReturnedOn: iso(r.last_returned_on) }, d, p.vdrl_resubmit_days) }));
}

// ── reading ──────────────────────────────────────────────────────────────

/** One line, with everything that has happened to it. */
export async function lineStatus(db, { projectId, poLineId, today = null }) {
  const { rows: [l] } = await db.query(
    `SELECT l.*, f.shipped_qty::float8 AS shipped_qty, f.received_qty::float8 AS received_qty,
            o.po_no, v.name AS vendor_name, i.code AS item_code, i.description AS item_description, t.tag_no
       FROM po_line l JOIN reporting.fact_po_line f ON f.po_line_key = l.id
       JOIN purchase_order o ON o.id = l.po_id JOIN vendor v ON v.id = o.vendor_id
       LEFT JOIN material_item i ON i.id = l.item_id LEFT JOIN tag t ON t.id = l.tag_id
      WHERE l.id = $1 AND l.project_id = $2`, [poLineId, projectId]);
  if (!l) throw notFound("PO line");
  return shape(l, await latestFat(db, l.id), today || todayIso());
}

export async function poStatus(db, { projectId, poId, today = null }) {
  const o = await poRow(db, projectId, poId);
  const d = today || todayIso();
  const { rows } = await db.query(
    `SELECT l.*, f.shipped_qty::float8 AS shipped_qty, f.received_qty::float8 AS received_qty,
            i.code AS item_code, i.description AS item_description, t.tag_no
       FROM po_line l LEFT JOIN reporting.fact_po_line f ON f.po_line_key = l.id
       LEFT JOIN material_item i ON i.id = l.item_id LEFT JOIN tag t ON t.id = l.tag_id
      WHERE l.po_id = $1 ORDER BY l.line_no`, [poId]);
  const lines = [];
  for (const l of rows) lines.push(shape({ ...l, po_no: o.po_no }, await latestFat(db, l.id), d));
  const { rows: shipments } = await db.query(
    `SELECT s.*, (SELECT json_agg(json_build_object('lineNo', l.line_no, 'qty', sl.qty) ORDER BY l.line_no)
                    FROM shipment_line sl JOIN po_line l ON l.id = sl.po_line_id WHERE sl.shipment_id = s.id) AS lines
       FROM shipment s WHERE s.po_id = $1 ORDER BY s.shipped_on`, [poId]);
  return { po: o, lines, shipments, docs: await vendorDocs(db, { projectId, poId, today: d }) };
}

export async function procurementBoard(db, { projectId, today = null }) {
  const d = today || todayIso();
  const { rows: pos } = await db.query(
    `SELECT o.id FROM purchase_order o WHERE o.project_id = $1 ORDER BY o.po_no`, [projectId]);
  const out = [];
  for (const { id } of pos) out.push(await poStatus(db, { projectId, poId: id, today: d }));
  const { rows: vendors } = await db.query("SELECT * FROM vendor WHERE project_id = $1 ORDER BY code", [projectId]);
  const { rows: [p] } = await db.query("SELECT vdrl_resubmit_days FROM project WHERE id = $1", [projectId]);
  const open = out.flatMap((o) => o.lines.filter((l) => l.stage !== "received").map((l) => ({ ...l, poNo: o.po.po_no, poId: o.po.id })));
  // Expediting order: what construction will wait for first. Unknown float
  // goes last, never first — "unknown" is not "on time", and not "late".
  const expediting = open.sort((a, b) => (a.floatDays ?? Infinity) - (b.floatDays ?? Infinity));
  return { today: d, orders: out, vendors, expediting, resubmitDays: p.vdrl_resubmit_days,
    reviewCodes: REVIEW_CODES, fatResults: FAT_RESULTS };
}

/** Open quantity and the earliest forecast per stock item, for the shortage list. */
export async function onOrderByItem(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT item_key, qty::float8 AS qty, received_qty::float8 AS received_qty, promised_on, forecast_on
       FROM reporting.fact_po_line WHERE project_key = $1 AND item_key IS NOT NULL`, [projectId]);
  const by = new Map();
  for (const r of rows) {
    if (!by.has(r.item_key)) by.set(r.item_key, []);
    by.get(r.item_key).push({ qty: r.qty, receivedQty: r.received_qty, promisedOn: iso(r.promised_on), forecastOn: iso(r.forecast_on) });
  }
  return Object.fromEntries([...by].map(([k, v]) => [k, onOrder(v)]));
}

export async function forecastHistory(db, { projectId, poLineId }) {
  const { rows } = await db.query(
    `SELECT f.*, u.display_name AS by_name FROM po_forecast f LEFT JOIN app_user u ON u.id = f.by_user
      WHERE f.project_id = $1 AND f.po_line_id = $2 ORDER BY f.at`, [projectId, poLineId]);
  return rows;
}

// ── helpers ──────────────────────────────────────────────────────────────

function shape(l, fat, today) {
  const base = {
    id: l.id, poId: l.po_id, poNo: l.po_no, vendorName: l.vendor_name, lineNo: l.line_no,
    itemId: l.item_id, tagId: l.tag_id, what: l.item_code ? `${l.item_code} — ${l.item_description}` : l.tag_no,
    description: l.description, qty: Number(l.qty), uom: l.uom, unitPrice: l.unit_price === null ? null : Number(l.unit_price),
    promisedOn: iso(l.promised_on), forecastOn: iso(l.forecast_on), needOn: iso(l.need_on), fatRequired: l.fat_required,
    shippedQty: Number(l.shipped_qty || 0), receivedQty: Number(l.received_qty || 0),
    fat: fat ? { result: fat.result, irnNo: fat.irn_no, inspectedOn: iso(fat.inspected_on), note: fat.note } : null,
  };
  return { ...base, stage: lineStage(base), ...lineDates(base, today) };
}
async function latestFat(db, poLineId) {
  const { rows: [f] } = await db.query(
    "SELECT * FROM fat_record WHERE po_line_id = $1 ORDER BY created_at DESC LIMIT 1", [poLineId]);
  return f || null;
}
async function lastSubmission(db, projectId, docId) {
  const { rows: [d] } = await db.query("SELECT id FROM vendor_document WHERE id = $1 AND project_id = $2", [docId, projectId]);
  if (!d) throw notFound("vendor document");
  const { rows: [s] } = await db.query(
    "SELECT * FROM vendor_doc_submission WHERE doc_id = $1 ORDER BY created_at DESC LIMIT 1", [docId]);
  return s || null;
}
async function poRow(db, projectId, id) {
  const { rows: [o] } = await db.query("SELECT * FROM purchase_order WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!o) throw notFound("purchase order");
  return o;
}
async function lineRow(db, projectId, id) {
  const { rows: [l] } = await db.query("SELECT * FROM po_line WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!l) throw notFound("PO line");
  return l;
}
const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const blankNum = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const todayIso = () => new Date().toISOString().slice(0, 10);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
