#!/usr/bin/env node
/**
 * Make an account a developer of the platform: every project, every action.
 *
 *   npm run auth:developer -- someone@example.com ["Display Name"]
 *
 * Creates the account if it does not exist. An account with no password
 * gets a one-time setup link (valid 72 hours) — the password is set by its
 * owner, never typed here. Set APP_URL to print the full link.
 *
 * This is the only way to make the FIRST developer; after that, a developer
 * can grant the flag from the users page. A project admin cannot.
 */
import "./env.mjs";
import { getDb } from "../lib/server/db.mjs";
import { ensureUser } from "../lib/db/repos/projects.mjs";
import { setDeveloper, issueSetupLink } from "../lib/db/repos/users.mjs";

const [email, name] = process.argv.slice(2);
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
  console.error("usage: npm run auth:developer -- <email> [display name]");
  process.exit(1);
}
const db = await getDb();
try {
  const e = email.trim().toLowerCase();
  const { rows: [existing] } = await db.query("SELECT id FROM app_user WHERE lower(email) = $1", [e]);
  const user = existing || await ensureUser(db, { subject: `local|${e}`, email: e, displayName: name || e.split("@")[0] });
  await db.query("UPDATE app_user SET is_active = true WHERE id = $1", [user.id]);
  await setDeveloper(db, { userId: user.id, value: true });
  const { rows: [cred] } = await db.query("SELECT 1 FROM user_credential WHERE user_id = $1", [user.id]);
  console.log(`\nDEVELOPER: ${e} — every project, every action`);
  if (!cred) {
    const link = await issueSetupLink(db, { userId: user.id, byDeveloper: true });
    const path = `/setup?token=${link.token}`;
    console.log(`  set the password (once, within 72 h): ${process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") + path : path}`);
  } else {
    console.log("  the account already has a password; it signs in as before");
  }
  console.log();
} finally {
  await db.close();
}
