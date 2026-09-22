/**
 * Importing an equipment list into the tag spine.
 *
 * The parser (lib/equipment/parse.mjs) turns a file into records. This puts
 * them in the database and says exactly what it did — how many tags, how
 * many subsystems created on the way, and which rows a person still has to
 * look at.
 *
 * Call inside `withProject`.
 */
import { upsertSubsystem, upsertTag } from "./spine.mjs";

/**
 * Import parsed tags.
 *
 * Subsystems named by the list are created as they are met, because an
 * equipment list is usually the FIRST document that states the breakdown,
 * and refusing the import until somebody loads a subsystem table separately
 * would mean typing the same codes twice.
 *
 * `dryRun` returns the same report without writing. An import that can only
 * be understood after it has happened is an import nobody runs on a real
 * project.
 */
export async function importEquipmentList(db, {
  projectId, tags = [], userId = null, dryRun = false,
}) {
  const report = {
    tags: 0, created: 0, updated: 0,
    subsystems: 0, unclassified: [], unfiled: [],
  };

  const existing = new Set(
    (await db.query("SELECT upper(tag_no) AS t FROM tag WHERE project_id = $1", [projectId]))
      .rows.map((r) => r.t));

  const subs = new Map();
  for (const t of tags) {
    if (!t.subsystem) { report.unfiled.push(t.tagNo); continue; }
    if (subs.has(t.subsystem)) continue;
    subs.set(t.subsystem, dryRun ? { id: null } : await upsertSubsystem(db, {
      projectId, code: t.subsystem, systemCode: t.system || null }));
  }
  report.subsystems = subs.size;

  for (const t of tags) {
    report.tags++;
    if (existing.has(t.tagNo.toUpperCase())) report.updated++; else report.created++;
    // An unclassified tag is still imported. It exists on the plant whether
    // or not this parser could read its description, and leaving it out
    // would make the equipment count wrong — which is worse than a tag whose
    // chain an engineer has to pick.
    if (!t.kind) report.unclassified.push({ tagNo: t.tagNo, reason: t.kindReason });
    if (dryRun) continue;

    await upsertTag(db, {
      projectId, tagNo: t.tagNo, discipline: "equipment", kind: t.kind,
      description: t.description,
      subsystemId: t.subsystem ? subs.get(t.subsystem)?.id || null : null,
    });
  }
  return report;
}

/** Set the chain for a tag the parser could not place. The human half. */
export async function classifyTag(db, { projectId, tagId, kind }) {
  if (!["rotating", "static"].includes(kind)) {
    throw Object.assign(new Error(`نوع «${kind}» شناخته نشد.`),
      { status: 400, code: "INVALID_INPUT" });
  }
  const { rows } = await db.query(
    "UPDATE tag SET kind = $1 WHERE id = $2 AND project_id = $3 RETURNING id, tag_no, kind",
    [kind, tagId, projectId]);
  if (!rows[0]) throw Object.assign(new Error("tag not found"), { status: 404 });
  return rows[0];
}

/** The queue for that: equipment with no chain, so nobody has to go looking. */
export async function unclassifiedTags(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT id, tag_no, description, subsystem_id FROM tag
      WHERE project_id = $1 AND discipline = 'equipment' AND kind IS NULL
      ORDER BY tag_no`, [projectId]);
  return rows;
}
