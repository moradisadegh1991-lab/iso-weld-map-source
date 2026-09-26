/**
 * Piping as one picture: welds, inch-dia, NDT compliance, lines, spools,
 * supports, test packs and welders — read from the facts every piping page
 * already writes. Rules: lib/ndt/compliance.mjs. Call inside `withProject`.
 */
import { compliance, inchDia, parseRequirement, STATUS } from "../../ndt/compliance.mjs";

/** Every weld of the governing registers with its NDT compliance status. */
export async function weldCompliance(db, { projectId }) {
  const { rows: welds } = await db.query(
    `SELECT f.weld_uid, f.line_key, f.spool_key, f.welder_key, f.weld_no, f.weld_kind, f.shop_field, f.nps, f.ndt_requirement,
            f.is_welded, f.welded_at, f.is_accepted, l.line_no, sp.spool_no, wl.stamp_no,
            COALESCE(l.subsystem_id, d.subsystem_id) AS subsystem_id
       FROM reporting.fact_weld f LEFT JOIN line l ON l.id = f.line_key LEFT JOIN spool sp ON sp.id = f.spool_key
       LEFT JOIN document d ON d.id = f.document_key
       LEFT JOIN welder wl ON wl.id = f.welder_key
      WHERE f.project_key = $1 ORDER BY l.line_no, f.weld_no`, [projectId]);
  const { rows: sels } = await db.query(
    "SELECT line_id, method::text AS method, selected_uids, created_at FROM ndt_selection WHERE project_id = $1", [projectId]);
  const { rows: recs } = await db.query(
    `SELECT weld_uid, method::text AS method, result::text AS result, repair_cycle, inspected_at, created_at
       FROM ndt_record WHERE project_id = $1`, [projectId]);
  const status = compliance({
    welds: welds.map((w) => ({ uid: w.weld_uid, lineId: w.line_key, welded: w.is_welded, welderId: w.welder_key, requirement: w.ndt_requirement })),
    selections: sels.map((s) => ({ lineId: s.line_id, method: s.method, selectedUids: s.selected_uids, createdAt: iso(s.created_at, true) })),
    records: recs.map((r) => ({ uid: r.weld_uid, method: r.method, result: r.result, repairCycle: r.repair_cycle,
      at: `${iso(r.inspected_at) || "9999-12-31"}|${iso(r.created_at, true)}` })),
  });
  return welds.map((w) => ({ ...w, nps: w.nps === null ? null : Number(w.nps), ndt: status.get(w.weld_uid) }));
}

/**
 * Installed / tested for piping progress (F-17): welded, and NDT complete as
 * the weld's requirement defines it — its own examination for 100%, its
 * welder's sample (and §341.3.4 progressive examination) for random.
 */
export async function pipingProgressItems(db, { projectId, subsystemId = null }) {
  const welds = await weldCompliance(db, { projectId });
  return welds.filter((w) => !subsystemId || w.subsystem_id === subsystemId)
    .map((w) => ({ id: w.weld_uid, subsystemId: w.subsystem_id, installed: w.is_welded, tested: w.is_welded && STATUS[w.ndt.status].done }));
}

