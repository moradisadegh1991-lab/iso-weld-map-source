#!/usr/bin/env node
/**
 * The project's particulars, and the companies doing the work.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("contr-db-");

const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const spine = await import("../../lib/db/repos/spine.mjs");

const db = await getDb();
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const proj = await projects.createProject(db, { code: "K110", name: "K110", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "Other", ownerUserId: alice.id });
let civil, sub21;

// ── project profile ──────────────────────────────────────────────────────

test("a project can be saved before its contract is signed", async () => {
  // A form that refuses to save until everything is known is a form people
  // keep in Excel instead.
  const p = await projects.updateProjectProfile(db, {
    projectId: proj.id, patch: { client_name: "پتروشیمی کاویان" } });
  equal(p.client_name, "پتروشیمی کاویان");
  equal(p.contract_no, null, "and the rest stays genuinely empty");
  assert(p.updated_at, "stamped, so 'never edited' stays distinguishable");
});

test("an emptied field is cleared, not stored as an empty string", async () => {
  // A contract number of "" prints as a blank that looks recorded.
  await projects.updateProjectProfile(db, { projectId: proj.id, patch: { contract_no: "C-9" } });
  const p = await projects.updateProjectProfile(db, {
    projectId: proj.id, patch: { contract_no: "" } });
  equal(p.contract_no, null);
});

test("a field nobody declared cannot be written through the profile", async () => {
  // The update builds SQL from a fixed allowlist. A patch key outside it is
  // ignored rather than interpolated.
  const p = await projects.updateProjectProfile(db, {
    projectId: proj.id, patch: { code: "HACKED", "name = 'x'--": 1, name: "K110 Phase 2" } });
  equal(p.code, "K110", "the project code is not a profile field");
  equal(p.name, "K110 Phase 2", "and a real one still writes");
});

test("an amount with no currency is refused", async () => {
  // A number whose unit nobody recorded gets added to another one eventually.
  await throws(() => projects.updateProjectProfile(db, {
    projectId: proj.id, patch: { contract_value: 1200000 } }), "value_has_currency");

  const p = await projects.updateProjectProfile(db, {
    projectId: proj.id, patch: { contract_value: 1200000, contract_currency: "EUR" } });
  equal(Number(p.contract_value), 1200000);
});

test("a completion date before the start date is refused", async () => {
  await throws(() => projects.updateProjectProfile(db, {
    projectId: proj.id, patch: { start_date: "2026-01-01", planned_end_date: "2025-01-01" } }),
    "end_after_start");
});

// ── contractors ──────────────────────────────────────────────────────────

test("a contractor holds the trades it is approved for", async () => {
  await withProject(db, proj.id, async () => {
    civil = await contractors.upsertContractor(db, {
      projectId: proj.id, code: "C-01", name: "سازه پاد",
      disciplines: ["civil", "structural"],
      contactName: "مهندس احمدی", prequalifiedUntil: "2027-01-01" });
    equal(civil.disciplines, ["civil", "structural"],
      "a civil contractor that also does steel is normal, not a second row");
    assert(Array.isArray(civil.disciplines),
      "and it is a JS array, not the raw '{civil,structural}' literal the driver returns");
  });
});

test("a trade nobody declared is refused", async () => {
  await withProject(db, proj.id, async () => {
    await throws(() => contractors.upsertContractor(db, {
      projectId: proj.id, code: "C-99", name: "x", disciplines: ["plumbing"] }),
      "INVALID_INPUT");
  });
});

test("a contractor is invisible from another project", async () => {
  await withProject(db, other.id, async () => {
    equal((await contractors.listContractors(db, { projectId: other.id })).length, 0);
  });
});

test("expiry is computed, so it becomes true on its own", async () => {
  // A stored "expired" flag is wrong the morning after it becomes true and
  // nobody is watching.
  await withProject(db, proj.id, async () => {
    const lapsed = await contractors.upsertContractor(db, {
      projectId: proj.id, code: "C-02", name: "پیمانکار منقضی",
      disciplines: ["piping"], prequalifiedUntil: "2020-01-01" });
    assert(lapsed.prequalified_until, "the date is stored");

    const list = await contractors.listContractors(db, { projectId: proj.id });
    equal(list.find((c) => c.code === "C-02").expired, true);
    equal(list.find((c) => c.code === "C-01").expired, false);
  });
});

// ── scope of work ────────────────────────────────────────────────────────

test("a package with no subsystem covers the whole discipline", async () => {
  await withProject(db, proj.id, async () => {
    sub21 = await spine.upsertSubsystem(db, { projectId: proj.id, code: "21-01" });
    const whole = await contractors.upsertPackage(db, {
      projectId: proj.id, contractorId: civil.id, code: "PKG-CIV",
      title: "فونداسیون‌های واحد ۲۱", discipline: "civil" });
    equal(whole.subsystem_id, null,
      "null means the whole discipline, rather than a magic 'ALL' subsystem");

    const narrowed = await contractors.upsertPackage(db, {
      projectId: proj.id, contractorId: civil.id, code: "PKG-STR",
      discipline: "structural", subsystemId: sub21.id, value: 500000, currency: "IRR" });
    equal(narrowed.subsystem_id, sub21.id);
  });
});

test("a package amount with no currency is refused before it reaches the table", async () => {
  await withProject(db, proj.id, async () => {
    const e = await throws(() => contractors.upsertPackage(db, {
      projectId: proj.id, contractorId: civil.id, code: "PKG-X",
      discipline: "civil", value: 10 }), "INVALID_INPUT");
    assert(/واحد پول/.test(e.message), "in Persian, not as a constraint name");
  });
});

test("the contractor list carries what each one holds", async () => {
  await withProject(db, proj.id, async () => {
    const list = await contractors.listContractors(db, { projectId: proj.id });
    const c = list.find((x) => x.code === "C-01");
    equal(c.disciplines, ["civil", "structural"], "parsed on the list path too, not only on write");
    equal(c.packages, 2);
    equal(c.awardedValue, 500000, "one priced package, one not yet priced");
  });
});

test("an expired prequalification only matters when work is held", async () => {
  // The same lapsed certificate is paperwork on a company with no package
  // and an audit finding on one currently welding.
  await withProject(db, proj.id, async () => {
    equal((await contractors.lapsedWithWork(db, { projectId: proj.id })).length, 0,
      "C-02 is lapsed but holds nothing");

    await contractors.upsertPackage(db, {
      projectId: proj.id, contractorId:
        (await db.query("SELECT id FROM contractor WHERE code = 'C-02'")).rows[0].id,
      code: "PKG-PIP", discipline: "piping" });

    const flagged = await contractors.lapsedWithWork(db, { projectId: proj.id });
    equal(flagged.map((f) => f.contractor_code), ["C-02"],
      "and the moment it holds a package it is a finding");
  });
});

test("package progress names the company behind a subsystem", async () => {
  await withProject(db, proj.id, async () => {
    const rows = await contractors.packageProgress(db, { projectId: proj.id });
    const civilPkg = rows.find((r) => r.code === "PKG-CIV");
    equal(civilPkg.contractor, "سازه پاد");
    equal(civilPkg.scope, "کل پروژه", "a package with no subsystem says so in words");
    const str = rows.find((r) => r.code === "PKG-STR");
    equal(str.scope, "21-01");
  });
});

test("one register of parties: a contractor is a company, its name is the company's, and it is a party of its project", async () => {
  const org = await import("../../lib/db/repos/org.mjs");
  await withProject(db, proj.id, async () => {
    // typed by code and name (the old way, and every loader): the company is found or registered once
    const k = await contractors.upsertContractor(db, { projectId: proj.id, code: "C-REG", name: "ثبت قدیمی" });
    const { rows: [co] } = await db.query("SELECT * FROM company WHERE id = $1", [k.company_id]);
    equal([co.code, co.name], ["C-REG", "ثبت قدیمی"]);
    // picked from the companies: the same contractor, never a second one
    const again = await contractors.upsertContractor(db, { projectId: proj.id, companyId: co.id, status: "suspended" });
    equal([again.id, again.status], [k.id, "suspended"]);
    // the company renamed is renamed as the contractor
    await org.upsertCompany(db, { id: co.id, code: co.code, name: "نام تازه" });
    equal((await db.query("SELECT name FROM contractor WHERE id = $1", [k.id])).rows[0].name, "نام تازه");
    // and the contractor is a party of the project
    const { rows: st } = await db.query("SELECT role FROM project_stakeholder WHERE project_id = $1 AND company_id = $2", [proj.id, co.id]);
    equal(st.map((r) => r.role), ["contractor"]);
    // a company given the role of subcontractor is the project's contractor too
    const { rows: [sub] } = await db.query("INSERT INTO company (code, name) VALUES ('SUBX', 'جزء') RETURNING id");
    await org.addProjectStakeholder(db, { projectId: proj.id, companyId: sub.id, role: "subcontractor" });
    const { rows: ks } = await db.query("SELECT code, name FROM contractor WHERE company_id = $1", [sub.id]);
    equal(ks, [{ code: "SUBX", name: "جزء" }]);
    // the project page reads its parties from here
    const parties = await projects.projectParties(db, { projectId: proj.id });
    assert(parties.contractors.includes("SUBX — جزء") && parties.contractors.includes("C-REG — نام تازه"), parties.contractors.join(" | "));
  });
});

await run();
