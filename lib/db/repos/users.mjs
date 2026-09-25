/**
 * Users: the members of a project, and the accounts behind them.
 *
 * A project admin manages that project's members: invites people, sets their
 * role, work areas and inspection party, removes them, and ends their
 * sessions. What reaches beyond one project stays with a developer: resetting
 * the password of an account that already has one (it may belong to other
 * projects too — a reset link is the account), deactivating an account, and
 * the developer flag itself.
 *
 * A password never passes through this module or an admin's hands. A new
 * account gets a one-time link; its owner sets the password. The link's
 * token is kept only as a SHA-256, expires, and works once.
 *
 * app_user, user_credential and user_setup_token are outside project RLS;
 * every function here names the project or the user it acts on.
 */
import { randomBytes, createHash } from "node:crypto";
import { ROLES } from "../../authz.mjs";
import { AREAS } from "../../platform/areas.mjs";
import { setPassword, revokeSessions } from "./credentials.mjs";

export const SETUP_HOURS = 72;
const PARTIES = ["contractor", "company", "tpi"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const sha = (t) => createHash("sha256").update(String(t)).digest("hex");

/** Every member of a project with what the users page shows about them. */
export async function listProjectUsers(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT u.id AS user_id, u.email, u.display_name, u.is_active, u.is_developer,
            m.role, m.areas, m.inspection_party, m.granted_at,
            (c.user_id IS NOT NULL) AS has_password, c.last_login_at, c.locked_until,
            EXISTS (SELECT 1 FROM user_setup_token t WHERE t.user_id = u.id AND t.used_at IS NULL
                     AND t.expires_at > clock_timestamp()) AS link_pending
       FROM project_member m JOIN app_user u ON u.id = m.user_id
       LEFT JOIN user_credential c ON c.user_id = u.id
      WHERE m.project_id = $1
      ORDER BY (m.role = 'admin') DESC, u.display_name NULLS LAST, u.email`, [projectId]);
  return rows.map((r) => ({ ...r, areas: r.areas || [],
    status: !r.is_active ? "inactive" : r.locked_until && new Date(r.locked_until) > new Date() ? "locked"
      : r.has_password ? "active" : r.link_pending ? "invited" : "no_password" }));
}

/** The platform's developers (read-only on a project's page). */
export async function listDevelopers(db) {
  const { rows } = await db.query(
    "SELECT id AS user_id, email, display_name, is_active FROM app_user WHERE is_developer ORDER BY email");
  return rows;
}

/**
 * Invite someone to a project. A new email becomes an account with a
 * one-time setup link; an existing account is added as a member (and gets a
 * link only if it never set a password).
 */
export async function inviteUser(db, { projectId, email, displayName = null, role, areas = [], party = null, byUser }) {
  const e = String(email || "").trim().toLowerCase();
  if (!EMAIL.test(e)) throw bad("ایمیل معتبر نیست.");
  checkMember({ role, areas, party });
  const { rows: [existing] } = await db.query(
    "SELECT id, email, display_name, is_active FROM app_user WHERE lower(email) = $1", [e]);
  let user = existing;
  if (!user) {
    ({ rows: [user] } = await db.query(
      `INSERT INTO app_user (subject, email, display_name) VALUES ($1,$2,$3)
       ON CONFLICT (subject) DO UPDATE SET email = EXCLUDED.email RETURNING id, email, display_name, is_active`,
      [`local|${e}`, e, String(displayName || "").trim() || e.split("@")[0]]));
  }
  const { rows: [already] } = await db.query(
    "SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, user.id]);
  if (already) throw Object.assign(new Error("این کاربر پیش‌تر عضو پروژه است."), { status: 409, code: "DUPLICATE" });
  await db.query(
    `INSERT INTO project_member (project_id, user_id, role, areas, inspection_party) VALUES ($1,$2,$3,$4,$5)`,
    [projectId, user.id, role, areas, party || null]);
  const { rows: [cred] } = await db.query("SELECT 1 FROM user_credential WHERE user_id = $1", [user.id]);
  const link = cred ? null : await issueToken(db, { userId: user.id, purpose: "setup", byUser });
  return { user, created: !existing, link };
}

/** Change a member's role, areas and inspection party. */
export async function updateMember(db, { projectId, userId, role, areas = [], party = null }) {
  checkMember({ role, areas, party });
  const { rows: [m] } = await db.query("SELECT role FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  if (!m) throw notFound("member");
  if (m.role === "admin" && role !== "admin") await keepAnAdmin(db, projectId);
  const { rows: [row] } = await db.query(
    `UPDATE project_member SET role = $3, areas = $4, inspection_party = $5 WHERE project_id = $1 AND user_id = $2 RETURNING *`,
    [projectId, userId, role, areas, party || null]);
  return row;
}

/** Take someone off a project. The account stays; their other projects are theirs. */
export async function removeMember(db, { projectId, userId }) {
  const { rows: [m] } = await db.query("SELECT role FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  if (!m) throw notFound("member");
  if (m.role === "admin") await keepAnAdmin(db, projectId);
  await db.query("DELETE FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  return { removed: true };
}

/**
 * A one-time link to set a password. For an account with no password
 * (invited, never finished) a project admin may issue it; resetting an
 * existing password is a developer's — the account may be in projects this
 * admin does not run.
 */
export async function issueSetupLink(db, { userId, byUser, byDeveloper = false }) {
  const { rows: [u] } = await db.query(
    `SELECT u.id, u.is_active, (c.user_id IS NOT NULL) AS has_password FROM app_user u
       LEFT JOIN user_credential c ON c.user_id = u.id WHERE u.id = $1`, [userId]);
  if (!u) throw notFound("user");
  if (!u.is_active) throw bad("حساب غیرفعال است؛ اول فعالش کنید.");
  if (u.has_password && !byDeveloper) {
    throw Object.assign(new Error("این حساب رمز دارد؛ بازنشانی رمز حسابی که ممکن است عضو پروژه‌های دیگر هم باشد با توسعه‌دهنده است."),
      { status: 403, code: "FORBIDDEN" });
  }
  return issueToken(db, { userId, purpose: u.has_password ? "reset" : "setup", byUser });
}

/** End every session of an account (a lost phone, a left company). */
export async function endSessions(db, { userId }) {
  const v = await revokeSessions(db, { userId });
  return { revoked: v !== null };
}

/** Developer only: deactivate or reactivate an account. Deactivating ends its sessions. */
export async function setActive(db, { userId, active, byUser }) {
  if (!active && userId === byUser) throw bad("حساب خودتان را غیرفعال نمی‌کنید.");
  const { rows: [u] } = await db.query("UPDATE app_user SET is_active = $2 WHERE id = $1 RETURNING id, is_active", [userId, !!active]);
  if (!u) throw notFound("user");
  if (!active) await revokeSessions(db, { userId });
  return u;
}

/** Developer only: grant or withdraw the developer flag. The last one stays. */
export async function setDeveloper(db, { userId, value }) {
  if (!value) {
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM app_user WHERE is_developer AND is_active AND id <> $1", [userId]);
    if (!n) throw bad("آخرین توسعه‌دهندهٔ فعال حذف نمی‌شود.");
  }
  const { rows: [u] } = await db.query("UPDATE app_user SET is_developer = $2 WHERE id = $1 RETURNING id, is_developer", [userId, !!value]);
  if (!u) throw notFound("user");
  return u;
}

/** What a setup link is for, without using it: the page shows whose account it sets. */
export async function peekSetupToken(db, { token }) {
  const t = await liveToken(db, token);
  return { email: t.email, displayName: t.display_name, purpose: t.purpose, expiresAt: t.expires_at };
}

/** Use a setup link: set the password, and the link is spent. */
export async function consumeSetupToken(db, { token, password }) {
  const t = await liveToken(db, token);
  await setPassword(db, { userId: t.user_id, password });
  await db.query("UPDATE user_setup_token SET used_at = clock_timestamp() WHERE user_id = $1 AND used_at IS NULL", [t.user_id]);
  return { email: t.email };
}

// ── internals ────────────────────────────────────────────────────────────

async function issueToken(db, { userId, purpose, byUser }) {
  // A new link retires any older one still outstanding.
  await db.query("UPDATE user_setup_token SET used_at = clock_timestamp() WHERE user_id = $1 AND used_at IS NULL", [userId]);
  const token = randomBytes(32).toString("base64url");
  const { rows: [r] } = await db.query(
    `INSERT INTO user_setup_token (user_id, token_hash, purpose, created_by, expires_at)
     VALUES ($1,$2,$3,$4, clock_timestamp() + ($5 || ' hours')::interval) RETURNING expires_at`,
    [userId, sha(token), purpose, byUser || null, String(SETUP_HOURS)]);
  return { token, purpose, expiresAt: r.expires_at };
}

async function liveToken(db, token) {
  if (!/^[A-Za-z0-9_-]{30,80}$/.test(String(token || ""))) throw bad("لینک معتبر نیست.");
  const { rows: [t] } = await db.query(
    `SELECT t.*, u.email, u.display_name, u.is_active FROM user_setup_token t JOIN app_user u ON u.id = t.user_id
      WHERE t.token_hash = $1`, [sha(token)]);
  if (!t || t.used_at || new Date(t.expires_at) <= new Date() || !t.is_active) {
    throw Object.assign(new Error("این لینک منقضی شده یا پیش‌تر استفاده شده است؛ لینک تازه بخواهید."), { status: 410, code: "LINK_EXPIRED" });
  }
  return t;
}

function checkMember({ role, areas, party }) {
  if (!ROLES.includes(role)) throw bad(`نقش «${role}» شناخته نشد.`);
  if (!Array.isArray(areas) || areas.some((a) => !AREAS[a])) throw bad("حوزهٔ کاری ناشناخته است.");
  if (party && !PARTIES.includes(party)) throw bad(`طرف بازرسی «${party}» شناخته نشد.`);
}

async function keepAnAdmin(db, projectId) {
  const { rows: [{ n }] } = await db.query(
    "SELECT count(*)::int AS n FROM project_member WHERE project_id = $1 AND role = 'admin'", [projectId]);
  if (n <= 1) throw bad("پروژه بدون مدیر نمی‌ماند؛ اول نفر دیگری را مدیر کنید.");
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
