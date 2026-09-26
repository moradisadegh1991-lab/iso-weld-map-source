/**
 * Drive design conditions and DCS/Historian points: the handover board and
 * form for K-2101 (seeded from DS-K-2101 Rev.1), adding and removing a point,
 * the refusals shown to the user, and the asset page carrying both.
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [], refused = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() === 400 && r.request().method() === "POST" && /\/api\/handover/.test(r.url())) refused.push(r.status());
  else if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push("check: " + what); };

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
// After login: before it, the session probe's 401 is expected.
page.on("console", (m) => { if (m.type() === "error" && !/status of 400/.test(m.text())) problems.push("console: " + m.text()); });

await page.goto(BASE + "/handover", { waitUntil: "networkidle" }); await page.waitForTimeout(1000);
const row = page.locator("tbody > tr", { hasText: "K-2101" }).first();
const rowText = flat(await row.innerText());
console.log("  K-2101 row:", rowText.slice(0, 200));
check(/38\.5 barg/.test(rowText) && /-29…135°C/.test(rowText) && /DS-K-2101 Rev\.1/.test(rowText), "board shows design conditions with their datasheet");
check(/DCS\/Historian: 2/.test(rowText), "board shows two DCS/Historian points");
await page.screenshot({ path: `${SHOT}/190-handover-board.png`, fullPage: true });

await row.getByRole("button", { name: "ویرایش" }).click();
const form = page.locator("tr", { has: page.getByLabel("رویژن دیتاشیت") }).first();
await form.waitFor();
await page.waitForTimeout(800);
const sel = form.getByLabel("رویژن دیتاشیت");
check(/DS-K-2101 Rev\.1/.test(flat(await sel.locator("option:checked").innerText())), "form has the datasheet revision selected");
check((await form.getByLabel("فشار طراحی (barg)").inputValue()) === "38.5", "form shows design pressure 38.5");
const pointRows = () => form.locator("table tbody tr");
check((await pointRows().count()) === 2, "form lists two points");

await form.getByLabel("پارامتر", { exact: true }).fill("Vibration");
await form.getByLabel("Historian tag").fill("OLF12:K2101.VT101");
await form.getByLabel("واحد").fill("mm/s");
await form.getByRole("button", { name: "افزودن" }).click();
await page.waitForTimeout(1200);
check((await pointRows().count()) === 3, "a Historian-only point is added");
await page.screenshot({ path: `${SHOT}/191-handover-form.png`, fullPage: true });

await form.getByLabel("پارامتر", { exact: true }).fill("Nothing to find");
await form.getByRole("button", { name: "افزودن" }).click();
await page.waitForTimeout(1000);
const err1 = flat(await page.locator("p.err").first().innerText().catch(() => ""));
check(/DCS یا Historian/.test(err1), `a point with neither identifier is refused, and says why: «${err1.slice(0, 90)}»`);
check((await pointRows().count()) === 3, "and nothing was added");

await pointRows().filter({ hasText: "Vibration" }).getByRole("button", { name: "حذف" }).click();
await page.waitForTimeout(1200);
check((await pointRows().count()) === 2, "the point is removed");

await form.getByLabel("رویژن دیتاشیت").selectOption("");
await form.getByRole("button", { name: "ذخیره" }).click();
await page.waitForTimeout(1000);
const err2 = flat(await page.locator("p.err").first().innerText().catch(() => ""));
check(/بدون ارجاع به رویژن دیتاشیت/.test(err2), `design values without their datasheet are refused: «${err2.slice(0, 90)}»`);

await page.goto(BASE + "/asset?tag=K-2101", { waitUntil: "networkidle" }); await page.waitForTimeout(1500);
const cmms = page.locator(".card", { has: page.locator("h2", { hasText: "شناسنامهٔ نگهداری" }) }).first();
const cmmsText = flat(await cmms.innerText());
console.log("  asset CMMS card:", cmmsText.slice(0, 260));
check(/38\.5 barg/.test(cmmsText) && /DS-K-2101/.test(cmmsText), "asset page shows design conditions and datasheet");
check(/K2101_PI102\.PV/.test(cmmsText) && /Running status/.test(cmmsText), "asset page lists the DCS/Historian points");
const notHeld = flat(await page.locator(".card", { has: page.locator("h2", { hasText: "هنوز در این پلتفرم نیست" }) }).innerText());
check(!/DCS/.test(notHeld), "DCS/Historian is no longer listed as not held");
await page.screenshot({ path: `${SHOT}/192-asset-k2101.png`, fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("deliberate refusals (400):", refused.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
process.exit(problems.length ? 1 : 0);
