/**
 * Reading received documents into the registers (migration 063; rules in
 * lib/intake/*). Call inside `withProject`.
 *
 * Only a revision the project has approved (code 1 or 2) is read: an
 * unapproved drawing is not yet what will be built. What is read is a
 * proposal; a person applies it, item by item or in bulk, and a conflict
 * with the register is applied only with a reason.
 */
import { readPdf, readXlsx, kindOfFile } from "../../intake/read.mjs";
import { extract, diff, FIELDS } from "../../intake/extract.mjs";
import { ocrPdf, ocrEngine } from "../../intake/ocr.mjs";
import { compileFormat, parseLineNumbers, parseCodeList, CODE_KINDS } from "../../intake/legend.mjs";
import { withProject } from "../scope.mjs";
import { learnShapes, shapeOf, sharedShapes, KINDS } from "../../intake/patterns.mjs";
import { classifyKind } from "../../equipment/parse.mjs";
import { upsertTag, upsertSubsystem, lineForRegister } from "./spine.mjs";
import { importInstrumentIndex } from "./instrumentation.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const up = (v) => String(v ?? "").trim().toUpperCase();

// ── patterns ─────────────────────────────────────────────────────────────

const REGISTER_VALUES = {
  equipment: "SELECT tag_no AS v FROM tag WHERE project_id = $1 AND discipline = 'equipment'",
  line: "SELECT line_no AS v FROM line WHERE project_id = $1",
  instrument: "SELECT tag_no AS v FROM instrument WHERE project_id = $1",
  subsystem: "SELECT code AS v FROM subsystem WHERE project_id = $1",
  system: "SELECT DISTINCT system_code AS v FROM subsystem WHERE project_id = $1 AND system_code IS NOT NULL",
  drawing: "SELECT doc_no AS v FROM mdr_document WHERE project_id = $1",
};

/** Learn the shapes the registers already use. Never removes a pattern; a person can switch one off. */
export async function learnPatterns(db, { projectId }) {
  let added = 0;
  for (const [kind, sql] of Object.entries(REGISTER_VALUES)) {
    const { rows } = await db.query(sql, [projectId]);
    for (const s of learnShapes(rows.map((r) => r.v), { min: kind === "system" ? 1 : 2 })) {
      const { rowCount } = await db.query(
        `INSERT INTO intake_pattern (project_id, kind, shape, example, source) VALUES ($1,$2,$3,$4,'learned')
         ON CONFLICT (project_id, kind, shape) DO NOTHING`, [projectId, kind, s.shape, s.example]);
      added += rowCount;
    }
  }
  return added;
}

/** A person's example: "30-E-1101A" teaches the equipment shape 99-A-9999A. */
export async function addPattern(db, { projectId, kind, example, userId = null }) {
  if (!KINDS[kind]) throw bad("نوع را انتخاب کنید.");
  const ex = up(example);
  const shape = shapeOf(ex);
  if (!/9/.test(shape) || ex.length < 3) throw bad("نمونه باید یک شمارهٔ کامل با دست‌کم یک رقم باشد (مثلاً 30-E-1101A).");
  const { rows: [p] } = await db.query(
    `INSERT INTO intake_pattern (project_id, kind, shape, example, source, created_by) VALUES ($1,$2,$3,$4,'person',$5)
     ON CONFLICT (project_id, kind, shape) DO UPDATE SET active = true RETURNING *`, [projectId, kind, shape, ex, userId]);
  return p;
}

export async function setPatternActive(db, { projectId, id, active }) {
  const { rows: [p] } = await db.query("UPDATE intake_pattern SET active = $3 WHERE id = $2 AND project_id = $1 RETURNING *",
    [projectId, id, !!active]);
  if (!p) throw bad("الگو پیدا نشد.");
  return p;
}

async function activePatterns(db, projectId) {
  return (await db.query("SELECT kind, shape FROM intake_pattern WHERE project_id = $1 AND active", [projectId])).rows;
}

// ── the registers as maps ────────────────────────────────────────────────

