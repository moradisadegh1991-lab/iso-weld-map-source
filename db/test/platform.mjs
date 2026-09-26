#!/usr/bin/env node
/**
 * The platform shell: the stages every discipline shares, and the registry
 * of what the platform is made of.
 */
import { test, run, assert, equal } from "./harness.mjs";
import {
  STAGES, STAGE_ORDER, TRANSITIONS, isStage, transitionsFrom,
  canTransition, stageProgress, STAGE_FA,
  assertTransition, assertEditable, isPersisted, PERSISTED_STAGES,
} from "../../lib/platform/workflow.mjs";
import { MODULES, byId, liveModules, executionModules, modulesForRole } from "../../lib/platform/modules.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

// ── the lock that matters ────────────────────────────────────────────────

test("an approved register cannot be edited, only superseded", async () => {
  // The signature is against a hash of the contents. Editing in place would
  // leave an engineer's name attesting to something that no longer exists.
  for (const to of [STAGES.EXTRACTED, STAGES.IN_REVIEW, STAGES.DRAFT, STAGES.FAILED]) {
    const r = canTransition(STAGES.APPROVED, to);
    equal(r.ok, false, `approved -> ${to} must be refused`);
    assert(/رویژن جدید/.test(r.reason), "and it must say why, not just 'not allowed'");
  }
  equal(canTransition(STAGES.APPROVED, STAGES.SUPERSEDED).ok, true,
    "a newer revision is the one way out");
});

test("every transition names an action that authz actually knows", async () => {
  // A transition guarded by an action nobody can hold would be dead; one
  // guarded by a typo would be open to everyone.
  for (const t of TRANSITIONS) {
    // The VALUE, not the key: storing "APPROVE_REGISTER" instead of
    // "register:approve" reads the same and denies everyone.
    assert(Object.values(ACTIONS).includes(t.action),
      `${t.from} -> ${t.to} names unknown action ${t.action}`);
  }
});

test("permission is checked, not assumed", async () => {
  const deny = () => false;
  const r = canTransition(STAGES.EXTRACTED, STAGES.APPROVED, deny);
  equal(r.ok, false);
  assert(r.reason.includes(ACTIONS.APPROVE_REGISTER), "and it names the action that was missing");
});

test("a real role gets exactly the moves its actions allow", async () => {
  // can() takes a membership object, not a role string.
  const allows = (role) => (action) => can({ role }, action);

  // qc records NDT and assigns welds, but does not sign a register off.
  equal(canTransition(STAGES.EXTRACTED, STAGES.APPROVED, allows("qc")).ok, false,
    "qc must not approve");
  equal(canTransition(STAGES.EXTRACTED, STAGES.APPROVED, allows("engineer")).ok, true,
    "an engineer may");
  equal(canTransition(STAGES.DRAFT, STAGES.EXTRACTED, allows("viewer")).ok, false,
    "a viewer changes nothing");
});

test("the server's gate refuses with a status and a code, not just a message", async () => {
  // A route that has to parse a sentence to decide on a status code will get
  // it wrong. The machine hands it both.
  equal(assertTransition(STAGES.EXTRACTED, STAGES.APPROVED).label, "تأیید");

  const locked = throws(() => assertTransition(STAGES.APPROVED, STAGES.EXTRACTED));
  equal(locked.status, 409);
  equal(locked.code, "RUN_LOCKED", "the code the API and its tests already use");

  const bad = throws(() => assertTransition(STAGES.FAILED, STAGES.APPROVED));
  equal(bad.status, 409);
  equal(bad.code, "INVALID_TRANSITION", "signing a failed extraction is a different fault");
});

test("a correction may be written to a live run and never to a signed one", async () => {
  // This is the rule lib/db/repos/review.mjs used to keep its own copy of,
  // spelled as `locked_at`. One rule, one home.
  for (const s of [STAGES.EXTRACTED, STAGES.IN_REVIEW, STAGES.FAILED]) {
    assertEditable(s);                 // throws on failure, so reaching here is the assertion
  }
  const e = throws(() => assertEditable(STAGES.APPROVED));
  equal(e.code, "RUN_LOCKED");
  equal(e.status, 409);
  assert(/رویژن جدید/.test(e.message), "and it points at the only legitimate route");

  equal(throws(() => assertEditable(STAGES.SUPERSEDED)).status, 409,
    "a retired revision is not a scratchpad either");
});

