/**
 * The contract's daily report (migration 070; content rules in
 * lib/reports/contract-daily.mjs, workflow rules in lib/reports/workflow.mjs).
 * A report belongs to a contract; its resources, narrative categories and
 * the colour each stage's changes are shown in come from the contract and
 * the report type. Call inside `withProject`.
 */
import { createHash } from "node:crypto";
import * as rp from "./reports.mjs";
import * as wf from "../../reports/workflow.mjs";
import * as cd from "../../reports/contract-daily.mjs";
import { treeOf } from "../../org/budget.mjs";
import { sniffImage } from "../../quality/photo.mjs";
import { resourceTree } from "./resources.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const forbidden = (m) => Object.assign(new Error(m), { status: 403, code: "FORBIDDEN" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const iso = (d) => (d instanceof Date ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` : d ? String(d).slice(0, 10) : null);

export const CONTRACT_REPORT_TYPE = {
  code: "CR", name: "گزارش روزانهٔ قرارداد", description: "شرح کار، مشکلات و منابع روزانهٔ قرارداد، با گردش کار مرحله‌ای",
};
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

/** The CR type with the agreed stages (contractor → supervision → client), made once; its groups' members are the project's to set. */
export async function ensureType(db, { projectId }) {
  const { rows: [have] } = await db.query("SELECT * FROM report_type WHERE project_id = $1 AND code = 'CR'", [projectId]);
  if (have) return have;
  const t = await rp.upsertReportType(db, { projectId, ...CONTRACT_REPORT_TYPE });
  for (const st of rp.DAILY_TEMPLATE.stages) {
    const s = await rp.upsertStage(db, { projectId, reportTypeId: t.id, seq: st.seq, name: st.name });
    for (const g of st.groups) await rp.upsertGroup(db, { projectId, stageId: s.id, ...g });
  }
  return t;
}

