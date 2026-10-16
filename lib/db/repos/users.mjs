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
    `SELECT u.id AS user_id, u.email, u.display_name, u.is_active, u.is_developer, u.username, u.job_title, u.specialty, u.phone, u.company_id,
            (SELECT code FROM company co WHERE co.id = u.company_id) AS company_code,
            EXISTS (SELECT 1 FROM user_signature s WHERE s.user_id = u.id) AS has_signature,
            m.role, m.areas, m.tiles, m.inspection_party, m.granted_at,
            (c.user_id IS NOT NULL) AS has_password, c.last_login_at, c.locked_until,
            EXISTS (SELECT 1 FROM user_setup_token t WHERE t.user_id = u.id AND t.used_at IS NULL
                     AND t.expires_at > clock_timestamp()) AS link_pending
       FROM project_member m JOIN app_user u ON u.id = m.user_id
       LEFT JOIN user_credential c ON c.user_id = u.id
      WHERE m.project_id = $1
      ORDER BY (m.role = 'admin') DESC, u.display_name NULLS LAST, u.email`, [projectId]);
  return rows.map((r) => ({ ...r, areas: r.areas || [], tiles: r.tiles || [],
    status: !r.is_active ? "inactive" : r.locked_until && new Date(r.locked_until) > new Date() ? "locked"
      : r.has_password ? "active" : r.link_pending ? "invited" : "no_password" }));
}

/**
 * A member's profile (owner's spec, step 3): username to sign in with,
 * display name, job title, field of expertise, phone, the company they work
 * for. The email stays as it is — it is the account's identity everywhere.
 */
export async function updateProfile(db, { userId, username = null, displayName = null, jobTitle = null, specialty = null, phone = null, companyId = null }) {
  const u = String(username ?? "").trim().toLowerCase() || null;
  if (u && !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(u)) throw bad("نام کاربری: ۳ تا ۳۲ نویسهٔ لاتین کوچک، رقم، نقطه، خط تیره یا زیرخط.");
  if (u) {
    const { rows: [taken] } = await db.query("SELECT 1 FROM app_user WHERE username = $1 AND id <> $2", [u, userId]);
    if (taken) throw bad(`نام کاربری «${u}» گرفته شده است.`);
    const { rows: [asEmail] } = await db.query("SELECT 1 FROM app_user WHERE lower(email) = $1 AND id <> $2", [u, userId]);
    if (asEmail) throw bad("نام کاربری نمی‌تواند ایمیل کاربر دیگری باشد.");
  }
  if (companyId) {
    const { rows: [c] } = await db.query("SELECT 1 FROM company WHERE id = $1", [companyId]);
    if (!c) throw bad("شرکت را از فهرست شرکت‌ها انتخاب کنید.");
  }
  const t = (v) => String(v ?? "").trim() || null;
  const { rows: [row] } = await db.query(
    `UPDATE app_user SET username = $2, display_name = COALESCE($3, display_name), job_title = $4, specialty = $5, phone = $6, company_id = $7
      WHERE id = $1 RETURNING id, email, username, display_name, job_title, specialty, phone, company_id`,
    [userId, u, t(displayName), t(jobTitle), t(specialty), t(phone), companyId || null]);
  if (!row) throw notFound("user");
  return row;
}

export const CONTRACT_ACCESS = { view: "مشاهده", edit: "ثبت و ویرایش", manage: "مدیریت قرارداد" };

