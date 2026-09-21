/**
 * Deterministic guards that no model can talk its way past.
 *
 * These run before and after the repair pass, on the extraction the model
 * returned. They are pure functions over plain data — no DOM, no network —
 * which is the whole reason they live here rather than inside the page
 * component: a guard that cannot be tested is not a guard.
 */

/**
 * Repair the obvious, report what was repaired.
 *
 * Mutates `d` in place (the callers hold the only reference) and returns a
 * list of human-readable notes describing every change, because a silent
 * correction to an engineering extraction is indistinguishable from a bug.
 *
 * @returns {string[]} notes
 */
export function sanitize(d) {
  const notes = [];
  d.meta = d.meta || {};

  // The MTO's DIAM column is the authority on what diameters this line has.
  // A model that reports nps 3 for a 36" line is not making a small mistake,
  // it is reading the wrong number off the drawing entirely.
  const bomSizes = [...new Set((d.bom || []).map((b) => Number(b.diam)).filter((n) => n > 0))]
    .sort((a, b) => b - a);
  if (bomSizes.length) {
    const n = Number(d.meta.nps);
    if (!n || !bomSizes.includes(n)) {
      notes.push(`nps از ${n || "خالی"} به ${bomSizes[0]}" اصلاح شد (ستون DIAM در MTO)`);
      d.meta.nps = bomSizes[0];
    }
    (d.edges || []).forEach((e) => { if (!bomSizes.includes(Number(e.nps))) e.nps = d.meta.nps; });
  }

  // A node without numeric coordinates cannot be placed, and two nodes at the
  // same point are one node read twice.
  const before = (d.nodes || []).length;
  const seen = new Set();
  d.nodes = (d.nodes || []).filter((n) => {
    if (![n.E, n.N, n.EL].every((v) => typeof v === "number" && isFinite(v))) return false;
    const k = `${n.E}|${n.N}|${n.EL}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (d.nodes.length !== before) {
    notes.push(`${before - d.nodes.length} گره تکراری یا بی‌مختصات حذف شد`);
  }

  // An edge pointing at a node that no longer exists would crash the engine.
  const ids = new Set(d.nodes.map((n) => n.id));
  if (Array.isArray(d.edges)) d.edges = d.edges.filter((e) => ids.has(e.from) && ids.has(e.to));

  return notes;
}

/**
 * How bad a model is, lower being better.
 *
 * An error counts far more than any number of warnings: a repair pass that
 * deleted the route has zero warnings precisely because there is nothing left
 * to check, and the old guard read that as an improvement.
 */
export const score = (m) => (m.error ? 1000 : 0) + ((m.checks || []).filter((c) => c.status === "warn").length);

/**
 * Should the repair pass's output replace the original?
 *
 * Three conditions, all of which must hold. This is the guard that stopped
 * the repair pass from destroying a route (README, v3.1), stated once here
 * instead of inline in a click handler.
 *
 * @returns {{accept: boolean, why?: string}}
 */
export function acceptRepair(before, after, baseData, fixedData) {
  const lostGeometry = (fixedData.nodes || []).length < (baseData.nodes || []).length;
  if ((fixedData.nodes || []).length < 2) return { accept: false, why: "نتیجه کمتر از دو گره داشت" };
  if (lostGeometry) return { accept: false, why: "پاس اصلاح گره حذف کرده بود" };
  if (!(score(after) < score(before))) return { accept: false, why: "چک‌ها بهتر نشدند" };
  return { accept: true };
}
