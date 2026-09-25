/**
 * Handover to maintenance: asset master per tag, readiness, and export.
 *
 * Every rule is lib/cmms/handover.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import { createHash } from "node:crypto";
import {
  ISO14224_CLASSES, CHECK_FA, flocFor, flocParent, criticalityLevels, masterProblems, handoverChecklist, toCsv,
} from "../../cmms/handover.mjs";
import { vendorDocs } from "./procurement.mjs";

export async function setAssetMaster(db, {
  projectId, tagId, isoClass = null, criticality = null, criticalityBasis = null, manufacturer = null, model = null,
  serialNo = null, yearBuilt = null, userId = null,
}) {
  const { rows: [t] } = await db.query("SELECT id, discipline FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
  if (!t) throw notFound("tag");
  if (t.discipline !== "equipment") throw bad("شناسنامهٔ نگهداری برای تگ تجهیز ثبت می‌شود.");
  const { rows: [p] } = await db.query("SELECT criticality_levels FROM project WHERE id = $1", [projectId]);
  const m = { isoClass: blank(isoClass)?.toUpperCase() ?? null, criticality: blank(criticality), criticalityBasis: blank(criticalityBasis),
    manufacturer: blank(manufacturer), model: blank(model), serialNo: blank(serialNo),
    yearBuilt: yearBuilt === "" || yearBuilt === null || yearBuilt === undefined ? null : Number(yearBuilt) };
  const problems = masterProblems(m, criticalityLevels(p.criticality_levels));
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [row] } = await db.query(
    `INSERT INTO asset_master (tag_id, project_id, iso_class, criticality, criticality_basis, manufacturer, model, serial_no,
                               year_built, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT (tag_id) DO UPDATE SET iso_class = EXCLUDED.iso_class, criticality = EXCLUDED.criticality,
        criticality_basis = EXCLUDED.criticality_basis, manufacturer = EXCLUDED.manufacturer, model = EXCLUDED.model,
        serial_no = EXCLUDED.serial_no, year_built = EXCLUDED.year_built, updated_by = EXCLUDED.updated_by, updated_at = now()
     RETURNING *`,
    [tagId, projectId, m.isoClass, m.criticality, m.criticalityBasis, m.manufacturer, m.model, m.serialNo, m.yearBuilt, userId]);
  await db.query("INSERT INTO asset_master_revision (project_id, tag_id, snapshot, by_user) VALUES ($1,$2,$3,$4)",
    [projectId, tagId, JSON.stringify(m), userId]);
  return row;
}

export async function assetMasterHistory(db, { projectId, tagId }) {
  const { rows } = await db.query(
    `SELECT r.*, u.display_name AS by_name FROM asset_master_revision r LEFT JOIN app_user u ON u.id = r.by_user
      WHERE r.project_id = $1 AND r.tag_id = $2 ORDER BY r.at`, [projectId, tagId]);
  return rows;
}

/** Every equipment tag with its asset master, functional location and handover checklist. */
export async function handoverBoard(db, { projectId }) {
  const { rows: [p] } = await db.query(
    "SELECT cmms_plant_code, floc_template, criticality_levels FROM project WHERE id = $1", [projectId]);
  const { rows: tags } = await db.query(
    `SELECT t.id, t.tag_no, t.description, t.kind, s.id AS subsystem_id, s.code AS subsystem, s.system_code, u.code AS unit,
            m.iso_class, m.criticality, m.criticality_basis, m.manufacturer, m.model, m.serial_no, m.year_built,
            mc.accepted_at AS mc_accepted_at
       FROM tag t
       LEFT JOIN subsystem s ON s.id = t.subsystem_id
       LEFT JOIN unit u ON u.id = s.unit_id
       LEFT JOIN asset_master m ON m.tag_id = t.id
       LEFT JOIN mc_certificate mc ON mc.subsystem_id = t.subsystem_id
      WHERE t.project_id = $1 AND t.discipline = 'equipment'
      ORDER BY t.tag_no`, [projectId]);
  // The PO lines buying each tag, and the IOM on those POs' VDRL.
  const { rows: lines } = await db.query(
    `SELECT l.tag_id, l.po_id, v.name AS vendor FROM po_line l JOIN purchase_order o ON o.id = l.po_id
       JOIN vendor v ON v.id = o.vendor_id WHERE l.project_id = $1 AND l.tag_id IS NOT NULL AND o.status = 'placed'`, [projectId]);
  const docsByPo = new Map();
  for (const poId of new Set(lines.map((l) => l.po_id))) {
    docsByPo.set(poId, await vendorDocs(db, { projectId, poId }));
  }
  const out = tags.map((t) => {
    const mine = lines.filter((l) => l.tag_id === t.id);
    let iom = null;
    if (mine.length) {
      const docs = mine.flatMap((l) => docsByPo.get(l.po_id) || []).filter((d) => d.doc_code === "IOM");
      iom = !docs.length ? "در VDRL خرید نیامده" : docs.every((d) => d.state === "accepted") ? "accepted" : docs[0].state;
    }
    const master = { isoClass: t.iso_class, criticality: t.criticality, manufacturer: t.manufacturer, model: t.model, serialNo: t.serial_no };
    const floc = flocFor(p.floc_template, { plant: p.cmms_plant_code, unit: t.unit, system: t.system_code, subsystem: t.subsystem, tag: t.tag_no });
    const mcAccepted = t.subsystem_id ? !!t.mc_accepted_at : null;
    return {
      id: t.id, tagNo: t.tag_no, description: t.description, kind: t.kind, unit: t.unit, system: t.system_code, subsystem: t.subsystem,
      master: { ...master, criticalityBasis: t.criticality_basis, yearBuilt: t.year_built },
      classLabel: t.iso_class ? ISO14224_CLASSES[t.iso_class] || "خارج از فهرست — همان‌طور که ثبت شده" : null,
      vendorHint: [...new Set(mine.map((l) => l.vendor))].join("، ") || null,
      floc, mcAccepted, iom, ...handoverChecklist({ master, floc, mcAccepted, iom }),
    };
  });
  return {
    tags: out, settings: { plantCode: p.cmms_plant_code, flocTemplate: p.floc_template, levels: criticalityLevels(p.criticality_levels) },
    classes: ISO14224_CLASSES, checks: CHECK_FA,
  };
}

