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

import { AsyncLocalStorage } from "node:async_hooks";

const APP_ROLE = "app_rw";

/**
 * PGlite is ONE connection shared by every request. The project setting and
 * the role are state on that connection, so two scoped blocks interleaving at
 * their awaits would run each other's queries under the wrong project — or,
 * after the other's RESET ROLE, as the superuser, past row security. Scoped
 * blocks on PGlite therefore run one at a time. A block nested inside one
 * already held by the same async chain runs straight through. node-postgres
 * gives each query a pooled connection and needs no lock (its scoping is the
 * transaction's business).
 */
const held = new AsyncLocalStorage();
const tails = new WeakMap();
async function exclusive(db, fn) {
  if (db.driver !== "pglite" || held.getStore()?.has(db)) return fn();
  const before = tails.get(db) || Promise.resolve();
  let release;
  const mine = new Promise((r) => { release = r; });
  tails.set(db, before.then(() => mine));
  await before;
  try {
    return await held.run(new Set([...(held.getStore() || []), db]), fn);
  } finally {
    release();
  }
}

/** Run `fn` detached from any scope this async chain holds (background work started from a request). */
export function outsideScope(fn) {
  return held.exit(fn);
}

/** Bind a connection to one project, as the restricted role, for `fn`. */
export async function withProject(db, projectId, fn, { role = APP_ROLE } = {}) {
  if (!projectId) throw new Error("withProject needs a project id");
  return exclusive(db, () => scoped(db, projectId, fn, role));
}

async function scoped(db, projectId, fn, role) {
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
  return exclusive(db, () => unscoped(db, fn, role));
}

async function unscoped(db, fn, role) {
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