async function registers(db, projectId) {
  const map = async (sql, key = "k") => new Map((await db.query(sql, [projectId])).rows.map((r) => [up(r[key]), r]));
  return {
    equipment: await map(`SELECT t.id, upper(t.tag_no) AS k, t.description, s.code AS subsystem_code FROM tag t
      LEFT JOIN subsystem s ON s.id = t.subsystem_id WHERE t.project_id = $1 AND t.discipline = 'equipment'`),
    line: await map(`SELECT l.id, upper(l.line_no) AS k, l.service, l.piping_class, l.fluid_code, l.insulation, s.code AS subsystem_code FROM line l
      LEFT JOIN subsystem s ON s.id = l.subsystem_id WHERE l.project_id = $1`),
    instrument: await map(`SELECT i.id, upper(i.tag_no) AS k, i.service, s.code AS subsystem_code FROM instrument i
      LEFT JOIN subsystem s ON s.id = i.subsystem_id WHERE i.project_id = $1`),
    subsystem: await map("SELECT id, upper(code) AS k, system_code FROM subsystem WHERE project_id = $1"),
    system: await map("SELECT DISTINCT ON (upper(system_code)) id, upper(system_code) AS k FROM subsystem WHERE project_id = $1 AND system_code IS NOT NULL"),
    drawing: await map("SELECT id, upper(doc_no) AS k FROM mdr_document WHERE project_id = $1"),
  };
}

// ── the legend ───────────────────────────────────────────────────────────

/** The project's line-number format (compiled, or null) and its legend codes per kind. */
export async function loadLegend(db, projectId) {
  const { rows: [f] } = await db.query("SELECT * FROM intake_line_format WHERE project_id = $1", [projectId]);
  const { rows: codes } = await db.query("SELECT * FROM legend_code WHERE project_id = $1 ORDER BY kind, code", [projectId]);
  const maps = Object.fromEntries(Object.keys(CODE_KINDS).map((k) => [k, new Map(codes.filter((c) => c.kind === k).map((c) => [c.code, c.meaning]))]));
  let compiled = null;
  try { compiled = f ? compileFormat(f.format) : null; } catch { compiled = null; }
  return { format: f || null, compiled, codes: maps, rows: codes };
}

/** A person writes the format from the legend sheet; an example, if given, must read with it. */
export async function setLineFormat(db, { projectId, format, example = null, source = null, userId = null }) {
  const fmt = compileFormat(format);
  const ex = String(example || "").trim().toUpperCase() || null;
  if (ex && !parseLineNumbers(ex, fmt).length) throw bad(`نمونهٔ «${ex}» با این قالب خوانده نمی‌شود.`);
  const { rows: [r] } = await db.query(
    `INSERT INTO intake_line_format (project_id, format, example, source, updated_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (project_id) DO UPDATE SET format = EXCLUDED.format, example = EXCLUDED.example, source = EXCLUDED.source,
       updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING *`, [projectId, fmt.format, ex, source || null, userId]);
  return r;
}

/** Codes pasted from the legend sheet, one per line ("MP = MEDIUM PRESSURE STEAM"). */
export async function addLegendCodes(db, { projectId, kind, text, source = null, userId = null }) {
  if (!CODE_KINDS[kind]) throw bad("نوع کد را انتخاب کنید.");
  const rows = parseCodeList(text);
  if (!rows.length) throw bad("هیچ کدی نوشته نشده.");
  for (const r of rows) {
    await db.query(
      `INSERT INTO legend_code (project_id, kind, code, meaning, source, created_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, kind, code) DO UPDATE SET meaning = EXCLUDED.meaning, source = EXCLUDED.source`,
      [projectId, kind, r.code, r.meaning, source || null, userId]);
  }
  return rows.length;
}

