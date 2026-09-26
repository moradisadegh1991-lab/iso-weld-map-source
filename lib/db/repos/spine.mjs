/**
 * The cross-discipline spine: subsystems, tags, and what is filed under them.
 *
 * Every module the platform will ever grow files its work here. That is the
 * whole reason this exists — see db/migrations/007_spine.sql for why the join
 * is declared once instead of once per discipline.
 *
 * Call these inside `withProject`.
 */

/**
 * Register a subsystem, or update the one already registered under this code.
 *
 * Upsert rather than insert because the breakdown arrives as a list and gets
 * re-issued: a project that has to delete before re-importing will eventually
 * delete a subsystem that documents are already filed under, and the
 * ON DELETE SET NULL would silently unfile them.
 */
export async function upsertSubsystem(db, {
  projectId, code, systemCode = null, name = null, unitId = null,
  handoverSeq = null, targetMcDate = null,
}) {
  if (!code) throw bad("subsystem code is required");
  const { rows } = await db.query(
    `INSERT INTO subsystem (project_id, unit_id, system_code, code, name,
                            handover_seq, target_mc_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (project_id, code) DO UPDATE
        SET unit_id        = COALESCE(EXCLUDED.unit_id, subsystem.unit_id),
            system_code    = EXCLUDED.system_code,
            name           = COALESCE(EXCLUDED.name, subsystem.name),
            handover_seq   = COALESCE(EXCLUDED.handover_seq, subsystem.handover_seq),
            target_mc_date = COALESCE(EXCLUDED.target_mc_date, subsystem.target_mc_date)
     RETURNING *`,
    [projectId, unitId, systemCode ?? deriveSystem(code), code, name,
     handoverSeq, targetMcDate]);
  return rows[0];
}

/**
 * A system code, when the import did not carry one.
 *
 * "21-01" belongs to system "21". Guessing this is safe in a way guessing an
 * extracted value never is: it is derived from a code the user typed, not
 * from a drawing somebody has to trust, and the caller can always pass the
 * real one.
 */
const deriveSystem = (code) => String(code).split(/[-_ ]/)[0] || code;

/** Register a tag. The identity the plant is operated by, so it upserts too. */
export async function upsertTag(db, {
  projectId, tagNo, discipline, subsystemId = null, kind = null, description = null,
}) {
  if (!tagNo) throw bad("tag_no is required");
  if (!discipline) throw bad("a tag must name its discipline");
  const { rows } = await db.query(
    `INSERT INTO tag (project_id, subsystem_id, tag_no, discipline, kind, description)
     VALUES ($1,$2,$3,$4::discipline,$5,$6)
     ON CONFLICT (project_id, tag_no) DO UPDATE
        SET subsystem_id = COALESCE(EXCLUDED.subsystem_id, tag.subsystem_id),
            discipline   = EXCLUDED.discipline,
            kind         = COALESCE(EXCLUDED.kind, tag.kind),
            description  = COALESCE(EXCLUDED.description, tag.description)
     RETURNING *`,
    [projectId, subsystemId, tagNo, discipline, kind, description]);
  return rows[0];
}

/** File a line under a subsystem. */
export async function fileLine(db, { projectId, lineId, subsystemId, tagId = null }) {
  const { rows } = await db.query(
    `UPDATE line SET subsystem_id = $1, tag_id = COALESCE($2, tag_id)
      WHERE id = $3 AND project_id = $4 RETURNING id, line_no, subsystem_id, tag_id`,
    [subsystemId, tagId, lineId, projectId]);
  if (!rows[0]) throw notFound("line");
  return rows[0];
}

/**
 * The line an isometric register belongs to, made when its register is
 * saved. Without it the welds and spools of a drawing extracted in the
 * platform belonged to no line — so they could not go into a test package
 * or a subsystem, and mechanical completion never saw them (found by the
 * DM-water pump scenario; the demo seed had made its line by hand).
 *
 * The drawing's class and unit fill the line's only when the line has none:
 * a later sheet does not rewrite what an earlier one set. If the drawing is
 * in the MDR under a subsystem, a line not yet filed goes under it; its
 * equipment is the first tag its tie-ins name.
 */
