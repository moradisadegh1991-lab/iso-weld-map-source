#!/usr/bin/env node
/**
 * Authentication.
 *
 * This is the layer that decides whether the platform can be put behind a
 * public URL, so the tests are written as an attacker would read them: what
 * does a wrong answer reveal, and what happens when someone keeps trying.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hashPassword, verifyPassword, needsRehash, passwordProblem,
} from "../../lib/auth/password.mjs";
import {
  issue, verify, sign, sessionSecret, cookieHeader, clearCookieHeader,
  readCookie, isLocal, COOKIE_NAME,
} from "../../lib/auth/cookie.mjs";

// ── hashing ──────────────────────────────────────────────────────────────

test("a password verifies against its own hash and nothing else", async () => {
  const h = await hashPassword("correct-horse-battery");
  equal(await verifyPassword("correct-horse-battery", h), true);
  equal(await verifyPassword("correct-horse-batterX", h), false);
  equal(await verifyPassword("", h), false);
});

test("the same password hashes differently every time", async () => {
  // Without a per-password salt, identical passwords are visible as
  // identical hashes, and one cracked row cracks every account that shares it.
  const a = await hashPassword("correct-horse-battery");
  const b = await hashPassword("correct-horse-battery");
  assert(a !== b, "two hashes of one password must differ");
  equal(await verifyPassword("correct-horse-battery", b), true);
});

test("the hash carries the parameters it was made under", async () => {
  // So they can be raised later without invalidating everyone's password.
  const h = await hashPassword("correct-horse-battery", { N: 1024, r: 8, p: 1, keyLen: 32 });
  assert(h.startsWith("scrypt$1024$8$1$"));
  equal(await verifyPassword("correct-horse-battery", h), true,
    "an old hash still verifies after the cost is raised");
  equal(needsRehash(h), true, "and is marked for replacement");
  equal(needsRehash(await hashPassword("correct-horse-battery")), false);
});

test("a corrupt hash fails the login rather than the endpoint", async () => {
  // A throw here would be a 500 that tells an attacker the account exists.
  for (const bad of ["", "not-a-hash", "scrypt$x$y$z$q$r", "bcrypt$1$2$3$4$5", null, 42]) {
    equal(await verifyPassword("anything", bad), false, `${bad} must return false`);
  }
});

test("password rules ask for length, not for four character classes", async () => {
  equal(passwordProblem("short"), "رمز عبور باید دست‌کم ۱۰ نویسه باشد.");
  equal(passwordProblem("a-perfectly-fine-passphrase"), null);
  assert(passwordProblem("x".repeat(400)), "and an absurd length is refused too");

  // Every entry in the common list must be long enough to actually reach
  // that check — a shorter one is refused for its length and the list entry
  // is dead code.
  for (const common of ["1234567890", "qwertyuiop", "PASSWORD123", "welcome123"]) {
    assert(/رایج/.test(passwordProblem(common)),
      `"${common}" is tried first by every attacker and must be refused as common`);
  }
});

// ── the session cookie ───────────────────────────────────────────────────

const SECRET = "x".repeat(40);

test("a session verifies, and a tampered one does not", async () => {
  const t = issue({ sub: "user-1" }, SECRET);
  equal(verify(t, SECRET).sub, "user-1");
  // A character that is not the one there: "A" alone left about one token in
  // sixteen unchanged (a 32-byte MAC's last base64url character is one of 16).
  equal(verify(t.slice(0, -1) + (t.at(-1) === "A" ? "E" : "A"), SECRET), null, "a changed signature is rejected");
  equal(verify(t, "y".repeat(40)), null, "and so is another server's secret");
});

test("a payload cannot be edited without the secret", async () => {
  // The attack this exists to stop: swap the user id for an admin's.
  const t = issue({ sub: "user-1" }, SECRET);
  const forged = Buffer.from(JSON.stringify({
    sub: "admin", exp: Math.floor(Date.now() / 1000) + 999 })).toString("base64url")
    + "." + t.split(".").pop();
  equal(verify(forged, SECRET), null);
});

test("an expired session is refused", async () => {
  const t = issue({ sub: "user-1" }, SECRET, Date.now());
  equal(verify(t, SECRET, Date.now() + 9 * 60 * 60 * 1000), null, "eight hours is a shift");
  assert(verify(t, SECRET, Date.now() + 7 * 60 * 60 * 1000), "and it lasts that long");
});

test("a session with no subject or no expiry is refused", async () => {
  equal(verify(sign({ exp: 9e9 }, SECRET), SECRET), null, "no subject");
  equal(verify(sign({ sub: "u" }, SECRET), SECRET), null, "no expiry");
  equal(verify(sign({ sub: "u", exp: "later" }, SECRET), SECRET), null, "a non-numeric expiry");
  equal(verify("garbage", SECRET), null);
  equal(verify(null, SECRET), null);
});

test("production refuses to start without a real secret", async () => {
  // A hard-coded default would put one secret, in a public repository, on
  // every deployment — and anyone could mint a session for any user.
  const e = throwsSync(() => sessionSecret({ NODE_ENV: "production" }));
  equal(e.code, "NO_SESSION_SECRET");
  equal(throwsSync(() => sessionSecret({ NODE_ENV: "production", SESSION_SECRET: "short" })).code,
    "NO_SESSION_SECRET");
  equal(sessionSecret({ NODE_ENV: "production", SESSION_SECRET: SECRET }), SECRET);
  assert(sessionSecret({}), "and development still works, with a per-process secret");
});

test("the cookie is HttpOnly, SameSite and Secure off localhost", async () => {
  const h = cookieHeader("tok");
  for (const bit of ["HttpOnly", "SameSite=Lax", "Secure", "Path=/"]) {
    assert(h.includes(bit), `the cookie must set ${bit}`);
  }
  assert(!cookieHeader("tok", { secure: false }).includes("Secure"),
    "except on plain-http localhost, where Secure would break login entirely");
  assert(clearCookieHeader().includes("Max-Age=0"));
});

test("localhost is recognised, and a public host is not", async () => {
  const req = (url) => ({ url, headers: { get: () => "" } });
  equal(isLocal(req("http://localhost:3000/x")), true);
  equal(isLocal(req("http://127.0.0.1:3000/x")), true);
  equal(isLocal(req("https://epc.example.com/x")), false);
  equal(isLocal(req("http://epc.example.com/x")), false,
    "a public host over plain http must still get Secure, even though it breaks — "
    + "silently dropping it would ship a readable session cookie");
});

test("the cookie is found among others and ignored when absent", async () => {
  const req = (c) => ({ url: "http://localhost/", headers: { get: () => c } });
  equal(readCookie(req(`a=1; ${COOKIE_NAME}=tok.en; b=2`)), "tok.en");
  equal(readCookie(req("a=1; b=2")), null);
  equal(readCookie(req("")), null);
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "auth-db-"));

const { getDb } = await import("../../lib/server/db.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const creds = await import("../../lib/db/repos/credentials.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, {
  subject: "local|alice", email: "alice@kavian.ir", displayName: "Alice" });

test("a correct password signs in", async () => {
  await creds.setPassword(db, { userId: alice.id, password: "a-perfectly-fine-passphrase" });
  const u = await creds.authenticatePassword(db, {
    email: "alice@kavian.ir", password: "a-perfectly-fine-passphrase" });
  equal(u.id, alice.id);
  equal(u.displayName, "Alice");
});

test("the email is matched without regard to case or stray spaces", async () => {
  const u = await creds.authenticatePassword(db, {
    email: "  ALICE@Kavian.IR  ", password: "a-perfectly-fine-passphrase" });
  equal(u.id, alice.id, "nobody types their own address the same way twice");
});

test("an unknown email and a wrong password give the SAME error", async () => {
  // Telling them apart reveals which addresses are real, which is most of
  // the work of getting in.
  const wrong = await throws(() => creds.authenticatePassword(db, {
    email: "alice@kavian.ir", password: "not-the-password" }));
  const unknown = await throws(() => creds.authenticatePassword(db, {
    email: "nobody@kavian.ir", password: "not-the-password" }));
  equal(wrong.message, unknown.message);
  equal(wrong.code, unknown.code);
  equal(wrong.status, 401);
});

test("a user with no password set cannot be signed in as", async () => {
  const bob = await projects.ensureUser(db, { subject: "local|bob", email: "bob@kavian.ir" });
  assert(bob.id);
  const e = await throws(() => creds.authenticatePassword(db, {
    email: "bob@kavian.ir", password: "anything-at-all-here" }));
  equal(e.code, "BAD_CREDENTIALS", "and it reads the same as every other failure");
});

test("a weak password is refused when it is set, not when it is used", async () => {
  const e = await throws(() => creds.setPassword(db, { userId: alice.id, password: "short" }));
  equal(e.code, "WEAK_PASSWORD");
  equal(e.status, 400);
});

test("repeated failures lock the account, and the lock is in the database", async () => {
  // The app runs as several instances behind Vercel. A counter in one
  // process is not a lockout — an attacker just gets a different instance.
  const carol = await projects.ensureUser(db, { subject: "local|carol", email: "carol@kavian.ir" });
  await creds.setPassword(db, { userId: carol.id, password: "another-fine-passphrase" });

  for (let i = 0; i < creds.MAX_FAILURES; i++) {
    await throws(() => creds.authenticatePassword(db, {
      email: "carol@kavian.ir", password: "wrong-one-here" }));
  }
  const locked = await throws(() => creds.authenticatePassword(db, {
    email: "carol@kavian.ir", password: "another-fine-passphrase" }));
  equal(locked.code, "ACCOUNT_LOCKED", "even the CORRECT password is refused while locked");
  equal(locked.status, 429);

  const { rows } = await db.query(
    "SELECT locked_until FROM user_credential WHERE user_id = $1", [carol.id]);
  assert(rows[0].locked_until, "and the lock outlives this process");
});

test("a successful sign-in clears the failure count", async () => {
  await throws(() => creds.authenticatePassword(db, {
    email: "alice@kavian.ir", password: "wrong-one-here" }));
  await creds.authenticatePassword(db, {
    email: "alice@kavian.ir", password: "a-perfectly-fine-passphrase" });
  const { rows } = await db.query(
    "SELECT failed_count, last_login_at FROM user_credential WHERE user_id = $1", [alice.id]);
  equal(rows[0].failed_count, 0, "otherwise a busy typist locks themselves out next week");
  assert(rows[0].last_login_at);
});

test("setting a new password unlocks the account", async () => {
  const { rows: [carol] } = await db.query(
    "SELECT id FROM app_user WHERE email = 'carol@kavian.ir'");
  await creds.setPassword(db, { userId: carol.id, password: "a-brand-new-passphrase" });
  const u = await creds.authenticatePassword(db, {
    email: "carol@kavian.ir", password: "a-brand-new-passphrase" });
  equal(u.id, carol.id, "a reset is how a locked-out person gets back in");
});

// ── the request path ─────────────────────────────────────────────────────

const { authenticate } = await import("../../lib/server/session.mjs");

/** A minimal Request-alike: authenticate only reads url and two headers. */
const req = (headers = {}) => ({
  url: "http://localhost:3000/api/x",
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
});

