/**
 * Project controls: earned value, the deterministic part.
 *
 * PLANNED — a control account's baseline is a list of cumulative-percent
 * points (the S-curve as the planner issued it). PV% on a date is read
 * straight off it, linearly between the stated points; before the first
 * point it is 0, after the last it is the last. Nothing is smoothed or
 * fitted — the curve is the planner's, not ours.
 *
 * EARNED — two sources, never mixed and always labelled:
 *
 *   platform  computed from what the platform already knows: the items of
 *             one discipline (welds, cables, instruments — optionally one
 *             subsystem) that are installed and tested, weighted by a rule
 *             of credit the PROJECT states (e.g. 70 % at installed, the
 *             rest at tested). No rule of credit, no EV: there is no
 *             default split.
 *   manual    a percentage somebody reported, with its date and source.
 *             Shown as "reported", because it is.
 *
 * ACTUAL — the sum of cost entries posted up to the data date.
 *
 * INDICES — SV = EV − PV, CV = EV − AC, SPI = EV / PV, CPI = EV / AC,
 * EAC = BAC / CPI, VAC = BAC − EAC, TCPI = (BAC − EV) / (BAC − AC). Any
 * ratio whose denominator is zero is not a number and is not shown as one.
 * Without a BAC (or without a contract currency to state it in) no money
 * figure exists; SPI still does, as EV% / PV%, because it needs none.
 */

/** Problems with a baseline, or [] when it is usable. */
export function checkBaseline(points) {
  const out = [];
  if (!points?.length) return ["خط مبنا نقطه‌ای ندارد"];
  const sorted = [...points].sort((a, b) => cmp(a.date, b.date));
  const seen = new Set();
  for (const p of sorted) {
    if (!validDate(p.date)) out.push(`تاریخ «${p.date}» نامعتبر است`);
    if (seen.has(p.date)) out.push(`تاریخ ${p.date} دو بار آمده`);
    seen.add(p.date);
    const v = n(p.pct);
    if (v === null || v < 0 || v > 100) out.push(`درصد ${p.date} باید بین 0 و 100 باشد`);
  }
  for (let i = 1; i < sorted.length; i++) {
    if (n(sorted[i].pct) < n(sorted[i - 1].pct)) out.push(`منحنی تجمعی در ${sorted[i].date} پایین آمده`);
  }
  return out;
}

/** Planned cumulative % on a date, read off the baseline. */
export function plannedPct(points, date) {
  if (!points?.length || checkBaseline(points).length) return null;
  const s = [...points].sort((a, b) => cmp(a.date, b.date)).map((p) => ({ t: day(p.date), v: Number(p.pct) }));
  const t = day(date);
  if (t < s[0].t) return 0;
  if (t >= s[s.length - 1].t) return s[s.length - 1].v;
  const i = s.findIndex((p) => p.t > t);
  const a = s[i - 1], b = s[i];
  return round2(a.v + ((b.v - a.v) * (t - a.t)) / (b.t - a.t));
}

/**
 * Earned % from platform counts and the project's rule of credit.
 * @param {{items: number, installed: number, tested: number}} c
 * @param {number|null} creditInstalledPct  share credited at "installed"; the rest at "tested"
 */
export function earnedFromCounts(c, creditInstalledPct) {
  const k = n(creditInstalledPct);
  if (k === null || k < 0 || k > 100) return { pct: null, reason: "قاعدهٔ اعتباردهی (سهم نصب) تعیین نشده" };
  if (!(c.items > 0)) return { pct: null, reason: "این رشته/ساب‌سیستم هنوز آیتمی در پلتفرم ندارد" };
  if (c.tested > c.installed || c.installed > c.items) return { pct: null, reason: "شمارش‌ها با هم جور نیست" };
  return { pct: round2((c.installed * k + c.tested * (100 - k)) / c.items) };
}

/**
 * The indices for one account (or a roll-up) on the data date.
 * @param {{bac: number|null, pvPct: number|null, evPct: number|null, ac: number|null}} a
 */
export function evm({ bac, pvPct, evPct, ac }) {
  const B = n(bac), pv = n(pvPct), ev = n(evPct), A = n(ac);
  const out = { spi: ratio(ev, pv), money: null };
  if (B === null || pv === null || ev === null) return out;
  const PV = B * pv / 100, EV = B * ev / 100;
  const money = { bac: B, pv: round2(PV), ev: round2(EV), ac: A, sv: round2(EV - PV), cv: null, cpi: null,
    eac: null, vac: null, tcpi: null };
  if (A !== null) {
    money.cv = round2(EV - A);
    money.cpi = ratio(EV, A);
    money.eac = money.cpi ? round2(B / (EV / A)) : null;
    money.vac = money.eac === null ? null : round2(B - money.eac);
    money.tcpi = B - A > 0 ? round3((B - EV) / (B - A)) : null;
  }
  out.money = money;
  return out;
}

/**
 * Roll accounts up: sums of money where every contributor has it, weighted
 * by BAC. Accounts without a BAC or without a PV/EV are named, not dropped
 * quietly — a roll-up that leaves out the late account looks on time.
 */
export function rollup(rows) {
  const usable = rows.filter((r) => r.money && r.money.ac !== null);
  const left = rows.filter((r) => !usable.includes(r)).map((r) => r.code);
  if (!usable.length) return { spi: null, money: null, excluded: left };
  const sum = (k) => usable.reduce((a, r) => a + r.money[k], 0);
  const bac = sum("bac"), pv = sum("pv"), ev = sum("ev"), ac = sum("ac");
  const r = evm({ bac, pvPct: bac ? (pv / bac) * 100 : null, evPct: bac ? (ev / bac) * 100 : null, ac });
  return { ...r, excluded: left };
}

// ── risk ─────────────────────────────────────────────────────────────────

/**
 * Score and state. The score is P × I on 1–5 scales; the bands that call a
 * score "high" are company policy and are not invented here — the register
 * sorts by score and shows the 5 × 5 grid instead.
 */
export function riskScore(p, i) {
  const P = n(p), I = n(i);
  if (![P, I].every((v) => Number.isInteger(v) && v >= 1 && v <= 5)) return null;
  return P * I;
}

export function riskState(r, today) {
  if (r.status === "closed") return "closed";
  if (r.dueOn && String(r.dueOn) < String(today)) return "overdue";
  return r.response ? "open" : "no_response";
}

/** Counts per cell of the 5 × 5 grid, [probability][impact]. */
export function heatMap(risks, which = "inherent") {
  const g = Array.from({ length: 5 }, () => Array(5).fill(0));
  for (const r of risks) {
    if (r.status === "closed") continue;
    const p = which === "residual" ? r.residualP : r.probability, i = which === "residual" ? r.residualI : r.impact;
    if (riskScore(p, i)) g[p - 1][i - 1]++;
  }
  return g;
}

const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const ratio = (a, b) => (a === null || b === null || !b ? null : round3(a / b));
const round2 = (x) => Math.round(x * 100) / 100;
const round3 = (x) => Math.round(x * 1000) / 1000;
const day = (d) => Math.floor(Date.parse(String(d).slice(0, 10) + "T00:00:00Z") / 86_400_000);
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && Number.isFinite(Date.parse(d));
const cmp = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
