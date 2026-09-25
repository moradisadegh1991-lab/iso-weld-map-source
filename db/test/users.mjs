#!/usr/bin/env node
/**
 * Users: a developer stands in every project; a member's areas decide their
 * menu and where they may write; an admin manages their own project's people
 * without reaching accounts through it; a password is set only by its owner,
 * through a one-time link kept as a hash.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { inArea, areaForPath, areaForOp, AREAS } from "../../lib/platform/areas.mjs";
import { navigationFor } from "../../lib/platform/navigation.mjs";

test("a developer holds every action; an area limits a member, never an admin", async () => {
  assert(Object.values(ACTIONS).every((a) => can({ role: "developer" }, a)));
  assert(!can({ role: "qc" }, ACTIONS.MANAGE_MEMBERS));
  const piping = { role: "engineer", areas: ["piping"] };
  equal([inArea(piping, "piping"), inArea(piping, "civil"), inArea(piping, null)], [true, false, true]);
  equal([inArea({ role: "engineer", areas: [] }, "civil"), inArea({ role: "admin", areas: ["piping"] }, "civil"),
    inArea({ role: "developer" }, "hse"), inArea(null, "civil")], [true, true, true, false]);
});

test("routes and site operations name their area", async () => {
  equal([areaForPath("/api/civil"), areaForPath("/api/piping-classes"), areaForPath("/api/documents/upload-url"),
    areaForPath("/api/inspection"), areaForPath("/api/precom"), areaForPath("/api/doc-control"), areaForPath("/api/project"),
    areaForPath("/api/civilx"), areaForPath("/api/field")],
    ["civil", "piping", "piping", "quality", "completions", "documents", null, null, null]);
  equal([areaForOp("spool_step"), areaForOp("cable_ir"), areaForOp("loop_check"), areaForOp("punch_photo"),
    areaForOp("tag_step", { tagKind: "foundation" }), areaForOp("tag_step", { tagKind: "structure" }), areaForOp("tag_step", { tagKind: "rotating" })],
    ["piping", "electrical", "instrumentation", "quality", "civil", "structural", "equipment"]);
});

test("the menu is the member's areas, plus what is common", async () => {
  const hrefs = (m) => navigationFor(m, can).flatMap((g) => g.items.map((i) => i.href));
  const civil = hrefs({ role: "engineer", areas: ["civil"] });
  assert(civil.includes("/civil") && civil.includes("/") && civil.includes("/field") && civil.includes("/asset"), civil.join(" "));
  assert(!civil.includes("/piping") && !civil.includes("/hse") && !civil.includes("/admin"), civil.join(" "));
  const all = hrefs({ role: "engineer", areas: [] });
  assert(all.includes("/hse") && all.includes("/piping"));
  assert(hrefs({ role: "developer" }).includes("/admin"));
  equal(new Set(navigationFor({ role: "developer" }, can).flatMap((g) => g.items.map((i) => i.area)).filter(Boolean)).size,
    Object.keys(AREAS).length, "every area has a page in the menu");
});

// ── against the database ─────────────────────────────────────────────────

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await mkdtemp(path.join(tmpdir(), "usr-db-"));
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const users = await import("../../lib/db/repos/users.mjs");
const creds = await import("../../lib/db/repos/credentials.mjs");
const { authenticate } = await import("../../lib/server/session.mjs");
const fld = await import("../../lib/db/repos/field.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");

const db = await getDb();
const admin = await projects.ensureUser(db, { subject: "kc|admin", email: "admin@x.ir" });
const dev = await projects.ensureUser(db, { subject: "kc|dev", email: "dev@x.ir" });
await db.query("UPDATE app_user SET is_developer = true WHERE id = $1", [dev.id]);
const pA = await projects.createProject(db, { code: "UA", name: "A", ownerUserId: admin.id });
const pB = await projects.createProject(db, { code: "UB", name: "B", ownerUserId: dev.id });
const inA = (fn) => withProject(db, pA.id, fn);
let invited, link;

test("a developer stands in every project; a deactivated account in none", async () => {
  equal((await projects.membershipOf(db, { projectId: pA.id, userId: dev.id })).role, "developer", "not a member of A, still in it");
  equal((await projects.listProjectsForUser(db, dev.id)).map((p) => [p.code, p.role]), [["UA", "developer"], ["UB", "developer"]]);
  equal((await projects.listProjectsForUser(db, admin.id)).map((p) => p.code), ["UA"]);
  equal(await projects.membershipOf(db, { projectId: pB.id, userId: admin.id }), null);
});

test("an invitation makes the account, adds the member, and hands out a one-time link — never a password", async () => {
  await inA(async () => {
    await throws(async () => users.inviteUser(db, { projectId: pA.id, email: "not-an-email", role: "qc", byUser: admin.id }), "ایمیل");
    await throws(async () => users.inviteUser(db, { projectId: pA.id, email: "x@y.ir", role: "boss", byUser: admin.id }), "نقش");
    await throws(async () => users.inviteUser(db, { projectId: pA.id, email: "x@y.ir", role: "qc", areas: ["piping", "space"], byUser: admin.id }), "حوزه");
    const r = await users.inviteUser(db, { projectId: pA.id, email: "Civil.Sup@Site.ir", displayName: "Civil supervisor",
      role: "engineer", areas: ["civil"], party: "contractor", byUser: admin.id });
    invited = r.user; link = r.link;
    equal([r.created, invited.email, link.purpose], [true, "civil.sup@site.ir", "setup"]);
    assert(/^[A-Za-z0-9_-]{40,}$/.test(link.token));
    const { rows: [t] } = await db.query("SELECT token_hash FROM user_setup_token WHERE user_id = $1", [invited.id]);
    assert(t.token_hash !== link.token && t.token_hash.length === 64, "kept as a hash, never as the token");
    await throws(async () => users.inviteUser(db, { projectId: pA.id, email: "civil.sup@site.ir", role: "qc", byUser: admin.id }), "پیش‌تر عضو");
    const list = await users.listProjectUsers(db, { projectId: pA.id });
    equal(list.find((u) => u.user_id === invited.id).status, "invited");
  });
});

test("the link sets the password once, and a newer link retires an older one", async () => {
  equal((await users.peekSetupToken(db, { token: link.token })).email, "civil.sup@site.ir");
  const second = await inA(() => users.issueSetupLink(db, { userId: invited.id, byUser: admin.id }));
  await throws(async () => users.consumeSetupToken(db, { token: link.token, password: "a long enough passphrase" }), "منقضی");
  await throws(async () => users.consumeSetupToken(db, { token: second.token, password: "short" }));
  await users.consumeSetupToken(db, { token: second.token, password: "a long enough passphrase" });
  await throws(async () => users.consumeSetupToken(db, { token: second.token, password: "another long passphrase" }), "منقضی");
  const who = await creds.authenticatePassword(db, { email: "civil.sup@site.ir", password: "a long enough passphrase" });
  equal(who.id, invited.id);
  await throws(async () => users.peekSetupToken(db, { token: "x" }), "معتبر نیست");
  const stale = await inA(() => users.issueSetupLink(db, { userId: invited.id, byUser: dev.id, byDeveloper: true }));
  await db.query("UPDATE user_setup_token SET expires_at = now() - interval '1 minute' WHERE used_at IS NULL");
  await throws(async () => users.peekSetupToken(db, { token: stale.token }), "منقضی", "expired");
});

test("resetting a password that exists is a developer's; an admin reaches nobody through their project", async () => {
  await inA(async () => {
    await throws(async () => users.issueSetupLink(db, { userId: invited.id, byUser: admin.id }), "توسعه‌دهنده");
    const r = await users.issueSetupLink(db, { userId: invited.id, byUser: dev.id, byDeveloper: true });
    equal(r.purpose, "reset");
  });
});

test("a project keeps an admin; a member's areas, role and party are changed together", async () => {
  await inA(async () => {
    await throws(async () => users.updateMember(db, { projectId: pA.id, userId: admin.id, role: "engineer", areas: [] }), "بدون مدیر");
    await throws(async () => users.removeMember(db, { projectId: pA.id, userId: admin.id }), "بدون مدیر");
    const m = await users.updateMember(db, { projectId: pA.id, userId: invited.id, role: "qc", areas: ["civil", "quality"], party: "company" });
    equal([m.role, m.areas, m.inspection_party], ["qc", ["civil", "quality"], "company"]);
    await throws(async () => db.query("UPDATE project_member SET areas = '{rocketry}' WHERE user_id = $1", [invited.id]), "member_areas_known");
  });
});

test("a write outside the member's areas is refused for every route, in one place; reading is not", async () => {
  const req = (method, p) => new Request(`http://x${p}?projectId=${pA.id}`, { method, headers: { authorization: "Bearer kc|member-2" } });
  const m2 = await projects.ensureUser(db, { subject: "kc|member-2", email: "m2@x.ir" });
  await projects.addMember(db, { projectId: pA.id, userId: m2.id, role: "engineer" });
  await db.query("UPDATE project_member SET areas = '{piping}' WHERE user_id = $1", [m2.id]);
  const e = await throws(async () => authenticate(req("POST", "/api/civil"), { projectId: pA.id }), "حوزهٔ کاری");
  equal([e.status, e.code], [403, "OUT_OF_AREA"]);
  await authenticate(req("GET", "/api/civil"), { projectId: pA.id });
  await authenticate(req("POST", "/api/piping"), { projectId: pA.id });
  await authenticate(req("POST", "/api/project"), { projectId: pA.id });
  await db.query("UPDATE project_member SET areas = '{}' WHERE user_id = $1", [m2.id]);
  await authenticate(req("POST", "/api/civil"), { projectId: pA.id });
});

test("on site, each operation is judged by its own area", async () => {
  const f = await inA(() => spine.upsertTag(db, { projectId: pA.id, tagNo: "FDN-1", discipline: "civil", kind: "foundation" }));
  const pump = await inA(() => spine.upsertTag(db, { projectId: pA.id, tagNo: "P-1", discipline: "equipment", kind: "rotating" }));
  const uuid = () => globalThis.crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const op = (tagId, code) => ({ opId: uuid(), kind: "tag_step", projectId: pA.id, payload: { tagId, code, doneOn: today },
    capturedAt: new Date().toISOString() });
  const r = await fld.applyOps(db, { projectId: pA.id, userId: invited.id, membership: { role: "engineer", areas: ["civil"] },
    ops: [op(f.id, "excavation"), op(pump.id, "set")] });
  equal(r.map((x) => x.status), ["applied", "rejected"]);
  assert(/تجهیزات/.test(r[1].error), r[1].error);
});

test("deactivation is a developer's, ends the sessions, and closes every door", async () => {
  await throws(async () => users.setActive(db, { userId: dev.id, active: false, byUser: dev.id }), "خودتان");
  await users.setActive(db, { userId: invited.id, active: false, byUser: dev.id });
  equal(await creds.currentSessionVersion(db, { userId: invited.id }) > 0, true, "sessions revoked");
  await throws(async () => creds.authenticatePassword(db, { email: "civil.sup@site.ir", password: "a long enough passphrase" }), "غیرفعال");
  equal(await projects.membershipOf(db, { projectId: pA.id, userId: invited.id }), null);
  equal((await inA(() => users.listProjectUsers(db, { projectId: pA.id }))).find((u) => u.user_id === invited.id).status, "inactive");
  await throws(async () => inA(() => users.issueSetupLink(db, { userId: invited.id, byUser: dev.id, byDeveloper: true })), "غیرفعال");
  await users.setActive(db, { userId: invited.id, active: true, byUser: dev.id });
  await throws(async () => users.setDeveloper(db, { userId: dev.id, value: false }), "آخرین");
  await users.setDeveloper(db, { userId: invited.id, value: true });
  await users.setDeveloper(db, { userId: dev.id, value: false });
  equal((await projects.membershipOf(db, { projectId: pB.id, userId: invited.id })).role, "developer");
});

test("removing a member leaves the account and its other projects alone", async () => {
  await inA(async () => {
    const extra = await users.inviteUser(db, { projectId: pA.id, email: "temp@x.ir", role: "viewer", byUser: admin.id });
    await withProject(db, pB.id, () => db.query("INSERT INTO project_member (project_id, user_id, role) VALUES ($1,$2,'qc')", [pB.id, extra.user.id]));
    await users.removeMember(db, { projectId: pA.id, userId: extra.user.id });
    equal((await projects.listProjectsForUser(db, extra.user.id)).map((p) => p.code), ["UB"]);
  });
  // An account that has a password joins another project as it is: no link — a link would be a way into it.
  const joined = await withProject(db, pB.id, () => users.inviteUser(db, { projectId: pB.id, email: "CIVIL.SUP@site.ir", role: "viewer", byUser: dev.id }));
  equal([joined.created, joined.link, joined.user.id], [false, null, invited.id]);
});

await run();
