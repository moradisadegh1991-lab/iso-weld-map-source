/**
 * Drive handover phase 2 (production build, seeded DEMO): the checklist
 * holds tags with no approved plan · the PM tab lists tasks with their
 * sources, a draft cannot be approved by its author but can by another,
 * a change to an approved task opens a revision · the spares tab shows the
 * short commissioning seal and the shared seal across pumps · the
 * calibration tab shows PI-1203A overdue and a plan set from the form ·
 * the PM export downloads approved tasks only.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-maintenance.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
const flat = (s) => s.replace(/\s+/g, " ").trim();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
await showAllTabs(page);
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
page.on("response", (r) => { if (r.status() >= 500) problems.push(`HTTP ${r.status()} ${r.url()}`); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(`${BASE}/handover`, { waitUntil: "networkidle" });
await page.waitForSelector(".kpis");
console.log("master KPIs:", (await page.locator(".kpi").allInnerTexts()).map(flat).join(" | "));
console.log("P-1203A open:", flat(await page.locator("tr", { hasText: "P-1203A" }).first().locator("td").nth(5).innerText()));

// ── the plan ──
await page.getByRole("tab", { name: "برنامهٔ PM" }).click();
await page.waitForSelector("text=برنامهٔ نگهداری (PM)");
console.log("PM KPIs:", (await page.locator(".kpi").allInnerTexts()).map(flat).join(" | "));
for (const r of await page.locator(".tk tbody tr:not([hidden])").allInnerTexts()) console.log("  task", flat(r).slice(0, 150));
const draftRow = page.locator("tr", { hasText: "PM-02" }).filter({ hasText: "P-1203A" });
console.log("draft prepared by the QC inspector — approve offered to the admin:", await draftRow.getByRole("button", { name: "تأیید" }).count() === 1);
await draftRow.getByRole("button", { name: "تأیید" }).click();
await page.waitForTimeout(800);
console.log("after approval:", flat(await draftRow.innerText()).slice(0, 140));
// A change to an approved task is a new revision, prepared by me — so I cannot approve it.
const k1 = page.locator("tr", { hasText: "PM-01" }).filter({ hasText: "K-2101" });
await k1.getByRole("button", { name: "رویژن جدید" }).click();
await page.fill("#pm-iv", "2");
await page.fill("#pm-ref", "Compressor IOM (demo) §8.3 rev B");
await page.getByRole("button", { name: "ذخیره به‌عنوان پیش‌نویس" }).click();
await page.waitForTimeout(800);
console.log("K-2101 PM-01 now:", flat(await k1.innerText()).slice(0, 160), "| approve offered to its author:", await k1.getByRole("button", { name: "تأیید" }).count());
// A new task without a source reference is refused, with the reason.
await page.locator(".fold-head", { hasText: "تسک نگهداری جدید" }).click();
await page.fill("#pm-code", "PM-77"); await page.fill("#pm-title", "Coupling alignment check"); await page.fill("#pm-iv", "6");
await page.getByRole("button", { name: "ذخیره به‌عنوان پیش‌نویس" }).click();
await page.waitForSelector("p.err");
console.log("no source reference:", flat(await page.locator("p.err").first().innerText()).slice(0, 140));
const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: /خروجی CSV/ }).click()]);
const csv = (await dl.createReadStream().then((s) => s.toArray())).map((c) => c.toString("utf8")).join("");
console.log("PM export:", dl.suggestedFilename(), csv.trim().split("\r\n").length - 1, "rows | first:", csv.split("\r\n")[1]?.slice(0, 90));
await page.screenshot({ path: `${SHOT}/180-pm-plan.png`, fullPage: true });

// ── spares ──
await page.getByRole("tab", { name: "قطعات یدکی (SPIR)" }).click();
await page.waitForSelector("text=قطعات مشترک");
console.log("spares KPIs:", (await page.locator(".kpi").allInnerTexts()).map(flat).join(" | "));
for (const r of await page.locator(".tk tbody tr:not([hidden])").allInnerTexts()) console.log("  spare", flat(r).slice(0, 140));
console.log("shared:", flat(await page.locator("ul", { hasText: "SC-65-OH2" }).innerText()));
await page.screenshot({ path: `${SHOT}/181-spares.png`, fullPage: true });

// ── calibration ──
await page.getByRole("tab", { name: "کالیبراسیون دوره‌ای" }).click();
await page.waitForSelector("text=سررسید = آخرین کالیبراسیون");
console.log("calibration KPIs:", (await page.locator(".kpi").allInnerTexts()).map(flat).join(" | "));
console.log("PI-1203A:", flat(await page.locator("tr", { hasText: "PI-1203A" }).first().innerText()).slice(0, 150));
const lt = page.locator("tr", { hasText: "LG-3102" }).first();
if (await lt.count()) {
  await lt.getByRole("button", { name: "برنامه" }).click();
  const id = await page.locator("input[id^='cp-m-']").getAttribute("id");
  await page.fill(`#${id}`, "12"); await page.fill(`#${id.replace("cp-m-", "cp-r-")}`, "ENG-STD-INST-04 (demo) §5");
  await page.getByRole("button", { name: "ذخیره" }).click();
  await page.waitForTimeout(800);
  console.log("LG-3102 after plan:", flat(await lt.innerText()).slice(0, 150));
}
await page.screenshot({ path: `${SHOT}/182-calibration.png`, fullPage: true });

// ── the checklist again: P-1203A now has an approved plan item ──
await page.getByRole("tab", { name: "شناسنامهٔ تجهیزات" }).click();
await page.waitForSelector(".kpis");
console.log("P-1203A open now:", flat(await page.locator("tr", { hasText: "P-1203A" }).first().locator("td").nth(5).innerText()));
console.log("problems:", problems.length ? problems : "none");
await b.close();
