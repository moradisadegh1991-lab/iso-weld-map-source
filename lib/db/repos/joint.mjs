/**
 * Joint history: one weld's whole life, on one page.
 *
 * Nothing here is recorded for the purpose. Every line is read from the
 * record that already holds it, keyed on `weld_uid` — the identity that
 * survives renumbering and re-datuming across drawing revisions:
 *
 *   the drawing     every revision the weld appears in, its number and
 *                   shop/field in each, and what changed between them
 *   the material    lots issued to its spool, with heat, MTC and MIR
 *   fit-up          the spool's step, and its inspection requests
 *   welding         welder, WPS, and the qualification verdict AS IT STOOD
 *                   when the weld was assigned (not re-judged today)
 *   NDT             whether the sample drew it, every shot and re-shot, and
 *                   whether it is accepted (F11: examined is not accepted)
 *   PWHT, the pressure test of its line's package
 *   the drawing's corrections (field edits on the extraction run)
 *
 * The "attention" list compares these records with each other and says what
 * does not add up: a weld made after its line's test, material from a heat
 * whose MTC was rejected, a rejected shot with no re-shot, a weld the current
 * revision dropped that was already welded. It asserts nothing the records
 * do not show; where a record is missing it says so rather than assuming.
 *
 * Call inside `withProject`.
 */
import { spoolStatus } from "./piping-execution.mjs";
import { requestsFor } from "./inspection.mjs";
import { weldCompliance } from "./piping-hub.mjs";
import { STATUS as NDT_STATUS } from "../../ndt/compliance.mjs";

/** Welds of the current revisions matching a search, for choosing one. */
export async function searchJoints(db, { projectId, q = "", limit = 300 }) {
  const term = String(q || "").trim();
  const { rows } = await db.query(
    `SELECT f.weld_uid, f.weld_no, f.shop_field, f.weld_kind, f.nps, f.is_welded, f.is_examined, f.is_accepted,
            f.awaiting_ndt, f.welded_at, l.line_no, d.doc_no, d.revision, s.spool_no, wd.stamp_no
       FROM reporting.fact_weld f
       LEFT JOIN line l ON l.id = f.line_key
       LEFT JOIN document d ON d.id = f.document_key
       LEFT JOIN spool s ON s.id = f.spool_key
       LEFT JOIN welder wd ON wd.id = f.welder_key
      WHERE f.project_key = $1
        AND ($2 = '' OR f.weld_no ILIKE $3 OR f.weld_uid ILIKE $3 OR l.line_no ILIKE $3
             OR s.spool_no ILIKE $3 OR d.doc_no ILIKE $3 OR wd.stamp_no ILIKE $3)
      ORDER BY l.line_no NULLS LAST, d.doc_no, f.weld_no
      LIMIT $4`, [projectId, term, `%${term}%`, limit]);
  return rows.map((r) => ({ ...r, welded_at: day(r.welded_at) }));
}