async function contractOf(db, projectId, contractId) {
  const { rows: [c] } = await db.query("SELECT * FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) throw notFound("contract");
  return c;
}

/** What the contract allows a report to name: its resources and its narrative branches. */
async function allowed(db, contractId) {
  const { rows: res } = await db.query("SELECT id FROM contract_resource WHERE contract_id = $1", [contractId]);
  const { rows: cats } = await db.query("SELECT id, tree FROM contract_category WHERE contract_id = $1 AND tree IN ('narrative', 'work_group')", [contractId]);
  return { resourceIds: new Set(res.map((r) => r.id)), narrativeIds: new Set(cats.filter((c) => c.tree === "narrative").map((c) => c.id)),
    workGroupIds: new Set(cats.filter((c) => c.tree === "work_group").map((c) => c.id)) };
}

/**
 * A new report of a contract — empty, or copied from an earlier report of the
 * same contract (its rows as they stand, as this report's first-stage rows).
 */
export async function createContractReport(db, { projectId, contractId, reportTypeId = null, reportDate, title, header = {}, copyFromId = null, userId }) {
  const c = await contractOf(db, projectId, contractId);
  if (!String(title || "").trim()) throw bad("نام گزارش لازم است.");
  const type = reportTypeId ? { id: reportTypeId } : await ensureType(db, { projectId });
  let content = { ...cd.EMPTY, header: { base: {}, stages: {} } };
  if (copyFromId) {
    const { rows: [src] } = await db.query("SELECT contract_id FROM report WHERE id = $1 AND project_id = $2", [copyFromId, projectId]);
    if (!src || src.contract_id !== contractId) throw bad("گزارشی که از آن کپی می‌شود باید از همین قرارداد باشد.");
    const { rows: [v] } = await db.query("SELECT content FROM report_version WHERE report_id = $1 ORDER BY version_no DESC LIMIT 1", [copyFromId]);
    content = cd.copyFrom(v.content);
  }
  content.header.base = { ...content.header.base, ...header };
  const { content: clean, problems } = cd.checkContent(content, await allowed(db, contractId));
  if (problems.length) throw bad(problems.join(" "));
  const r = await rp.createReport(db, { projectId, reportTypeId: type.id, reportDate, title, content: clean, userId });
  const { rows: [row] } = await db.query("UPDATE report SET contract_id = $2 WHERE id = $1 RETURNING *", [r.id, c.id]);
  return row;
}

/** A new version. The content rules say what changed and refuse what a stage may not change. */
export async function editContractReport(db, { projectId, reportId, content, userId }) {
  const { rows: [r] } = await db.query("SELECT contract_id FROM report WHERE id = $1 AND project_id = $2", [reportId, projectId]);
  if (!r?.contract_id) throw notFound("contract report");
  const { content: clean, problems } = cd.checkContent(content, await allowed(db, r.contract_id));
  if (problems.length) throw bad(problems.join(" "));
  return rp.editReport(db, { projectId, reportId, content: clean, userId, inspect: (prev, snap) => {
    const firstSeq = Math.min(...snap.stages.map((s) => s.seq));
    // a row a later stage adds carries that stage's number: set here, not taken from the form
    for (const kind of Object.keys(cd.SECTIONS)) for (const row of clean[kind]) {
      if (!prev[kind]?.some((x) => x.id === row.id)) { if (snap.stageSeq !== firstSeq) row.addedAt = snap.stageSeq; else delete row.addedAt; }
    }
    const d = cd.diffContent(prev, clean, { stageSeq: snap.stageSeq, firstSeq });
    if (d.illegal.length) throw bad([...new Set(d.illegal)].join(" "));
    return { added: d.added, changed: d.changed, removed: d.removed };
  } });
}

/** One report as the user may see it, with what its rows show and what the contract offers. */
export async function contractReportView(db, { projectId, reportId, userId }) {
  const v = await rp.reportView(db, { projectId, reportId, userId });
  if (!v.report.contract_id) throw notFound("contract report");
  const c = await contractOf(db, projectId, v.report.contract_id);
  const stages = await rp.workflowOf(db, { projectId, reportTypeId: v.report.report_type_id });
  const tree = await resourceTree(db, { projectId, contractId: c.id });
  const { rows: cats } = await db.query("SELECT * FROM contract_category WHERE contract_id = $1 AND tree IN ('narrative', 'work_group')", [c.id]);
  const content = v.content.schema === 2 ? v.content : cd.EMPTY;
  const lines = Object.fromEntries(Object.keys(cd.SECTIONS).map((k) => [k, (content[k] || []).map((row) => ({ id: row.id, ...cd.displayLines(row, stages) }))]));
  const { rows: files } = await db.query(
    `SELECT f.id, f.kind, f.name, f.caption, f.tags, f.content_type, f.byte_size, f.stage_seq, f.uploaded_at, f.removed_at,
            u.display_name AS uploaded_name FROM report_file f LEFT JOIN app_user u ON u.id = f.uploaded_by
      WHERE f.report_id = $1 ORDER BY f.uploaded_at`, [reportId]);
  const snap = (await rp.snapshotOf(db, { projectId, reportId })).snapshot;
  // which stages approved the report on its way to where it is now (a return starts the stage over)
  const approvedNow = stages.filter((s) => s.seq < snap.stageSeq || v.report.status === "approved").map((s) => s.seq);
  return {
    ...v, contract: { id: c.id, contract_no: c.contract_no, title: c.title }, content, lines,
    summary: cd.resourceSummary(content.resources || [], tree.resources),
    board: cd.resourceBoard(content.resources || [], tree.tree, tree.loose),
    resources: tree.resources, resourceTree: tree.tree,
    narrativeTree: treeOf(cats.filter((x) => x.tree === "narrative")), workGroupTree: treeOf(cats.filter((x) => x.tree === "work_group")),
    stages: stages.map((s) => ({ seq: s.seq, name: s.name, changeColor: s.changeColor, approverName: s.approverName, deputyName: s.deputyName,
      approved: approvedNow.includes(s.seq), current: v.report.status === "open" && s.seq === snap.stageSeq,
      groups: s.groups.map((g) => ({ id: g.id, seq: g.seq, name: g.name, title: g.title })) })),
    firstSeq: Math.min(...stages.map((s) => s.seq)),
    files,
    may: { ...v.may, upload: v.may.edit },
  };
}

/** The contract's reports the user may see, newest first. */
export async function listContractReports(db, { projectId, contractId, userId }) {
  const { rows: types } = await db.query(
    "SELECT DISTINCT report_type_id FROM report WHERE project_id = $1 AND contract_id = $2", [projectId, contractId]);
  const out = [];
  for (const t of types) {
    const rows = await rp.listReports(db, { projectId, reportTypeId: t.report_type_id, userId });
    const { rows: mine } = await db.query("SELECT id FROM report WHERE contract_id = $1 AND report_type_id = $2", [contractId, t.report_type_id]);
    const ids = new Set(mine.map((x) => x.id));
    out.push(...rows.filter((r) => ids.has(r.id)));
  }
  return out.sort((a, b) => (iso(b.report_date) > iso(a.report_date) ? 1 : iso(b.report_date) < iso(a.report_date) ? -1 : 0));
}

/**
 * Resources over a period (6.3.1): every report of the contract from `from`
 * to `to` (cancelled ones excluded), each at its latest version, filtered by
 * resource type, branch (and everything under it) and name.
 */
export async function resourceSummaryRange(db, { projectId, contractId, from = null, to = null, kind = null, categoryId = null, name = null }) {
  const tree = await resourceTree(db, { projectId, contractId });
  const under = new Set();
  if (categoryId) {
    const walk = (nodes, inside) => nodes.forEach((n) => { const yes = inside || n.id === categoryId; if (yes) under.add(n.id); walk(n.children, yes); });
    walk(tree.tree, false);
  }
  const pick = new Set(tree.resources.filter((r) => (!kind || r.kind === kind) && (!categoryId || under.has(r.category_id))
    && (!name || r.name.includes(String(name).trim()))).map((r) => r.id));
  const { rows } = await db.query(
    `SELECT r.id, r.report_no, r.report_date, (SELECT content FROM report_version v WHERE v.report_id = r.id ORDER BY version_no DESC LIMIT 1) AS content
       FROM report r WHERE r.project_id = $1 AND r.contract_id = $2 AND r.status <> 'cancelled'
        AND ($3::date IS NULL OR r.report_date >= $3) AND ($4::date IS NULL OR r.report_date <= $4) ORDER BY r.report_date`,
    [projectId, contractId, from || null, to || null]);
  const all = rows.flatMap((r) => (r.content?.resources || []).map((row) => cd.effective(row)).filter((e) => pick.has(e.resourceId)));
  const byResource = {};
  for (const e of all) {
    if (e.removed) continue;
    const k = e.resourceId;
    byResource[k] = byResource[k] || { resourceId: k, day: 0, night: 0, leave: 0, sick: 0, total: 0 };
    for (const f of ["day", "night", "leave", "sick"]) byResource[k][f] += Number(e[f]) || 0;
    byResource[k].total += cd.total(e);
  }
  return { reports: rows.length, summary: cd.resourceSummary(all, tree.resources), byResource: Object.values(byResource) };
}

// ── photos and files ─────────────────────────────────────────────────────

const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };

