/**
 * Contracts and subcontracts, their payment items on the WBS, the design
 * (PDMS) quantities they can be measured against, contractors' payment
 * statements and the payments made on them.
 *
 * Every step is logged (lib/db/repos/log.mjs) with who took it; the four-eyes
 * rules of a statement are lib/contracts/statement.mjs.
 *
 * Call inside `withProject`.
 */
import { METRICS } from "../../contracts/metrics.mjs";
import { statementMoney, lineFlags, transitionProblem, STATUS, CONTRACT_STATUS } from "../../contracts/statement.mjs";
import { latestToday } from "../../civil/concrete.mjs";
import { controlsBoard } from "./controls.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
const blank = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const numOrNull = (v, what) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v); if (!Number.isFinite(n)) throw bad(`${what}: «${v}» عدد نیست.`); return n;
};
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const LOG = (db, projectId, c, action, extra = {}) => logEvent(db, { projectId, section: "contracts", entityType: "contract",
  entityId: c.id, label: `قرارداد ${c.contract_no}`, action, ...extra });

// ── contracts ────────────────────────────────────────────────────────────

export async function upsertContract(db, { projectId, contractNo, title, kind = "subcontract", contractorId = null,
  counterparty = null, currency = null, value = null, startOn = null, endOn = null, advancePct = 0, advanceRecoveryPct = null,
  retentionPct = 0, insurancePct = 0, withholdingPct = 0, vatPct = 0, overrunLimitPct = 25, scope = null, userId = null }) {
  const no = blank(contractNo), t = blank(title);
  if (!no || !t) throw bad("شمارهٔ قرارداد و عنوان لازم است.");
  if (kind === "subcontract" && !contractorId) throw bad("پیمان پیمانکار جزء، پیمانکار ثبت‌شده می‌خواهد (پروژه › پیمانکاران).");
  if (!contractorId && !blank(counterparty)) throw bad("طرف قرارداد را بنویسید.");
  const { rows: [proj] } = await db.query("SELECT contract_currency FROM project WHERE id = $1", [projectId]);
  const cur = blank(currency) || proj?.contract_currency;
  if (!cur) throw bad("ارز قرارداد مشخص نیست — در قرارداد یا مشخصات پروژه ثبت کنید.");
  const { rows: [have] } = await db.query("SELECT * FROM contract WHERE project_id = $1 AND contract_no = $2", [projectId, no]);
  if (have && ["signed", "closed"].includes(have.status)) throw bad(`قرارداد ${no} ${CONTRACT_STATUS[have.status]} است — تغییر شرایط آن الحاقیه می‌خواهد.`);
  const pct = (v, w) => { const n = numOrNull(v, w) ?? 0; if (n < 0 || n > 100) throw bad(`${w} باید بین ۰ و ۱۰۰ باشد.`); return n; };
  const vals = [projectId, no, t, kind, contractorId || null, blank(counterparty), cur, numOrNull(value, "مبلغ قرارداد"),
    startOn || null, endOn || null, pct(advancePct, "پیش‌پرداخت"), advanceRecoveryPct === null || advanceRecoveryPct === "" ? null : pct(advanceRecoveryPct, "استهلاک پیش‌پرداخت"),
    pct(retentionPct, "حسن انجام کار"), pct(insurancePct, "بیمه"), pct(withholdingPct, "مالیات تکلیفی"), pct(vatPct, "ارزش افزوده"),
    pct(overrunLimitPct, "حد مازاد مقادیر"), blank(scope), userId];
  const { rows: [c] } = await db.query(
    `INSERT INTO contract (project_id, contract_no, title, kind, contractor_id, counterparty, currency, value, start_on, end_on,
       advance_pct, advance_recovery_pct, retention_pct, insurance_pct, withholding_pct, vat_pct, overrun_limit_pct, scope, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (project_id, contract_no) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind,
       contractor_id = EXCLUDED.contractor_id, counterparty = EXCLUDED.counterparty, currency = EXCLUDED.currency,
       value = EXCLUDED.value, start_on = EXCLUDED.start_on, end_on = EXCLUDED.end_on, advance_pct = EXCLUDED.advance_pct,
       advance_recovery_pct = EXCLUDED.advance_recovery_pct, retention_pct = EXCLUDED.retention_pct,
       insurance_pct = EXCLUDED.insurance_pct, withholding_pct = EXCLUDED.withholding_pct, vat_pct = EXCLUDED.vat_pct,
       overrun_limit_pct = EXCLUDED.overrun_limit_pct, scope = EXCLUDED.scope
     RETURNING *`, vals);
  await LOG(db, projectId, c, have ? "updated" : "created", { to: c.status, userId });
  return c;
}

/**
 * A contract's life: draft → in review → signed → closed; a contract in
 * review can go back to draft with a reason. The one who sent it for review
 * does not sign it; it is signed only with payment items to measure.
 */
