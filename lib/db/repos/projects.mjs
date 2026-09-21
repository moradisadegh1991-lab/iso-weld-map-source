/**
 * Projects, units and membership — the directory a user consults before a
 * project scope exists. These tables sit outside project-scoped RLS for that
 * reason, so access is filtered by USER here instead. Every function that
 * reads them takes a user id and joins membership; none of them accepts a
 * bare project id and trusts it.
 */

export async function ensureUser(db, { subject, email = null, displayName = null }) {
  const { rows } = await db.query(
    `INSERT INTO app_user (subject, email, display_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (subject) DO UPDATE
       SET email = COALESCE(EXCLUDED.email, app_user.email),
           display_name = COALESCE(EXCLUDED.display_name, app_user.display_name)
     RETURNING id, subject, email, display_name`,
    [subject, email, displayName]);
  return rows[0];
}

export async function createProject(db, { code, name, ownerUserId }) {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query(
      "INSERT INTO project (code, name) VALUES ($1, $2) RETURNING id, code, name",
      [code, name]);
    const project = rows[0];
    if (ownerUserId) {
      await tx.query(
        "INSERT INTO project_member (project_id, user_id, role) VALUES ($1, $2, 'admin')",
        [project.id, ownerUserId]);
    }
    return project;
  });
}

export async function addMember(db, { projectId, userId, role }) {
  const { rows } = await db.query(
    `INSERT INTO project_member (project_id, user_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role
     RETURNING project_id, user_id, role`,
    [projectId, userId, role]);
  return rows[0];
}

/** What this user may see. Never call it with a project id from a request. */
export async function listProjectsForUser(db, userId) {
  const { rows } = await db.query(
    `SELECT p.id, p.code, p.name, m.role
       FROM project p
       JOIN project_member m ON m.project_id = p.id
      WHERE m.user_id = $1
      ORDER BY p.code`,
    [userId]);
  return rows;
}

/**
 * The membership check every request must pass before a project scope is
 * opened. Returns null when the user has no standing in the project, which
 * callers must treat as "this project does not exist" rather than "forbidden"
 * — the difference leaks whether a project code is in use.
 */
export async function membershipOf(db, { projectId, userId }) {
  const { rows } = await db.query(
    "SELECT project_id, user_id, role FROM project_member WHERE project_id = $1 AND user_id = $2",
    [projectId, userId]);
  return rows[0] || null;
}

export async function createUnit(db, { projectId, code, name = null }) {
  const { rows } = await db.query(
    `INSERT INTO unit (project_id, code, name) VALUES ($1, $2, $3)
     ON CONFLICT (project_id, code) DO UPDATE SET name = COALESCE(EXCLUDED.name, unit.name)
     RETURNING id, project_id, code, name`,
    [projectId, code, name]);
  return rows[0];
}
