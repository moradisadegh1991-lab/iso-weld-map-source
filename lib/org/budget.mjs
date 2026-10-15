/**
 * A contract's budget, per currency — the owner's columns (step 2.3):
 *
 *   forecast    the budget forecast in the currency (typed, from the contract)
 *   weight %    forecast × rate ÷ Σ(forecast × rate) over the contract's currencies
 *   done        the approved payment statements' gross, when the currency is
 *               the contract's own (statements are in it); otherwise typed —
 *               and said to be typed
 *   remaining   forecast − done
 *   decrease    Σ negative amendment changes (shown positive)
 *   increase    Σ positive amendment changes
 *   new items   Σ amendment new-item lines
 *   needed      forecast − decrease + increase + new items
 *
 * Every money figure is also given in the base unit (× rate). Pure: rows in,
 * rows out.
 */

const r2 = (v) => Math.round(v * 100) / 100;

/**
 * currencies: [{ currency, rate, budget, done_typed }]
 * amendments: [{ currency, kind: 'change'|'new_items', amount }]
 * statementDone: number|null — approved statements' gross, in `mainCurrency`
 */
export function contractBudget({ currencies = [], amendments = [], statementDone = null, mainCurrency = null }) {
  const base = currencies.reduce((s, c) => s + Number(c.budget) * Number(c.rate), 0);
  const rows = currencies.map((c) => {
    const lines = amendments.filter((a) => a.currency === c.currency);
    const increase = lines.filter((a) => a.kind === "change" && Number(a.amount) > 0).reduce((s, a) => s + Number(a.amount), 0);
    const decrease = -lines.filter((a) => a.kind === "change" && Number(a.amount) < 0).reduce((s, a) => s + Number(a.amount), 0);
    const newItems = lines.filter((a) => a.kind === "new_items").reduce((s, a) => s + Number(a.amount), 0);
    const fromStatements = c.currency === mainCurrency && statementDone != null;
    const done = fromStatements ? Number(statementDone) : c.done_typed == null ? null : Number(c.done_typed);
    const forecast = Number(c.budget), rate = Number(c.rate);
    return {
      currency: c.currency, rate, forecast,
      weightPct: base > 0 ? r2((forecast * rate * 100) / base) : null,
      done, doneSource: fromStatements ? "statements" : done == null ? null : "typed",
      remaining: done == null ? null : r2(forecast - done),
      decrease: r2(decrease), increase: r2(increase), newItems: r2(newItems),
      needed: r2(forecast - decrease + increase + newItems),
      base: { forecast: r2(forecast * rate), needed: r2((forecast - decrease + increase + newItems) * rate),
        done: done == null ? null : r2(done * rate) },
    };
  });
  const sum = (k) => r2(rows.reduce((s, x) => s + (x.base[k] ?? 0), 0));
  return { rows, total: { forecast: sum("forecast"), needed: sum("needed"), done: rows.some((x) => x.done != null) ? sum("done") : null } };
}

/** The contract period after its time amendments: end + Σ days. */
export function revisedEnd(endOn, amendments = []) {
  if (!endOn) return null;
  const days = amendments.reduce((s, a) => s + (Number(a.days) || 0), 0);
  const day = endOn instanceof Date
    ? `${endOn.getFullYear()}-${String(endOn.getMonth() + 1).padStart(2, "0")}-${String(endOn.getDate()).padStart(2, "0")}` : String(endOn).slice(0, 10);
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return { endOn: d.toISOString().slice(0, 10), days };
}

/** An amendment as typed: what is wrong with it. */
export function amendmentProblems({ kind, days, lines = [] }) {
  const p = [];
  if (!["time", "financial", "both"].includes(kind)) p.push("نوع الحاقیه را انتخاب کنید (زمانی، مالی یا هر دو).");
  const d = Number(days) || 0;
  if ((kind === "time" || kind === "both") && !d) p.push("الحاقیهٔ زمانی تعداد روز افزایش یا کاهش مدت لازم دارد.");
  if (kind === "financial" && d) p.push("الحاقیهٔ فقط مالی مدت را تغییر نمی‌دهد.");
  if ((kind === "financial" || kind === "both") && !lines.length) p.push("الحاقیهٔ مالی دست‌کم یک ردیف مبلغ لازم دارد.");
  if (kind === "time" && lines.length) p.push("الحاقیهٔ فقط زمانی مبلغ ندارد.");
  for (const l of lines) {
    const a = Number(l.amount);
    if (!l.currency) p.push("ارز هر ردیف لازم است.");
    if (!Number.isFinite(a) || a === 0) p.push(`مبلغ ${l.currency || ""} باید عددی غیر صفر باشد.`);
    if (l.kind === "new_items" && a < 0) p.push("بودجهٔ آیتم‌های جدید منفی نمی‌شود؛ کاهش را با «تغییر» ثبت کنید.");
  }
  return p;
}

/** A tree from parent-linked rows: [{...row, children: []}], siblings by seq then name. */
export function treeOf(rows) {
  const byId = new Map(rows.map((r) => [r.id, { ...r, children: [] }]));
  const roots = [];
  for (const n of byId.values()) (n.parent_id && byId.has(n.parent_id) ? byId.get(n.parent_id).children : roots).push(n);
  const sort = (xs) => { xs.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || String(a.name).localeCompare(String(b.name), "fa")); xs.forEach((x) => sort(x.children)); return xs; };
  return sort(roots);
}

/** Would moving `id` under `parentId` make a loop? */
export function makesCycle(rows, id, parentId) {
  const parent = new Map(rows.map((r) => [r.id, r.parent_id]));
  for (let p = parentId; p; p = parent.get(p)) if (p === id) return true;
  return false;
}