export async function removeLegendCode(db, { projectId, id }) {
  const { rowCount } = await db.query("DELETE FROM legend_code WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!rowCount) throw bad("کد پیدا نشد.");
}

// ── reading one revision ─────────────────────────────────────────────────

/** The newest code the project gave this revision. */
async function approvalOf(db, revisionId) {
  const { rows: [r] } = await db.query(
    `SELECT min(i.return_code) FILTER (WHERE i.return_code IN (1, 2)) AS approved FROM transmittal_item i WHERE i.revision_id = $1`, [revisionId]);
  return r?.approved == null ? null : Number(r.approved);
}

/** What a reading needs from the database: the revision, the project's shapes and legend. */
async function prepare(db, { projectId, revisionId }) {
  const { rows: [rev] } = await db.query(
    `SELECT r.*, d.doc_no FROM mdr_revision r JOIN mdr_document d ON d.id = r.mdr_id WHERE r.id = $1 AND r.project_id = $2`,
    [revisionId, projectId]);
  if (!rev) throw bad("رویژن پیدا نشد.");
  if (!rev.file_uri) throw bad(`${rev.doc_no} Rev.${rev.revision} فایل ندارد.`);
  if (!(await approvalOf(db, revisionId))) throw bad(`${rev.doc_no} Rev.${rev.revision} هنوز کد ۱ یا ۲ نگرفته — مدرک تأییدنشده خوانده نمی‌شود.`);
  let patterns = await activePatterns(db, projectId);
  if (!patterns.length) { await learnPatterns(db, { projectId }); patterns = await activePatterns(db, projectId); }
  return { rev, type: kindOfFile(rev.file_name, rev.content_type), patterns, legend: await loadLegend(db, projectId) };
}

async function insertRun(db, projectId, revisionId, userId, f) {
  return (await db.query(
    `INSERT INTO intake_run (project_id, revision_id, method, status, pages, scanned_pages, doc_no_seen, ambiguous, unknown_format, error,
                             started_by, engine, ocr_pages, ocr_conf)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14) RETURNING *`,
    [projectId, revisionId, f.method, f.status, f.pages ?? null, f.scanned ?? [], f.docNoSeen ?? null,
      JSON.stringify(f.ambiguous ?? []), JSON.stringify(f.unknownFormat ?? []), f.error ?? null, userId,
      f.engine ?? null, f.ocrPages ?? [], f.ocrConf ?? null])).rows[0];
}

/** Extract, compare with the registers, and record the reading and its proposal. */
async function record(db, { projectId, revisionId, userId, prep, read, method, engine = null }) {
  const { rev, type, patterns, legend } = prep;
  const ex = extract(read, { patterns, docNo: rev.doc_no, lineFormat: legend.compiled, codes: legend.codes });
  const proposal = diff(ex.candidates, await registers(db, projectId));
  const ocrPages = (read.pages || []).filter((p) => p.words).map((p) => p.n);
  const scanned = (read.scanned || []).filter((n) => !ocrPages.includes(n));
  const allScanned = type === "pdf" && read.pages.length && scanned.length === read.pages.length;
  const confs = (read.pages || []).filter((p) => p.words && p.conf != null).map((p) => p.conf);
  const run = await insertRun(db, projectId, revisionId, userId, { method, status: allScanned ? "needs-ocr" : "read",
    pages: read.pages?.length ?? null, scanned, docNoSeen: type === "pdf" && !allScanned ? ex.docNoSeen : null,
    ambiguous: ex.ambiguous, unknownFormat: ex.unknownFormat, engine, ocrPages,
    ocrConf: confs.length ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 100) / 100 : null });
  for (const p of proposal) {
    await db.query(
      `INSERT INTO intake_item (project_id, run_id, kind, key, action, target_id, changes, attrs, disagree, seen_at,
                                confidence, ocr_read, suspect, checks, unknown_codes)
       VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb)`,
      [projectId, run.id, p.kind, p.key, p.action, p.targetId, JSON.stringify(p.changes), JSON.stringify(p.attrs),
        JSON.stringify(p.disagree), p.where, p.confidence, p.ocrRead, p.suspect, p.check, JSON.stringify(p.unknownCodes)]);
  }
  return { run, items: proposal };
}

/** Read an approved revision's text layer or workbook. A scan comes back "needs OCR" (see queueOcr). */
export async function readRevision(db, { projectId, revisionId, store, userId = null }) {
  const prep = await prepare(db, { projectId, revisionId });
  const { rev, type } = prep;
  if (!type) return { run: await insertRun(db, projectId, revisionId, userId, { method: "none", status: "unsupported", error: `نوع فایل ${rev.file_name || ""} هنوز خوانده نمی‌شود (فعلاً PDF و اکسل).` }), items: [] };
  let read;
  try {
    const bytes = await store.get(rev.file_uri);
    read = type === "pdf" ? await readPdf(bytes) : readXlsx(bytes);
  } catch (e) {
    return { run: await insertRun(db, projectId, revisionId, userId, { method: type === "pdf" ? "pdf-text" : "xlsx", status: "failed", error: String(e.message || e).slice(0, 300) }), items: [] };
  }
  return record(db, { projectId, revisionId, userId, prep, read, method: type === "pdf" ? "pdf-text" : "xlsx" });
}

