/** Drive the equipment tab in a real browser. Compiling is not working. */
import { chromium } from "playwright";

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
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url()}`); });
page.on("requestfailed", (r) => errors.push(`REQFAIL ${r.url()} ${r.failure()?.errorText}`));

await page.goto("http://localhost:3000", { waitUntil: "networkidle" });

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
const bodyText = await page.locator(".pane").innerText();
console.log("names EA-2103:", bodyText.includes("EA-2103"));
console.log("names TOTAL as skipped:", /رد شد/.test(bodyText) && bodyText.includes("TOTAL"));

// Nothing may overflow the phone viewport sideways.
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow px:", overflow);

await page.screenshot({ path: "/tmp/claude-0/shots/equipment.png", fullPage: true });
console.log("console errors:", errors.length ? errors : "none");
await browser.close();