test("a valid session cookie identifies the caller", async () => {
  const token = issue({ sub: alice.id }, sessionSecret());
  const { user, authMode } = await authenticate(req({ cookie: `${COOKIE_NAME}=${token}` }));
  equal(user.id, alice.id);
  equal(authMode, "session");
});

test("an INVALID cookie is refused and does not fall through to the dev header", async () => {
  // The attack this stops: AUTH_MODE=dev is on, so the header path accepts
  // any subject anyone types. If an expired or forged cookie fell through to
  // it, every rejected session would become an open door — and it would look
  // like it was working, which is the worst kind of authentication bug.
  const forged = issue({ sub: alice.id }, "z".repeat(40));   // signed with the wrong secret
  const e = await throws(() => authenticate(req({
    cookie: `${COOKIE_NAME}=${forged}`,
    authorization: "Bearer local|alice",
  })));
  equal(e.code, "SESSION_EXPIRED");
  equal(e.status, 401);
});

test("a cookie for a deleted account is refused", async () => {
  const token = issue({ sub: "00000000-0000-0000-0000-000000000000" }, sessionSecret());
  const e = await throws(() => authenticate(req({ cookie: `${COOKIE_NAME}=${token}` })));
  equal(e.code, "UNAUTHENTICATED");
});

test("with no cookie at all, the dev header still works on a laptop", async () => {
  // AUTH_MODE=dev is set at the top of this file. This is the path that must
  // keep working locally, and the one that must never be reachable when a
  // cookie was presented.
  const { user, authMode } = await authenticate(req({ authorization: "Bearer local|alice" }));
  equal(user.subject, "local|alice");
  equal(authMode, "dev");
});

