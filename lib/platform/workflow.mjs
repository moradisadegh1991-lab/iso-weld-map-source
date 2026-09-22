/**
 * The stages a document passes through, for every discipline.
 *
 * WHY THIS IS SHARED AND NOT PER-MODULE
 *
 * Piping, civil, structural steel, electrical and instrumentation all do the
 * same thing to a drawing: take it in, read it, let an engineer reconcile
 * what was read, sign it, and retire it when a newer revision is signed.
 * Only the schema and the engineering rules differ.
 *
 * Left to itself each module would invent its own stage names, and then
 * nothing could be reported across disciplines — the "ten tools that never
 * join" failure the plan warns about. So the stages live here once, and a
 * module declares which of them it uses rather than naming its own.
 *
 * Every transition carries the ACTION it requires, so authorisation is one
 * answer rather than one answer per module. It stores the action's VALUE
 * from lib/authz.mjs rather than its key, so a transition can be handed
 * straight to can() — storing the key looked identical and silently denied
 * everything, which a test caught.
 */

import { ACTIONS } from "../authz.mjs";

export const STAGES = {
  DRAFT: "draft",             // uploaded, nothing read yet
  EXTRACTED: "extracted",     // the model read it and the engine built a register
  IN_REVIEW: "in_review",     // an engineer is reconciling what was read
  APPROVED: "approved",       // signed and locked
  SUPERSEDED: "superseded",   // a newer revision was signed
  FAILED: "failed",           // extraction or the engine could not produce one
};

export const STAGE_ORDER = [
  STAGES.DRAFT, STAGES.EXTRACTED, STAGES.IN_REVIEW, STAGES.APPROVED, STAGES.SUPERSEDED,
];

/**
 * Every legal move, and what it takes to make it.
 *
 * The rule that matters most is the one that is NOT here: there is no
 * transition out of `approved` except to `superseded`. An approved register
 * has an engineer's signature against a hash of its contents, so editing it
 * would leave the signature attesting to something that no longer exists.
 * A correction is a new revision, which is the only honest way to keep both
 * the old record and the new one. The API already refuses the edit; this
 * states the same rule where every module can see it.
 */
export const TRANSITIONS = [
  { from: STAGES.DRAFT, to: STAGES.EXTRACTED, action: ACTIONS.RUN_EXTRACTION, label: "استخراج" },
  { from: STAGES.DRAFT, to: STAGES.FAILED, action: ACTIONS.RUN_EXTRACTION, label: "شکست استخراج" },
  { from: STAGES.FAILED, to: STAGES.EXTRACTED, action: ACTIONS.RUN_EXTRACTION, label: "تلاش دوباره" },

  { from: STAGES.EXTRACTED, to: STAGES.IN_REVIEW, action: ACTIONS.EDIT_EXTRACTION, label: "شروع بازبینی" },
  { from: STAGES.IN_REVIEW, to: STAGES.EXTRACTED, action: ACTIONS.EDIT_EXTRACTION, label: "محاسبهٔ دوباره" },

  { from: STAGES.EXTRACTED, to: STAGES.APPROVED, action: ACTIONS.APPROVE_REGISTER, label: "تأیید" },
  { from: STAGES.IN_REVIEW, to: STAGES.APPROVED, action: ACTIONS.APPROVE_REGISTER, label: "تأیید" },

  { from: STAGES.APPROVED, to: STAGES.SUPERSEDED, action: ACTIONS.RUN_EXTRACTION, label: "رویژن جدید" },
];

/** Is this a stage the system knows? */
export const isStage = (s) => Object.values(STAGES).includes(s);

/** Everything reachable from here. */
export function transitionsFrom(stage) {
  return TRANSITIONS.filter((t) => t.from === stage);
}

/**
 * May this move be made, and by whom?
 *
 * @param {string} from
 * @param {string} to
 * @param {(action: string) => boolean} allows  usually a closure over lib/authz
 * @returns {{ok: true, transition: object} | {ok: false, reason: string}}
 */
export function canTransition(from, to, allows = () => true) {
  if (!isStage(from)) return { ok: false, reason: `unknown stage: ${from}` };
  if (!isStage(to)) return { ok: false, reason: `unknown stage: ${to}` };

  const t = TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) {
    // Named rather than generic, because this one is asked about constantly
    // and "not allowed" would send someone looking for a bug.
    if (from === STAGES.APPROVED) {
      return { ok: false, reason:
        "رجیستر تأییدشده قفل است — اصلاح یعنی رویژن جدید، نه ویرایش همین." };
    }
    return { ok: false, reason: `no transition from ${from} to ${to}` };
  }
  if (!allows(t.action)) return { ok: false, reason: `action not permitted: ${t.action}` };
  return { ok: true, transition: t };
}

/** Where a stage sits on the line, for a progress indicator. 0..1, or null. */
export function stageProgress(stage) {
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? null : i / (STAGE_ORDER.length - 1);
}

/** Persian label for a stage. */
export const STAGE_FA = {
  [STAGES.DRAFT]: "بارگذاری‌شده",
  [STAGES.EXTRACTED]: "استخراج‌شده",
  [STAGES.IN_REVIEW]: "در بازبینی",
  [STAGES.APPROVED]: "تأییدشده",
  [STAGES.SUPERSEDED]: "منسوخ",
  [STAGES.FAILED]: "ناموفق",
};