test("the machine says which stages the database actually stores", async () => {
  // `run_status` has four values. `draft` and `in_review` describe a screen,
  // not a row, and a server-side check that validated against them would be
  // checking something the database cannot hold.
  equal(PERSISTED_STAGES.every(isStage), true);
  equal(isPersisted(STAGES.DRAFT), false);
  equal(isPersisted(STAGES.IN_REVIEW), false);
  for (const s of [STAGES.EXTRACTED, STAGES.APPROVED, STAGES.SUPERSEDED, STAGES.FAILED]) {
    equal(isPersisted(s), true, `${s} is stored, so it must be validatable`);
  }
});

/** Run `fn`, expecting it to throw; hand back what it threw. */
function throws(fn) {
  try { fn(); } catch (e) { return e; }
  throw new Error("expected this to be refused, and it was allowed");
}

// ── the shape of the machine ─────────────────────────────────────────────

test("an unknown stage is refused rather than silently ignored", async () => {
  equal(canTransition("nonsense", STAGES.APPROVED).ok, false);
  equal(canTransition(STAGES.DRAFT, "nonsense").ok, false);
  equal(isStage("nonsense"), false);
});

test("a failed extraction can be retried", async () => {
  // Otherwise one bad read strands the document forever.
  equal(canTransition(STAGES.FAILED, STAGES.EXTRACTED).ok, true);
});

test("review can send a register back to be recomputed", async () => {
  // Editing the payload has to recompute the register, or the engineer is
  // approving numbers that no longer follow from the data.
  equal(canTransition(STAGES.IN_REVIEW, STAGES.EXTRACTED).ok, true);
  assert(transitionsFrom(STAGES.IN_REVIEW).length >= 2);
});

test("progress runs forward along the line, and failed sits outside it", async () => {
  equal(stageProgress(STAGES.DRAFT), 0);
  equal(stageProgress(STAGES.SUPERSEDED), 1);
  assert(stageProgress(STAGES.EXTRACTED) < stageProgress(STAGES.APPROVED));
  equal(stageProgress(STAGES.FAILED), null, "failure is not a step along the way");
});

test("every stage has a label, so nothing renders as a raw key", async () => {
  for (const s of Object.values(STAGES)) {
    assert(STAGE_FA[s] && STAGE_FA[s].length, `stage ${s} has no label`);
  }
});

// ── the registry ─────────────────────────────────────────────────────────

test("exactly what is built is marked built", async () => {
  // A platform that shows planned work as live is a lie the first user finds.
  equal(liveModules().map((m) => m.id), ["piping"], "only piping reads its drawings");
  equal(executionModules().map((m) => m.id).sort(),
    ["civil", "coating", "electrical", "equipment", "instrumentation", "piping", "structural"],
    "site tracking is built for all seven; drawing extraction only for piping");
  assert(MODULES.length > 1, "and the rest are declared, not hidden");
});

test("every module declares a source, a standard and an item", async () => {
  // Without these a module is a name on a menu. The standard in particular
  // is what its deterministic engine will answer to.
  for (const m of MODULES) {
    for (const k of ["title", "source", "standard", "item", "discipline"]) {
      assert(m[k] && String(m[k]).trim(), `module ${m.id} is missing ${k}`);
    }
    assert(m.stages.every(isStage), `module ${m.id} uses a stage the machine does not know`);
    assert(m.actions.every((a) => a in ACTIONS), `module ${m.id} names an unknown action key`);
  }
});

test("module ids are unique", async () => {
  equal(new Set(MODULES.map((m) => m.id)).size, MODULES.length);
  equal(byId("piping").discipline, "piping");
  equal(byId("nope"), null);
});

test("an engineer sees the modules they can act in", async () => {
  const forEngineer = modulesForRole("engineer", can, ACTIONS);
  assert(forEngineer.some((m) => m.id === "piping"), "piping is theirs");
  assert(forEngineer.length > 0, "and the filter does not silently empty the navigation");
});

test("a viewer sees every module, and can act in none", async () => {
  // Being able to look is not being able to act; hiding a module from
  // someone who may read it only makes them ask a colleague to look.
  equal(modulesForRole("viewer", can, ACTIONS).length, MODULES.length);
  const acts = MODULES.flatMap((m) => m.actions.map((k) => ACTIONS[k]));
  assert(!acts.some((a) => can({ role: "viewer" }, a)),
    "but a viewer holds none of the actions");
});

await run();