// ── revocation, spraying, and what an error says ────────────────────────

test("a new password ends every session issued before it", async () => {
  const dave = await projects.ensureUser(db, { subject: "local|dave", email: "dave@kavian.ir" });
  await creds.setPassword(db, { userId: dave.id, password: "dave-first-passphrase" });
  const u = await creds.authenticatePassword(db, { email: "dave@kavian.ir", password: "dave-first-passphrase" });
  const before = issue({ sub: dave.id, v: u.sessionVersion }, sessionSecret());
  equal((await authenticate(req({ cookie: `${COOKIE_NAME}=${before}` }))).user.id, dave.id);
  await creds.setPassword(db, { userId: dave.id, password: "dave-second-passphrase" });
  const e = await throws(() => authenticate(req({ cookie: `${COOKIE_NAME}=${before}` })));
  equal([e.code, e.status], ["SESSION_EXPIRED", 401], "the stolen cookie dies with the old password");
  const u2 = await creds.authenticatePassword(db, { email: "dave@kavian.ir", password: "dave-second-passphrase" });
  const after = issue({ sub: dave.id, v: u2.sessionVersion }, sessionSecret());
  equal((await authenticate(req({ cookie: `${COOKIE_NAME}=${after}` }))).user.id, dave.id);
});

test("sign out everywhere revokes every cookie, and a forged version does not help", async () => {
  const { rows: [dave] } = await db.query("SELECT id FROM app_user WHERE email = 'dave@kavian.ir'");
  const v = await creds.currentSessionVersion(db, { userId: dave.id });
  const token = issue({ sub: dave.id, v }, sessionSecret());
  await creds.revokeSessions(db, { userId: dave.id });
  equal((await throws(() => authenticate(req({ cookie: `${COOKIE_NAME}=${token}` })))).code, "SESSION_EXPIRED");
  const ahead = issue({ sub: dave.id, v: v + 5 }, sessionSecret());
  equal((await throws(() => authenticate(req({ cookie: `${COOKIE_NAME}=${ahead}` })))).code, "SESSION_EXPIRED",
    "a version from the future is not the current one either");
});

