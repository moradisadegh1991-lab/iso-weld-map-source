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
import { EQUIPMENT_KINDS, CHAINS } from "../../platform/precedence.mjs";

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
    subsystems: 0, unclassified: [], unfiled: [], kindKept: [],
  };

  const existing = new Map(
    (await db.query(
      `SELECT upper(t.tag_no) AS key, t.id, t.kind,
              COALESCE(array_agg(a.code) FILTER (WHERE a.code IS NOT NULL), '{}') AS codes
         FROM tag t LEFT JOIN tag_activity a ON a.tag_id = t.id
        WHERE t.project_id = $1 GROUP BY t.id`, [projectId]))
      .rows.map((r) => [r.key, { ...r, codes: toArray(r.codes) }]));

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
    const before = existing.get(t.tagNo.toUpperCase());
    if (before) report.updated++; else report.created++;

    // A re-issued list that reads a tag differently must not strand the
    // steps already recorded against it. The old kind is kept and the
    // conflict reported, so an engineer decides — the import does not.
    let kind = t.kind;
    if (before && kind && before.kind && kind !== before.kind) {
      const stranded = strandedCodes(before.codes, kind);
      if (stranded.length) {
        report.kindKept.push({ tagNo: t.tagNo, from: before.kind, to: kind, stranded });
        kind = before.kind;
      }
    }
    // An unclassified tag is still imported. It exists on the plant whether
    // or not this parser could read its description, and leaving it out
    // would make the equipment count wrong — which is worse than a tag whose
    // chain an engineer has to pick.
    if (!t.kind) report.unclassified.push({ tagNo: t.tagNo, reason: t.kindReason });
    if (dryRun) continue;

    await upsertTag(db, {
      projectId, tagNo: t.tagNo, discipline: "equipment", kind,
      description: t.description,
      subsystemId: t.subsystem ? subs.get(t.subsystem)?.id || null : null,
    });
  }
  return report;
}

/** Set the chain for a tag the parser could not place. The human half. */
export async function classifyTag(db, { projectId, tagId, kind }) {
  if (!(kind in EQUIPMENT_KINDS)) {
    throw Object.assign(new Error(`نوع «${kind}» شناخته نشد.`),
      { status: 400, code: "INVALID_INPUT" });
  }
  const { rows: acts } = await db.query(
    "SELECT code FROM tag_activity WHERE tag_id = $1 AND project_id = $2", [tagId, projectId]);
  const stranded = strandedCodes(acts.map((a) => a.code), kind);
  if (stranded.length) {
    throw Object.assign(new Error(
      `تغییر نوع به «${EQUIPMENT_KINDS[kind]}» مراحل ثبت‌شدهٔ ${stranded.join("، ")} را بی‌زنجیره می‌کند. `
      + "این مراحل در زنجیرهٔ جدید نیستند؛ اول آن‌ها را بررسی کنید."),
      { status: 409, code: "CHAIN_CHANGE_STRANDS", stranded });
  }
  const { rows } = await db.query(
    "UPDATE tag SET kind = $1 WHERE id = $2 AND project_id = $3 RETURNING id, tag_no, kind",
    [kind, tagId, projectId]);
  if (!rows[0]) throw Object.assign(new Error("tag not found"), { status: 404 });
  return rows[0];
}

/**
 * Steps already recorded that the chain for `kind` does not have.
 *
 * Recorded under the old chain, they would sit in the table with nothing
 * that reads them: evidence of work done, silently dropped from every
 * progress figure. A static tag with `grout` recorded, moved to the fired
 * chain, is the case this exists for.
 */
function strandedCodes(codes, kind) {
  const chain = new Set((CHAINS[kind] || []).map((s) => s.code));
  return [...new Set(codes)].filter((c) => !chain.has(c));
}

const toArray = (v) => (Array.isArray(v) ? v
  : typeof v === "string" ? v.replace(/^\{|\}$/g, "").split(",").filter(Boolean) : []);

/** The queue for that: equipment with no chain, so nobody has to go looking. */
export async function unclassifiedTags(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT id, tag_no, description, subsystem_id FROM tag
      WHERE project_id = $1 AND discipline = 'equipment' AND kind IS NULL
      ORDER BY tag_no`, [projectId]);
  return rows;
}
