/**
 * Look at the DM-water pump scenario's end state in the browser, page by
 * page, the way a person checks the guide's «باید ببینید»:
 *
 *   npm run scenario:dm -- you@… --upto all     (makes project DMW)
 *   DRIVE_EMAIL=you@… DRIVE_PASSWORD=… node tools/drive-scenario-dm.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const CODE = process.env.SCENARIO_PROJECT || "DMW";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });
const flat = (s) => s.replace(/\s+/g, " ").trim();
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push("check: " + what); };
const settle = () => page.waitForTimeout(1200);
// Everything on a page, every tab at once: this drive reads, it does not click through tabs.
const text = async () => flat(await page.locator("main").innerText());
const all = async (path) => {
  await page.goto(BASE + path, { waitUntil: "networkidle" }); await settle();
  await page.addStyleTag({ content: ".ptab-panel > [data-tab-hidden]{display:revert !important}" });
  return text();
};

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const sel = page.locator(".topbar select").first();
const value = await sel.locator("option").evaluateAll((os, code) => os.find((o) => o.textContent.trim().startsWith(`${code} —`) || o.textContent.includes(`${code} —`))?.value, CODE);
check(!!value, `project ${CODE} is offered`);
await sel.selectOption(value); await settle();

let t = await all("/documents");
check(/DMW-DS-P-7001/.test(t) && (t.match(/Rev\.0/g) || []).length >= 4, "documents: four IFC Rev.0 construction revisions");

t = await all("/procurement");
check(/PO-7001/.test(t) && /PO-7002/.test(t), "procurement: the pump PO from the award, and the pipe PO");

await page.getByRole("tab", { name: "درخواست خرید و مناقصه" }).click(); await settle();
await page.locator("tr", { hasText: "MR-7001" }).getByRole("button", { name: "جزئیات" }).click(); await settle();
t = flat(await page.locator(".tk", { has: page.locator("th", { hasText: "FAT" }) }).first().innerText());
check(/P-7001/.test(t) && /لازم/.test(t), "tender: MR-7001's line asks for FAT (carried to PO-7001)");

t = await all("/civil");
check(/FDN-P-7001/.test(t) && /FDN-D-7002/.test(t) && /تحویل‌شده/.test(t), "civil: both foundations handed over");

t = await all("/subsystems");
check(/70-01/.test(t) && !/خطوطی که زیر هیچ ساب‌سیستمی نیستند/.test(t), "subsystems: 70-01, and no line left unfiled");

t = await all("/piping/execution");
check(/SP-01/.test(t) && /SP-02/.test(t), "piping execution: both spools");

t = await all("/completions");
check(/TP-70-01/.test(t) && /پذیرفته — نمایندهٔ کارفرما/.test(t), "completions: TP-70-01, and MC accepted by the client's representative");
await page.screenshot({ path: `${SHOT}/320-scenario-mc.png`, fullPage: true });

t = await all("/precom");
check(/RFSU/.test(t) && /PG-01/.test(t) && /برآورده/.test(t), "precom: RFSU and the performance guarantee met");
await page.screenshot({ path: `${SHOT}/321-scenario-rfsu.png`, fullPage: true });

t = await all("/handover");
check(/P-7001/.test(t) && /PMA-24-7001/.test(t), "handover: the pump's asset master");

await page.goto(BASE + "/asset?tag=P-7001", { waitUntil: "networkidle" }); await settle();
t = await text();
check(/P-7001/.test(t) && /16/.test(t) && /70FT7001\.PV/.test(t), "asset page: design conditions and the DCS point of P-7001");
await page.screenshot({ path: `${SHOT}/322-scenario-asset.png`, fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("problems:", problems.length ? problems : "none");
await b.close();
process.exit(problems.length ? 1 : 0);
