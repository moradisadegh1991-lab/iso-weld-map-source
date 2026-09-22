/**
 * What each pane in the navigator is worth opening for.
 *
 * Kept out of the component so it can be tested without a browser: this is
 * the logic that decides whether a problem is visible from the tab strip,
 * and on the first live extraction that mattered — the engine found that the
 * MTO listed a weld-neck flange the model had not placed in the geometry,
 * and the warning sat in a tab nobody had opened.
 *
 * Counts are neutral; only something the engineer must act on takes the
 * warning tone, because a badge that is always lit is a badge nobody reads.
 */

/** @returns {{text: string, tone: "warn"|"plain"}|null} */
export function badgeFor(k, model, data) {
  const ok = model && !model.error;

  if (k === "weld") {
    return ok && model.totals?.welds ? { text: String(model.totals.welds), tone: "plain" } : null;
  }

  if (k === "check") {
    if (!ok) return null;
    // Both live in this pane: a check the engine failed, and a value the
    // model admitted it could not read.
    const warns = (model.checks || []).filter((c) => c.status === "warn").length
      + (data?.unreadable?.length || 0);
    if (warns) return { text: `${warns} !`, tone: "warn" };
    // A tick rather than nothing, so "everything passed" is distinguishable
    // from "nothing has been computed yet".
    return (model.checks || []).length ? { text: "✓", tone: "plain" } : null;
  }

  if (k === "truth") {
    // Nothing to count until a register is loaded — and this badge must not
    // invent one: an accuracy figure that appears before any contractor data
    // has been read would be the worst lie in the app.
    return null;
  }

  if (k === "mto") {
    const rows = data?.bom?.length || 0;
    if (!rows) return null;
    // A BOM row the engine could not place is the same class of problem as a
    // failed check, and this is the pane that shows which row.
    const orphans = (model?.bomDropped?.length || 0) + (model?.bomGhosted?.length || 0);
    return orphans
      ? { text: `${rows} · ${orphans} !`, tone: "warn" }
      : { text: String(rows), tone: "plain" };
  }

  return null;
}
