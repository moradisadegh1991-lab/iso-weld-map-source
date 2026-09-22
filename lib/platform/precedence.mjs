/**
 * What must happen before what, around a tag.
 *
 * WHY THIS IS THE SECOND MODULE AND NOT ELECTRICAL
 *
 * A subsystem's readiness table says WHAT is incomplete. It cannot say WHY,
 * and "why" is the entire job of a construction planner. The answer lives in
 * a chain that every discipline touches in turn and none of them owns:
 *
 *   فونداسیون → استقرار → گروت → الایمنت → پایپینگ → کنترل تنش لوله
 *                                              ↘ برق ↘ ابزار دقیق → راه‌اندازی
 *
 * An equipment tag is where all six disciplines meet. Building it first turns
 * `tag` from a filing label into the dependency graph the schedule is really
 * made of — so "why is 21-01 late" stops being an afternoon in Primavera and
 * becomes a query.
 *
 * THIS IS ENGINE CODE, NOT MODEL CODE. No language model decides what
 * precedes what. The order below is engineering practice, written down where
 * it can be reviewed and tested, exactly as `lib/engine.js` holds B31.3.
 *
 * `blocked` is NEVER stored — it is computed from the predecessors every time
 * it is asked for. A stored blocked flag is wrong the moment its predecessor
 * completes, and nobody goes back to clear it.
 */

/** A step nobody has recorded anything against yet. */
export const NOT_STARTED = "not_started";
export const IN_PROGRESS = "in_progress";
export const DONE = "done";

/**
 * The chain for machinery that turns.
 *
 * Two orderings here are the ones people get wrong, and both cost money:
 *
 * GROUT BEFORE ALIGNMENT. Grout cures and the baseplate moves. Aligning
 * first means aligning to a position that will not survive the pour, and the
 * alignment has to be done twice — once for nothing.
 *
 * ALIGNMENT RE-CHECKED AFTER PIPING. Bolting up a suction and discharge
 * flange pulls the machine. This is pipe strain, it is invisible on a
 * walkdown, and it is a leading cause of the vibration and bearing failures
 * that show up months into operation — by which time it reads as an
 * equipment problem rather than an installation one. API 686 treats the
 * post-connection check as a distinct hold point, so it is a distinct step
 * here. The tolerance itself belongs to the project's own machinery spec,
 * not to this file.
 *
 * Electrical and instrumentation hang off `set` rather than the piping
 * chain, because they genuinely can proceed in parallel — a chain drawn as
 * one line would invent a dependency and idle two crews.
 */
const ROTATING = [
  { code: "foundation", discipline: "civil",           title: "فونداسیون و بولت", after: [] },
  { code: "set",        discipline: "equipment",       title: "استقرار و تراز بیس‌پلیت", after: ["foundation"] },
  { code: "grout",      discipline: "civil",           title: "گروت‌ریزی", after: ["set"] },
  { code: "align",      discipline: "equipment",       title: "الایمنت سرد", after: ["grout"] },
  { code: "piping",     discipline: "piping",          title: "اتصال پایپینگ",
    after: ["align"], derive: "piping" },
  { code: "strain",     discipline: "equipment",       title: "کنترل تنش لوله و الایمنت نهایی", after: ["piping"] },
  { code: "electrical", discipline: "electrical",      title: "ترمینیشن برق", after: ["set"] },
  { code: "instrument", discipline: "instrumentation", title: "نصب و تست ابزار دقیق", after: ["set"] },
  { code: "ready",      discipline: "equipment",       title: "آمادگی راه‌اندازی",
    after: ["strain", "electrical", "instrument"] },
];

/** Vessels, exchangers, filters: set and connected, never aligned. */
const STATIC = [
  { code: "foundation", discipline: "civil",           title: "فونداسیون و بولت", after: [] },
  { code: "set",        discipline: "equipment",       title: "استقرار و تراز", after: ["foundation"] },
  { code: "grout",      discipline: "civil",           title: "گروت‌ریزی", after: ["set"] },
  { code: "piping",     discipline: "piping",          title: "اتصال پایپینگ",
    after: ["grout"], derive: "piping" },
  { code: "electrical", discipline: "electrical",      title: "ترمینیشن برق (تریسینگ/ارت)", after: ["set"] },
  { code: "instrument", discipline: "instrumentation", title: "نصب و تست ابزار دقیق", after: ["set"] },
  { code: "ready",      discipline: "equipment",       title: "آمادگی راه‌اندازی",
    after: ["piping", "electrical", "instrument"] },
];

export const CHAINS = { rotating: ROTATING, static: STATIC };

/**
 * Which chain a tag follows.
 *
 * Returns null rather than guessing for a kind nobody declared. A tag filed
 * under the wrong chain would report a hold point that does not exist, or
 * — worse — omit one that does.
 */