/** The whole history of one weld. 404 when no revision of any drawing carries it. */
export async function jointHistory(db, { projectId, weldUid }) {
  const uid = String(weldUid || "").trim();
  const { rows: revs } = await db.query(
    `SELECT w.id, w.weld_uid, w.weld_no, w.weld_kind, w.shop_field, w.joint_role, w.nps, w.schedule,
            w.elevation_mm, w.ndt_requirement, w.spool_id, w.line_id, w.extraction_run_id AS run_id,
            d.id AS document_id, d.doc_no, d.revision, d.sheet_no, d.revision_date, d.created_at AS issued_at,
            r.status AS run_status, r.approved_at, r.created_at AS run_created_at,
            s.spool_no, l.line_no, l.piping_class, (cr.run_id IS NOT NULL) AS is_current
       FROM weld w
       JOIN extraction_run r ON r.id = w.extraction_run_id
       JOIN document d ON d.id = w.document_id
       LEFT JOIN spool s ON s.id = w.spool_id
       LEFT JOIN line l ON l.id = w.line_id
       LEFT JOIN reporting.current_run cr ON cr.run_id = w.extraction_run_id
      WHERE w.project_id = $1 AND w.weld_uid = $2
      ORDER BY r.created_at, d.revision`, [projectId, uid]);
  if (!revs.length) throw Object.assign(new Error(`جوش ${uid} در هیچ رویژنی نیست.`), { status: 404, code: "NOT_FOUND" });

  const current = revs.filter((r) => r.is_current).at(-1) || null;
  const latest = revs.at(-1);

  // Dropped: the drawing's current register no longer carries the weld.
  let droppedIn = null;
  if (!current) {
    const { rows: [cur] } = await db.query(
      `SELECT d.revision, d.doc_no FROM reporting.current_run cr JOIN document d ON d.id = cr.document_id
        WHERE cr.project_id = $1 AND d.doc_no = $2 AND d.sheet_no = $3 ORDER BY cr.created_at DESC LIMIT 1`,
      [projectId, latest.doc_no, latest.sheet_no]);
    droppedIn = cur ? { docNo: cur.doc_no, revision: cur.revision } : null;
  }

  const revisions = revs.map((r, i) => ({
    docNo: r.doc_no, revision: r.revision, sheetNo: r.sheet_no, issuedOn: day(r.revision_date), registeredOn: day(r.issued_at),
    runStatus: r.run_status, approvedAt: r.approved_at, current: r.is_current,
    weldNo: r.weld_no, shopField: r.shop_field, kind: r.weld_kind, nps: num(r.nps), schedule: r.schedule,
    spoolNo: r.spool_no, lineNo: r.line_no, ndtRequirement: r.ndt_requirement, elevationMm: r.elevation_mm,
    changes: i === 0 ? [] : changed(revs[i - 1], r),
  }));
  const here = current || latest;

  const { rows: [exe] } = await db.query(
    `SELECT e.*, wd.stamp_no, wd.name AS welder_name, wd.employer, p.wps_no, p.pqr_no, p.pwht_required AS wps_pwht,
            u.display_name AS recorded_by_name
       FROM weld_execution e
       LEFT JOIN welder wd ON wd.id = e.welder_id
       LEFT JOIN wps p ON p.id = e.wps_id
       LEFT JOIN app_user u ON u.id = e.created_by
      WHERE e.project_id = $1 AND e.weld_uid = $2`, [projectId, uid]);

  const { rows: ndtRows } = await db.query(
    `SELECT n.*, u.display_name AS recorded_by_name FROM ndt_record n LEFT JOIN app_user u ON u.id = n.created_by
      WHERE n.project_id = $1 AND n.weld_uid = $2 ORDER BY n.method, n.repair_cycle`, [projectId, uid]);
  const ndt = ndtRows.map((n) => ({ method: n.method, cycle: n.repair_cycle, result: n.result, reportNo: n.report_no,
    defect: n.defect_type, inspectedOn: day(n.inspected_at), inspector: n.inspector, recordedBy: n.recorded_by_name }));
  const methods = [...new Set(ndt.map((n) => n.method))].map((m) => {
    const mine = ndt.filter((n) => n.method === m);
    const last = mine.at(-1);
    return { method: m, shots: mine.length, repairs: last.cycle, latest: last.result };
  });

  // The sample: every selection drawn on the lines this weld has been on.
  const lineIds = [...new Set(revs.map((r) => r.line_id).filter(Boolean))];
  const { rows: sels } = lineIds.length ? await db.query(
    `SELECT method, percent, seed, created_at, ($2 = ANY(selected_uids)) AS selected, cardinality(selected_uids) AS drawn
       FROM ndt_selection WHERE project_id = $1 AND line_id = ANY($3::uuid[]) ORDER BY created_at`,
    [projectId, uid, lineIds]) : { rows: [] };
  const selection = sels.map((s) => ({ method: s.method, percent: num(s.percent), seed: s.seed, on: day(s.created_at),
    selected: s.selected, drawn: Number(s.drawn) }));

  const { rows: [fact] } = await db.query(
    `SELECT is_welded, is_examined, is_accepted, awaiting_ndt, is_buried, height_above_grade_mm, grade_applied_mm, pwht_done
       FROM reporting.fact_weld WHERE project_key = $1 AND weld_uid = $2`, [projectId, uid]);

  // The spool: its chain as the execution page shows it (fit-up among it).
  const spool = here.spool_id ? await spoolStatus(db, { projectId, spoolId: here.spool_id }).catch(() => null) : null;

  // Material issued to any spool this weld has been in, in any revision.
  const spoolIds = [...new Set(revs.map((r) => r.spool_id).filter(Boolean))];
  const { rows: mat } = spoolIds.length ? await db.query(
    `SELECT m.kind, m.qty, m.moved_on, m.ref_no, l.receipt_no, l.heat_no, l.mtc_ref, l.mtc_status, l.qty_accepted,
            i.code, i.description, i.uom, s.spool_no
       FROM material_movement m JOIN material_lot l ON l.id = m.lot_id JOIN material_item i ON i.id = l.item_id
       JOIN spool s ON s.id = m.spool_id
      WHERE m.project_id = $1 AND m.spool_id = ANY($2::uuid[]) ORDER BY m.moved_on, m.created_at`,
    [projectId, spoolIds]) : { rows: [] };
  const material = mat.map((m) => ({ kind: m.kind, qty: num(m.qty), uom: m.uom, on: day(m.moved_on), refNo: m.ref_no,
    code: m.code, description: m.description, receiptNo: m.receipt_no, heatNo: m.heat_no, mtcRef: m.mtc_ref,
    mtcStatus: m.mtc_status, spoolNo: m.spool_no }));

  // Inspections raised on its spool (fit-up and the rest of the spool ITP).
  const inspections = [];
  for (const sid of spoolIds) {
    for (const r of await requestsFor(db, { projectId, itemKind: "spool", itemId: sid })) {
      inspections.push({ irNo: r.ir_no, itpNo: r.itp_no, seq: r.seq, title: r.activity.title, stepCode: r.activity.stepCode,
        plannedAt: r.planned_at, state: r.state.state, ncrNo: r.ncr_no || null,
        results: r.results.map((x) => ({ party: x.party, outcome: x.outcome, comments: x.comments, at: x.recorded_at, by: x.by_name })) });
    }
  }

  // Its line's pressure test.
  const { rows: tests } = here.line_id ? await db.query(
    `SELECT p.pack_no, p.medium, t.tested_on, t.verdict, t.achieved_barg, t.required_barg, t.accepted_at, t.witness
       FROM test_package_line tl JOIN test_package p ON p.id = tl.package_id
       LEFT JOIN test_record t ON t.package_id = p.id
      WHERE tl.project_id = $1 AND tl.line_id = $2 ORDER BY t.tested_on NULLS LAST`, [projectId, here.line_id]) : { rows: [] };
  const testPack = tests.length ? {
    packNo: tests[0].pack_no, medium: tests[0].medium,
    records: tests.filter((t) => t.tested_on).map((t) => ({ on: day(t.tested_on), verdict: t.verdict,
      achievedBarg: num(t.achieved_barg), requiredBarg: num(t.required_barg), accepted: !!t.accepted_at, witness: t.witness })),
  } : null;

  // Corrections to the drawing's extraction: drawing-level, not this weld's own.
  const runIds = [...new Set(revs.map((r) => r.run_id))];
  const { rows: edits } = await db.query(
    `SELECT e.path, e.field, e.kind, e.before_value, e.after_value, e.reason, e.edited_at, u.display_name AS by_name, d.revision
       FROM extraction_edit e LEFT JOIN app_user u ON u.id = e.edited_by
       JOIN extraction_run r ON r.id = e.extraction_run_id JOIN document d ON d.id = r.document_id
      WHERE e.project_id = $1 AND e.extraction_run_id = ANY($2::uuid[]) ORDER BY e.edited_at`, [projectId, runIds]);

  const execution = exe ? {
    welder: { stampNo: exe.stamp_no, name: exe.welder_name, employer: exe.employer },
    wpsNo: exe.wps_no, pqrNo: exe.pqr_no, process: exe.process, position: exe.position, weldedOn: day(exe.welded_at),
    visual: exe.visual_result, pwhtRequired: exe.pwht_required, pwhtReportNo: exe.pwht_report_no, pwhtOn: day(exe.pwht_at),
    verdict: exe.qualification_verdict || {}, recordedBy: exe.recorded_by_name,
  } : null;

  const identity = {
    weldUid: uid, weldNo: here.weld_no, kind: here.weld_kind, shopField: here.shop_field, jointRole: here.joint_role,
    nps: num(here.nps), schedule: here.schedule, lineNo: here.line_no, pipingClass: here.piping_class, spoolNo: here.spool_no,
    docNo: here.doc_no, revision: here.revision, ndtRequirement: here.ndt_requirement, elevationMm: here.elevation_mm,
    current: !!current, droppedIn,
    buried: fact?.is_buried ?? null, heightAboveGradeMm: num(fact?.height_above_grade_mm),
  };
  const status = {
    welded: !!exe, examined: ndt.length > 0,
    // F11: accepted only when every method's latest cycle is an accept.
    accepted: methods.length > 0 && methods.every((m) => m.latest === "accept"),
    repairs: methods.reduce((a, m) => a + m.repairs, 0),
  };
  // What the requirement asks of THIS weld, and whether it has had it (lib/ndt/compliance.mjs).
  const c = current ? (await weldCompliance(db, { projectId })).find((w) => w.weld_uid === uid)?.ndt : null;
  status.compliance = c ? { ...c, text: NDT_STATUS[c.status].text, done: NDT_STATUS[c.status].done, lot: c.lot || null } : null;

  const history = { identity, status, revisions, execution, ndt, methods, selection, spool, material, inspections, testPack,
    edits: edits.map((e) => ({ path: e.path, field: e.field, kind: e.kind, before: e.before_value, after: e.after_value,
      reason: e.reason, at: e.edited_at, by: e.by_name, revision: e.revision })) };
  history.attention = attention(history);
  history.timeline = timeline(history);
  return history;
}

