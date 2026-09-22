/**
 * The contractor's register against the one this project computed.
 *
 * This produces the only honest accuracy number the project can have, so it
 * is written to refuse the two ways such a number usually gets inflated.
 *
 * FIRST: a field is only scored when BOTH sides carry a value. A register
 * with no joint-type column must not make the type score 0%, and it must not
 * quietly make it 100% either — it is simply not measured, and says so.
 *
 * SECOND: a weld present on one side only is never paired with a neighbour
 * to make the numbers tidy. Missing and extra are reported as themselves,
 * and they are different failures: a weld the extraction never found is a
 * weld nobody will inspect, while one it invented is a line item the shop
 * will query. Averaging them into a single "accuracy" would hide both.
 */

const FIELDS = ["loc", "kind", "nps"];

/** Weld numbers compare on digits, so W-01, W01 and 1 are the same weld. */
export function weldKey(no) {
  const digits = String(no ?? "").replace(/\D+/g, "");
  return digits ? String(Number(digits)) : String(no ?? "").trim().toLowerCase();
}

/**
 * @param {Array} truth  rows from the contractor's register
 * @param {Array} computed  model.register
 */
export function compareRegister(truth = [], computed = []) {
  const byKey = new Map(computed.map((w) => [weldKey(w.no), w]));
  const seen = new Set();

  const matched = [];
  const missing = [];            // in the contractor's register, not in ours
  for (const t of truth) {
    const k = weldKey(t.no);
    const c = byKey.get(k);
    if (!c) { missing.push(t); continue; }
    seen.add(k);

    const diffs = [];
    for (const f of FIELDS) {
      const a = t[f], b = c[f];
      // Not scored unless both sides have something to say.
      if (a == null || a === "" || b == null || b === "") continue;
      const same = String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
      diffs.push({ field: f, truth: a, computed: b, same });
    }
    matched.push({ no: t.no, diffs });
  }
  const extra = computed.filter((w) => !seen.has(weldKey(w.no)));

  // Per field, over the matched welds only: an unmatched weld is a counting
  // error, not a field error, and mixing the two would double-count it.
  const fields = {};
  for (const f of FIELDS) {
    const scored = matched.flatMap((m) => m.diffs.filter((d) => d.field === f));
    fields[f] = {
      compared: scored.length,
      correct: scored.filter((d) => d.same).length,
      measured: scored.length > 0,
    };
  }

  const compared = Object.values(fields).reduce((a, f) => a + f.compared, 0);
  const correct = Object.values(fields).reduce((a, f) => a + f.correct, 0);

  return {
    counts: {
      truth: truth.length,
      computed: computed.length,
      matched: matched.length,
      missing: missing.length,
      extra: extra.length,
    },
    // The headline is deliberately two numbers, not one: getting the weld
    // COUNT right and getting each weld's ATTRIBUTES right are separate
    // claims, and a single percentage would let a good one carry a bad one.
    weldCountExact: truth.length > 0 && missing.length === 0 && extra.length === 0,
    fieldAccuracy: compared ? correct / compared : null,
    fields, matched, missing, extra,
  };
}

/**
 * The `expect` block for a golden case, written from the contractor's
 * register rather than from anything this engine produced.
 *
 * That direction is the whole point. An expectation derived from our own
 * output would make every future run agree with today's bugs.
 */
export function toGoldenExpect(truth = []) {
  const field = truth.filter((w) => w.loc === "Field");
  const expect = {
    weldCount: truth.length,
    fieldWeldCount: field.length,
    register: truth.map((w) => {
      const row = { no: w.no };
      if (w.loc) row.loc = w.loc;
      if (w.kind) row.kind = w.kind;
      if (w.nps) row.nps = w.nps;
      return row;
    }),
  };
  if (field.length) expect.fieldWelds = field.map((w) => w.no);
  return expect;
}