export async function lineForRegister(db, { projectId, lineNo, docNo = null, unitCode = null, pipingClass = null, tieInRefs = [] }) {
  const no = String(lineNo || docNo || "").trim();
  if (!no) throw bad("شمارهٔ خط یا شمارهٔ نقشه لازم است.");
  const { rows: [line] } = await db.query(
    `INSERT INTO line (project_id, line_no, piping_class, unit_id)
     VALUES ($1, $2, $3, (SELECT id FROM unit WHERE project_id = $1 AND code = $4))
     ON CONFLICT (project_id, line_no) DO UPDATE
        SET piping_class = COALESCE(line.piping_class, EXCLUDED.piping_class),
            unit_id = COALESCE(line.unit_id, EXCLUDED.unit_id)
     RETURNING *`,
    [projectId, no, pipingClass ? String(pipingClass).trim() : null, unitCode ? String(unitCode).trim() : null]);
  // The equipment the line starts at, named on the drawing's tie-ins
  // ("P-7001 discharge N2"): its «piping» step is read from this line. The
  // first tie-in that names a tag of the project wins; nothing is guessed
  // from a ref that names none.
  if (!line.tag_id) {
    const tokens = tieInRefs.flatMap((r) => String(r || "").toUpperCase().split(/[\s,;/]+/)).filter(Boolean);
    if (tokens.length) {
      const { rows: tags } = await db.query("SELECT id, tag_no FROM tag WHERE project_id = $1 AND upper(tag_no) = ANY($2)", [projectId, tokens]);
      const first = tokens.map((t) => tags.find((g) => g.tag_no.toUpperCase() === t)).find(Boolean);
      if (first) {
        await db.query("UPDATE line SET tag_id = $2 WHERE id = $1", [line.id, first.id]);
        line.tag_id = first.id;
      }
    }
  }
  if (!line.subsystem_id && docNo) {
    const { rows: [mdr] } = await db.query(
      "SELECT subsystem_id FROM mdr_document WHERE project_id = $1 AND doc_no = $2 AND subsystem_id IS NOT NULL",
      [projectId, String(docNo).trim().toUpperCase()]);
    if (mdr) return { ...line, ...(await fileLine(db, { projectId, lineId: line.id, subsystemId: mdr.subsystem_id })) };
  }
  return line;
}

/** The tie-in refs of an isometric payload, in drawing order. */
export const tieInRefsOf = (payload) => (payload?.nodes || []).filter((n) => n.type === "tie-in").map((n) => n.ref);

/** Lines no subsystem holds — they are in no one's mechanical completion. */
export async function unfiledLines(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT l.id, l.line_no, l.piping_class, (SELECT count(*)::int FROM weld w WHERE w.line_id = l.id) AS welds
       FROM line l WHERE l.project_id = $1 AND l.subsystem_id IS NULL ORDER BY l.line_no`, [projectId]);
  return rows;
}

/** File a document under a subsystem — the route a discipline with no lines uses. */
export async function fileDocument(db, { projectId, documentId, subsystemId }) {
  const { rows } = await db.query(
    `UPDATE document SET subsystem_id = $1
      WHERE id = $2 AND project_id = $3 RETURNING id, doc_no, subsystem_id`,
    [subsystemId, documentId, projectId]);
  if (!rows[0]) throw notFound("document");
  return rows[0];
}

/**
 * Readiness per subsystem, across every discipline that has filed anything.
 *
 * Worst first, then by the order the project intends to hand over in: a
 * subsystem that is behind AND needed early is the one the meeting is about.
 */
export async function subsystemReadiness(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT * FROM reporting.kpi_subsystem_readiness
      WHERE project_key = $1
      ORDER BY pct_ready NULLS FIRST, handover_seq NULLS LAST, subsystem_code`,
    [projectId]);
  return rows.map((r) => ({
    subsystemId: r.subsystem_key,
    code: r.subsystem_code,
    system: r.system_code,
    name: r.subsystem_name,
    discipline: r.discipline,
    handoverSeq: r.handover_seq,
    targetMcDate: r.target_mc_date,
    items: Number(r.items),
    installed: Number(r.installed),
    tested: Number(r.tested),
    pctReady: r.pct_ready == null ? null : Number(r.pct_ready),
  }));
}

/**
 * Work that belongs to no subsystem yet.
 *
 * Reported on its own rather than folded into the readiness table, because
 * an unfiled item is not a readiness problem — it is a breakdown problem,
 * and the two are fixed by different people.
 */
export async function unfiled(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT discipline, COUNT(*)::int AS items
       FROM reporting.fact_progress
      WHERE project_key = $1 AND subsystem_key IS NULL
      GROUP BY discipline`,
    [projectId]);
  return rows;
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
