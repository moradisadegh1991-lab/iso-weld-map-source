/**
 * Project controls: control accounts, baseline, progress, cost, EVM, risk.
 *
 * Every rule is lib/controls/evm.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  checkBaseline, plannedPct, earnedFromCounts, evm, rollup, riskScore, riskState, heatMap,
} from "../../controls/evm.mjs";

/** Disciplines whose items reporting.fact_progress counts as installed and tested. */
export const PLATFORM_DISCIPLINES = { piping: "جوش‌های پایپینگ", electrical: "کابل‌ها", instrumentation: "ابزارها" };

export async function upsertAccount(db, {
  projectId, code, title, contractorId = null, bac = null, evMethod = "manual", evDiscipline = null,
  evSubsystemId = null, creditInstalledPct = null,
}) {
  if (!String(code || "").trim() || !String(title || "").trim()) throw bad("کد و عنوان حساب کنترلی لازم است.");
  if (!["manual", "platform"].includes(evMethod)) throw bad(`روش ارزش کسب‌شده «${evMethod}» شناخته نشد.`);
  if (evMethod === "platform" && !PLATFORM_DISCIPLINES[evDiscipline])
    throw bad("برای EV از پلتفرم، رشته‌ای را انتخاب کنید که پلتفرم پیشرفتش را می‌شمارد.");
  const B = blankNum(bac);
  if (B !== null) {
    if (!(B > 0)) throw bad("BAC باید مثبت باشد.");
    await requireCurrency(db, projectId);
  }
  const k = blankNum(creditInstalledPct);
  if (k !== null && !(k >= 0 && k <= 100)) throw bad("سهم نصب باید بین 0 و 100 باشد.");
  const { rows } = await db.query(
    `INSERT INTO control_account (project_id, code, title, contractor_id, bac, ev_method, ev_discipline,
                                  ev_subsystem_id, credit_installed_pct)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (project_id, code) DO UPDATE SET title = EXCLUDED.title, contractor_id = EXCLUDED.contractor_id,
        bac = EXCLUDED.bac, ev_method = EXCLUDED.ev_method, ev_discipline = EXCLUDED.ev_discipline,
        ev_subsystem_id = EXCLUDED.ev_subsystem_id, credit_installed_pct = EXCLUDED.credit_installed_pct
     RETURNING *`,
    [projectId, String(code).trim().toUpperCase(), title, contractorId || null, B, evMethod,
     evMethod === "platform" ? evDiscipline : null, evMethod === "platform" ? evSubsystemId || null : null, k]);
  return rows[0];
}

/** Issue (or re-issue) an account's baseline. The whole curve, with a revision and a reason. */
export async function setBaseline(db, { projectId, accountId, points, revision, reason, userId = null }) {
  await accountRow(db, projectId, accountId);
  if (!String(revision || "").trim() || !String(reason || "").trim()) throw bad("شمارهٔ رویژن و دلیل خط مبنا لازم است.");
  const clean = (points || []).map((p) => ({ date: String(p.date).slice(0, 10), pct: Number(p.pct) }));
  const problems = checkBaseline(clean);
  if (problems.length) throw bad(`خط مبنا پذیرفته نشد: ${problems.join(" · ")}`);
  await db.query("DELETE FROM control_baseline_point WHERE account_id = $1", [accountId]);
  for (const p of clean) {
    await db.query("INSERT INTO control_baseline_point (project_id, account_id, on_date, cum_pct) VALUES ($1,$2,$3,$4)",
      [projectId, accountId, p.date, p.pct]);
  }
  await db.query(
    `INSERT INTO control_baseline_revision (project_id, account_id, revision, points, reason, issued_by)
     VALUES ($1,$2,$3,$4,$5,$6)`, [projectId, accountId, revision, JSON.stringify(clean), reason, userId]);
  const { rows } = await db.query("UPDATE control_account SET baseline_rev = $1 WHERE id = $2 RETURNING *", [revision, accountId]);
  return rows[0];
}

export async function baselineHistory(db, { projectId, accountId }) {
  const { rows } = await db.query(
    `SELECT r.*, u.display_name AS issued_by_name FROM control_baseline_revision r LEFT JOIN app_user u ON u.id = r.issued_by
      WHERE r.project_id = $1 AND r.account_id = $2 ORDER BY r.created_at`, [projectId, accountId]);
  return rows;
}

