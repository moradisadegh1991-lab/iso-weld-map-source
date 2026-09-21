/**
 * Choosing which welds get radiographed.
 *
 * §341.4.1(b) does not say "any 5%". It says the welds examined shall be
 * selected to ensure that the work of each welder is included. A sample drawn
 * without that constraint can radiograph five welds from one crew and none
 * from the man whose repair rate is about to become a problem — which is the
 * exact failure the clause exists to prevent.
 *
 * REPRODUCIBLE ON PURPOSE
 *
 * The selection is seeded and deterministic. A "random" sample nobody can
 * reproduce is not auditable: when an inspector asks why these welds and not
 * others, the answer has to be a procedure, not a shrug. Store the seed with
 * the selection and the same welds come back every time.
 */

/** Small, fast, deterministic. Not for cryptography; this is a dice roll with a receipt. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < String(text).length; i++) {
    h ^= String(text).charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Fisher-Yates driven by the seeded generator, so the order is reproducible. */
function shuffled(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * @param {Array} population  welds eligible for this requirement,
 *                            each { weldUid, welderId?, stampNo?, weldNo }
 * @param {number} percent    the governing percentage
 * @param {string} seed       anything stable — a line number and revision works well
 *
 * @returns {{selected, required, coverageAdded, uncovered, unassigned, seed, rate}}
 */
export function selectSample(population, percent, { seed = "default" } = {}) {
  const rand = mulberry32(seedFrom(seed));
  const total = population.length;
  const required = Math.ceil((Number(percent) / 100) * total);

  if (!total || !required) {
    return { selected: [], required, coverageAdded: [], uncovered: [],
             unassigned: [], seed, rate: 0, total };
  }

  const withWelder = population.filter((w) => w.welderId);
  const unassigned = population.filter((w) => !w.welderId);

  // One from each welder first — the constraint that outranks the percentage.
  const byWelder = new Map();
  for (const w of withWelder) {
    if (!byWelder.has(w.welderId)) byWelder.set(w.welderId, []);
    byWelder.get(w.welderId).push(w);
  }

  const picked = new Map();
  const coverageAdded = [];
  for (const [, welds] of [...byWelder.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    const choice = shuffled(welds, rand)[0];
    picked.set(choice.weldUid, choice);
    coverageAdded.push(choice);
  }

  // Then fill up to the percentage from whatever is left.
  const rest = shuffled(population.filter((w) => !picked.has(w.weldUid)), rand);
  for (const w of rest) {
    if (picked.size >= required) break;
    picked.set(w.weldUid, w);
  }

  const selected = [...picked.values()];
  return {
    selected,
    required,
    total,
    // When there are more welders than the percentage would sample, coverage
    // wins and the sample is larger. That is the clause working, not a bug.
    coverageAdded: coverageAdded.filter((w) => selected.includes(w)),
    uncovered: [],
    unassigned,
    seed,
    rate: Math.round((selected.length / total) * 1000) / 10,
  };
}

/**
 * How much of what was required has actually been examined.
 *
 * Reported per welder as well as in total, because "92% complete" hides the
 * one welder whose work nobody has shot yet — and that is the welder whose
 * spools will be held at handover.
 */
export function coverage({ required = [], records = [] }) {
  const done = new Map();
  for (const r of records) {
    if (r.repair_cycle !== 0 && r.repairCycle !== 0) continue;   // first shots only
    done.set(r.weld_uid ?? r.weldUid, r.result);
  }

  const byWelder = new Map();
  let examined = 0, rejected = 0;
  for (const w of required) {
    const key = w.stampNo || w.welderId || "—";
    if (!byWelder.has(key)) byWelder.set(key, { stampNo: key, required: 0, examined: 0, rejected: 0 });
    const bucket = byWelder.get(key);
    bucket.required++;
    const result = done.get(w.weldUid);
    if (result) {
      bucket.examined++;
      examined++;
      if (result === "reject") { bucket.rejected++; rejected++; }
    }
  }

  const welders = [...byWelder.values()].map((b) => ({
    ...b, pct: b.required ? Math.round((b.examined / b.required) * 1000) / 10 : null,
  })).sort((a, b) => a.pct - b.pct);

  return {
    required: required.length,
    examined,
    rejected,
    pct: required.length ? Math.round((examined / required.length) * 1000) / 10 : null,
    welders,
    // The list that matters at handover: welders with nothing examined at all.
    welderGaps: welders.filter((w) => w.examined === 0 && w.required > 0),
  };
}
