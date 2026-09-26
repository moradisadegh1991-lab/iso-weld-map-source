/**
 * Drive Punch and NCR: the board, a punch item raised and cleared by the
 * same person and refused at verify, and an NCR the proposer cannot approve.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-quality.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
await showAllTabs(page);
const problems = [], expected400 = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/400|Failed to load resource/.test(m.text())) problems.push("console: " + m.text()); });
page.on("response", (r) => {
  if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) (r.status() === 400 ? expected400 : problems).push(`HTTP ${r.status()} ${r.url()}`);
});
const RUN = `Drive ${Date.now().toString(36)}`;
const flat = (s) => s.replace(/\s+/g, " ").trim();
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/quality", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header:", flat(await page.locator(".pagehead .sub").innerText()));
for (const k of await page.locator(".kpi").allInnerTexts()) console.log("  kpi ", flat(k));
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
for (const r of await card("نگه داشته").locator("tbody tr").allInnerTexts()) console.log("  sub ", flat(r));
await page.screenshot({ path: `${SHOT}/100-quality.png` });

const list = card("Punch list");
for (const r of (await list.locator("tbody > tr").allInnerTexts()).slice(0, 12)) console.log("  punch", flat(r).slice(0, 150));

// Raise a punch item, clear it, and try to verify as the same person.
await page.locator(".fold-head", { hasText: "ثبت Punch جدید" }).click();   // the form is folded until asked for
await page.selectOption("#pf-t", { label: "P-1204A" });
await page.fill("#pf-d", `${RUN}: casing drain plug missing`);
await page.selectOption("#pf-c", "B");
await page.getByRole("button", { name: "ثبت", exact: true }).click(); await page.waitForTimeout(1200);
const row = list.locator("tbody > tr", { hasText: RUN });
console.log("raised:", flat(await row.innerText()).slice(0, 120));
await row.getByRole("button", { name: "اقدام" }).click(); await page.waitForTimeout(600);
const panel = list.locator("tbody > tr").filter({ has: page.locator("input[id^=pn-]") });
await panel.locator("input[id^=pn-]").fill("Plug fitted");
await panel.getByRole("button", { name: "رفع شد" }).click(); await page.waitForTimeout(1200);
await panel.getByRole("button", { name: "تأیید و بستن" }).click(); await page.waitForTimeout(1000);
console.log("self-verify refused:", flat(await page.locator(".page > p.err").innerText()));
console.log("history:", flat(await panel.locator("ol").innerText()));
await panel.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/101-quality-punch.png` });

// NCR tab.
await page.getByRole("tab", { name: "NCR" }).click(); await page.waitForTimeout(600);
const nc = card("عدم انطباق");
for (const r of await nc.locator("tbody > tr").allInnerTexts()) console.log("  ncr", flat(r).slice(0, 170));
const n2 = nc.locator("tbody > tr", { hasText: "NCR-0002" });
await n2.getByRole("button", { name: "اقدام" }).click(); await page.waitForTimeout(800);
const np = nc.locator("tbody > tr").filter({ has: page.locator("select[id^=nd-]") });
await np.locator("select[id^=nd-]").selectOption("use_as_is");
await np.locator("input[id^=ndn-]").fill("Drive test: 321 not required at this temperature");
await np.getByRole("button", { name: "پیشنهاد دیسپوزیشن" }).click(); await page.waitForTimeout(1200);
const np2 = nc.locator("tbody > tr").filter({ has: page.locator("ol") }).first();
await np2.getByRole("button", { name: "تأیید", exact: true }).click(); await page.waitForTimeout(1000);
console.log("self-approve refused:", flat(await page.locator(".page > p.err").innerText()));
await np2.locator("input[id^=nn-]").fill("Drive test cleanup");
await np2.getByRole("button", { name: "رد دیسپوزیشن" }).click(); await page.waitForTimeout(1000);
console.log("after reject:", flat(await n2.innerText()).slice(0, 170));
await nc.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/102-quality-ncr.png`, fullPage: false });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow, "· expected 400s:", expected400.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
