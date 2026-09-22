/**
 * Login, and the lockout that stops it being brute-forced.
 *
 * Failures are counted in the DATABASE, not in memory: the app runs as
 * several instances behind Vercel, and a counter in one process is not a
 * lockout — an attacker just gets a different instance.
 *
 * These tables sit outside project-scoped RLS by design (see
 * lib/db/repos/projects.mjs), so nothing here runs inside `withProject`.
 */
import { hashPassword, verifyPassword, needsRehash, passwordProblem } from "../../auth/password.mjs";

const MAX_FAILURES = 8;
const LOCK_MINUTES = 15;

export async function setPassword(db, { userId, password, mustChange = false }) {
  const problem = passwordProblem(password);
  if (problem) throw Object.assign(new Error(problem), { status: 400, code: "WEAK_PASSWORD" });
  const hash = await hashPassword(password);
  const { rows } = await db.query(
    `INSERT INTO user_credential (user_id, password_hash, must_change, password_set_at)
     VALUES ($1,$2,$3, now())
     ON CONFLICT (user_id) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            must_change = EXCLUDED.must_change,
            password_set_at = now(),
            failed_count = 0, locked_until = NULL
     RETURNING user_id, must_change`,
    [userId, hash, mustChange]);
  return rows[0];
}

/**
 * Check an email and password.
 *
 * Every failure returns the SAME error, whether the account is unknown, has
 * no password set, or the password is wrong. Distinguishing them tells an
 * attacker which email addresses are real, which is most of the work of
 * getting in.
 *
 * The one exception is a locked account, which says so — that message is
 * useful to the person it locks out and tells an attacker only what their
 * own failures already told them.
 */
export async function authenticatePassword(db, { email, password }) {
  const fail = () => Object.assign(
    new Error("ایمیل یا رمز عبور درست نیست."), { status: 401, code: "BAD_CREDENTIALS" });

  const { rows: [row] } = await db.query(
    `SELECT u.id, u.subject, u.email, u.display_name,
            c.password_hash, c.must_change, c.failed_count, c.locked_until
       FROM app_user u
       LEFT JOIN user_credential c ON c.user_id = u.id
      WHERE lower(u.email) = lower($1)`,
    [String(email || "").trim()]);

  if (row?.locked_until && new Date(row.locked_until) > new Date()) {
    throw Object.assign(
      new Error(`این حساب تا ${LOCK_MINUTES} دقیقه قفل است.`),
      { status: 429, code: "ACCOUNT_LOCKED" });
  }

  // A user with no credential row still costs a hash comparison, so an
  // unknown email does not answer measurably faster than a known one.
  const hash = row?.password_hash || NO_SUCH_USER_HASH;
  const ok = await verifyPassword(password, hash);

  if (!row || !row.password_hash || !ok) {
    if (row) await noteFailure(db, row.id);
    throw fail();
  }

  await db.query(
    `UPDATE user_credential
        SET failed_count = 0, locked_until = NULL, last_login_at = now()
      WHERE user_id = $1`, [row.id]);

  // Re-hash on a correct password when the cost parameters have been raised.
  // This is the only moment the plaintext is available to do it.
  if (needsRehash(row.password_hash)) {
    await db.query("UPDATE user_credential SET password_hash = $1 WHERE user_id = $2",
      [await hashPassword(password), row.id]);
  }

  return {
    id: row.id, subject: row.subject, email: row.email,
    displayName: row.display_name, mustChange: row.must_change,
  };
}

async function noteFailure(db, userId) {
  await db.query(
    `UPDATE user_credential
        SET failed_count = failed_count + 1,
            locked_until = CASE WHEN failed_count + 1 >= $2
                                THEN now() + ($3 || ' minutes')::interval
                                ELSE locked_until END
      WHERE user_id = $1`,
    [userId, MAX_FAILURES, String(LOCK_MINUTES)]);
}

/**
 * A hash of a password nobody has, so the unknown-email path does the same
 * work as the known-email one. Without it, "no such user" returns in
 * microseconds and a real user's wrong password takes ~100 ms, which is a
 * user-enumeration oracle anyone can measure over the internet.
 */
const NO_SUCH_USER_HASH =
  "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export async function hasAnyUser(db) {
  const { rows } = await db.query("SELECT count(*)::int AS n FROM user_credential");
  return rows[0].n > 0;
}

export { MAX_FAILURES, LOCK_MINUTES };
