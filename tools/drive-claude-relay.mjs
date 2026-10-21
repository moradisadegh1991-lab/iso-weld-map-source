/**
 * Claude through the same Vercel relay as Gemini, in the browser: a server
 * with neither key of its own, ANTHROPIC_BASE_URL and GEMINI_BASE_URL at the
 * relay and one token for both. Both providers' models are enabled and
 * marked as going through the relay; a reading with Opus 5 reaches
 * Anthropic (a stand-in, tools/relay-local.mjs) and is accounted as
 * anthropic / claude-opus-5 / relay.
 *   server: ANTHROPIC_BASE_URL=http://127.0.0.1:8787/v1 ANTHROPIC_RELAY_TOKEN=t
 *           GEMINI_BASE_URL=http://127.0.0.1:8787/v1beta GEMINI_RELAY_TOKEN=t
 *   relay:  RELAY_TOKEN=t GEMINI_API_KEY=k ANTHROPIC_API_KEY=ak FAKE_GEMINI_PORT=8788 node tools/relay-local.mjs
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-claude-relay.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
const projectId = me.projects[0].id;
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);
await page.getByRole("button", { name: "خواندن مدل‌ها" }).click();
await page.waitForSelector(".model-group");
for (const id of ["anthropic", "gemini"]) {
  const g = page.locator(`.model-group[data-provider="${id}"]`).first();
  check(/رلهٔ Vercel/.test(await g.innerText()) && !/پیکربندی نشده/.test(await g.innerText()), `${id}: set up, through the relay`);
  check(await g.locator("button").evaluateAll((bs) => bs.length > 0 && bs.every((x) => !x.disabled)), `${id}: its models can be picked`);
}
const claude = page.locator('.model-group[data-provider="anthropic"]').first();
await claude.locator('button[data-model="claude-opus-5"]').click();
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await page.check('input[name="iso-reader"][value="model"]');
const first = page.waitForResponse((r) => r.url().includes("/api/extract"), { timeout: 120000 });
await page.setInputFiles(".drop input[type=file]", "eval/cases/golden/drawings/25-1004-SH1-0.pdf");
check((await first).status() === 200, "the reading reached Anthropic through the relay");
await page.waitForTimeout(4000);
const usage = await page.evaluate((id) => fetch(`/api/llm-usage?projectId=${id}`).then((x) => x.json()), projectId);
const rows = (usage.recent || []).filter((x) => x.model === "claude-opus-5");
check(rows.length > 0 && rows.every((x) => x.provider === "anthropic" && x.via === "relay" && x.input_tokens === 900 && x.output_tokens === 21),
  `accounted as anthropic / claude-opus-5 / relay, 900 + 21 tokens: ${rows.length} call(s)`);
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
