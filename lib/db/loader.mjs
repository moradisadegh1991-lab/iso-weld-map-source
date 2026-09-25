/**
 * A request-scoped loader for the per-tag lookups the readiness engine
 * makes over and over.
 *
 * tagStatus() used to ask the database, tag by tag, for the tag row, its
 * recorded steps, the foundations under it, how many lines, cables and
 * instruments it has, and so on — about nine queries a tag, and a
 * foundation's status was worked out again for every machine standing on
 * it. At plant size (15–20 thousand tags) that is minutes per page
 * (docs/digital-epc/01-ecosystem-review.md, F1).
 *
 * `prime(tagIds)` loads each lookup for every tag at once, in one query
 * per lookup; afterwards the same methods answer from memory. An unprimed
 * loader asks for one tag at a time, exactly as before, so a caller that
 * never primes gets the old behaviour. Statuses are memoised by tag, so a
 * foundation is judged once however many machines stand on it.
 *
 * The primed and unprimed answers must be identical: with
 * TAGSTATUS_CROSSCHECK=1, tagStatus computes both and throws on any
 * difference, and the whole test suite has been run that way.
 */
export function createLoader(db, projectId) {
  const maps = {};           // lookup name → Map(tagId → value), filled by prime()
  const primed = new Set();  // tag ids prime() has covered
  const status = new Map();  // tagId → Promise<tagStatus result>
  const memos = new Map();
  let project = null;

  const one = async (name, tagId, single) => {
    if (primed.has(tagId)) return maps[name].get(tagId) ?? EMPTY[name]();
    return single();
  };

  const loader = {
    projectId,
    status,
    async prime(tagIds) {
      const ids = [...new Set(tagIds)].filter((id) => !primed.has(id));
      if (!ids.length) return;
      const group = (rows, key = "k", val = (r) => r) => {
        const m = new Map();
        for (const r of rows) { const k = r[key]; if (!m.has(k)) m.set(k, []); m.get(k).push(val(r)); }
        return m;
      };
      const q = async (sql) => (await db.query(sql, [projectId, ids])).rows;
      const put = (name, m) => { maps[name] ||= new Map(); for (const [k, v] of m) maps[name].set(k, v); };

      put("tag", new Map((await q(
        `SELECT id, tag_no, kind, discipline, subsystem_id FROM tag WHERE project_id = $1 AND id = ANY($2::uuid[])`))
        .map((r) => [r.id, r])));
      put("activities", group(await q(
        `SELECT tag_id AS k, code, status, done_at, ref_no FROM tag_activity
          WHERE project_id = $1 AND tag_id = ANY($2::uuid[])`), "k", strip));
      put("carriedBy", group(await q(
        `SELECT carries_tag_id AS k, id FROM tag WHERE project_id = $1 AND carries_tag_id = ANY($2::uuid[])`), "k", strip));
      put("lineCount", new Map((await q(
        `SELECT tag_id AS k, count(*)::int AS n FROM line WHERE project_id = $1 AND tag_id = ANY($2::uuid[]) GROUP BY tag_id`))
        .map((r) => [r.k, r.n])));
      put("pipingCounts", new Map((await q(
        `SELECT p.tag_key AS k, COUNT(*)::int AS items,
                COUNT(*) FILTER (WHERE p.is_tested)::int AS tested,
                COUNT(*) FILTER (WHERE p.is_installed)::int AS installed
           FROM reporting.fact_progress p
          WHERE p.project_key = $1 AND p.tag_key = ANY($2::uuid[]) AND p.discipline = 'piping'
          GROUP BY p.tag_key`)).map((r) => [r.k, { items: r.items, tested: r.tested, installed: r.installed }])));
      put("cableIds", group(await q(
        `SELECT to_tag_id AS k, id FROM cable WHERE project_id = $1 AND to_tag_id = ANY($2::uuid[])`), "k", strip));
      put("instrumentIds", group(await q(
        `SELECT eq_tag_id AS k, id FROM instrument WHERE project_id = $1 AND eq_tag_id = ANY($2::uuid[])`), "k", strip));
      put("foundationSpec", new Map((await q(
        `SELECT * FROM foundation_spec WHERE project_id = $1 AND tag_id = ANY($2::uuid[])`)).map((r) => [r.tag_id, r])));
      put("pours", group(await q(
        `SELECT * FROM concrete_pour WHERE project_id = $1 AND tag_id = ANY($2::uuid[]) ORDER BY poured_on, pour_no`),
        "tag_id"));
      put("coatingItem", new Map((await q(
        `SELECT tag_id AS k, id, insulation FROM coating_item WHERE project_id = $1 AND tag_id = ANY($2::uuid[])`))
        .map((r) => [r.k, strip(r)])));
      for (const id of ids) primed.add(id);
    },

    tag: (tagId) => one("tag", tagId, async () => (await db.query(
      "SELECT id, tag_no, kind, discipline, subsystem_id FROM tag WHERE id = $1 AND project_id = $2",
      [tagId, projectId])).rows[0]),
    activities: (tagId) => one("activities", tagId, async () => (await db.query(
      "SELECT code, status, done_at, ref_no FROM tag_activity WHERE tag_id = $1 AND project_id = $2",
      [tagId, projectId])).rows),
    carriedBy: (tagId) => one("carriedBy", tagId, async () => (await db.query(
      "SELECT id FROM tag WHERE carries_tag_id = $1 AND project_id = $2", [tagId, projectId])).rows),
    lineCount: (tagId) => one("lineCount", tagId, async () => (await db.query(
      "SELECT count(*)::int AS n FROM line WHERE tag_id = $1 AND project_id = $2", [tagId, projectId])).rows[0].n),
    pipingCounts: (tagId) => one("pipingCounts", tagId, async () => (await db.query(
      `SELECT COUNT(*)::int AS items,
              COUNT(*) FILTER (WHERE p.is_tested)::int   AS tested,
              COUNT(*) FILTER (WHERE p.is_installed)::int AS installed
         FROM reporting.fact_progress p
        WHERE p.project_key = $2 AND p.tag_key = $1
          -- fact_progress carries every discipline; a motor's cables are not
          -- its piping.
          AND p.discipline = 'piping'`, [tagId, projectId])).rows[0]),
    cableIds: (tagId) => one("cableIds", tagId, async () => (await db.query(
      "SELECT id FROM cable WHERE to_tag_id = $1 AND project_id = $2", [tagId, projectId])).rows),
    instrumentIds: (tagId) => one("instrumentIds", tagId, async () => (await db.query(
      "SELECT id FROM instrument WHERE eq_tag_id = $1 AND project_id = $2", [tagId, projectId])).rows),
    foundationSpec: (tagId) => one("foundationSpec", tagId, async () => (await db.query(
      "SELECT * FROM foundation_spec WHERE tag_id = $1 AND project_id = $2", [tagId, projectId])).rows[0]),
    pours: (tagId) => one("pours", tagId, async () => (await db.query(
      "SELECT * FROM concrete_pour WHERE tag_id = $1 AND project_id = $2 ORDER BY poured_on, pour_no",
      [tagId, projectId])).rows),
    coatingItem: (tagId) => one("coatingItem", tagId, async () => (await db.query(
      `SELECT id, insulation FROM coating_item WHERE project_id = $1 AND (spool_id = $2::uuid OR tag_id = $3::uuid)`,
      [projectId, null, tagId])).rows[0]),
    /** Any other result worth computing once per loader (a concrete class, say). */
    memo(key, fn) {
      if (!memos.has(key)) memos.set(key, fn());
      return memos.get(key);
    },
    /** The project's own row, once per loader. */
    async project() {
      project ||= (await db.query("SELECT * FROM project WHERE id = $1", [projectId])).rows[0];
      return project;
    },
  };
  return loader;
}

/** What an empty lookup is, per lookup — the value a single query would have returned. */
const EMPTY = {
  tag: () => undefined, activities: () => [], carriedBy: () => [], lineCount: () => 0,
  pipingCounts: () => ({ items: 0, tested: 0, installed: 0 }), cableIds: () => [], instrumentIds: () => [],
  foundationSpec: () => undefined, pours: () => [], coatingItem: () => undefined,
};
const strip = ({ k, ...rest }) => rest;
