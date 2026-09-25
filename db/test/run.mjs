#!/usr/bin/env node
/**
 * Data layer tests (EPIC-1).
 *
 * These run against real PostgreSQL — PGlite, in this process, migrated from
 * the same db/migrations/*.sql that production uses. So the row level
 * security policies being tested here are the ones that will be deployed,
 * not an approximation of them.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { createClient } from "../../lib/db/client.mjs";
import { migrate } from "../../lib/db/migrate.mjs";
import { withProject, withoutProject } from "../../lib/db/scope.mjs";
import * as projects from "../../lib/db/repos/projects.mjs";
import * as documents from "../../lib/db/repos/documents.mjs";
import * as runs from "../../lib/db/repos/runs.mjs";
import { createLocalStore, sha256 } from "../../lib/storage/content-store.mjs";
import { can, assertCan, ACTIONS, highestRole, createIdentityResolver } from "../../lib/authz.mjs";
import { buildModel } from "../../lib/engine.js";
import { DEMO } from "../../lib/demo.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const db = await createClient();          // in-memory PGlite
await migrate(db);

// ── fixtures ─────────────────────────────────────────────────────────────
const alice = await projects.ensureUser(db, { subject: "kc|alice", email: "a@ex.com", displayName: "Alice" });
const bob = await projects.ensureUser(db, { subject: "kc|bob", email: "b@ex.com" });
const kavian = await projects.createProject(db, { code: "K110", name: "Ethane Cracking", ownerUserId: alice.id });
const other = await projects.createProject(db, { code: "OTHER", name: "Another plant", ownerUserId: bob.id });

const bytes = Buffer.from("pretend this is a 300 DPI scan of SW 265022A");
const digest = sha256(bytes);

// ── schema and migrations ────────────────────────────────────────────────

test("migrations are idempotent", async () => {
  const ran = await migrate(db);
  equal(ran, [], "a second migrate should apply nothing");
});

test("an edited migration that was already applied is refused", async () => {
  const { rows: [{ checksum }] } = await db.query(
    "SELECT checksum FROM schema_migrations WHERE version = '001_core'");
  await db.query("UPDATE schema_migrations SET checksum = $1 WHERE version = '001_core'",
    ["0".repeat(64)]);
  const e = await throws(() => migrate(db), "has changed since it was applied");
  assert(String(e.message).includes("Add a new migration"), "the error should say what to do");
  // restore the recorded checksum so later tests see a consistent history
  await db.query("UPDATE schema_migrations SET checksum = $1 WHERE version = '001_core'", [checksum]);
  equal(await migrate(db), [], "and the suite is back to a clean record");
});

// ── story 1.5 · tenancy ──────────────────────────────────────────────────

test("a query with no project scope sees nothing", async () => {
  await withProject(db, kavian.id, async () => {
    await documents.registerDocument(db, {
      projectId: kavian.id, docNo: "SW 265022A", revision: "0",
      fileSha256: digest, storageUri: "local://x", byteSize: bytes.length,
    });
  });
  await withoutProject(db, async () => {
    const { rows } = await db.query("SELECT * FROM document");
    equal(rows.length, 0, "row level security should hide everything without a scope");
  });
});

test("one project cannot see another's documents", async () => {
  const seen = await withProject(db, other.id, async () => {
    const { rows } = await db.query("SELECT * FROM document");
    return rows.length;
  });
  equal(seen, 0, "OTHER must not see K110's drawing");
});

test("a write cannot be smuggled into another project", async () => {
  await withProject(db, other.id, async () => {
    await throws(() => db.query(
      `INSERT INTO document (project_id, doc_no, revision, file_sha256, storage_uri)
       VALUES ($1, 'SMUGGLED', '0', $2, 'local://y')`,
      [kavian.id, "1".repeat(64)]), "row-level security");
  });
});

test("membership decides which projects a user sees", async () => {
  const forAlice = await projects.listProjectsForUser(db, alice.id);
  const forBob = await projects.listProjectsForUser(db, bob.id);
  equal(forAlice.map((p) => p.code), ["K110"]);
  equal(forBob.map((p) => p.code), ["OTHER"]);
  equal(await projects.membershipOf(db, { projectId: kavian.id, userId: bob.id }), null,
    "Bob has no standing in K110");
});

// ── story 1.2 · content-addressed storage ────────────────────────────────

test("the same bytes are stored once and reported as deduplicated", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "store-"));
  try {
    const store = createLocalStore({ root });
    const first = await store.put(bytes, { ext: ".png" });
    const second = await store.put(bytes, { ext: ".png" });
    equal(first.digest, digest, "digest is the sha256 of the content");
    equal(first.deduplicated, false);
    equal(second.deduplicated, true, "the second put must not rewrite the blob");
    equal(second.uri, first.uri, "identical content addresses to one uri");
    equal(Buffer.compare(await store.get(first.uri), bytes), 0, "round trip is byte exact");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("re-registering identical bytes does not create a second document", async () => {
  await withProject(db, kavian.id, async () => {
    const again = await documents.registerDocument(db, {
      projectId: kavian.id, docNo: "SW 265022A", revision: "0",
      fileSha256: digest, storageUri: "local://x",
    });
    equal(again.created, false, "an unchanged re-upload is not a new document");
  });
});

test("the same revision with different bytes is refused, not silently replaced", async () => {
  await withProject(db, kavian.id, async () => {
    await throws(() => documents.registerDocument(db, {
      projectId: kavian.id, docNo: "SW 265022A", revision: "0",
      fileSha256: "2".repeat(64), storageUri: "local://z",
    }), "REVISION_CONTENT_CONFLICT");
  });
});

test("a new revision supersedes the old one", async () => {
  await withProject(db, kavian.id, async () => {
    const { document: revB } = await documents.registerDocument(db, {
      projectId: kavian.id, docNo: "SW 265022A", revision: "B",
      revisionDate: "2026-09-01", fileSha256: "3".repeat(64), storageUri: "local://b",
    });
    const superseded = await documents.supersedePrevious(db, {
      projectId: kavian.id, documentId: revB.id });
    equal(superseded.map((r) => r.revision), ["0"], "rev 0 is superseded by rev B");
    const current = await documents.currentRevision(db, { projectId: kavian.id, docNo: "SW 265022A" });
    equal(current.revision, "B", "rev B is now in force");
  });
});

// ── story 1.3 · the run and its register ─────────────────────────────────

let runId, docId;

test("an extraction run persists its payload, checks and token cost", async () => {
  await withProject(db, kavian.id, async () => {
    docId = (await documents.currentRevision(db, { projectId: kavian.id, docNo: "SW 265022A" })).id;
    const model = buildModel(DEMO, {});
    assert(!model.error, "the demo drawing must build");
    const run = await runs.createRun(db, {
      projectId: kavian.id, documentId: docId,
      modelName: "claude-sonnet-5", passName: "nodes",
      inputTokens: 24_000, outputTokens: 3_900,
      payload: DEMO, validationChecks: model.checks, createdBy: alice.id,
    });
    runId = run.id;
    equal(run.status, "extracted");
    equal(run.input_tokens, 24000);
    equal(run.payload.meta.drawingNo, "SW 265022A", "payload survives the jsonb round trip");
    assert(Array.isArray(run.validation_checks) && run.validation_checks.length > 0,
      "the engine's checks are kept verbatim");
  });
});

test("the register saved matches the register the engine computed", async () => {
  await withProject(db, kavian.id, async () => {
    const model = buildModel(DEMO, {});
    const saved = await runs.saveRegister(db, {
      projectId: kavian.id, runId, documentId: docId,
      lineNo: "36-P-001", model,
    });
    equal(saved.welds.length, 10, "ten welds, as the hand-made register says");
    equal(saved.spools, 3, "three spools");

    const back = await runs.getRegister(db, { projectId: kavian.id, runId });
    equal(back.map((w) => w.weld_no), model.register.map((w) => w.no), "weld numbering round trips");
    equal(back.filter((w) => w.shop_field === "Field").map((w) => w.weld_no),
      ["W-01", "W-05", "W-06", "W-10"], "the field welds are the documented ones");
    equal(back[0].spool_no, "SP-01", "spool association round trips");
  });
});

test("weld identity is carried forward, and only when asked for", async () => {
  await withProject(db, kavian.id, async () => {
    const previous = await runs.getRegister(db, { projectId: kavian.id, runId });
    const before = previous.map((w) => w.weld_uid);

    // A uid is a surrogate, not a value derived from the weld: a run that is
    // not told what came before it mints fresh identities, by design.
    const fresh = await runs.createRun(db, {
      projectId: kavian.id, documentId: docId, payload: DEMO, validationChecks: [] });
    await runs.saveRegister(db, {
      projectId: kavian.id, runId: fresh.id, documentId: docId, model: buildModel(DEMO, {}) });
    const minted = (await runs.getRegister(db, { projectId: kavian.id, runId: fresh.id }))
      .map((w) => w.weld_uid);
    assert(minted.every((u) => !before.includes(u)), "with nothing to carry from, identity is new");

    // Given the previous register, every weld keeps the identity that NDT
    // records and ITRs are hung off.
    const carried = await runs.createRun(db, {
      projectId: kavian.id, documentId: docId, payload: DEMO, validationChecks: [] });
    const saved = await runs.saveRegister(db, {
      projectId: kavian.id, runId: carried.id, documentId: docId,
      model: buildModel(DEMO, {}), carryFrom: previous });
    equal(saved.carried, 10);
    const after = (await runs.getRegister(db, { projectId: kavian.id, runId: carried.id }))
      .map((w) => w.weld_uid);
    equal(after, before, "identity survives a re-extraction of the same drawing");
  });
});

test("a register is never saved from a failed model", async () => {
  await withProject(db, kavian.id, async () => {
    await throws(() => runs.saveRegister(db, {
      projectId: kavian.id, runId, documentId: docId, lineNo: "x",
      model: buildModel({ nodes: [{ id: "N1", type: "tie-in", E: 0, N: 0, EL: 0 }] }, {}),
    }), "refusing to save a register from a failed model");
  });
});

// ── story 1.4 · approval ─────────────────────────────────────────────────

test("approval records who signed and exactly what they signed", async () => {
  await withProject(db, kavian.id, async () => {
    const approved = await runs.approveRun(db, { projectId: kavian.id, runId, userId: alice.id });
    equal(approved.status, "approved");
    equal(approved.approved_by, alice.id);
    assert(/^[0-9a-f]{64}$/.test(approved.approved_sha256),
      "the approval must carry the hash of what was approved");
  });
});

test("a second click of the approve button is not a failure", async () => {
  // The run is already approved by the test above. Approving it again must
  // read as success: the operator's finger is not a state machine, and an
  // error here would send them looking for a problem that is not there.
  await withProject(db, kavian.id, async () => {
    const again = await runs.approveRun(db, { projectId: kavian.id, runId, userId: alice.id });
    equal(again.status, "approved");
    const { rows: [r] } = await db.query(
      "SELECT approved_by FROM extraction_run WHERE id = $1", [runId]);
    equal(r.approved_by, alice.id, "and it does not re-sign it under whoever clicked second");
  });
});

test("a failed extraction cannot be signed", async () => {
  // Signing is an engineer attesting to a register. A failed run has none,
  // so there is nothing for a signature to attest to.
  await withProject(db, kavian.id, async () => {
    const broken = await runs.createRun(db, {
      projectId: kavian.id, documentId: docId, payload: DEMO,
      engineError: "geometry does not close",
    });
    equal(broken.status, "failed");
    const e = await throws(() => runs.approveRun(db, {
      projectId: kavian.id, runId: broken.id, userId: alice.id }), "INVALID_TRANSITION");
    equal(e.status, 409);
  });
});

test("the database refuses an approval with no signatory", async () => {
  // A fresh, unapproved run: the already-approved one carries a signatory, so
  // flipping its status would not exercise the constraint at all.
  await withProject(db, kavian.id, async () => {
    const fresh = await runs.createRun(db, {
      projectId: kavian.id, documentId: docId, payload: DEMO, validationChecks: [],
    });
    await throws(() => db.query(
      "UPDATE extraction_run SET status = 'approved' WHERE id = $1", [fresh.id]),
      "approval_is_complete");
  });
});

test("only an engineer may approve a register", async () => {
  equal(can({ role: "engineer" }, ACTIONS.APPROVE_REGISTER), true);
  equal(can({ role: "qc" }, ACTIONS.APPROVE_REGISTER), false, "QC inspects, it does not sign the design");
  equal(can({ role: "viewer" }, ACTIONS.APPROVE_REGISTER), false);
  equal(can({ role: "admin" }, ACTIONS.APPROVE_REGISTER), true);
  equal(can(null, ACTIONS.APPROVE_REGISTER), false, "no membership means no permission");
  equal(can({ role: "nonsense" }, ACTIONS.VIEW_PROJECT), false, "an unknown role grants nothing");
});

test("QC may record NDT and an engineer may not", async () => {
  equal(can({ role: "qc" }, ACTIONS.RECORD_NDT), true);
  equal(can({ role: "engineer" }, ACTIONS.RECORD_NDT), false);
});

test("anybody on site records HSE; only an engineer or admin issues a permit", async () => {
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.RECORD_HSE)), [false, true, true, true]);
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.ISSUE_PERMIT)), [false, false, true, true]);
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.MANAGE_CONTROLS)), [false, false, true, true]);
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.RECORD_QUALITY)), [false, true, true, true]);
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.APPROVE_CONCESSION)), [false, false, true, true]);
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.RECORD_COMPLETIONS)), [false, true, true, true]);
  equal(["viewer", "qc", "engineer", "admin"].map((role) => can({ role }, ACTIONS.SIGN_MC)), [false, false, true, true]);
});

test("assertCan throws a 403 rather than returning false", async () => {
  const e = await throws(() => assertCan({ role: "viewer" }, ACTIONS.APPROVE_REGISTER), "FORBIDDEN");
  equal(e.status, 403);
});

test("highestRole picks the strongest standing", async () => {
  equal(highestRole(["viewer", "engineer", "qc"]), "engineer");
  equal(highestRole([]), null);
});

test("identity resolution rejects a missing or subject-less token", async () => {
  const resolve = createIdentityResolver({ verify: async (t) => (t === "good" ? { sub: "kc|alice" } : {}) });
  equal((await resolve("good")).subject, "kc|alice");
  equal((await throws(() => resolve(null), "UNAUTHENTICATED")).status, 401);
  equal((await throws(() => resolve("bad"), "UNAUTHENTICATED")).status, 401);
});

test("every operational script reads the same .env.local the app does", async () => {
  // A script that talks to the database but cannot see DATABASE_URL does not
  // fail — it quietly falls back to a local PGlite directory and succeeds
  // against the wrong database. db:migrate did exactly that: it reported
  // "6 migrations applied" while the doctor, one line later, reported "0 of 6",
  // because only one of them was loading .env.local.
  const { readFile } = await import("node:fs/promises");
  for (const f of ["db/migrate-cli.mjs", "db/doctor.mjs", "db/seed.mjs"]) {
    const src = await readFile(f, "utf8");
    assert(/import ["']\.\.\/tools\/env\.mjs["']/.test(src),
      `${f} must import tools/env.mjs — without it DATABASE_URL from ` +
      `.env.local is invisible and it silently migrates a different database`);
  }
});

test("the test loader does not pull in the app's .env.local", async () => {
  // tools/env.mjs exists so `npm run doctor` and `npm run db:seed` see the
  // same configuration the server does. It must never reach the suites: a
  // DATABASE_URL in .env.local outranks the temporary data directory each
  // suite makes for itself, and these tests migrate, seed and write. That is
  // somebody's real database, entered by accident.
  const { readFile } = await import("node:fs/promises");
  const loader = await readFile("tools/register.mjs", "utf8");
  assert(!/env\.mjs/.test(loader),
    "tools/register.mjs must not import tools/env.mjs — tests stay hermetic");
  assert(!process.env.DATABASE_URL,
    "a suite reached a configured DATABASE_URL; it must run on its own PGlite");
});

await run();
