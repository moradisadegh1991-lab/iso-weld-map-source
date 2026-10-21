/**
 * Model usage accounting: what each model call spent, and what that comes
 * to. The rows are in llm_usage (migration 082), written by /api/extract
 * after every call, successful or not. Call the repo functions inside
 * `withProject`.
 *
 *   LLM_PRICES          model|input|output per million tokens, comma separated,
 *                       e.g. gemini-3.8-flash|0.30|2.50,gemini-4-argon|2|12
 *   LLM_PRICE_CURRENCY  the unit of those prices (default USD)
 *   LLM_MONTHLY_TOKENS  a project's allowance for a calendar month (UTC):
 *                       input + output tokens; a reading is refused once the
 *                       month has spent it. Unset: no limit.
 *
 * No price is built in: what a model costs is the provider's to say and
 * changes; a model with no configured price shows its tokens and "no price",
 * never a guessed cost. Tokens a provider did not report are unknown (NULL)
 * and counted apart, not as zero.
 */

export function pricesFromEnv(raw = process.env.LLM_PRICES) {
  const out = {};
  for (const entry of String(raw || "").split(",")) {
    const [model, input, output] = entry.split("|").map((x) => (x || "").trim());
    const i = Number(input), o = Number(output);
    if (model && Number.isFinite(i) && Number.isFinite(o) && i >= 0 && o >= 0) out[model] = { input: i, output: o };
  }
  return out;
}

export const currency = () => process.env.LLM_PRICE_CURRENCY || "USD";

export function monthlyLimit(raw = process.env.LLM_MONTHLY_TOKENS) {
  const n = Number(raw);
  return raw && Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
}

/** Cost of a number of tokens of one model; null when its price is not configured or a count is unknown. */
export function costOf({ model, input, output }, prices) {
  const p = prices[model];
  if (!p || input == null || output == null) return null;
  return (input * p.input + output * p.output) / 1e6;
}

// ── repository ───────────────────────────────────────────────────────────

const toInt = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.round(Number(v))));

export async function recordUsage(db, { projectId, userId, provider, via = null, model, pass, usage, ok, errorCode = null, stopReason = null, ms = null }) {
  await db.query(
    `INSERT INTO llm_usage (project_id, user_id, provider, via, model, pass, input_tokens, output_tokens, ok, error_code, stop_reason, ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [projectId, userId || null, provider, via, model || "?", pass, toInt(usage?.input_tokens), toInt(usage?.output_tokens),
      !!ok, errorCode, stopReason, toInt(ms)]);
}

/** Tokens the project has spent this calendar month (UTC), unknown counts aside. */
export async function monthTokens(db, { projectId, now = new Date() }) {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(sum(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0)::bigint AS tokens
       FROM llm_usage WHERE project_id = $1 AND at >= date_trunc('month', $2::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
    [projectId, now.toISOString()]);
  return Number(r.tokens);
}

/** The account: totals by month, model, person and pass; the latest calls. */
export async function usageReport(db, { projectId, prices = pricesFromEnv(), limit = monthlyLimit(), now = new Date() }) {
  const group = async (key, extra = "") => (await db.query(
    `SELECT ${key} AS k, model, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed,
            count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL)::int AS unknown,
            COALESCE(sum(input_tokens), 0)::bigint AS input, COALESCE(sum(output_tokens), 0)::bigint AS output
       FROM llm_usage u ${extra} WHERE u.project_id = $1 GROUP BY 1, 2 ORDER BY 1 DESC, 2`, [projectId])).rows;
  // each group is summed per model first, so a cost is only added up from priced models
  const roll = (rows) => {
    const m = new Map();
    for (const r of rows) {
      const k = r.k ?? "—";
      const t = m.get(k) || { key: k, calls: 0, failed: 0, unknown: 0, input: 0, output: 0, cost: 0, unpriced: 0, models: [] };
      const input = Number(r.input), output = Number(r.output);
      t.calls += r.calls; t.failed += r.failed; t.unknown += r.unknown; t.input += input; t.output += output;
      const c = costOf({ model: r.model, input, output }, prices);
      if (c == null) t.unpriced += input + output; else t.cost += c;
      if (!t.models.includes(r.model)) t.models.push(r.model);
      m.set(k, t);
    }
    return [...m.values()].map((t) => ({ ...t, tokens: t.input + t.output, cost: t.unpriced && !t.cost ? null : t.cost }));
  };
  const byMonth = roll(await group(`to_char(date_trunc('month', u.at AT TIME ZONE 'UTC'), 'YYYY-MM')`));
  const byModel = roll(await group("u.model"));
  const byUser = roll(await group("COALESCE(au.display_name, au.email, '—')", "LEFT JOIN app_user au ON au.id = u.user_id"));
  const byPass = roll(await group("u.pass"));
  const total = roll((await group("'all'")).map((r) => ({ ...r, k: "all" })))[0] || { calls: 0, failed: 0, unknown: 0, input: 0, output: 0, tokens: 0, cost: null, unpriced: 0 };
  const { rows: recent } = await db.query(
    `SELECT u.at, u.provider, u.via, u.model, u.pass, u.input_tokens, u.output_tokens, u.ok, u.error_code, u.stop_reason, u.ms,
            COALESCE(au.display_name, au.email) AS who
       FROM llm_usage u LEFT JOIN app_user au ON au.id = u.user_id
      WHERE u.project_id = $1 ORDER BY u.at DESC LIMIT 50`, [projectId]);
  const month = await monthTokens(db, { projectId, now });
  return {
    total, byMonth, byModel, byUser, byPass,
    recent: recent.map((r) => ({ ...r, cost: costOf({ model: r.model, input: r.input_tokens, output: r.output_tokens }, prices) })),
    month: { tokens: month, limit, left: limit == null ? null : Math.max(0, limit - month) },
    prices, currency: currency(),
  };
}
