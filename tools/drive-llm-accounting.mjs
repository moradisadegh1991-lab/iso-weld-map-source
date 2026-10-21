/**
 * Model accounting end to end, in the browser: the piping page reads a
 * drawing with the model; the server (LLM_PROVIDER=gemini, through the
 * relay with its token, no Gemini key of its own) calls the relay
 * (tools/relay-local.mjs, the deploy/gemini-relay code as Vercel serves it),
 * which adds the key and calls a stand-in Gemini that spends 1200 + 34
 * tokens a call. Then the users-and-access page's usage tab must show
 * exactly the calls made and their tokens, the relay, this month against
 * the allowance and the cost from the configured price.
 *   server: LLM_PROVIDER=gemini GEMINI_BASE_URL=http://127.0.0.1:8787/v1beta GEMINI_RELAY_TOKEN=t
 *           LLM_PRICES='gemini-3.8-flash|0.5|3' LLM_MONTHLY_TOKENS=1000000
 *   relay:  RELAY_TOKEN=t GEMINI_API_KEY=k FAKE_GEMINI_PORT=8788 node tools/relay-local.mjs
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-llm-accounting.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const RELAY = process.env.RELAY_URL || "http://127.0.0.1:8787/v1beta";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));

// the relay is closed to anyone without its token
const probe = await fetch(`${RELAY}/models/gemini-3.8-flash:generateContent`, { method: "POST", body: "{}", headers: { "x-relay-token": "guess" } });
check(probe.status === 401, `the relay refuses a wrong token (${probe.status})`);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const before = (await page.evaluate((id) => fetch(`/api/llm-usage?projectId=${id}`).then((r) => r.json()), projectId)).total;

await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await page.check('input[name="iso-reader"][value="model"]');
const passes = [];
page.on("response", (r) => { if (r.url().includes("/api/extract")) passes.push(r.status()); });
await page.setInputFiles(".drop input[type=file]", "eval/cases/golden/drawings/25-1004-SH1-0.pdf");
// every pass answered, and nothing more on its way
for (let i = 0, last = -1, still = 0; i < 120 && still < 4; i++) {
  await page.waitForTimeout(1000);
  if (passes.length && passes.length === last) still++; else still = 0;
  last = passes.length;
}
check(passes.length > 0 && passes.every((s) => s === 200), `the reading's passes went through the relay: ${passes.join(",")}`);

await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
await page.getByRole("tab", { name: "مصرف مدل (توکن)" }).click();
await page.waitForSelector("[data-usage-kpis]");
const u = await page.evaluate((id) => fetch(`/api/llm-usage?projectId=${id}`).then((r) => r.json()), projectId);
const calls = u.total.calls - before.calls, tokens = u.total.tokens - before.tokens;
check(calls === passes.length, `one account row per model call: ${calls} for ${passes.length} passes`);
check(tokens === passes.length * 1234, `the tokens Gemini reported, summed: ${tokens}`);
check(u.recent.slice(0, calls).every((r) => r.provider === "gemini" && r.via === "relay" && r.input_tokens === 1200 && r.output_tokens === 34 && r.ok),
  "each row: gemini, through the relay, 1200 in / 34 out, succeeded");
check(u.month.limit === 1000000 && u.month.tokens >= tokens && u.month.left === u.month.limit - u.month.tokens, `this month against the allowance: ${u.month.tokens} of ${u.month.limit}`);
const flash = u.byModel.find((m) => m.key === "gemini-3.8-flash");
check(flash && Math.abs(flash.cost - (flash.input * 0.5 + flash.output * 3) / 1e6) < 1e-12, `cost from the configured price: ${flash?.cost} ${u.currency}`);
const kpis = await page.locator("[data-usage-kpis] .kpi .v").allInnerTexts();
check(kpis[0] === u.total.tokens.toLocaleString("en-US"), `the page shows the total: ${kpis.join(" | ")}`);
check(await page.locator("table[data-usage='به تفکیک مدل'] td", { hasText: "gemini-3.8-flash" }).count() === 1, "the by-model table lists the model");
await page.screenshot({ path: `${SHOT}/llm-accounting.png`, fullPage: false });
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