export function chainFor(kind) {
  return CHAINS[String(kind || "").toLowerCase()] || null;
}

/** The step every chain ends at. */
export const TERMINAL = "ready";

/**
 * The state of every step, given what has been recorded.
 *
 * @param {Array} chain    from CHAINS
 * @param {Record<string, string>} recorded  code -> NOT_STARTED|IN_PROGRESS|DONE
 * @returns {Array<{code, title, discipline, status, blocked, waitingOn}>}
 */
export function walk(chain, recorded = {}) {
  const byCode = new Map(chain.map((s) => [s.code, s]));
  const state = (c) => recorded[c] || NOT_STARTED;

  return chain.map((s) => {
    const waitingOn = s.after.filter((p) => state(p) !== DONE);
    // A step already recorded as done is done, even if a predecessor is not.
    // That situation is a data problem worth surfacing, not a reason to
    // contradict a record somebody signed.
    const outOfOrder = state(s.code) === DONE && waitingOn.length > 0;
    return {
      code: s.code,
      title: s.title,
      discipline: s.discipline,
      derived: Boolean(s.derive),
      status: state(s.code),
      blocked: state(s.code) !== DONE && waitingOn.length > 0,
      waitingOn: waitingOn.map((p) => ({ code: p, title: byCode.get(p)?.title || p })),
      outOfOrder,
    };
  });
}

/** What can be started right now, and by which discipline. */
export function nextActions(chain, recorded = {}) {
  return walk(chain, recorded)
    .filter((s) => s.status !== DONE && !s.blocked)
    .map(({ code, title, discipline, status }) => ({ code, title, discipline, status }));
}

/**
 * Why a step cannot happen — traced back to the work that actually has to
 * start, not just its immediate predecessor.
 *
 * "راه‌اندازی بسته است چون کنترل تنش انجام نشده" is not useful; the crew that
 * has to move is the one pouring the foundation. So the trace walks back
 * until it reaches steps with nothing left blocking them, and reports those.
 *
 * @returns {{ready: boolean, rootCauses: Array, path: Array}}
 */
export function whyNotReady(chain, recorded = {}, target = TERMINAL) {
  const steps = new Map(walk(chain, recorded).map((s) => [s.code, s]));
  const goal = steps.get(target);
  if (!goal) return { ready: false, rootCauses: [], path: [], unknownTarget: true };
  if (goal.status === DONE) return { ready: true, rootCauses: [], path: [] };

  const roots = new Map();
  const path = [];
  const seen = new Set();

  (function back(code) {
    if (seen.has(code)) return;          // a chain is a DAG, but guard anyway
    seen.add(code);
    const s = steps.get(code);
    if (!s || s.status === DONE) return;
    path.push({ code: s.code, title: s.title, discipline: s.discipline, status: s.status });
    if (!s.blocked) { roots.set(s.code, s); return; }
    for (const w of s.waitingOn) back(w.code);
  })(target);

  return {
    ready: false,
    // The work that can actually start today, which is the only part anyone
    // can act on this morning.
    rootCauses: [...roots.values()].map(
      ({ code, title, discipline, status }) => ({ code, title, discipline, status })),
    path,
  };
}

/** How far along a tag is. Steps done over steps in the chain. */
export function progress(chain, recorded = {}) {
  const done = chain.filter((s) => (recorded[s.code] || NOT_STARTED) === DONE).length;
  return { done, total: chain.length, pct: Math.round((done / chain.length) * 1000) / 10 };
}

/**
 * Is a chain well formed?
 *
 * Exported so a test can assert it, and so a chain added later cannot ship
 * with a predecessor nobody defined or a cycle that would hang `whyNotReady`.
 */
export function validateChain(chain) {
  const codes = new Set(chain.map((s) => s.code));
  const problems = [];
  if (codes.size !== chain.length) problems.push("duplicate step code");
  if (!codes.has(TERMINAL)) problems.push(`no "${TERMINAL}" step`);

  for (const s of chain) {
    for (const p of s.after) {
      if (!codes.has(p)) problems.push(`${s.code} waits on unknown step ${p}`);
    }
  }
  // Cycle detection: a cycle would make whyNotReady recurse forever, and the
  // `seen` guard there would hide it rather than report it.
  const mark = new Map();
  const visit = (code, stack) => {
    if (mark.get(code) === "done") return;
    if (stack.has(code)) { problems.push(`cycle through ${code}`); return; }
    stack.add(code);
    for (const p of chain.find((s) => s.code === code)?.after || []) visit(p, stack);
    stack.delete(code);
    mark.set(code, "done");
  };
  for (const s of chain) visit(s.code, new Set());
  return problems;
}