export async function pipingHub(db, { projectId }) {
  const welds = await weldCompliance(db, { projectId });
  const done = (w) => STATUS[w.ndt.status].done;
  const byStatus = {};
  for (const w of welds) byStatus[w.ndt.status] = (byStatus[w.ndt.status] || 0) + 1;

  const { rows: lines } = await db.query(
    `SELECT l.id, l.line_no, l.piping_class, l.service, l.piping_class_id, s.code AS subsystem_code,
            tp.pack_no, tp.is_accepted AS pack_accepted
       FROM line l LEFT JOIN subsystem s ON s.id = l.subsystem_id
       LEFT JOIN test_package_line tl ON tl.line_id = l.id
       LEFT JOIN reporting.fact_test_package tp ON tp.package_key = tl.package_id
      WHERE l.project_id = $1 ORDER BY l.line_no`, [projectId]);
  const { rows: spools } = await db.query(
    "SELECT line_key, stage FROM reporting.spool_stage WHERE project_key = $1", [projectId]);
  const { rows: sels } = await db.query(
    "SELECT line_id, method::text AS method, percent::float8 AS percent, cardinality(selected_uids) AS drawn FROM ndt_selection WHERE project_id = $1", [projectId]);

  const lineRows = lines.map((l) => {
    const lw = welds.filter((w) => w.line_key === l.id);
    const reqs = [...new Set(lw.map((w) => w.ndt_requirement).filter((r) => parseRequirement(r)))];
    const open = {};
    for (const w of lw) if (!done(w) && w.ndt.status !== "not_welded") open[w.ndt.status] = (open[w.ndt.status] || 0) + 1;
    const stages = {};
    for (const s of spools.filter((x) => x.line_key === l.id)) stages[s.stage] = (stages[s.stage] || 0) + 1;
    return {
      id: l.id, lineNo: l.line_no, pipingClass: l.piping_class, classLinked: !!l.piping_class_id, service: l.service, subsystem: l.subsystem_code,
      welds: lw.length, welded: lw.filter((w) => w.is_welded).length, ndtDone: lw.filter(done).length,
      di: inchDia(lw), diWelded: inchDia(lw.filter((w) => w.is_welded)).di, diDone: inchDia(lw.filter(done)).di,
      requirements: reqs, samples: sels.filter((s) => s.line_id === l.id), open, spools: stages,
      pack: l.pack_no ? { no: l.pack_no, accepted: l.pack_accepted } : null,
    };
  }).filter((l) => l.welds > 0 || l.pack);

  const { rows: welders } = await db.query(
    `SELECT stamp_no, welder_name, welds_made, shots, rejects, repair_rate_pct::float8 AS repair_rate_pct
       FROM reporting.kpi_welder_performance WHERE project_key = $1 AND welds_made > 0 ORDER BY repair_rate_pct DESC NULLS LAST, stamp_no`, [projectId]);
  const { rows: [sup] } = await db.query(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE installed_at IS NOT NULL)::int AS installed,
            count(*) FILTER (WHERE inspected_at IS NOT NULL)::int AS inspected FROM pipe_support WHERE project_id = $1`, [projectId]);
  const { rows: [runs] } = await db.query(
    `SELECT count(*) FILTER (WHERE r.status = 'approved')::int AS approved, count(*)::int AS current
       FROM reporting.current_run c JOIN extraction_run r ON r.id = c.run_id WHERE r.project_id = $1`, [projectId]);

  const total = inchDia(welds);
  return {
    totals: {
      welds: welds.length, welded: welds.filter((w) => w.is_welded).length, ndtDone: welds.filter(done).length,
      field: welds.filter((w) => w.shop_field === "Field").length,
      di: total.di, diWelded: inchDia(welds.filter((w) => w.is_welded)).di, diDone: inchDia(welds.filter(done)).di, unsized: total.unsized,
      drawings: runs?.current ?? 0, drawingsApproved: runs?.approved ?? 0,
      supports: sup,
      packs: { total: new Set(lineRows.filter((l) => l.pack).map((l) => l.pack.no)).size,
        accepted: new Set(lineRows.filter((l) => l.pack?.accepted).map((l) => l.pack.no)).size },
    },
    byStatus, statusText: Object.fromEntries(Object.entries(STATUS).map(([k, v]) => [k, v.text])),
    lines: lineRows, welders,
    missing: {
      linesWithoutClass: lineRows.filter((l) => !l.classLinked).map((l) => l.lineNo),
      unsized: welds.filter((w) => !(w.nps > 0)).length,
      noRequirement: welds.filter((w) => !parseRequirement(w.ndt_requirement)).length,
      samplesNotDrawn: [...new Set(welds.filter((w) => w.ndt.status === "sample_not_drawn").map((w) => w.line_no))],
    },
  };
}

/** The project's weld log: one row per weld of the governing registers. */
export async function weldLogCsv(db, { projectId }) {
  const welds = await weldCompliance(db, { projectId });
  const cols = ["line", "weld", "spool", "kind", "shop_field", "nps_in", "requirement", "welder", "welded_on", "ndt_status"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(","), ...welds.map((w) => [w.line_no, w.weld_no, w.spool_no, w.weld_kind, w.shop_field, w.nps,
    w.ndt_requirement, w.stamp_no, iso(w.welded_at), STATUS[w.ndt.status].text].map(q).join(","))];
  return "﻿" + lines.join("\r\n");
}

const iso = (d, full = false) => (d instanceof Date ? (full ? d.toISOString() : d.toISOString().slice(0, 10)) : d == null ? null : String(d).slice(0, full ? 30 : 10));
