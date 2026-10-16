/** Drive the equipment tab in a real browser. Compiling is not working. */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";

const LIST = `Tag No,Description,Type,Subsystem,Unit
P-2101A,Feed Pump,Centrifugal,21-01,21
P-2101B,Feed Pump (spare),Centrifugal,21-01,21
V-2101,Feed Surge Drum,Vertical,21-01,21
E-2102,Feed/Effluent Exchanger,Shell & Tube,21-02,21
EA-2103,Product Air Cooler,Fin-Fan,21-02,21
TOTAL,,,,
K-2201,Recycle Compressor,Centrifugal,22-01,22`;

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });   // a phone
await showAllTabs(page);
const errors = [];
// Before signing in, /api/auth/me answers 401: that is the sign-in page asking, not a fault.
const signInProbe = (t) => /401/.test(t) && /auth\/me|status of 401/.test(t);
page.on("console", (m) => m.type() === "error" && !signInProbe(m.text()) && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !(r.status() === 401 && r.url().endsWith("/api/auth/me"))) errors.push(`HTTP ${r.status()} ${r.url()}`); });
// A navigation cancels the menu prefetches in flight (ERR_ABORTED); that is the browser, not a fault.
page.on("requestfailed", (r) => { if (!/ERR_ABORTED/.test(r.failure()?.errorText || "")) errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`); });

// Since the platform shell the intake lives at /piping, behind the sign-in.
const BASE = process.env.BASE_URL || "http://localhost:3000";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" });

// The intake screen: no drawing loaded, which is when an equipment list
// actually turns up on a project.
const more = page.locator("details.intake-more");
console.log("intake entry present:", await more.count());
await more.locator("summary").click();

await page.locator("textarea.truth-paste").fill(LIST);
await page.getByRole("button", { name: "خواندن متن" }).click();
await page.waitForTimeout(400);

const totals = (await page.locator(".tot").first().innerText()).trim();
const verdict = (await page.locator(".check").first().innerText()).replace(/\s+/g, " ").trim();
const rows = await page.locator("table").last().locator("tbody tr").count();
console.log("totals :", totals);
console.log("verdict:", verdict);
console.log("rows   :", rows);

// The unclassified table must name the air cooler, not just count it.
const bodyText = await page.locator("details.intake-more .pane").innerText();
console.log("names EA-2103:", bodyText.includes("EA-2103"));
console.log("names TOTAL as skipped:", /رد شد/.test(bodyText) && bodyText.includes("TOTAL"));

// Nothing may overflow the phone viewport sideways.
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow px:", overflow);

await page.screenshot({ path: `${process.env.SHOT_DIR || "/tmp/shots"}/equipment.png`, fullPage: true });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