/** What the records, read against each other, do not agree on. */
export function attention(h) {
  const out = [];
  const { identity: id, execution: ex, methods, selection, material, testPack, spool } = h;
  if (!id.current && ex) {
    out.push({ level: "bad", text: `این جوش در رویژن جاری نقشه${id.droppedIn ? ` (Rev ${id.droppedIn.revision})` : ""} نیست ولی جوشکاری شده — دوباره‌کاری را بررسی کنید.` });
  }
  for (const m of methods) {
    if (m.latest === "reject") out.push({ level: "bad", text: `${m.method}: آخرین شات (چرخهٔ ${m.repairs}) رد شده و شات پس از تعمیر ثبت نشده است.` });
    if (m.latest === "pending") out.push({ level: "warn", text: `${m.method}: نتیجهٔ آخرین شات (چرخهٔ ${m.repairs}) هنوز ثبت نشده است.` });
  }
  if (ex) {
    for (const s of selection.filter((x) => x.selected)) {
      if (!methods.some((m) => m.method === s.method)) out.push({ level: "warn", text: `در نمونهٔ ${s.method} ${s.percent}% انتخاب شده ولی هنوز ${s.method} ثبت نشده است.` });
    }
    const v = ex.verdict || {};
    for (const w of v.warnings || []) out.push({ level: "warn", text: `هشدار صلاحیت در زمان تخصیص: ${w.message || w}` });
    if (ex.pwhtRequired && !ex.pwhtReportNo) out.push({ level: "warn", text: "PWHT لازم است (طبق WPS) ولی گزارشی ثبت نشده است." });
    if (ex.visual === "reject") out.push({ level: "bad", text: "بازرسی چشمی رد شده است." });
    const passed = (testPack?.records || []).filter((t) => t.verdict === "pass" && t.accepted).map((t) => t.on).sort();
    if (passed.length && ex.weldedOn && ex.weldedOn > passed[0]) {
      out.push({ level: "bad", text: `جوش در ${ex.weldedOn} زده شده، بعد از تست فشار پذیرفته‌شدهٔ ${testPack.packNo} در ${passed[0]} — خط باید دوباره تست شود یا جوش مستثنی (Golden joint) مستند شود.` });
    }
  }
  for (const m of material) {
    if (m.kind === "issue" && m.mtcStatus === "rejected") {
      out.push({ level: "bad", text: `مواد ذوب ${m.heatNo || "?"} (رسید ${m.receiptNo}) که MTC آن رد شده به اسپول ${m.spoolNo} حواله شده است — فراخوان.` });
    }
  }
  if (ex && spool) {
    const fit = spool.steps.find((s) => s.code === "fit_up");
    if (fit && fit.status !== "done") out.push({ level: "warn", text: "جوش ثبت شده ولی فیت‌آپ اسپول آن هنوز ثبت نشده است." });
  }
  return out;
}