const COLUMNS = [
  ["floc", "Functional Location"], ["parentFloc", "Parent (system)"], ["tagNo", "Tag"], ["description", "Description"],
  ["isoClass", "ISO 14224 class"], ["classLabel", "Class name"], ["criticality", "Criticality"], ["criticalityBasis", "Criticality basis"],
  ["manufacturer", "Manufacturer"], ["model", "Model"], ["serialNo", "Serial no."], ["yearBuilt", "Year built"],
  ["unit", "Unit"], ["system", "System"], ["subsystem", "Subsystem"], ["ready", "Ready for handover"], ["open", "Open items"],
];

/**
 * The asset master as CSV, every tag with its readiness — or ready tags
 * only. Neutral columns, not a particular CMMS's import layout: the layout
 * is the CMMS administrator's, and a guessed one is a failed import. Each
 * export is logged with its hash, so the file a CMMS received can be
 * identified later.
 */
export async function exportHandover(db, { projectId, readyOnly = false, userId = null }) {
  const b = await handoverBoard(db, { projectId });
  const parentOf = (t) => flocParent(b.settings.flocTemplate,
    { plant: b.settings.plantCode, unit: t.unit, system: t.system, subsystem: t.subsystem, tag: t.tagNo });
  const rows = b.tags.filter((t) => !readyOnly || t.ready).map((t) => ({
    floc: t.floc.code, parentFloc: parentOf(t), tagNo: t.tagNo, description: t.description,
    isoClass: t.master.isoClass, classLabel: t.classLabel, criticality: t.master.criticality, criticalityBasis: t.master.criticalityBasis,
    manufacturer: t.master.manufacturer, model: t.master.model, serialNo: t.master.serialNo, yearBuilt: t.master.yearBuilt,
    unit: t.unit, system: t.system, subsystem: t.subsystem, ready: t.ready ? "yes" : "no",
    open: t.open.map((k) => CHECK_FA[k]).join("; "),
  }));
  const csv = toCsv(COLUMNS, rows);
  const sha256 = createHash("sha256").update(csv, "utf8").digest("hex");
  await db.query("INSERT INTO handover_export (project_id, rows_total, rows_ready, sha256, by_user) VALUES ($1,$2,$3,$4,$5)",
    [projectId, rows.length, rows.filter((r) => r.ready === "yes").length, sha256, userId]);
  return { csv, sha256, rows: rows.length, ready: rows.filter((r) => r.ready === "yes").length };
}

export async function exportLog(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT e.*, u.display_name AS by_name FROM handover_export e LEFT JOIN app_user u ON u.id = e.by_user
      WHERE e.project_id = $1 ORDER BY e.at DESC LIMIT 20`, [projectId]);
  return rows;
}

const blank = (v) => (v === null || v === undefined || !String(v).trim() ? null : String(v).trim());
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
