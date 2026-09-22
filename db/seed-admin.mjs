#!/usr/bin/env node
/**
 * Create the first account, so a fresh deployment can be signed into.
 *
 *   npm run auth:admin -- admin@example.com 'a-good-passphrase' 'Name'
 *
 * There is deliberately NO default password and no "admin/admin" fallback:
 * a seeded default on a platform that is about to be reachable over the
 * internet is the same as no password at all. If the password is omitted,
 * one is generated and printed once.
 */
import "../tools/env.mjs";
import { randomBytes } from "node:crypto";
import { getDb } from "../lib/server/db.mjs";
import { ensureUser, createProject, addMember, listProjectsForUser } from "../lib/db/repos/projects.mjs";
import { setPassword } from "../lib/db/repos/credentials.mjs";

const [email, given, name] = process.argv.slice(2);
if (!email || !email.includes("@")) {
  console.error("usage: npm run auth:admin -- <email> [password] [display name]");
  process.exit(1);
}

const password = given || randomBytes(12).toString("base64url");
const db = await getDb();
try {
  const user = await ensureUser(db, {
    subject: `local|${email.toLowerCase()}`, email, displayName: name || email.split("@")[0] });
  await setPassword(db, { userId: user.id, password });

  // A user with no project sees an empty shell and cannot tell whether that
  // is a permissions problem or an empty database, so the first account gets
  // a project to stand in.
  let projects = await listProjectsForUser(db, user.id);
  if (!projects.length) {
    const p = await createProject(db, { code: "DEMO", name: "پروژهٔ نمونه", ownerUserId: user.id });
    await addMember(db, { projectId: p.id, userId: user.id, role: "admin" });
    projects = await listProjectsForUser(db, user.id);
  }

  console.log("\nACCOUNT READY");
  console.log("  email    :", email);
  if (!given) console.log("  password :", password, " <- shown once, not stored anywhere else");
  console.log("  projects :", projects.map((p) => `${p.code} (${p.role})`).join(", "));
  console.log();
} finally {
  await db.close();
}