/**
 * Put a scanned PDF in the OCR queue: recorded as a 'queued' run now; the
 * reading itself (ocrRevision) is a new run when it finishes.
 */
export async function queueOcr(db, { projectId, revisionId, userId = null }) {
  const { engine, why } = await ocrEngine();
  if (!engine) throw bad(why);
  const { type, rev } = await prepare(db, { projectId, revisionId });
  if (type !== "pdf") throw bad(`${rev.doc_no}: OCR فقط برای PDF است.`);
  return insertRun(db, projectId, revisionId, userId, { method: "ocr", status: "queued" });
}

/**
 * The OCR reading, for the queue. The slow part — the engine — runs with no
 * project scope held, so the rest of the platform keeps answering; the
 * database is touched only before and after it.
 */
export async function ocrRevision(db, { projectId, revisionId, store, userId = null }) {
  const prep = await withProject(db, projectId, () => prepare(db, { projectId, revisionId }));
  let read, engine;
  try {
    const bytes = await store.get(prep.rev.file_uri);
    read = await readPdf(bytes);
    const want = read.scanned.length ? read.scanned : [];
    if (want.length) {
      const e = await ocrEngine();
      engine = e.version || e.engine;
      const ocr = await ocrPdf(bytes, want);
      const byN = new Map(ocr.map((p) => [p.n, p]));
      read = { ...read, pages: read.pages.map((p) => (byN.has(p.n) ? { ...byN.get(p.n), n: p.n } : p)) };
    }
  } catch (e) {
    return withProject(db, projectId, async () => ({
      run: await insertRun(db, projectId, revisionId, userId, { method: "ocr", status: "failed", error: String(e.message || e).slice(0, 300) }), items: [] }));
  }
  return withProject(db, projectId, () => record(db, { projectId, revisionId, userId, prep, read, method: engine ? "ocr" : "pdf-text", engine }));
}

// ── applying ─────────────────────────────────────────────────────────────

async function subsystemId(db, projectId, code) {
  if (!code) return null;
  const { rows: [s] } = await db.query("SELECT id FROM subsystem WHERE project_id = $1 AND upper(code) = upper($2)", [projectId, code]);
  return s ? s.id : (await upsertSubsystem(db, { projectId, code: up(code) })).id;
}