/** A reported percentage, for a manual account only. */
export async function reportProgress(db, { projectId, accountId, asOf, pct, source, userId = null }) {
  const a = await accountRow(db, projectId, accountId);
  if (a.ev_method !== "manual") throw bad("پیشرفت این حساب از پلتفرم محاسبه می‌شود؛ گزارش دستی با آن مخلوط نمی‌شود.");
  const v = blankNum(pct);
  if (v === null || v < 0 || v > 100) throw bad("درصد پیشرفت باید بین 0 و 100 باشد.");
  if (!asOf || !String(source || "").trim()) throw bad("تاریخ و منبع گزارش پیشرفت لازم است.");
  const { rows } = await db.query(
    `INSERT INTO control_progress (project_id, account_id, as_of, pct, source, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [projectId, accountId, asOf, v, source, userId]);
  return rows[0];
}

/** Post a cost. A reversal is a negative entry with its reason; the total never goes below zero. */
export async function postCost(db, { projectId, accountId, postedOn, amount, refNo, note = null, userId = null }) {
  await accountRow(db, projectId, accountId);
  await requireCurrency(db, projectId);
  const A = blankNum(amount);
  if (A === null || A === 0) throw bad("مبلغ باید عددی غیرصفر باشد.");
  if (!postedOn || !String(refNo || "").trim()) throw bad("تاریخ و شمارهٔ سند لازم است.");
  if (A < 0) {
    if (!String(note || "").trim()) throw bad("برگشت هزینه بدون شرح دلیل ثبت نمی‌شود.");
    const { rows: [t] } = await db.query("SELECT COALESCE(sum(amount), 0)::float8 AS s FROM cost_entry WHERE account_id = $1", [accountId]);
    if (t.s + A < 0) throw bad(`برگشت ${-A} از کل هزینهٔ ثبت‌شده (${t.s}) بیشتر است.`);
  }
  const { rows } = await db.query(
    `INSERT INTO cost_entry (project_id, account_id, posted_on, amount, ref_no, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [projectId, accountId, postedOn, A, refNo, note || null, userId]);
  return rows[0];
}

/** Installed / tested counts the platform holds for one discipline (and subsystem). */
export async function platformCounts(db, { projectId, discipline, subsystemId = null }) {
  const { rows: [c] } = await db.query(
    `SELECT count(*)::int AS items,
            count(*) FILTER (WHERE is_installed)::int AS installed,
            count(*) FILTER (WHERE is_tested)::int AS tested
       FROM reporting.fact_progress
      WHERE project_key = $1 AND discipline = $2 AND ($3::uuid IS NULL OR subsystem_key = $3)`,
    [projectId, discipline, subsystemId]);
  return c;
}

/**
 * Every account on the data date, with where each figure came from, and the
 * roll-up. EV from the platform is the platform's CURRENT count, so it is
 * offered for today's data date only.
 */
export async function controlsBoard(db, { projectId, asOf }) {
  const today = new Date().toISOString().slice(0, 10);
  const date = asOf || today;
  const { rows: [proj] } = await db.query("SELECT contract_currency FROM project WHERE id = $1", [projectId]);
  const { rows: accounts } = await db.query(
    `SELECT a.*, c.code AS contractor_code, s.code AS subsystem_code FROM control_account a
       LEFT JOIN contractor c ON c.id = a.contractor_id LEFT JOIN subsystem s ON s.id = a.ev_subsystem_id
      WHERE a.project_id = $1 ORDER BY a.code`, [projectId]);
  const out = [];
  for (const a of accounts) {
    const { rows: pts } = await db.query(
      "SELECT on_date, cum_pct FROM control_baseline_point WHERE account_id = $1 ORDER BY on_date", [a.id]);
    const points = pts.map((p) => ({ date: iso(p.on_date), pct: Number(p.cum_pct) }));
    const pvPct = points.length ? plannedPct(points, date) : null;
    let ev = { pct: null, reason: null, source: a.ev_method, detail: null };
    if (a.ev_method === "platform") {
      if (date !== today) ev.reason = "EV پلتفرم فقط برای امروز محاسبه می‌شود";
      else {
        const c = await platformCounts(db, { projectId, discipline: a.ev_discipline, subsystemId: a.ev_subsystem_id });
        const r = earnedFromCounts(c, a.credit_installed_pct);
        ev = { ...ev, pct: r.pct, reason: r.reason || null, detail: c };
      }
    } else {
      const { rows: [r] } = await db.query(
        `SELECT as_of, pct, source FROM control_progress WHERE account_id = $1 AND as_of <= $2
          ORDER BY as_of DESC, created_at DESC LIMIT 1`, [a.id, date]);
      ev = r ? { ...ev, pct: Number(r.pct), detail: { asOf: iso(r.as_of), source: r.source } }
        : { ...ev, reason: "گزارش پیشرفتی تا این تاریخ ثبت نشده" };
    }
    const { rows: [cost] } = await db.query(
      `SELECT COALESCE(sum(amount), 0)::float8 AS ac, count(*)::int AS n FROM cost_entry
        WHERE account_id = $1 AND posted_on <= $2`, [a.id, date]);
    const bac = proj.contract_currency && a.bac !== null ? Number(a.bac) : null;
    const k = evm({ bac, pvPct, evPct: ev.pct, ac: bac === null ? null : cost.ac });
    out.push({
      id: a.id, code: a.code, title: a.title, contractorCode: a.contractor_code, bac, evMethod: a.ev_method,
      evDiscipline: a.ev_discipline, subsystemCode: a.subsystem_code, creditInstalledPct: a.credit_installed_pct === null ? null : Number(a.credit_installed_pct),
      baselineRev: a.baseline_rev, points, pvPct, ev, ac: cost.n ? cost.ac : null, costEntries: cost.n, ...k,
    });
  }
  const risks = await listRisks(db, { projectId, today });
  return {
    asOf: date, today, currency: proj.contract_currency, accounts: out, total: rollup(out),
    risks, heat: { inherent: heatMap(risks.map(asRisk)), residual: heatMap(risks.map(asRisk), "residual") },
    platformDisciplines: PLATFORM_DISCIPLINES,
  };
}

export async function costLedger(db, { projectId, accountId }) {
  const { rows } = await db.query(
    "SELECT * FROM cost_entry WHERE project_id = $1 AND account_id = $2 ORDER BY posted_on, created_at", [projectId, accountId]);
  return rows;
}

// ── risk ─────────────────────────────────────────────────────────────────

export async function upsertRisk(db, {
  projectId, code, title, category = null, cause = null, consequence = null, owner = null, accountId = null,
  probability, impact, response = null, dueOn = null, residualP = null, residualI = null,
}) {
  if (!String(code || "").trim() || !String(title || "").trim()) throw bad("کد و عنوان ریسک لازم است.");
  if (riskScore(probability, impact) === null) throw bad("احتمال و اثر باید عدد صحیح 1 تا 5 باشند.");
  const rp = blankNum(residualP), ri = blankNum(residualI);
  if ((rp === null) !== (ri === null) || (rp !== null && riskScore(rp, ri) === null))
    throw bad("احتمال و اثر باقیمانده هر دو با هم و بین 1 تا 5.");
  if (rp !== null && !response) throw bad("ریسک باقیمانده بدون اقدام پاسخ معنا ندارد.");
  const { rows } = await db.query(
    `INSERT INTO control_risk (project_id, code, title, category, cause, consequence, owner, account_id, probability,
                               impact, response, due_on, residual_p, residual_i)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (project_id, code) DO UPDATE SET title = EXCLUDED.title, category = EXCLUDED.category,
        cause = EXCLUDED.cause, consequence = EXCLUDED.consequence, owner = EXCLUDED.owner,
        account_id = EXCLUDED.account_id, probability = EXCLUDED.probability, impact = EXCLUDED.impact,
        response = EXCLUDED.response, due_on = EXCLUDED.due_on, residual_p = EXCLUDED.residual_p,
        residual_i = EXCLUDED.residual_i, updated_at = now()
     RETURNING *`,
    [projectId, String(code).trim().toUpperCase(), title, category, cause, consequence, owner, accountId || null,
     Number(probability), Number(impact), response || null, dueOn || null, rp, ri]);
  return rows[0];
}

export async function closeRisk(db, { projectId, riskId, closedOn }) {
  if (!closedOn) throw bad("تاریخ بستن لازم است.");
  const { rows } = await db.query(
    "UPDATE control_risk SET status = 'closed', closed_on = $1, updated_at = now() WHERE id = $2 AND project_id = $3 AND status = 'open' RETURNING *",
    [closedOn, riskId, projectId]);
  if (!rows[0]) throw bad("ریسک باز پیدا نشد.");
  return rows[0];
}

export async function listRisks(db, { projectId, today }) {
  const { rows } = await db.query(
    `SELECT r.*, a.code AS account_code FROM control_risk r LEFT JOIN control_account a ON a.id = r.account_id
      WHERE r.project_id = $1`, [projectId]);
  return rows.map((r) => ({
    ...r, score: riskScore(r.probability, r.impact), residualScore: riskScore(r.residual_p, r.residual_i),
    state: riskState({ status: r.status, dueOn: iso(r.due_on), response: r.response }, today),
  })).sort((a, b) => (a.status === "closed") - (b.status === "closed") || b.score - a.score || cmp(a.code, b.code));
}

// ── helpers ──────────────────────────────────────────────────────────────

async function requireCurrency(db, projectId) {
  const { rows: [p] } = await db.query("SELECT contract_currency FROM project WHERE id = $1", [projectId]);
  if (!p?.contract_currency) throw bad("ارز قرارداد در مشخصات پروژه تعیین نشده؛ مبلغ بدون ارز ثبت نمی‌شود.");
}
async function accountRow(db, projectId, id) {
  const { rows: [a] } = await db.query("SELECT * FROM control_account WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!a) throw notFound("control account");
  return a;
}
const asRisk = (r) => ({ status: r.status, probability: r.probability, impact: r.impact, residualP: r.residual_p, residualI: r.residual_i });
const blankNum = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
