/**
 * Finance: what the project has committed, certified and paid — by contract
 * and by WBS element — and the cash that went out, by month.
 *
 * Nothing here is entered twice. Commitments are the contracts' payment
 * items and the purchase orders; certified is the approved statements; the
 * actual cost of a WBS element is its cost entries (approved statements post
 * there, lib/db/repos/contracts.mjs); paid is the payments recorded.
 *
 * Money is never summed across currencies: each total is per currency.
 *
 * Call inside `withProject`.
 */
import { contractsBoard } from "./contracts.mjs";

const r2 = (x) => Math.round(Number(x) * 100) / 100;

export async function financeBoard(db, { projectId }) {
  const { rows: [proj] } = await db.query("SELECT contract_currency FROM project WHERE id = $1", [projectId]);
  const contracts = await contractsBoard(db, { projectId });

  // By WBS element: budget, committed in contracts, actual (cost entries), certified by statements.
  const { rows: wbs } = await db.query(
    `SELECT a.id, a.code, a.title, a.bac,
            (SELECT COALESCE(sum(l.qty * l.rate), 0) FROM contract_line l JOIN contract c ON c.id = l.contract_id
              WHERE l.account_id = a.id AND c.status IN ('signed', 'closed')) AS committed,
            (SELECT COALESCE(sum(e.amount), 0) FROM cost_entry e WHERE e.account_id = a.id) AS actual,
            (SELECT count(*) FROM cost_entry e WHERE e.account_id = a.id AND e.ref_no LIKE '%/PS-%') AS from_statements
       FROM control_account a WHERE a.project_id = $1 ORDER BY a.code`, [projectId]);

  // Purchase orders: commitments priced line by line, in each PO's own currency.
  const { rows: pos } = await db.query(
    `SELECT p.po_no, p.currency, v.code AS vendor, COALESCE(sum(pl.qty * pl.unit_price), 0) AS value,
            count(pl.id) FILTER (WHERE pl.unit_price IS NULL)::int AS unpriced
       FROM purchase_order p JOIN vendor v ON v.id = p.vendor_id LEFT JOIN po_line pl ON pl.po_id = p.id
      WHERE p.project_id = $1 GROUP BY p.id, v.code ORDER BY p.po_no`, [projectId]);

  // Cash out, by month and currency.
  const { rows: cash } = await db.query(
    `SELECT to_char(p.paid_on, 'YYYY-MM') AS month, c.currency, p.kind, sum(p.amount) AS amount
       FROM contract_payment p JOIN contract c ON c.id = p.contract_id WHERE p.project_id = $1
      GROUP BY 1, 2, 3 ORDER BY 1`, [projectId]);

  // Totals per currency.
  const totals = {};
  const t = (cur) => (totals[cur] ||= { currency: cur, contractValue: 0, boq: 0, certified: 0, netApproved: 0, paid: 0, retentionHeld: 0, due: 0, poValue: 0 });
  for (const c of contracts) {
    if (!["signed", "closed"].includes(c.status)) continue;
    const x = t(c.currency);
    x.contractValue += c.value || 0; x.boq += c.boq; x.certified += c.certified; x.netApproved += c.netApproved;
    x.paid += c.payments.filter((p) => p.kind !== "advance").reduce((s, p) => s + p.amount, 0);
    x.retentionHeld += c.retentionHeld;
  }
  for (const p of pos) if (p.currency) t(p.currency).poValue += Number(p.value);
  for (const x of Object.values(totals)) {
    x.due = x.netApproved - x.paid;
    for (const k of Object.keys(x)) if (typeof x[k] === "number") x[k] = r2(x[k]);
  }

  // Statements waiting on someone, oldest first: the finance desk's queue.
  const queue = contracts.flatMap((c) => c.statements.filter((s) => ["submitted", "verified", "approved"].includes(s.status))
    .map((s) => ({ ...s, contractId: c.id, contractNo: c.no, contractor: c.contractor, currency: c.currency,
      paidSoFar: r2(c.payments.filter((p) => p.statementId === s.id).reduce((a, p) => a + p.amount, 0)) })));

  return {
    currency: proj?.contract_currency || null,
    totals: Object.values(totals),
    contracts: contracts.map((c) => ({ id: c.id, no: c.no, title: c.title, contractor: c.contractor, status: c.status, statusFa: c.statusFa,
      currency: c.currency, value: c.value, boq: c.boq, certified: c.certified, netApproved: c.netApproved,
      advancePaid: c.advancePaid, advanceRecovered: c.advanceRecovered, retentionHeld: c.retentionHeld, paid: c.paid,
      due: r2(c.netApproved - c.payments.filter((p) => p.kind === "statement").reduce((s, p) => s + p.amount, 0)),
      statements: c.statements, payments: c.payments })),
    wbs: wbs.map((w) => ({ id: w.id, code: w.code, title: w.title, bac: w.bac === null ? null : Number(w.bac),
      committed: r2(w.committed), actual: r2(w.actual), fromStatements: Number(w.from_statements),
      remaining: w.bac === null ? null : r2(Number(w.bac) - Number(w.committed)) })),
    purchaseOrders: pos.map((p) => ({ poNo: p.po_no, vendor: p.vendor, currency: p.currency, value: r2(p.value), unpriced: p.unpriced })),
    cash: cash.map((c) => ({ month: c.month, currency: c.currency, kind: c.kind, amount: r2(c.amount) })),
    queue,
  };
}