export async function setContractStatus(db, { projectId, contractId, to, comment = null, userId = null }) {
  const c = await contractRow(db, projectId, contractId);
  const allowed = { draft: ["in_review"], in_review: ["signed", "draft"], signed: ["closed"], closed: [] }[c.status] || [];
  if (!allowed.includes(to)) throw bad(`قرارداد «${CONTRACT_STATUS[c.status]}» به «${CONTRACT_STATUS[to] || to}» نمی‌رود.`);
  if (c.status === "in_review" && to === "draft" && !blank(comment)) throw bad("برگشت قرارداد دلیل می‌خواهد.");
  if (to === "signed") {
    const { rows: [n] } = await db.query("SELECT count(*)::int AS n FROM contract_line WHERE contract_id = $1", [contractId]);
    if (!n.n) throw bad("قرارداد بدون ردیف پرداخت (BOQ) امضا نمی‌شود — چیزی برای اندازه‌گیری نیست.");
    const { rows: [sent] } = await db.query(
      `SELECT user_id FROM workflow_event WHERE entity_id = $1 AND action = 'submitted' ORDER BY at DESC LIMIT 1`, [contractId]);
    if (sent && sent.user_id === userId) throw bad("کسی که قرارداد را برای بررسی فرستاده، آن را امضا نمی‌کند.");
  }
  if (to === "closed") {
    const { rows: [open] } = await db.query("SELECT count(*)::int AS n FROM pay_statement WHERE contract_id = $1 AND status NOT IN ('paid')", [contractId]);
    if (open.n) throw bad(`قرارداد بسته نمی‌شود — ${open.n} صورت وضعیت پرداخت‌نشده دارد.`);
  }
  const { rows: [out] } = await db.query(
    `UPDATE contract SET status = $2, signed_on = CASE WHEN $2 = 'signed' THEN COALESCE(signed_on, $3::date) ELSE signed_on END
      WHERE id = $1 RETURNING *`, [contractId, to, latestToday()]);
  const action = to === "in_review" ? "submitted" : to === "signed" ? "signed" : to === "closed" ? "closed" : "returned";
  await LOG(db, projectId, out, action, { from: c.status, to, comment: blank(comment), userId });
  return out;
}

