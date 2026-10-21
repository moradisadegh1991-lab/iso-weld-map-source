/**
 * Claude and Gemini side by side in the isometric page's model picker: on a
 * server with no Anthropic key and Gemini through the relay, both providers'
 * models are offered, Claude's disabled and marked as not set up, Gemini's
 * preselected; a drawing read with the Gemini model a person picks goes to
 * Gemini (through the relay) although LLM_PROVIDER is anthropic, and the
 * usage account records that model.
 *   server: LLM_PROVIDER=anthropic (no ANTHROPIC_API_KEY)
 *           GEMINI_BASE_URL=http://127.0.0.1:8787/v1beta GEMINI_RELAY_TOKEN=t
 *   relay:  RELAY_TOKEN=t GEMINI_API_KEY=k FAKE_GEMINI_PORT=8788 node tools/relay-local.mjs
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-model-picker.mjs
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

const groups = page.locator(".model-group");
const providers = await groups.evaluateAll((els) => [...new Set(els.map((e) => e.dataset.provider))]);
check(providers.includes("anthropic") && providers.includes("gemini"), `both providers are offered: ${providers.join(", ")}`);
const claude = page.locator('.model-group[data-provider="anthropic"]').first();
const gemini = page.locator('.model-group[data-provider="gemini"]').first();
check(/پیکربندی نشده/.test(await claude.innerText()), "Claude's group says it is not set up on this server");
check(await claude.locator("button").evaluateAll((bs) => bs.length > 0 && bs.every((x) => x.disabled)), "Claude's models cannot be picked");
check(/رلهٔ Vercel/.test(await gemini.innerText()), "Gemini's group says it goes through the relay");
check(await gemini.locator("button").evaluateAll((bs) => bs.length === 3 && bs.every((x) => !x.disabled)), "Gemini's three models can be picked");
const on = await page.locator(".models button.on").evaluateAll((bs) => bs.map((x) => x.dataset.model));
check(on[0] === "gemini-3.8-flash" && on[1] === "gemini-4-argon", `a model that can run is preselected: ${on.join(", ")}`);

await gemini.locator('button[data-model="gemini-4-argon"]').click();
check(await gemini.locator('button[data-model="gemini-4-argon"]').evaluate((x) => x.classList.contains("on")), "Gemini 4 Argon picked");
await page.screenshot({ path: `${SHOT}/model-picker.png`, fullPage: false, clip: await page.locator(".model-group").first().evaluate((e) => {
  const r = e.parentElement.getBoundingClientRect(); return { x: r.x, y: Math.max(0, r.y - 60 + scrollY), width: r.width, height: Math.min(700, r.height + 60) }; }) }).catch(() => page.screenshot({ path: `${SHOT}/model-picker.png` }));

await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await page.check('input[name="iso-reader"][value="model"]');
const sent = [];
page.on("request", (r) => { if (r.url().includes("/api/extract")) sent.push(JSON.parse(r.postData() || "{}").model); });
const first = page.waitForResponse((r) => r.url().includes("/api/extract"), { timeout: 120000 });
await page.setInputFiles(".drop input[type=file]", "eval/cases/golden/drawings/25-1004-SH1-0.pdf");
const r = await first;
check(r.status() === 200, `the reading reached Gemini through the relay and came back ${r.status()}`);
await page.waitForTimeout(4000);
check(sent.length > 0 && sent.every((m) => m === "gemini-4-argon"), `every pass asked for the picked model: ${[...new Set(sent)].join(", ")}`);

const usage = await page.evaluate((id) => fetch(`/api/llm-usage?projectId=${id}`).then((x) => x.json()), projectId);
const rows = usage.recent || [];
check(rows.length > 0 && rows.every((x) => x.provider === "gemini" && x.model === "gemini-4-argon" && x.via === "relay"),
  `the account records Gemini 4 Argon through the relay: ${rows.length} call(s)`);
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