test("a cookie for an account whose password was removed is refused", async () => {
  const erin = await projects.ensureUser(db, { subject: "local|erin", email: "erin@kavian.ir" });
  await creds.setPassword(db, { userId: erin.id, password: "erin-fine-passphrase" });
  const token = issue({ sub: erin.id, v: 0 }, sessionSecret());
  await db.query("DELETE FROM user_credential WHERE user_id = $1", [erin.id]);
  equal((await throws(() => authenticate(req({ cookie: `${COOKIE_NAME}=${token}` })))).code, "SESSION_EXPIRED");
});

test("spraying one password across many accounts is stopped per source, not per account", async () => {
  const src = "203.0.113.7";
  for (let i = 0; i < creds.SOURCE_MAX_FAILURES; i++) {
    const e = await throws(() => creds.authenticatePassword(db, {
      email: `user${i}@kavian.ir`, password: "Summer2026!!", source: src }));
    equal(e.code, "BAD_CREDENTIALS", "each account on its own is nowhere near its lockout");
  }
  const blocked = await throws(() => creds.authenticatePassword(db, {
    email: "alice@kavian.ir", password: "a-perfectly-fine-passphrase", source: src }));
  equal([blocked.code, blocked.status], ["TOO_MANY_ATTEMPTS", 429], "even a correct password, from that source");
  const other = await creds.authenticatePassword(db, {
    email: "alice@kavian.ir", password: "a-perfectly-fine-passphrase", source: "198.51.100.9" });
  equal(other.id, alice.id, "another source is not punished");
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM login_failure WHERE source = $1", [src]);
  equal(n, creds.SOURCE_MAX_FAILURES, "a refused attempt is not counted again");
});

test("the source is the first forwarded address", async () => {
  equal(creds.loginSource(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
  equal(creds.loginSource(req({ "x-real-ip": "198.51.100.9" })), "198.51.100.9");
  equal(creds.loginSource(req({})), "direct");
});

test("an unexpected error says only that it failed; a database refusal says which rule", async () => {
  const { errorResponse } = await import("../../lib/server/session.mjs");
  const err = console.error; console.error = () => {};
  try {
    const r = errorResponse(new Error('relation "user_credential" column password_hash does not exist'));
    const b = await r.json();
    equal(r.status, 500);
    assert(!/user_credential|password_hash/.test(b.error), "no table or column names");
    equal([b.code, /^[0-9a-f]{8}$/.test(b.ref)], ["INTERNAL", true]);
  } finally { console.error = err; }
  const dup = errorResponse(Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505", constraint: "punch_item_project_id_punch_no_key" }));
  equal([dup.status, (await dup.json()).code], [409, "DUPLICATE"]);
  const chk = errorResponse(Object.assign(new Error("new row violates check constraint"), { code: "23514", constraint: "ncr_closed_with_cause" }));
  const cb = await chk.json();
  equal([chk.status, cb.code, cb.error.includes("ncr_closed_with_cause")], [400, "RULE", true]);
  const mine = errorResponse(Object.assign(new Error("کد و عنوان لازم است."), { status: 400, code: "INVALID_INPUT" }));
  equal((await mine.json()).error, "کد و عنوان لازم است.", "the platform's own refusals pass through unchanged");
});

/** throws(), for something synchronous. */
function throwsSync(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error("expected this to be refused, and it was allowed");
}

await run();