/** A photo (with caption and tags) or a file, added by someone who may add to the report now. */
export async function addReportFile(db, { projectId, reportId, kind, name, caption = null, tags = [], bytes, contentType = null, store, userId }) {
  const s = await rp.snapshotOf(db, { projectId, reportId });
  const v = wf.checkEdit(s.snapshot, userId, { added: 1 });
  if (!v.ok) throw forbidden(v.reason);
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buf.length) throw bad("فایل خالی است.");
  if (!["photo", "file"].includes(kind)) throw bad("نوع پیوست نامعتبر است.");
  let type = contentType || "application/octet-stream";
  if (kind === "photo") {
    type = sniffImage(buf);
    if (!type) throw bad("عکس باید PNG، JPEG یا WebP باشد.");
    if (buf.length > MAX_PHOTO_BYTES) throw bad("حجم عکس بیش از ۸ مگابایت است.");
  } else if (buf.length > MAX_FILE_BYTES) throw bad("حجم فایل بیش از ۲۰ مگابایت است.");
  const cleanTags = [...new Set((Array.isArray(tags) ? tags : String(tags || "").split(/[،,]/)).map((t) => String(t).trim()).filter(Boolean))].slice(0, 20);
  const ext = kind === "photo" ? EXT[type] : (String(name).match(/\.[A-Za-z0-9]{1,8}$/)?.[0] || "");
  const blob = await store.put(buf, { ext, contentType: type });
  const { rows: [f] } = await db.query(
    `INSERT INTO report_file (project_id, report_id, kind, name, caption, tags, sha256, storage_uri, content_type, byte_size, stage_seq, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id, kind, name, caption, tags`,
    [projectId, reportId, kind, String(name || "").trim() || (kind === "photo" ? "عکس" : "پیوست"), String(caption || "").trim() || null, cleanTags,
      blob.digest, blob.uri, type, buf.length, s.snapshot.stageSeq, userId]);
  await logEvent(db, { projectId, section: "reports", entityType: "report", entityId: reportId, label: s.report.report_no,
    action: "updated", comment: `${kind === "photo" ? "عکس" : "پیوست"}: ${f.name}`, userId });
  return f;
}

/** A file is marked removed — by who may delete content now, or by its uploader while it is still at the stage it was added. */
export async function removeReportFile(db, { projectId, fileId, userId }) {
  const { rows: [f] } = await db.query("SELECT * FROM report_file WHERE id = $1 AND project_id = $2", [fileId, projectId]);
  if (!f || f.removed_at) throw notFound("file");
  const s = await rp.snapshotOf(db, { projectId, reportId: f.report_id });
  const own = f.uploaded_by === userId && f.stage_seq === s.snapshot.stageSeq;
  const v = wf.checkEdit(s.snapshot, userId, own ? {} : { removed: 1 });
  if (!v.ok) throw forbidden(v.reason);
  await db.query("UPDATE report_file SET removed_at = clock_timestamp(), removed_by = $2 WHERE id = $1", [fileId, userId]);
}

export async function readReportFile(db, { projectId, fileId, userId, store }) {
  const { rows: [f] } = await db.query("SELECT * FROM report_file WHERE id = $1 AND project_id = $2", [fileId, projectId]);
  if (!f) throw notFound("file");
  await rp.reportView(db, { projectId, reportId: f.report_id, userId });      // refuses whoever may not read the report
  return { bytes: await store.get(f.storage_uri), contentType: f.content_type, name: f.name, sha256: f.sha256 };
}

export const sha = (b) => createHash("sha256").update(b).digest("hex");