/** Apply one item to its register; returns the register row's id. */
async function applyItem(db, projectId, it, userId) {
  const val = (attr) => {
    const c = (it.changes || []).find((x) => x.attr === attr);
    return c ? c.to : null;
  };
  const sets = (it.changes || []);
  switch (it.kind) {
    case "subsystem": {
      const s = await upsertSubsystem(db, { projectId, code: it.key, systemCode: val("system") ?? undefined });
      if (val("system")) await db.query("UPDATE subsystem SET system_code = $2 WHERE id = $1", [s.id, val("system")]);
      return s.id;
    }
    case "system": {
      // A system is the code its subsystems carry; it has no row of its own.
      return null;
    }
    case "equipment": {
      if (it.action === "new") {
        const desc = val("service");
        const { kind } = classifyKind(desc, null);
        const t = await upsertTag(db, { projectId, tagNo: it.key, discipline: "equipment", kind: kind || null, description: desc,
          subsystemId: await subsystemId(db, projectId, val("subsystem")) });
        return t.id;
      }
      for (const c of sets) {
        if (c.field === "description") await db.query("UPDATE tag SET description = $2 WHERE id = $1", [it.target_id, c.to]);
        if (c.field === "subsystem_code") await db.query("UPDATE tag SET subsystem_id = $2 WHERE id = $1", [it.target_id, await subsystemId(db, projectId, c.to)]);
      }
      return it.target_id;
    }
    case "line": {
      const id = it.action === "new"
        ? (await lineForRegister(db, { projectId, lineNo: it.key, pipingClass: val("class") })).id : it.target_id;
      for (const c of sets) {
        if (c.field === "service") await db.query("UPDATE line SET service = $2 WHERE id = $1", [id, c.to]);
        if (c.field === "piping_class" && it.action !== "new") await db.query("UPDATE line SET piping_class = $2 WHERE id = $1", [id, c.to]);
        if (c.field === "fluid_code") await db.query("UPDATE line SET fluid_code = $2 WHERE id = $1", [id, c.to]);
        if (c.field === "insulation") await db.query("UPDATE line SET insulation = $2 WHERE id = $1", [id, c.to]);
        if (c.field === "subsystem_code") await db.query("UPDATE line SET subsystem_id = $2 WHERE id = $1", [id, await subsystemId(db, projectId, c.to)]);
      }
      return id;
    }
    case "instrument": {
      if (it.action === "new") {
        await importInstrumentIndex(db, { projectId, text: `Tag\tService\n${it.key}\t${val("service") || ""}` });
      }
      const { rows: [i] } = await db.query("SELECT id FROM instrument WHERE project_id = $1 AND upper(tag_no) = $2", [projectId, it.key]);
      if (!i) throw bad(`${it.key}: طبق ISA 5.1 خوانده نشد و به فهرست ابزار اضافه نشد.`);
      for (const c of sets) {
        if (c.field === "service" && it.action !== "new") await db.query("UPDATE instrument SET service = $2 WHERE id = $1", [i.id, c.to]);
        if (c.field === "subsystem_code") await db.query("UPDATE instrument SET subsystem_id = $2 WHERE id = $1", [i.id, await subsystemId(db, projectId, c.to)]);
      }
      return i.id;
    }
    case "drawing": {
      if (it.action !== "new") return it.target_id;
      const { rows: [run] } = await db.query(
        `SELECT d.doc_no, r.revision FROM intake_run x JOIN mdr_revision r ON r.id = x.revision_id JOIN mdr_document d ON d.id = r.mdr_id
          WHERE x.id = $1`, [it.run_id]);
      const { rows: [d] } = await db.query(
        `INSERT INTO mdr_document (project_id, doc_no, title, outside_mdr) VALUES ($1,$2,$3,true)
         ON CONFLICT (project_id, doc_no) DO UPDATE SET doc_no = EXCLUDED.doc_no RETURNING id`,
        [projectId, it.key, `ارجاع‌شده در ${run.doc_no} Rev.${run.revision} — عنوان هنوز ثبت نشده`]);
      return d.id;
    }
    default: throw bad(`نوع ${it.kind} شناخته نشد.`);
  }
}

/**
 * Apply or reject items. A conflict is applied only with a reason; items
 * already decided are left as they are.
 */
export async function decide(db, { projectId, itemIds = [], decision, reason = null, userId }) {
  if (!["applied", "rejected"].includes(decision)) throw bad("تصمیم نامعتبر است.");
  if (!userId) throw bad("تصمیم را یک شخص می‌گیرد.");
  if (!itemIds.length) throw bad("هیچ ردیفی انتخاب نشده.");
  const { rows: items } = await db.query(
    `SELECT i.*, x.revision_id FROM intake_item i JOIN intake_run x ON x.id = i.run_id
      WHERE i.project_id = $1 AND i.id = ANY($2::uuid[])`, [projectId, itemIds]);
  const why = String(reason || "").trim() || null;
  if (decision === "applied" && items.some((i) => i.action === "conflict" && i.decision === "pending") && !why) {
    throw bad("برای اعمال تناقض (جایگزینی مقدار فعلی رجیستر) دلیل لازم است.");
  }
  if (decision === "applied" && items.some((i) => i.decision === "pending" && i.action !== "same" && i.checks?.length) && !why) {
    throw bad("ردیف‌های «بررسی شود» (OCR نامطمئن، کاراکتر جابه‌جاشده یا شبیه شماره‌ای در رجیستر) فقط با دلیل اعمال می‌شوند — با نقشه مقایسه کنید.");
  }
  if (decision === "rejected" && !why) throw bad("رد کردن دلیل لازم دارد.");
  let done = 0;
  const errors = [];
  for (const it of items) {
    if (it.decision !== "pending") continue;
    let target = it.target_id;
    if (decision === "applied") {
      try { target = await applyItem(db, projectId, it, userId); }
      catch (e) { errors.push(`${it.key}: ${e.message}`); continue; }
      await db.query(
        `INSERT INTO doc_ref (project_id, revision_id, kind, key, target_id, item_id) VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (revision_id, kind, key) DO NOTHING`, [projectId, it.revision_id, it.kind, it.key, target, it.id]);
    }
    await db.query("UPDATE intake_item SET decision = $2, reason = $3, decided_by = $4, decided_at = now() WHERE id = $1",
      [it.id, decision, why, userId]);
    done++;
  }
  // What a document only confirmed changes no register; once a person applies
  // from that reading, those confirmations are recorded as references too.
  if (decision === "applied") {
    for (const runId of new Set(items.map((i) => i.run_id))) {
      const { rows: same } = await db.query(
        `SELECT i.*, x.revision_id FROM intake_item i JOIN intake_run x ON x.id = i.run_id
          WHERE i.run_id = $1 AND i.action = 'same' AND i.decision = 'pending'`, [runId]);
      for (const it of same) {
        await db.query(`INSERT INTO doc_ref (project_id, revision_id, kind, key, target_id, item_id) VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT (revision_id, kind, key) DO NOTHING`, [projectId, it.revision_id, it.kind, it.key, it.target_id, it.id]);
        await db.query("UPDATE intake_item SET decision = 'applied', reason = 'تأیید مقدار موجود', decided_by = $2, decided_at = now() WHERE id = $1",
          [it.id, userId]);
      }
    }
  }
  return { done, errors };
}