/** Assign a project member to a contract, with their position there and an access level. */
export async function setContractMember(db, { projectId, contractId, userId, position, access }) {
  if (!CONTRACT_ACCESS[access]) throw bad("سطح دسترسی را انتخاب کنید.");
  if (!String(position || "").trim()) throw bad("سمت کاربر در قرارداد لازم است.");
  const { rows: [m] } = await db.query("SELECT 1 FROM project_member WHERE project_id = $1 AND user_id = $2", [projectId, userId]);
  if (!m) throw bad("این کاربر عضو پروژه نیست.");
  const { rows: [c] } = await db.query("SELECT 1 FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) throw notFound("contract");
  // Only people of the contract's stakeholder companies (owner's review, item 5).
  const { rows: [u] } = await db.query(
    `SELECT u.company_id, co.name AS company, EXISTS (SELECT 1 FROM contract_stakeholder s WHERE s.contract_id = $2 AND s.company_id = u.company_id) AS stakeholder
       FROM app_user u LEFT JOIN company co ON co.id = u.company_id WHERE u.id = $1`, [userId, contractId]);
  if (!u?.company_id) throw bad("شرکت شاغل این کاربر تعیین نشده است (کاربران ◄ ویرایش ◄ مشخصات کاربر).");
  if (!u.stakeholder) throw bad(`شرکت این کاربر («${u.company}») در ذی‌نفعان این قرارداد نیست؛ اول آن را در «تعریف قرارداد ◄ ذی‌نفعان» اضافه کنید.`);
  const { rows: [r] } = await db.query(
    `INSERT INTO contract_member (project_id, contract_id, user_id, position, access) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (contract_id, user_id) DO UPDATE SET position = EXCLUDED.position, access = EXCLUDED.access RETURNING *`,
    [projectId, contractId, userId, String(position).trim(), access]);
  return r;
}

/** Project roles that stand over every contract of the project, as its manager. */
export const CONTRACT_MANAGER_ROLES = ["admin", "developer", "contracts"];

/**
 * What `userId` may do in a contract: 'manage' | 'edit' | 'view', or null
 * (not assigned). A project manager role manages every contract; anyone else
 * reaches a contract only through their assignment to it. Call inside
 * `withProject`.
 */
export async function contractAccess(db, { projectId, contractId, userId, role }) {
  const { rows: [c] } = await db.query("SELECT 1 FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) return null;
  if (CONTRACT_MANAGER_ROLES.includes(role)) return "manage";
  const { rows: [m] } = await db.query("SELECT access FROM contract_member WHERE contract_id = $1 AND user_id = $2", [contractId, userId]);
  return m?.access || null;
}

/** The contracts `userId` sees in a project (the top bar's list), each with their access. Call inside `withProject`. */
export async function visibleContracts(db, { projectId, userId, role }) {
  const all = CONTRACT_MANAGER_ROLES.includes(role);
  const { rows } = await db.query(
    `SELECT c.id, c.contract_no, c.title, ${all ? "'manage'" : "m.access"} AS access
       FROM contract c ${all ? "" : "JOIN contract_member m ON m.contract_id = c.id AND m.user_id = $2"}
      WHERE c.project_id = $1 ORDER BY c.contract_no`, all ? [projectId] : [projectId, userId]);
  return rows;
}

/** Refuse unless the user's access to the contract reaches `need` (view < edit < manage). */
export async function assertContractAccess(db, { projectId, contractId, userId, role, need = "view" }) {
  const rank = { view: 1, edit: 2, manage: 3 };
  const have = await contractAccess(db, { projectId, contractId, userId, role });
  if (!have) throw Object.assign(new Error("contract not found"), { status: 404 });
  if (rank[have] < rank[need]) {
    throw Object.assign(new Error(`دسترسی شما در این قرارداد «${CONTRACT_ACCESS[have]}» است؛ این کار «${CONTRACT_ACCESS[need]}» می‌خواهد.`), { status: 403, code: "FORBIDDEN" });
  }
  return have;
}

export async function removeContractMember(db, { projectId, id }) {
  await db.query("DELETE FROM contract_member WHERE id = $1 AND project_id = $2", [id, projectId]);
}

export async function contractMembers(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT m.*, c.contract_no, c.title AS contract_title, u.display_name, u.email FROM contract_member m
       JOIN contract c ON c.id = m.contract_id JOIN app_user u ON u.id = m.user_id
      WHERE m.project_id = $1 ORDER BY c.contract_no, u.display_name`, [projectId]);
  return rows;
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

/**
 * The tiles a member is given (lib/platform/tiles.mjs). None: their role
 * decides, as before. Some: they see and reach only those. Unknown pages
 * are refused rather than stored, so a typo cannot read as a grant.
 */
export async function setMemberTiles(db, { projectId, userId, tiles = [], cleanTiles, forms = [] }) {
  const { tiles: ok, unknown } = cleanTiles(tiles, forms);
  if (unknown.length) throw bad(`تایل ناشناخته: ${unknown.join("، ")}`);
  const { rows: [m] } = await db.query(
    "UPDATE project_member SET tiles = $3 WHERE project_id = $1 AND user_id = $2 RETURNING user_id, role, tiles", [projectId, userId, ok]);
  if (!m) throw notFound("member");
  return m;
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
 * (invited, never finished) a project admin may issue it. Resetting an
 * existing password is a developer's — unless every project the account is
 * in is one this admin runs: then no project they do not run is reached
 * through it. A developer's account is reset only by a developer.
 * Issuing a link answers the account's open "forgot password" request.
 */
export async function issueSetupLink(db, { userId, byUser, byDeveloper = false }) {
  const { rows: [u] } = await db.query(
    `SELECT u.id, u.is_active, u.is_developer, (c.user_id IS NOT NULL) AS has_password FROM app_user u
       LEFT JOIN user_credential c ON c.user_id = u.id WHERE u.id = $1`, [userId]);
  if (!u) throw notFound("user");
  if (!u.is_active) throw bad("حساب غیرفعال است؛ اول فعالش کنید.");
  // A developer stands in every project: a link to their account is a developer's to give, password or not.
  if (u.is_developer && !byDeveloper) {
    throw Object.assign(new Error("حساب توسعه‌دهنده فقط توسط توسعه‌دهنده بازنشانی می‌شود."), { status: 403, code: "FORBIDDEN" });
  }
  if (u.has_password && !byDeveloper && !(await adminOfAll(db, { userId, byUser }))) {
    throw Object.assign(new Error("این حساب در پروژه‌ای هم عضو است که شما مدیرش نیستید؛ بازنشانی رمز آن با توسعه‌دهنده است."),
      { status: 403, code: "FORBIDDEN" });
  }
  const link = await issueToken(db, { userId, purpose: u.has_password ? "reset" : "setup", byUser });
  await db.query(
    "UPDATE password_reset_request SET resolved_at = clock_timestamp(), resolved_by = $2, outcome = 'link' WHERE user_id = $1 AND resolved_at IS NULL",
    [userId, byUser || null]);
  return link;
}

/** Is `byUser` the admin of every project `userId` is in (and `userId` not a developer)? */
async function adminOfAll(db, { userId, byUser }) {
  const { rows: [r] } = await db.query(
    `SELECT u.is_developer,
            count(m.project_id)::int AS projects,
            count(a.project_id)::int AS mine
       FROM app_user u
       LEFT JOIN project_member m ON m.user_id = u.id
       LEFT JOIN project_member a ON a.project_id = m.project_id AND a.user_id = $2 AND a.role = 'admin'
      WHERE u.id = $1 GROUP BY u.is_developer`, [userId, byUser]);
  return !!r && !r.is_developer && r.projects > 0 && r.projects === r.mine;
}

/**
 * The open "forgot password" requests an administrator sees: members of this
 * project (a developer sees every one), each saying whether this person may
 * answer it with a link.
 */
export async function resetRequests(db, { projectId, byUser, byDeveloper = false }) {
  const { rows } = await db.query(
    `SELECT r.id, r.user_id, r.requested_at, u.display_name, u.email, u.username
       FROM password_reset_request r JOIN app_user u ON u.id = r.user_id
      WHERE r.resolved_at IS NULL
        AND ($2 OR EXISTS (SELECT 1 FROM project_member m WHERE m.project_id = $1 AND m.user_id = r.user_id))
      ORDER BY r.requested_at`, [projectId, !!byDeveloper]);
  const out = [];
  for (const r of rows) out.push({ ...r, mayIssue: byDeveloper || (await adminOfAll(db, { userId: r.user_id, byUser })) });
  return out;
}

export async function dismissResetRequest(db, { id, byUser }) {
  const { rows: [r] } = await db.query(
    "UPDATE password_reset_request SET resolved_at = clock_timestamp(), resolved_by = $2, outcome = 'dismissed' WHERE id = $1 AND resolved_at IS NULL RETURNING id",
    [id, byUser]);
  if (!r) throw notFound("request");
  return r;
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