async function contractRow(db, projectId, contractId) {
  const { rows: [c] } = await db.query("SELECT * FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) throw notFound("contract");
  return c;
}

// ── payment items ────────────────────────────────────────────────────────

export async function upsertLine(db, { projectId, contractId, itemNo, description, unit, qty, rate, accountId = null,
  method, metric = null, subsystemId = null, designCode = null, userId = null }) {
  const c = await contractRow(db, projectId, contractId);
  if (!["draft", "in_review"].includes(c.status)) throw bad(`ردیف‌های قرارداد «${CONTRACT_STATUS[c.status]}» تغییر نمی‌کنند — الحاقیه لازم است.`);
  const no = blank(itemNo), d = blank(description), un = blank(unit);
  if (!no || !d) throw bad("شمارهٔ ردیف و شرح لازم است.");
  const q = numOrNull(qty, "مقدار"), r = numOrNull(rate, "بهای واحد");
  if (!(q > 0) || r === null || r < 0) throw bad("مقدار قرارداد باید مثبت و بهای واحد صفر یا بیشتر باشد.");
  if (!["platform", "design", "measured", "lump_sum"].includes(method)) throw bad("روش اندازه‌گیری را انتخاب کنید.");
  let u = un;
  if (method === "platform") {
    if (!METRICS[metric]) throw bad("برای اندازه‌گیری پلتفرم، مقیاس را انتخاب کنید.");
    u = METRICS[metric].unit;
  }
  if ((method === "design" || method === "lump_sum") && !accountId) throw bad("این روش پیشرفت WBS را می‌خواهد — عنصر WBS را انتخاب کنید.");
  if (method === "design") {
    const { rows: [dq] } = await db.query(
      "SELECT unit FROM design_quantity WHERE project_id = $1 AND code = $2 ORDER BY imported_at DESC LIMIT 1", [projectId, blank(designCode)]);
    if (!dq) throw bad(`کد «${designCode}» در مقادیر طراحی (PDMS) نیست — اول فایل مقادیر مدل را وارد کنید.`);
    u = dq.unit;
  }
  if (method === "lump_sum") u = u || "LS";
  if (!u) throw bad("واحد لازم است.");
  if (accountId) {
    const { rows: [a] } = await db.query("SELECT id FROM control_account WHERE id = $1 AND project_id = $2", [accountId, projectId]);
    if (!a) throw bad("عنصر WBS پیدا نشد.");
  }
  const { rows: [l] } = await db.query(
    `INSERT INTO contract_line (project_id, contract_id, item_no, description, unit, qty, rate, account_id, method, metric, subsystem_id, design_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (contract_id, item_no) DO UPDATE SET description = EXCLUDED.description, unit = EXCLUDED.unit, qty = EXCLUDED.qty,
       rate = EXCLUDED.rate, account_id = EXCLUDED.account_id, method = EXCLUDED.method, metric = EXCLUDED.metric,
       subsystem_id = EXCLUDED.subsystem_id, design_code = EXCLUDED.design_code
     RETURNING *`,
    [projectId, contractId, no, d, u, q, r, accountId || null, method, method === "platform" ? metric : null,
     method === "platform" ? (subsystemId || null) : null, method === "design" ? blank(designCode) : null]);
  await LOG(db, projectId, c, "updated", { comment: `ردیف ${no}: ${d} — ${q} ${u} × ${r}`, userId });
  return l;
}

// ── design quantities (PDMS / E3D) ───────────────────────────────────────

/**
 * Rows of a model's material take-off, by model revision. The WBS code of a
 * row is matched to a control account by its code; one that matches none is
 * kept with no WBS and named, never attached to a guess.
 */
export async function importDesignQuantities(db, { projectId, modelRev, source = "PDMS", rows = [], userId = null }) {
  const rev = blank(modelRev);
  if (!rev) throw bad("رویژن مدل لازم است.");
  if (!rows.length) throw bad("فایل ردیفی ندارد.");
  const { rows: accounts } = await db.query("SELECT id, code FROM control_account WHERE project_id = $1", [projectId]);
  const byCode = new Map(accounts.map((a) => [a.code.toUpperCase(), a.id]));
  const report = { imported: 0, problems: [], noWbs: [] };
  for (const [i, r] of rows.entries()) {
    const code = blank(r.code), unit = blank(r.unit), qty = Number(String(r.qty ?? "").replace(/,/g, ""));
    if (!code || !unit || !Number.isFinite(qty) || qty < 0) { report.problems.push(`ردیف ${i + 2}: کد، واحد و مقدار لازم است`); continue; }
    const wbs = blank(r.wbs);
    const accountId = wbs ? byCode.get(wbs.toUpperCase()) || null : null;
    if (wbs && !accountId) report.noWbs.push(`${code} (WBS «${wbs}»)`);
    await db.query(
      `INSERT INTO design_quantity (project_id, source, model_rev, code, description, unit, qty, account_id, area, imported_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (project_id, code, model_rev) DO UPDATE SET description = EXCLUDED.description, unit = EXCLUDED.unit,
         qty = EXCLUDED.qty, account_id = EXCLUDED.account_id, area = EXCLUDED.area, imported_at = now()`,
      [projectId, blank(source) || "PDMS", rev, code, blank(r.description), unit, qty, accountId, blank(r.area), userId]);
    report.imported++;
  }
  await logEvent(db, { projectId, section: "contracts", entityType: "design_quantity", label: `مقادیر طراحی ${source} Rev.${rev}`,
    action: "imported", comment: `${report.imported} ردیف${report.problems.length ? ` · ${report.problems.length} رد` : ""}`, userId });
  return report;
}

/** The latest revision of each design item, with the revision before it where it changed. */
export async function designQuantities(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (q.code) q.*, a.code AS wbs_code FROM design_quantity q LEFT JOIN control_account a ON a.id = q.account_id
      WHERE q.project_id = $1 ORDER BY q.code, q.imported_at DESC`, [projectId]);
  return rows.map((r) => ({ id: r.id, code: r.code, description: r.description, unit: r.unit, qty: Number(r.qty),
    modelRev: r.model_rev, source: r.source, wbs: r.wbs_code, area: r.area, importedAt: r.imported_at }));
}

// ── measurement ──────────────────────────────────────────────────────────

/**
 * Each payment item's cumulative quantity as of `date`, with where it came
 * from. A quantity the platform cannot state is null with the reason — the
 * statement then cannot be submitted until it is known.
 */
async function measure(db, { projectId, lines, date, carried }) {
  const needEv = lines.some((l) => l.method === "design" || l.method === "lump_sum");
  const ev = new Map();
  if (needEv) {
    const board = await controlsBoard(db, { projectId, asOf: date });
    for (const a of board.accounts) ev.set(a.id, a.ev);
  }
  const out = [];
  for (const l of lines) {
    if (l.method === "platform") {
      const m = METRICS[l.metric];
      const { rows: [r] } = await db.query(m.sql, [projectId, date, l.subsystem_id]);
      out.push({ lineId: l.id, cumQty: Number(r.qty), evidence: { metric: l.metric, title: m.title, asOf: date, items: r.items, missing: r.missing,
        subsystemId: l.subsystem_id } });
    } else if (l.method === "design" || l.method === "lump_sum") {
      const e = ev.get(l.account_id);
      const pct = e?.pct ?? null;
      let base = Number(l.qty), dq = null;
      if (l.method === "design") {
        const { rows: [q] } = await db.query(
          "SELECT qty, model_rev, source FROM design_quantity WHERE project_id = $1 AND code = $2 ORDER BY imported_at DESC LIMIT 1", [projectId, l.design_code]);
        dq = q ? { qty: Number(q.qty), rev: q.model_rev, source: q.source } : null;
        base = dq ? dq.qty : null;
      }
      const reason = pct === null ? (e?.reason || "پیشرفت عنصر WBS در این تاریخ معلوم نیست") : base === null ? "مقدار طراحی پیدا نشد" : null;
      out.push({ lineId: l.id, cumQty: reason ? null : round3(base * pct / 100), reason,
        evidence: { method: l.method, wbsPct: pct, wbsSource: e?.source || null, asOf: date, design: dq } });
    } else {
      const prev = carried.get(l.id);
      out.push({ lineId: l.id, cumQty: prev?.cum ?? null, sheetRef: prev?.sheet ?? null,
        reason: prev ? null : "هنوز صورت‌جلسه‌ای ثبت نشده", evidence: { method: "measured", carried: !!prev } });
    }
  }
  return out;
}
const round3 = (x) => Math.round(x * 1000) / 1000;

// ── statements ───────────────────────────────────────────────────────────

/** The last statement a contract approved (approved or paid): what the next one is measured from. */
async function lastApproved(db, contractId) {
  const { rows: [s] } = await db.query(
    "SELECT * FROM pay_statement WHERE contract_id = $1 AND status IN ('approved', 'paid') ORDER BY seq DESC LIMIT 1", [contractId]);
  return s || null;
}

export async function createStatement(db, { projectId, contractId, periodTo, userId = null }) {
  const c = await contractRow(db, projectId, contractId);
  if (c.status !== "signed") throw bad(`برای قرارداد «${CONTRACT_STATUS[c.status]}» صورت وضعیت ثبت نمی‌شود — قرارداد باید امضا شده باشد.`);
  const to = iso(periodTo);
  if (!to) throw bad("تاریخ پایان دوره لازم است.");
  if (to > latestToday()) throw bad(`پایان دوره ${to} هنوز نرسیده است.`);
  const { rows: [open] } = await db.query(
    "SELECT seq, status FROM pay_statement WHERE contract_id = $1 AND status IN ('draft', 'submitted', 'verified') LIMIT 1", [contractId]);
  if (open) throw bad(`صورت وضعیت شمارهٔ ${open.seq} هنوز «${STATUS[open.status]}» است — یکی در جریان کافی است.`);
  const { rows: [last] } = await db.query("SELECT seq, period_to FROM pay_statement WHERE contract_id = $1 ORDER BY seq DESC LIMIT 1", [contractId]);
  if (last && to <= iso(last.period_to)) throw bad(`دوره باید پس از پایان صورت وضعیت ${last.seq} (${iso(last.period_to)}) باشد.`);
  const seq = (last?.seq || 0) + 1;
  const { rows: [st] } = await db.query(
    "INSERT INTO pay_statement (project_id, contract_id, seq, period_to, prepared_by) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [projectId, contractId, seq, to, userId]);
  await fillLines(db, { projectId, contract: c, statement: st });
  await logEvent(db, { projectId, section: "contracts", entityType: "statement", entityId: st.id,
    label: `صورت وضعیت ${seq} — ${c.contract_no}`, action: "created", to: "draft", comment: `تا ${to}`, userId });
  return st;
}

/** Measure every item into the statement; a measured item's own entry is kept. */
async function fillLines(db, { projectId, contract, statement }) {
  const { rows: lines } = await db.query("SELECT * FROM contract_line WHERE contract_id = $1 ORDER BY item_no", [contract.id]);
  const prevSt = await lastApproved(db, contract.id);
  const prev = new Map();
  if (prevSt) {
    const { rows } = await db.query("SELECT line_id, cum_qty, sheet_ref FROM pay_statement_line WHERE statement_id = $1", [prevSt.id]);
    for (const r of rows) prev.set(r.line_id, { cum: r.cum_qty === null ? null : Number(r.cum_qty), sheet: r.sheet_ref });
  }
  const { rows: mine } = await db.query("SELECT line_id, cum_qty, sheet_ref FROM pay_statement_line WHERE statement_id = $1", [statement.id]);
  const entered = new Map(mine.map((r) => [r.line_id, r]));
  const measured = await measure(db, { projectId, lines, date: iso(statement.period_to), carried: prev });
  for (const m of measured) {
    const line = lines.find((l) => l.id === m.lineId);
    const own = entered.get(m.lineId);
    const keepOwn = line.method === "measured" && own && own.cum_qty !== null;
    await db.query(
      `INSERT INTO pay_statement_line (project_id, statement_id, line_id, cum_qty, prev_qty, sheet_ref, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (statement_id, line_id) DO UPDATE SET cum_qty = EXCLUDED.cum_qty, prev_qty = EXCLUDED.prev_qty,
         sheet_ref = EXCLUDED.sheet_ref, evidence = EXCLUDED.evidence`,
      [projectId, statement.id, m.lineId, keepOwn ? own.cum_qty : m.cumQty, prev.get(m.lineId)?.cum ?? 0,
       keepOwn ? own.sheet_ref : (m.sheetRef ?? null), JSON.stringify({ ...m.evidence, reason: keepOwn ? null : m.reason || null })]);
  }
}

/** Measure again (the platform's work may have been recorded late); draft only. */
export async function remeasure(db, { projectId, statementId, userId = null }) {
  const st = await statementRow(db, projectId, statementId);
  if (st.status !== "draft") throw bad("فقط صورت وضعیت پیش‌نویس دوباره اندازه‌گیری می‌شود.");
  const c = await contractRow(db, projectId, st.contract_id);
  await fillLines(db, { projectId, contract: c, statement: st });
  await logEvent(db, { projectId, section: "contracts", entityType: "statement", entityId: st.id,
    label: `صورت وضعیت ${st.seq} — ${c.contract_no}`, action: "measured", userId });
  return statementDetail(db, { projectId, statementId });
}

/** A measured item's cumulative quantity, from its measurement sheet. */
export async function setMeasured(db, { projectId, statementId, lineId, cumQty, sheetRef, userId = null }) {
  const st = await statementRow(db, projectId, statementId);
  if (st.status !== "draft") throw bad("مقادیر فقط در صورت وضعیت پیش‌نویس تغییر می‌کنند.");
  const { rows: [l] } = await db.query("SELECT * FROM contract_line WHERE id = $1 AND contract_id = $2", [lineId, st.contract_id]);
  if (!l) throw notFound("contract line");
  if (l.method !== "measured") throw bad(`مقدار ردیف ${l.item_no} از «${l.method === "platform" ? "پلتفرم" : "پیشرفت WBS"}» خوانده می‌شود و دستی وارد نمی‌شود.`);
  const q = numOrNull(cumQty, "مقدار");
  if (q === null || q < 0) throw bad("مقدار تجمعی باید صفر یا بیشتر باشد.");
  if (!blank(sheetRef)) throw bad("شمارهٔ صورت‌جلسهٔ اندازه‌گیری لازم است.");
  await db.query("UPDATE pay_statement_line SET cum_qty = $3, sheet_ref = $4, evidence = evidence || $5 WHERE statement_id = $1 AND line_id = $2",
    [statementId, lineId, q, blank(sheetRef), JSON.stringify({ reason: null, enteredBy: userId })]);
  const c = await contractRow(db, projectId, st.contract_id);
  await logEvent(db, { projectId, section: "contracts", entityType: "statement", entityId: st.id,
    label: `صورت وضعیت ${st.seq} — ${c.contract_no}`, action: "measured", comment: `ردیف ${l.item_no}: ${q} ${l.unit} (صورت‌جلسه ${blank(sheetRef)})`, userId });
  return statementDetail(db, { projectId, statementId });
}

async function statementRow(db, projectId, statementId) {
  const { rows: [s] } = await db.query("SELECT * FROM pay_statement WHERE id = $1 AND project_id = $2", [statementId, projectId]);
  if (!s) throw notFound("statement");
  return s;
}

/** Everything a statement says: its lines with evidence and flags, its money, its payments. */
export async function statementDetail(db, { projectId, statementId }) {
  const st = await statementRow(db, projectId, statementId);
  const c = await contractRow(db, projectId, st.contract_id);
  const { rows } = await db.query(
    `SELECT sl.*, l.item_no, l.description, l.unit, l.qty, l.rate, l.method, l.metric, a.code AS wbs
       FROM pay_statement_line sl JOIN contract_line l ON l.id = sl.line_id LEFT JOIN control_account a ON a.id = l.account_id
      WHERE sl.statement_id = $1 ORDER BY l.item_no`, [statementId]);
  const lines = rows.map((r) => ({ lineId: r.line_id, itemNo: r.item_no, description: r.description, unit: r.unit,
    qty: Number(r.qty), rate: Number(r.rate), method: r.method, metric: r.metric, wbs: r.wbs,
    cumQty: r.cum_qty === null ? null : Number(r.cum_qty), prevQty: Number(r.prev_qty), sheetRef: r.sheet_ref,
    evidence: r.evidence, reason: r.evidence?.reason || null }));
  for (const l of lines) {
    l.thisQty = l.cumQty === null ? null : round3(l.cumQty - l.prevQty);
    l.amountCum = l.cumQty === null ? null : Math.round(l.cumQty * l.rate * 100) / 100;
    l.flags = lineFlags(l, { overrunLimitPct: Number(c.overrun_limit_pct) });
  }
  const frozen = st.status !== "draft";
  const money = frozen ? {
    grossCum: Number(st.gross_cum), grossPrev: Number(st.gross_prev), grossThis: Number(st.gross_this),
    advanceRecovery: Number(st.advance_recovery), retention: Number(st.retention), insurance: Number(st.insurance),
    withholding: Number(st.withholding), vat: Number(st.vat), net: Number(st.net_this),
  } : await liveMoney(db, { contract: c, statement: st, lines });
  const { rows: pays } = await db.query(
    "SELECT paid_on, amount, ref_no, kind FROM contract_payment WHERE statement_id = $1 ORDER BY paid_on", [statementId]);
  const paid = pays.reduce((s, p) => s + Number(p.amount), 0);
  const people = await db.query("SELECT id, display_name, email FROM app_user WHERE id = ANY($1)",
    [[st.prepared_by, st.submitted_by, st.verified_by, st.approved_by].filter(Boolean)]);
  const who = (id) => { const p = people.rows.find((x) => x.id === id); return p ? p.display_name || p.email : null; };
  return {
    id: st.id, seq: st.seq, periodTo: iso(st.period_to), status: st.status, statusFa: STATUS[st.status],
    contract: { id: c.id, no: c.contract_no, title: c.title, currency: c.currency },
    lines, money, flags: lines.flatMap((l) => l.flags), paid: Math.round(paid * 100) / 100, payments: pays,
    signatures: {
      prepared: { by: who(st.prepared_by), at: st.prepared_at }, submitted: { by: who(st.submitted_by), at: st.submitted_at },
      verified: { by: who(st.verified_by), at: st.verified_at }, approved: { by: who(st.approved_by), at: st.approved_at },
    },
    ids: { prepared: st.prepared_by, submitted: st.submitted_by, verified: st.verified_by, approved: st.approved_by },
  };
}

async function liveMoney(db, { contract, statement, lines }) {
  const prevSt = await lastApproved(db, contract.id);
  const { rows: [adv] } = await db.query(
    "SELECT COALESCE(sum(amount), 0)::float8 AS paid FROM contract_payment WHERE contract_id = $1 AND kind = 'advance'", [contract.id]);
  const { rows: [rec] } = await db.query(
    `SELECT COALESCE(sum(advance_recovery), 0)::float8 AS rec FROM pay_statement
      WHERE contract_id = $1 AND status IN ('approved', 'paid') AND id <> $2`, [contract.id, statement.id]);
  return statementMoney({ lines, grossPrev: prevSt ? Number(prevSt.gross_cum) : 0, terms: contract,
    advancePaid: adv.paid, advanceRecovered: rec.rec });
}

/**
 * Move a statement: submit (freezes the money), verify (technical /
 * supervision), approve (contracts — posts this period's gross to each WBS
 * element as actual cost), or return to draft with a comment.
 */
export async function statementTransition(db, { projectId, statementId, action, comment = null, userId = null }) {
  const st = await statementRow(db, projectId, statementId);
  const d = await statementDetail(db, { projectId, statementId });
  const why = transitionProblem(st, action, { userId, flags: d.flags });
  if (why) throw bad(why);
  if (action === "return" && !blank(comment)) throw bad("برگشت صورت وضعیت دلیل می‌خواهد — کامنت بنویسید.");
  const c = await contractRow(db, projectId, st.contract_id);
  const label = `صورت وضعیت ${st.seq} — ${c.contract_no}`;
  if (action === "submit") {
    const m = d.money;
    await db.query(
      `UPDATE pay_statement SET status = 'submitted', submitted_by = $2, submitted_at = now(), gross_cum = $3, gross_prev = $4, gross_this = $5,
         advance_recovery = $6, retention = $7, insurance = $8, withholding = $9, vat = $10, net_this = $11, flags = $12 WHERE id = $1`,
      [st.id, userId, m.grossCum, m.grossPrev, m.grossThis, m.advanceRecovery, m.retention, m.insurance, m.withholding, m.vat, m.net,
       JSON.stringify(d.flags)]);
  } else if (action === "verify") {
    await db.query("UPDATE pay_statement SET status = 'verified', verified_by = $2, verified_at = now() WHERE id = $1", [st.id, userId]);
  } else if (action === "approve") {
    await db.query("UPDATE pay_statement SET status = 'approved', approved_by = $2, approved_at = now() WHERE id = $1", [st.id, userId]);
    await postCost(db, { projectId, contract: c, statement: st, lines: d.lines, userId });
  } else if (action === "return") {
    await db.query(`UPDATE pay_statement SET status = 'draft', submitted_by = NULL, submitted_at = NULL, verified_by = NULL, verified_at = NULL,
      gross_cum = NULL, gross_prev = NULL, gross_this = NULL, advance_recovery = NULL, retention = NULL, insurance = NULL,
      withholding = NULL, vat = NULL, net_this = NULL WHERE id = $1`, [st.id]);
  }
  const to = { submit: "submitted", verify: "verified", approve: "approved", return: "draft" }[action];
  await logEvent(db, { projectId, section: "contracts", entityType: "statement", entityId: st.id, label,
    action: { submit: "submitted", verify: "verified", approve: "approved", return: "returned" }[action],
    from: st.status, to, comment: blank(comment), userId });
  return statementDetail(db, { projectId, statementId });
}

/**
 * An approved statement is actual cost: this period's gross of each item goes
 * to its WBS element (control account), so EVM's AC is what was certified.
 * An item with no WBS element is not posted, and the log says so.
 */
async function postCost(db, { projectId, contract, statement, lines, userId }) {
  const byAccount = new Map(); const orphan = [];
  const { rows: acc } = await db.query("SELECT id, account_id, item_no FROM contract_line WHERE contract_id = $1", [contract.id]);
  const accountOf = new Map(acc.map((r) => [r.id, r.account_id]));
  for (const l of lines) {
    const amount = ((l.cumQty ?? 0) - l.prevQty) * l.rate;
    if (!amount) continue;
    const a = accountOf.get(l.lineId);
    if (!a) { orphan.push(l.itemNo); continue; }
    byAccount.set(a, (byAccount.get(a) || 0) + amount);
  }
  const ref = `${contract.contract_no}/PS-${statement.seq}`;
  for (const [accountId, amount] of byAccount) {
    const a = Math.round(amount * 100) / 100;
    if (!a) continue;
    await db.query(
      `INSERT INTO cost_entry (project_id, account_id, posted_on, amount, ref_no, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [projectId, accountId, iso(statement.period_to), a, ref, a < 0 ? `اصلاح مقادیر در صورت وضعیت ${statement.seq}` : `صورت وضعیت ${statement.seq} تأییدشده`, userId]);
  }
  if (orphan.length) {
    await logEvent(db, { projectId, section: "finance", entityType: "statement", entityId: statement.id, label: ref,
      action: "recorded", comment: `ردیف‌های بدون WBS به هزینهٔ واقعی نرفتند: ${orphan.join("، ")}`, userId });
  }
}

// ── payments ─────────────────────────────────────────────────────────────

export async function recordPayment(db, { projectId, contractId, statementId = null, kind, paidOn, amount, refNo, note = null, userId = null }) {
  const c = await contractRow(db, projectId, contractId);
  const a = numOrNull(amount, "مبلغ");
  if (!(a > 0)) throw bad("مبلغ پرداخت باید مثبت باشد.");
  if (!blank(refNo)) throw bad("شمارهٔ سند پرداخت لازم است.");
  const on = iso(paidOn); if (!on) throw bad("تاریخ پرداخت لازم است.");
  if (on > latestToday()) throw bad(`تاریخ پرداخت ${on} هنوز نرسیده است.`);
  if (c.status !== "signed" && c.status !== "closed") throw bad("به قراردادی که امضا نشده پرداختی ثبت نمی‌شود.");
  const cents = (x) => Math.round(Number(x) * 100);
  let st = null;
  if (kind === "statement") {
    st = await statementRow(db, projectId, statementId);
    if (st.contract_id !== contractId) throw bad("صورت وضعیت مال این قرارداد نیست.");
    if (st.status !== "approved") throw bad(`صورت وضعیت «${STATUS[st.status]}» پرداخت نمی‌شود — باید تأیید نهایی شده و پرداخت‌نشده باشد.`);
    const { rows: [p] } = await db.query("SELECT COALESCE(sum(amount), 0) AS paid FROM contract_payment WHERE statement_id = $1", [st.id]);
    if (cents(p.paid) + cents(a) > cents(st.net_this)) throw bad(`پرداخت از خالص قابل پرداخت (${Number(st.net_this).toLocaleString()}) بیشتر می‌شود؛ پرداخت‌شده تاکنون ${Number(p.paid).toLocaleString()}.`);
  } else if (kind === "advance") {
    if (!(Number(c.advance_pct) > 0) || c.value === null) throw bad("قرارداد پیش‌پرداخت ندارد.");
    const { rows: [p] } = await db.query("SELECT COALESCE(sum(amount), 0) AS paid FROM contract_payment WHERE contract_id = $1 AND kind = 'advance'", [contractId]);
    const cap = Number(c.value) * Number(c.advance_pct) / 100;
    if (cents(p.paid) + cents(a) > cents(cap)) throw bad(`پیش‌پرداخت از ${Number(c.advance_pct)}٪ مبلغ قرارداد (${cap.toLocaleString()}) بیشتر می‌شود.`);
  } else if (kind === "retention_release") {
    const { rows: [h] } = await db.query(
      `SELECT COALESCE(sum(retention), 0) AS held FROM pay_statement WHERE contract_id = $1 AND status IN ('approved', 'paid')`, [contractId]);
    const { rows: [r] } = await db.query("SELECT COALESCE(sum(amount), 0) AS rel FROM contract_payment WHERE contract_id = $1 AND kind = 'retention_release'", [contractId]);
    if (cents(r.rel) + cents(a) > cents(h.held)) throw bad(`آزادسازی از حسن انجام کار کسرشده (${Number(h.held).toLocaleString()}) بیشتر می‌شود.`);
  } else throw bad("نوع پرداخت شناخته نشد.");
  const { rows: [pay] } = await db.query(
    `INSERT INTO contract_payment (project_id, contract_id, statement_id, kind, paid_on, amount, ref_no, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, contractId, st?.id || null, kind, on, a, blank(refNo), blank(note), userId]);
  if (st) {
    const { rows: [p] } = await db.query("SELECT COALESCE(sum(amount), 0) AS paid FROM contract_payment WHERE statement_id = $1", [st.id]);
    if (cents(p.paid) >= cents(st.net_this)) {
      await db.query("UPDATE pay_statement SET status = 'paid' WHERE id = $1", [st.id]);
      await logEvent(db, { projectId, section: "contracts", entityType: "statement", entityId: st.id,
        label: `صورت وضعیت ${st.seq} — ${c.contract_no}`, action: "paid", from: "approved", to: "paid", userId });
    }
  }
  const KIND = { advance: "پیش‌پرداخت", statement: `پرداخت صورت وضعیت ${st?.seq ?? ""}`, retention_release: "آزادسازی حسن انجام کار" };
  await logEvent(db, { projectId, section: "finance", entityType: "payment", entityId: pay.id, label: `${KIND[kind]} — ${c.contract_no}`,
    action: "paid", comment: `${a.toLocaleString()} ${c.currency} · سند ${blank(refNo)}${blank(note) ? ` · ${blank(note)}` : ""}`, userId });
  return pay;
}

// ── the register ─────────────────────────────────────────────────────────

export async function contractsBoard(db, { projectId }) {
  const { rows: contracts } = await db.query(
    `SELECT c.*, k.code AS contractor_code, k.name AS contractor_name FROM contract c LEFT JOIN contractor k ON k.id = c.contractor_id
      WHERE c.project_id = $1 ORDER BY c.contract_no`, [projectId]);
  const { rows: lines } = await db.query(
    `SELECT l.*, a.code AS wbs, s.code AS subsystem_code FROM contract_line l LEFT JOIN control_account a ON a.id = l.account_id
       LEFT JOIN subsystem s ON s.id = l.subsystem_id WHERE l.project_id = $1 ORDER BY l.item_no`, [projectId]);
  const { rows: sts } = await db.query("SELECT * FROM pay_statement WHERE project_id = $1 ORDER BY seq", [projectId]);
  const { rows: pays } = await db.query("SELECT * FROM contract_payment WHERE project_id = $1 ORDER BY paid_on", [projectId]);
  return contracts.map((c) => {
    const ls = lines.filter((l) => l.contract_id === c.id);
    const ss = sts.filter((s) => s.contract_id === c.id);
    const ps = pays.filter((p) => p.contract_id === c.id);
    const approved = ss.filter((s) => ["approved", "paid"].includes(s.status));
    const last = approved[approved.length - 1];
    const sum = (arr, k) => arr.reduce((s, x) => s + Number(x[k] || 0), 0);
    return {
      id: c.id, no: c.contract_no, title: c.title, kind: c.kind, status: c.status, statusFa: CONTRACT_STATUS[c.status],
      contractorId: c.contractor_id, contractor: c.contractor_code ? `${c.contractor_code} — ${c.contractor_name}` : c.counterparty,
      counterparty: c.counterparty, currency: c.currency, value: c.value === null ? null : Number(c.value),
      signedOn: iso(c.signed_on), startOn: iso(c.start_on), endOn: iso(c.end_on), scope: c.scope,
      terms: { advancePct: Number(c.advance_pct), advanceRecoveryPct: c.advance_recovery_pct === null ? null : Number(c.advance_recovery_pct),
        retentionPct: Number(c.retention_pct), insurancePct: Number(c.insurance_pct), withholdingPct: Number(c.withholding_pct),
        vatPct: Number(c.vat_pct), overrunLimitPct: Number(c.overrun_limit_pct) },
      lines: ls.map((l) => ({ id: l.id, itemNo: l.item_no, description: l.description, unit: l.unit, qty: Number(l.qty), rate: Number(l.rate),
        amount: Math.round(Number(l.qty) * Number(l.rate) * 100) / 100, method: l.method, metric: l.metric, wbs: l.wbs, accountId: l.account_id,
        subsystem: l.subsystem_code, subsystemId: l.subsystem_id, designCode: l.design_code })),
      boq: Math.round(ls.reduce((s, l) => s + Number(l.qty) * Number(l.rate), 0) * 100) / 100,
      statements: ss.map((s) => ({ id: s.id, seq: s.seq, periodTo: iso(s.period_to), status: s.status, statusFa: STATUS[s.status],
        grossThis: s.gross_this === null ? null : Number(s.gross_this), net: s.net_this === null ? null : Number(s.net_this) })),
      certified: last ? Number(last.gross_cum) : 0,
      netApproved: Math.round(sum(approved, "net_this") * 100) / 100,
      retentionHeld: Math.round(sum(approved, "retention") * 100) / 100,
      advancePaid: Math.round(sum(ps.filter((p) => p.kind === "advance"), "amount") * 100) / 100,
      advanceRecovered: Math.round(sum(approved, "advance_recovery") * 100) / 100,
      paid: Math.round(sum(ps, "amount") * 100) / 100,
      payments: ps.map((p) => ({ id: p.id, kind: p.kind, paidOn: iso(p.paid_on), amount: Number(p.amount), refNo: p.ref_no, statementId: p.statement_id, note: p.note })),
    };
  });
}