/** Every dated event, oldest first; undated records are listed after. */
export function timeline(h) {
  const ev = [];
  const add = (on, kind, text, tone = "") => ev.push({ on: day(on), kind, text, tone });
  for (const r of h.revisions) {
    // The revision's own date when the drawing states one; otherwise only when
    // it reached the platform — said as such, never passed off as an issue date.
    add(r.issuedOn || r.registeredOn, "drawing", `نقشهٔ ${r.docNo} Rev ${r.revision}${r.issuedOn ? "" : " (تاریخ ثبت در سامانه؛ تاریخ رویژن اعلام نشده)"}: جوش ${r.weldNo} (${r.shopField})${r.changes.length ? ` — تغییر: ${r.changes.map((c) => c.field).join("، ")}` : ""}`);
    if (r.approvedAt) add(r.approvedAt, "drawing", `رجیستر ${r.docNo} Rev ${r.revision} تأیید و قفل شد`);
  }
  if (h.identity.droppedIn) add(null, "drawing", `در Rev ${h.identity.droppedIn.revision} این جوش دیگر نیست`, "bad");
  for (const m of h.material) add(m.on, "material", `${m.kind === "issue" ? "حوالهٔ" : "برگشت"} ${m.qty} ${m.uom} ${m.code} — ذوب ${m.heatNo || "—"} به اسپول ${m.spoolNo}`, m.mtcStatus === "rejected" ? "bad" : "");
  const fit = h.spool?.steps.find((s) => s.code === "fit_up");
  if (fit?.status === "done") add(fit.doneAt, "fitup", `فیت‌آپ اسپول ${h.spool.spool.spool_no}${fit.refNo ? ` (${fit.refNo})` : ""}`);
  for (const i of h.inspections) add(i.plannedAt, "inspection", `${i.irNo} ${i.title} — ${IR_STATE[i.state] || i.state}${i.ncrNo ? ` · ${i.ncrNo}` : ""}`, i.state === "rejected" ? "bad" : i.state === "released" ? "ok" : "");
  if (h.execution) {
    const e = h.execution;
    add(e.weldedOn, "weld", `جوشکاری: ${e.welder.stampNo || "?"}${e.welder.name ? ` (${e.welder.name})` : ""}${e.wpsNo ? ` · WPS ${e.wpsNo}` : ""}${e.process ? ` · ${e.process}` : ""}${e.position ? ` · ${e.position}` : ""}`);
    if (e.pwhtOn || e.pwhtReportNo) add(e.pwhtOn, "pwht", `PWHT${e.pwhtReportNo ? ` — ${e.pwhtReportNo}` : ""}`);
  }
  for (const n of h.ndt) add(n.inspectedOn, "ndt", `${n.method} ${n.cycle === 0 ? "شات اول" : `شات پس از تعمیر ${n.cycle}`}: ${RESULT[n.result] || n.result}${n.defect ? ` — ${n.defect}` : ""}${n.reportNo ? ` (${n.reportNo})` : ""}`, n.result === "reject" ? "bad" : n.result === "accept" ? "ok" : "");
  for (const t of h.testPack?.records || []) add(t.on, "test", `تست ${h.testPack.packNo}: ${t.verdict === "pass" ? "قبول" : "رد"}${t.accepted ? " و پذیرفته" : ""}${t.achievedBarg != null ? ` · ${t.achievedBarg} barg` : ""}`, t.verdict === "pass" ? "ok" : "bad");
  const dated = ev.filter((e) => e.on).sort((a, b) => a.on.localeCompare(b.on));
  return [...dated, ...ev.filter((e) => !e.on)];
}

const IR_STATE = { awaiting: "منتظر نتیجه", released: "آزاد شد", rejected: "رد شد", cancelled: "لغو شد" };
const RESULT = { accept: "قبول", reject: "رد", pending: "در انتظار" };
const FIELDS = { weld_no: "شمارهٔ جوش", shop_field: "Shop/Field", weld_kind: "نوع", nps: "سایز", schedule: "اسکجول",
  spool_no: "اسپول", line_no: "خط", ndt_requirement: "NDT", elevation_mm: "تراز" };

function changed(a, b) {
  return Object.keys(FIELDS).filter((k) => String(a[k] ?? "") !== String(b[k] ?? ""))
    .map((k) => ({ field: FIELDS[k], from: a[k] ?? null, to: b[k] ?? null }));
}
const num = (v) => (v === null || v === undefined ? null : Number(v));
const day = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null || d === "" ? null : String(d).slice(0, 10));
