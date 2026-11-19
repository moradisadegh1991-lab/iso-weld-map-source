import * as cd from "../../reports/contract-daily.mjs";
import { reportRowReader } from "../../reports/workflow.mjs";

/**
 * Each row a change touches, as the duty rules read it (lib/reports/workflow.mjs
 * `outOfReach`): its part of the report and the tree rows it hangs from —
 * the narrative branch for a narrative row; the resource, its category branch
 * and the work group for a resource row; the activity and its WBS branch for
 * an activity row. A problem and the header hang from no tree.
 */
export async function reach(db, contractId, changes) {
  const touched = changes.flatMap(({ previous, ...change }) => previous ? [{ ...change, row: previous }, change] : [change]);
  const { rows: cats } = await db.query("SELECT id, parent_id FROM contract_category WHERE contract_id = $1", [contractId]);
  const { rows: res } = await db.query("SELECT id, category_id, name FROM contract_resource WHERE contract_id = $1", [contractId]);
  const ids = [...new Set(touched.filter((t) => t.section === "activities").map((t) => cd.effective(t.row)?.activityId).filter(Boolean))];
  const { rows: acts } = ids.length ? await db.query(
    `WITH RECURSIVE up AS (SELECT a.id AS act, n.id, n.parent_id, n.pms_id FROM wbs_activity a JOIN wbs_node n ON n.id = a.node_id WHERE a.id = ANY($1::uuid[])
                           UNION ALL SELECT up.act, n.id, n.parent_id, n.pms_id FROM wbs_node n JOIN up ON n.id = up.parent_id)
     SELECT act, id, pms_id FROM up`, [ids]) : { rows: [] };
  const parent = new Map(cats.map((c) => [c.id, c.parent_id]));
  const branch = (id) => { const out = []; for (let x = id; x && !out.includes(x); x = parent.get(x)) out.push(x); return out; };
  return touched.map(({ section, row, permission }) => {
    const e = cd.effective(row) || {};
    const path = section === "narrative" ? branch(e.categoryId)
      : section === "resources" ? [e.resourceId, ...branch(res.find((x) => x.id === e.resourceId)?.category_id), ...branch(e.workGroupId)].filter(Boolean)
        : section === "activities" ? [e.activityId, ...acts.filter((x) => x.act === e.activityId).flatMap((x) => [x.id, x.pms_id])].filter(Boolean)
          : [];
    return { section, path, permission, rowId: row.id, label: e.title || e.description || res.find((x) => x.id === e.resourceId)?.name || cd.SECTIONS[section]?.title || section };
  });
}

/** Project whole rows, including their history, against the caller's grants. */
export async function visibleContractContent(db, { contractId, content, stages, pages, userId }) {
  const canRead = contractId && reportRowReader(stages, pages, userId);
  if (!canRead || content.schema !== 2) return content;
  const rows = Object.keys(cd.SECTIONS).flatMap((section) => (content[section] || []).map((row) => ({ section, row })));
  const history = rows.flatMap(({ section, row }) => {
    const stages = Object.entries(row.stages || {}).sort(([a], [b]) => Number(a) - Number(b));
    const versions = row.base ? [{ ...row, stages: {} }] : [];
    const entries = [];
    for (const entry of stages) {
      entries.push(entry);
      versions.push({ ...row, stages: Object.fromEntries(entries) });
    }
    return (versions.length ? versions : [row]).map((state) => ({ section, row: state }));
  });
  const paths = history.length ? await reach(db, contractId, history) : [];
  const hidden = new Map();
  for (const { section, path, rowId } of paths) {
    if (canRead(section, path)) continue;
    if (!hidden.has(section)) hidden.set(section, new Set());
    hidden.get(section).add(rowId);
  }
  return {
    ...content,
    header: { base: {}, stages: {} },
    ...Object.fromEntries(Object.keys(cd.SECTIONS).map((key) =>
      [key, (content[key] || []).filter((row) => !hidden.get(key)?.has(row.id))])),
  };
}
