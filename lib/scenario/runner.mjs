/**
 * Plays scenario steps against a project (lib/scenario/dm-pump.mjs).
 *
 * Each step runs bound to the project, as the application's restricted
 * role — the same row security the forms go through. A refusal a step
 * expects must come with the reason the guide promises.
 *
 * `x.d(n)` is day n of the job: day 0 is `start`, and the whole scenario
 * sits in the past so no date is refused for being in the future.
 */
import { withProject } from "../db/scope.mjs";

export function context({ db, projectId, users, start }) {
  const t0 = new Date(`${start}T00:00:00Z`).getTime();
  const x = {
    db, P: projectId, users, ids: {}, log: [], step: null, refusals: {},
    d: (n) => new Date(t0 + n * 86400000).toISOString().slice(0, 10),
    at: (n, h = 9) => new Date(t0 + n * 86400000 + h * 3600000).toISOString(),
    check(ok, what) { if (!ok) throw new Error(`scenario check failed: ${what}`); x.log.push(`ok  ${what}`); },
    async refused(fn, pattern) {
      try {
        await fn();
      } catch (e) {
        const msg = String(e.message || e);
        if (pattern && !pattern.test(msg)) throw new Error(`refused, but not for the expected reason: ${msg}`);
        x.log.push(`ok  refused: ${msg.slice(0, 160)}`);
        (x.refusals[x.step] ||= []).push(msg);
        return msg;
      }
      throw new Error("expected the platform to refuse this, and it did not");
    },
  };
  return x;
}

/** Run `steps` in order; `onStep(step, x)` after each. Stops at the first failure, naming the step. */
export async function play(x, steps, { onStep = null } = {}) {
  for (const s of steps) {
    x.step = s.id;
    try {
      await withProject(x.db, x.P, () => s.run(x));
    } catch (e) {
      throw Object.assign(new Error(`step ${s.id} «${s.title}»: ${e.message}`), { step: s.id, cause: e });
    }
    onStep?.(s, x);
  }
  return x;
}

/** Day 0 of a scenario that ends `days` days ago at the latest — today minus the length of the job. */
export function startFor(days, today = new Date()) {
  return new Date(today.getTime() - (days + 2) * 86400000).toISOString().slice(0, 10);
}
