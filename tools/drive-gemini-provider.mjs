/**
 * The isometric page on a server set to Gemini (LLM_PROVIDER=gemini): the
 * models a person picks from are Gemini's, a drawing read with the model
 * goes to /api/extract and on to Google, and what Google answers reaches the
 * person — here a refused key, since the drive runs with a fake one
 * (GEMINI_API_KEY=fake-key-for-drive) and no drawing is actually read.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-gemini-provider.mjs
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
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(800);

const cat = await page.evaluate(() => fetch("/api/models").then((r) => r.json()));
check(cat.provider === "gemini" && cat.configured, `the server's provider is Gemini, configured (${cat.provider})`);
await page.getByRole("button", { name: "خواندن مدل‌ها" }).click();
await page.waitForTimeout(800);
const labels = await page.locator(".key button b.mono").allInnerTexts();
check(labels.includes("Gemini 3.8 Flash") && labels.includes("Gemini 4 Argon"), `the models offered are Gemini's: ${labels.join(", ")}`);

await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click({ timeout: 1500 }).catch(() => {}); // the 2D/3D choice is hidden while SHEET_MARKUP is on (app/piping/page.jsx)
await page.check('input[name="iso-reader"][value="model"]');
const extract = page.waitForResponse((r) => r.url().includes("/api/extract"), { timeout: 120000 });
await page.setInputFiles(".drop input[type=file]", "eval/cases/golden/drawings/25-1004-SH1-0.pdf");
const r = await extract;
check(r.status() >= 400, `the drawing went to /api/extract and the server answered ${r.status()}`);
await page.waitForTimeout(1500);
const err = (await page.locator(".err").allInnerTexts()).join(" | ");
check(/Gemini API 400/.test(err) && /API key not valid/.test(err), `Google's own reason reaches the person: ${err.slice(0, 160)}`);
await page.screenshot({ path: `${SHOT}/gemini-provider.png` });
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
