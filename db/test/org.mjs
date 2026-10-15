#!/usr/bin/env node
/**
 * The organisation's process (owner's spec 2026-10-15), steps 1–2:
 * companies with logos, project and contract stakeholders, currencies with
 * their base-unit value, project budgets in several currencies, the
 * contract budget's derived columns, amendments and the category trees.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import path from "node:path";
import { contractBudget, revisedEnd, amendmentProblems, treeOf, makesCycle } from "../../lib/org/budget.mjs";

// ── the rules ────────────────────────────────────────────────────────────

test("a contract budget: weight by forecast × rate, increases/decreases/new items from amendments, done from statements in the contract's currency", async () => {
  const b = contractBudget({
    currencies: [{ currency: "USD", rate: 1, budget: 1000 }, { currency: "IRR", rate: 0.00002, budget: 50000000, done_typed: 10000000 }],
    amendments: [{ currency: "USD", kind: "change", amount: 200 }, { currency: "USD", kind: "change", amount: -50 }, { currency: "USD", kind: "new_items", amount: 100 },
      { currency: "IRR", kind: "change", amount: -5000000 }],
    statementDone: 400, mainCurrency: "USD" });
  const [usd, irr] = b.rows;
  equal([usd.weightPct, irr.weightPct], [50, 50], "1000 × 1 and 50 000 000 × 0.00002 weigh the same");
  equal([usd.increase, usd.decrease, usd.newItems, usd.needed], [200, 50, 100, 1250]);
  equal([usd.done, usd.doneSource, usd.remaining], [400, "statements", 600]);
  equal([irr.done, irr.doneSource, irr.needed], [10000000, "typed", 45000000], "another currency's done is typed and says so");
  equal([b.total.forecast, b.total.needed], [2000, 2150]);
  equal(contractBudget({ currencies: [{ currency: "USD", rate: 1, budget: 10 }] }).rows[0].done, null, "nothing done is unknown, not zero");
});

test("amendments: time ones change the time, money ones carry lines; new items never negative", async () => {
  equal(revisedEnd("2026-12-31", [{ days: 30 }, { days: -10 }]), { endOn: "2027-01-20", days: 20 });
  equal(amendmentProblems({ kind: "time", days: 0 }).length, 1);
  equal(amendmentProblems({ kind: "financial", days: 0, lines: [] }).length, 1);
  equal(amendmentProblems({ kind: "financial", days: 5, lines: [{ currency: "USD", kind: "change", amount: 1 }] }).length, 1);
  equal(amendmentProblems({ kind: "both", days: 15, lines: [{ currency: "USD", kind: "new_items", amount: -1 }] }).length, 1);
  equal(amendmentProblems({ kind: "both", days: 15, lines: [{ currency: "USD", kind: "change", amount: -1 }] }), []);
});

test("a tree from parent links; a branch never moves under itself", async () => {
  const rows = [{ id: "a", parent_id: null, name: "Civil", seq: 2 }, { id: "b", parent_id: null, name: "Piping", seq: 1 },
    { id: "c", parent_id: "a", name: "Concrete", seq: 1 }, { id: "d", parent_id: "c", name: "Formwork", seq: 1 }];
  const t = treeOf(rows);
  equal([t.map((x) => x.name), t[1].children[0].children[0].name], [["Piping", "Civil"], "Formwork"]);
  equal([makesCycle(rows, "a", "d"), makesCycle(rows, "a", "a"), makesCycle(rows, "d", "b")], [true, true, false]);
});

// ── in the database ──────────────────────────────────────────────────────

const dir = await scratchDir("org-db-");
process.env.PGLITE_DIR = dir;
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const org = await import("../../lib/db/repos/org.mjs");
const ctr = await import("../../lib/db/repos/contracts.mjs");
const { createLocalStore } = await import("../../lib/storage/content-store.mjs");
const db = await getDb();
const store = createLocalStore({ root: path.join(dir, "files") });
const alice = await projects.ensureUser(db, { subject: "kc|alice" });
const P = (await projects.createProject(db, { code: "ORG", name: "O", ownerUserId: alice.id })).id;
const P2 = (await projects.createProject(db, { code: "ORG2", name: "O2", ownerUserId: alice.id })).id;
const inP = (fn, p = P) => withProject(db, p, fn);
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000" + "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");
let kavian, epc, contract;

test("companies are one directory for every project, each with several logos; stakeholders come from it", async () => {
  kavian = await inP(() => org.upsertCompany(db, { code: "KPC", name: "پتروشیمی کاویان", userId: alice.id }));
  epc = await inP(() => org.upsertCompany(db, { code: "epc1", name: "پیمانکار EPC", userId: alice.id }));
  await throws(() => inP(() => org.upsertCompany(db, { code: "KPC", name: "x" })), "ثبت شده");
  const l1 = await inP(() => org.addCompanyLogo(db, { companyId: kavian.id, name: "لوگوی فارسی", bytes: PNG, store, userId: alice.id }));
  const again = await inP(() => org.addCompanyLogo(db, { companyId: kavian.id, name: "تکراری", bytes: PNG, store }));
  equal([again.id, again.duplicate], [l1.id, true], "the same image is the logo already kept");
  await throws(() => inP(() => org.addCompanyLogo(db, { companyId: kavian.id, name: "متن", bytes: Buffer.from("not an image"), store })), "تصویر");
  await inP(() => org.addProjectStakeholder(db, { projectId: P, companyId: kavian.id, role: "owner" }));
  await inP(() => org.addProjectStakeholder(db, { projectId: P, companyId: epc.id, role: "epc" }));
  const other = await inP(() => org.projectSetup(db, { projectId: P2 }), P2);
  equal([other.companies.map((c) => c.code).sort(), other.stakeholders.length], [["EPC1", "KPC"], 0], "another project sees the companies, not this project's stakeholders");
  const mine = await inP(() => org.projectSetup(db, { projectId: P }));
  equal(mine.stakeholders.map((s) => [s.code, s.role]), [["EPC1", "epc"], ["KPC", "owner"]]);
  equal(mine.companies.find((c) => c.code === "KPC").logos.length, 1);
});

test("currencies have a value in the base unit; a project budgets in several", async () => {
  await inP(() => org.upsertCurrency(db, { projectId: P, code: "usd", name: "دلار", rate: 1 }));
  await inP(() => org.upsertCurrency(db, { projectId: P, code: "IRR", name: "ریال", rate: 0.00732 }));
  await throws(() => inP(() => org.upsertCurrency(db, { projectId: P, code: "EU", rate: 1 })), "سه حرف");
  await throws(() => inP(() => org.upsertCurrency(db, { projectId: P, code: "EUR", rate: 0 })), "مثبت");
  await inP(() => org.addProjectBudget(db, { projectId: P, title: "بودجهٔ ارزی", currency: "USD", amount: 1000, userId: alice.id }));
  await inP(() => org.addProjectBudget(db, { projectId: P, title: "بودجهٔ ریالی", currency: "IRR", amount: 100000, userId: alice.id }));
  await throws(() => inP(() => org.addProjectBudget(db, { projectId: P, title: "x", currency: "EUR", amount: 1 })), "ارزهای پروژه");
  equal((await inP(() => org.projectSetup(db, { projectId: P }))).budgetInBase, 1732);
});

test("a contract: currencies at its own rate, budget columns, stakeholders, amendments, revised end", async () => {
  const { rows: [civ] } = await inP(() => db.query(
    "INSERT INTO contractor (project_id, code, name) VALUES ($1, 'CIV', 'Civil Co') RETURNING id", [P]));
  contract = await inP(() => ctr.upsertContract(db, { projectId: P, contractNo: "SC-01", title: "Civil works", kind: "subcontract",
    contractorId: civ.id, currency: "USD", value: 1000, startOn: "2026-01-01", endOn: "2026-12-31", userId: alice.id }));
  await inP(() => org.upsertContractCurrency(db, { projectId: P, contractId: contract.id, currency: "USD", budget: 1000, userId: alice.id }));
  await inP(() => org.upsertContractCurrency(db, { projectId: P, contractId: contract.id, currency: "IRR", rate: 0.0073, budget: 50000, doneTyped: 1000, userId: alice.id }));
  await throws(() => inP(() => org.upsertContractCurrency(db, { projectId: P, contractId: contract.id, currency: "USD", budget: 1000, doneTyped: 5 })), "صورت‌وضعیت",
    "the contract's own currency is done by its statements, not by hand");
  await inP(() => org.addContractStakeholder(db, { projectId: P, contractId: contract.id, companyId: kavian.id, role: "employer" }));
  await throws(() => inP(() => org.addAmendment(db, { projectId: P, contractId: contract.id, amendmentNo: "A1", kind: "financial", title: "EUR",
    lines: [{ currency: "EUR", kind: "change", amount: 5 }] })), "از ارزهای این قرارداد نیست");
  await inP(() => org.addAmendment(db, { projectId: P, contractId: contract.id, amendmentNo: "A1", kind: "both", title: "Extension + scope",
    days: 45, lines: [{ currency: "USD", kind: "change", amount: 150 }, { currency: "USD", kind: "new_items", amount: 80 }, { currency: "IRR", kind: "change", amount: -4000 }], userId: alice.id }));
  const s = await inP(() => org.contractSetup(db, { projectId: P, contractId: contract.id }));
  const usd = s.budget.rows.find((r) => r.currency === "USD"), irr = s.budget.rows.find((r) => r.currency === "IRR");
  equal([usd.increase, usd.newItems, usd.needed, usd.done], [150, 80, 1230, null], "no approved statement yet: done unknown");
  equal([irr.rate, irr.decrease, irr.needed, irr.doneSource], [0.0073, 4000, 46000, "typed"], "the contract's rate, not the project's");
  equal(s.revised, { endOn: "2027-02-14", days: 45 });
  equal(s.stakeholders.map((x) => x.code), ["KPC"]);
});

test("category trees: by discipline and work group; moved by branch, never under itself; a branch with children stays", async () => {
  const add = (name, parentId = null, tree = "resource") => inP(() => org.addCategory(db, { projectId: P, contractId: contract.id, tree, parentId, name }));
  const civil = await add("سیویل"), people = await add("نیروی انسانی", civil.id), welders = await add("جوشکار", people.id);
  const mech = await add("مکانیک");
  await add("بتن‌ریزی", null, "narrative");
  await throws(() => add("نیروی انسانی", civil.id), "در همین شاخه");
  await throws(() => inP(() => org.moveCategory(db, { projectId: P, id: civil.id, parentId: welders.id })), "زیر خودش");
  await inP(() => org.moveCategory(db, { projectId: P, id: people.id, parentId: mech.id }));
  await throws(() => inP(() => org.removeCategory(db, { projectId: P, id: mech.id })), "زیرشاخه");
  const s = await inP(() => org.contractSetup(db, { projectId: P, contractId: contract.id }));
  equal(s.trees.resource.map((n) => [n.name, n.children.map((c) => c.name)]), [["سیویل", []], ["مکانیک", ["نیروی انسانی"]]]);
  equal(s.trees.narrative.map((n) => n.name), ["بتن‌ریزی"]);
});

// ── step 3: users ────────────────────────────────────────────────────────

test("a user's profile: username to sign in with, job title, expertise, company; assigned to a contract with a position and access", async () => {
  const users = await import("../../lib/db/repos/users.mjs");
  const cred = await import("../../lib/db/repos/credentials.mjs");
  const bob = await projects.ensureUser(db, { subject: "local|bob@x.test", email: "bob@x.test", displayName: "Bob" });
  await projects.addMember(db, { projectId: P, userId: bob.id, role: "engineer" });
  await cred.setPassword(db, { userId: bob.id, password: "Bob-is-long-enough-2026" });
  await throws(() => users.updateProfile(db, { userId: bob.id, username: "B" }), "نام کاربری");
  await throws(() => users.updateProfile(db, { userId: bob.id, username: "bob@x.test" }), "نام کاربری");
  await throws(() => users.updateProfile(db, { userId: bob.id, username: "alice@x.test" }), "نام کاربری");
  const u = await users.updateProfile(db, { userId: bob.id, username: "Bob.Site", jobTitle: "سرپرست کارگاه", specialty: "پایپینگ", companyId: epc.id });
  equal([u.username, u.job_title, u.company_id], ["bob.site", "سرپرست کارگاه", epc.id]);
  const carol = await projects.ensureUser(db, { subject: "local|carol@x.test", email: "carol@x.test" });
  await throws(() => users.updateProfile(db, { userId: carol.id, username: "bob.site" }), "گرفته شده");
  const viaName = await cred.authenticatePassword(db, { email: "BOB.SITE", password: "Bob-is-long-enough-2026" });
  equal(viaName.id, bob.id, "signs in with the username, any case");
  await inP(async () => {
    await throws(() => users.setContractMember(db, { projectId: P, contractId: contract.id, userId: carol.id, position: "x", access: "edit" }), "عضو پروژه نیست");
    await throws(() => users.setContractMember(db, { projectId: P, contractId: contract.id, userId: bob.id, position: "x", access: "boss" }), "سطح دسترسی");
    await users.setContractMember(db, { projectId: P, contractId: contract.id, userId: bob.id, position: "سرپرست کارگاه", access: "edit" });
    const list = await users.contractMembers(db, { projectId: P });
    equal(list.map((m) => [m.contract_no, m.position, m.access]), [["SC-01", "سرپرست کارگاه", "edit"]]);
  });
});

// ── step 4: resources in the contract's tree ─────────────────────────────

test("a contract's resources sit in its resource tree, move between branches, and a branch holding resources stays", async () => {
  const res = await import("../../lib/db/repos/resources.mjs");
  await inP(async () => {
    const civil = await org.addCategory(db, { projectId: P, contractId: contract.id, tree: "resource", name: "سیویل ۲" });
    const narr = (await org.contractSetup(db, { projectId: P, contractId: contract.id })).trees.narrative[0];
    await throws(() => res.upsertResource(db, { projectId: P, contractId: contract.id, categoryId: narr.id, kind: "person", name: "x" }), "درخت منابع",
      "a narrative branch is not a resource branch");
    await throws(() => res.upsertResource(db, { projectId: P, contractId: contract.id, kind: "material", name: "سیمان" }), "واحد لازم");
    const welder = await res.upsertResource(db, { projectId: P, contractId: contract.id, categoryId: civil.id, kind: "person", name: "جوشکار",
      direct: true, forecastQty: 12, actualQty: 10, status: "active" });
    equal(welder.unit, "نفر", "a person is counted in people");
    await res.upsertResource(db, { projectId: P, contractId: contract.id, categoryId: civil.id, kind: "material", name: "سیمان", unit: "تن", forecastQty: 40 });
    await throws(() => res.upsertResource(db, { projectId: P, contractId: contract.id, kind: "person", name: "جوشکار" }), "هست");
    let t = await res.resourceTree(db, { projectId: P, contractId: contract.id });
    const branch = t.tree.find((n) => n.id === civil.id);
    equal([branch.resources.length, branch.totals], [2, { "نفر": 12, "تن": 40 }], "totals by unit, never across units");
    await throws(() => org.removeCategory(db, { projectId: P, id: civil.id }), "منبع در این دسته");
    await res.moveResource(db, { projectId: P, id: welder.id, categoryId: null });
    t = await res.resourceTree(db, { projectId: P, contractId: contract.id });
    equal([t.loose.map((r) => r.name), t.tree.find((n) => n.id === civil.id).resources.length], [["جوشکار"], 1]);
  });
});

await run();
