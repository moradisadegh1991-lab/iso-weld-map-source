#!/usr/bin/env node
/**
 * The EPC reference made the project's own (lib/reference/epc.mjs,
 * lib/db/repos/reference.mjs): the reference is consistent with the
 * modules it points at; an adopted checklist becomes a pre-commissioning
 * template the module accepts, and is never overwritten by adopting again;
 * a standard without its edition is missing information, not a default.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("reference-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const ref = await import("../../lib/db/repos/reference.mjs");
const { missingInformation } = await import("../../lib/db/repos/assumptions.mjs");
const { PHASES, CHECKLISTS, CERTIFICATES, STANDARDS } = await import("../../lib/reference/epc.mjs");
const { APPLIES, PHASES: PRECOM_PHASES } = await import("../../lib/completions/precom.mjs");
const { navigationFor } = await import("../../lib/platform/navigation.mjs");

test("the reference points only at what exists: checklists fit the pre-commissioning module, links are pages in the menu", async () => {
  for (const c of CHECKLISTS) {
    assert(APPLIES[c.appliesTo] && PRECOM_PHASES[c.phase], `${c.code}: ${c.appliesTo}/${c.phase}`);
    assert(c.items.length >= 3, `${c.code} has items`);
  }
  equal(new Set(CHECKLISTS.map((c) => c.code)).size, CHECKLISTS.length, "codes are unique");
  const nav = navigationFor({ role: "admin", areas: [] }, () => true);
  const hrefs = new Set(JSON.stringify(nav).match(/"href":"[^"]+"/g).map((h) => h.slice(8, -1)));
  for (const h of [...PHASES.map((p) => p.href), ...CERTIFICATES.map((c) => c.href)].filter(Boolean)) assert(hrefs.has(h), `${h} is in the menu`);
  assert(hrefs.has("/reference"), "the reference page is in the menu");
  assert(STANDARDS.flatMap((g) => g.items).every(([code, , ]) => !/\b(19|20)\d\d\b/.test(code)), "no edition is assumed in the reference");
});

const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|ref" });
const proj = await projects.createProject(db, { code: "REF", name: "R", ownerUserId: me.id });
const P = proj.id;
const inP = (fn) => withProject(db, P, fn);

test("adopting a checklist makes it the project's template; adopting it again does not overwrite the project's copy", async () => {
  const row = await inP(() => ref.adoptChecklist(db, { projectId: P, code: "ITR-B-LOOP" }));
  equal([row.code, row.applies_to, row.phase], ["ITR-B-LOOP", "loop", "precom"]);
  assert(row.criteria.startsWith("1. کالیبراسیون"), row.criteria);
  await db.query("SELECT 1"); // the project now edits it
  await inP(() => db.query("UPDATE precom_template SET criteria = 'project wording' WHERE project_id = $1 AND code = 'ITR-B-LOOP'", [P]));
  await throws(() => inP(() => ref.adoptChecklist(db, { projectId: P, code: "ITR-B-LOOP" })), "قبلاً");
  const { rows: [t] } = await inP(() => db.query("SELECT criteria FROM precom_template WHERE project_id = $1 AND code = 'ITR-B-LOOP'", [P]));
  equal(t.criteria, "project wording");
  equal(await inP(() => ref.adoptedCodes(db, { projectId: P })), ["ITR-B-LOOP"]);
});

test("a standard without its edition is missing information; stating the edition clears it", async () => {
  await inP(() => ref.upsertStandard(db, { projectId: P, code: "asme b31.3", title: "Process Piping", userId: me.id }));
  let gaps = await inP(() => missingInformation(db, { projectId: P }));
  equal(gaps.find((g) => g.key === "standard-edition")?.count, 1);
  await inP(() => ref.upsertStandard(db, { projectId: P, code: "ASME B31.3", edition: "2022", source: "Contract Annex 4", userId: me.id }));
  gaps = await inP(() => missingInformation(db, { projectId: P }));
  equal(gaps.find((g) => g.key === "standard-edition"), undefined);
  const list = await inP(() => ref.listStandards(db, { projectId: P }));
  equal(list.map((s) => [s.code, s.edition, s.title]), [["ASME B31.3", "2022", "Process Piping"]], "one code, one row; the title kept");
});

await run();
