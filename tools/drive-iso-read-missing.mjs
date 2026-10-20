/**
 * The no-model reading on a server that lacks part of it (the owner's VPS,
 * installed before the reader existed): the page says which pieces are
 * missing and the one command that installs them — once, not twice.
 * Start the server with a PATH that has node and python3 but no tesseract
 * or pdftoppm, then:
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-iso-read-missing.mjs
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
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await page.check('input[name="iso-reader"][value="local"]');
const res = page.waitForResponse((r) => r.url().includes("/api/read-local"));
await page.setInputFiles(".drop input[type=file]", "eval/cases/golden/drawings/25-1004-SH1-0.pdf");
const r = await res;
check(r.status() === 501, `the server answers 501, not installed (${r.status()})`);
const body = await r.json();
check(JSON.stringify(body.missing) === JSON.stringify(["tesseract-ocr", "poppler-utils"]), `it names the missing packages: ${JSON.stringify(body.missing)}`);
await page.waitForTimeout(800);
const errs = await page.locator(".err").allInnerTexts();
const shown = errs.filter((t) => t.includes("بدون مدل"));
check(shown.length === 1, `the message is shown once (${shown.length})`);
check(/sudo apt-get install -y tesseract-ocr poppler-utils/.test(shown[0] || ""), "the message gives the command that installs them");
await page.screenshot({ path: `${SHOT}/iso-read-missing.png` });
console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
