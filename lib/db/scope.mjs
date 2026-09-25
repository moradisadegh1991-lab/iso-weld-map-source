/**
 * Project scope.
 *
 * Two things happen together here, and neither works without the other:
 *
 *   1. `app.project_id` is set — the row level security policies key on it,
 *      so a query issued without it sees an empty database.
 *   2. the session drops into the `app_rw` role — PostgreSQL lets superusers
 *      and BYPASSRLS roles through row security unconditionally, FORCE or
 *      not, so a scope that did not drop privileges would set the variable
 *      and still see everything.
 *
 * The failure mode we want is nothing, rather than someone else's welds.
 */

const APP_ROLE = "app_rw";

/** Bind a connection to one project, as the restricted role, for `fn`. */
export async function withProject(db, projectId, fn, { role = APP_ROLE } = {}) {
  if (!projectId) throw new Error("withProject needs a project id");
  await db.query("SELECT set_config('app.project_id', $1, false)", [String(projectId)]);
  if (role) await db.query(`SET ROLE ${quoteIdent(role)}`);
  try {
    return await fn(db);
  } finally {
    try {
      if (role) await db.query("RESET ROLE");
      await db.query("SELECT set_config('app.project_id', '', false)");
    } catch (resetError) {
      // Inside a transaction that a failed statement has aborted, these
      // cannot run — and need not: the ROLLBACK that follows undoes the
      // SET ROLE and the setting, both being transactional. Throwing here
      // would replace the error that matters with "transaction aborted".
      if (!db.inTransaction) throw resetError;
    }
  }
}

/**
 * Run `fn` with no project bound, for the directory tables (`project`,
 * `project_member`, `app_user`) that a user consults before choosing a
 * project. Those are filtered by user in lib/db/repos/projects.mjs.
 *
 * It drops into the same restricted role as `withProject`, so the invariant
 * holds everywhere the application touches the database: never a superuser,
 * therefore never a silent RLS bypass. With no project bound, every
 * project-scoped table reads as empty — which is the point.
 */
export async function withoutProject(db, fn, { role = APP_ROLE } = {}) {
  await db.query("SELECT set_config('app.project_id', '', false)");
  if (role) await db.query(`SET ROLE ${quoteIdent(role)}`);
  try {
    return await fn(db);
  } finally {
    if (role) await db.query("RESET ROLE");
  }
}

/** Role names come from configuration, never from a request, but quote anyway. */
function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`unsafe role name: ${name}`);
  return `"${name}"`;
}