// ── the board ────────────────────────────────────────────────────────────

export async function intakeBoard(db, { projectId, ocrActive = new Set() }) {
  const { rows: candidates } = await db.query(
    `SELECT r.id AS revision_id, d.doc_no, d.title, d.discipline, d.doc_type, r.revision, r.file_name,
            min(i.return_code) FILTER (WHERE i.return_code IN (1, 2)) AS approved
       FROM mdr_revision r JOIN mdr_document d ON d.id = r.mdr_id JOIN transmittal_item i ON i.revision_id = r.id
       JOIN transmittal t ON t.id = i.transmittal_id AND t.direction = 'in'
      WHERE r.project_id = $1 AND r.file_uri IS NOT NULL
      GROUP BY r.id, d.doc_no, d.title, d.discipline, d.doc_type, r.revision, r.file_name
      ORDER BY d.doc_no, r.revision`, [projectId]);
  const { rows: runs } = await db.query(
    `SELECT DISTINCT ON (x.revision_id) x.*, u.display_name AS by_name FROM intake_run x LEFT JOIN app_user u ON u.id = x.started_by
      WHERE x.project_id = $1 ORDER BY x.revision_id, x.created_at DESC`, [projectId]);
  const runIds = runs.map((r) => r.id);
  const { rows: items } = runIds.length ? await db.query(
    `SELECT i.*, u.display_name AS decided_name FROM intake_item i LEFT JOIN app_user u ON u.id = i.decided_by
      WHERE i.run_id = ANY($1::uuid[]) ORDER BY i.kind, i.key`, [runIds]) : { rows: [] };
  const patterns = (await db.query("SELECT * FROM intake_pattern WHERE project_id = $1 ORDER BY kind, shape", [projectId])).rows;
  const docs = candidates.map((c) => {
    const run = runs.find((r) => r.revision_id === c.revision_id) || null;
    return { ...c, approved: c.approved == null ? null : Number(c.approved), run,
      items: run ? items.filter((i) => i.run_id === run.id) : [] };
  });
  for (const d of docs) if (d.run?.status === "queued") d.run.stale = !ocrActive.has(d.revision_id);
  const legend = await loadLegend(db, projectId);
  return { docs, patterns, shared: sharedShapes(patterns.filter((p) => p.active)), kinds: KINDS, fields: FIELDS,
    legend: { format: legend.format, formatError: legend.format && !legend.compiled, codes: legend.rows, codeKinds: CODE_KINDS },
    ocr: await ocrEngine() };
}

/** Where a number appears: every revision that showed it, once applied. */
export async function refsOf(db, { projectId, kind, key }) {
  const { rows } = await db.query(
    `SELECT d.doc_no, r.revision, r.issued_on FROM doc_ref x JOIN mdr_revision r ON r.id = x.revision_id JOIN mdr_document d ON d.id = r.mdr_id
      WHERE x.project_id = $1 AND x.kind = $2 AND x.key = $3 ORDER BY r.issued_on`, [projectId, kind, up(key)]);
  return rows;
}
