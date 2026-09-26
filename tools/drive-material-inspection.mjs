/**
 * Drive material receipt under the ITP (production build, seeded DEMO):
 *   the warehouse shows which lot the material ITP holds and on which
 *   request · accepting a held lot is refused with the reason, rejecting is
 *   not offered less · the inspection page offers the material ITP, lists the
 *   lot's request under its receipt and heat, and opens the lot's file.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-material-inspection.mjs
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
const page = await (await b.newContext({ viewport: { width: 1366, height: 900 } })).newPage();
await showAllTabs(page);
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

// ── the warehouse ──
await page.goto(`${BASE}/warehouse`, { waitUntil: "networkidle" });
const row = page.locator("tr", { hasText: "MRR-0019" });
await row.waitFor();
console.log("MRR-0019 row:", flat(await row.innerText()).slice(0, 140));
const other = page.locator("tr", { hasText: "MRR-0015" });
// MRR-0015 passed its MIR before the ITP was in force; its MTC was never reviewed, so that is what is held.
console.log("MRR-0015 held on MIR:", await other.locator("td").nth(3).locator("text=توقف ITP").count() > 0,
  "| on MTC:", await other.locator("td").nth(4).locator("text=توقف ITP").count() > 0);
await row.getByRole("button", { name: "جزئیات" }).click();
const holdCard = page.locator(".card", { hasText: "نقطهٔ توقف ITP" }).last();
console.log("hold card:", flat(await holdCard.innerText()).slice(0, 260));
await page.getByLabel("پذیرفته").fill("72");
await page.getByRole("button", { name: "ثبت MIR" }).click();
const err = page.locator("p.err", { hasText: "ITP-MAT-001" });
await err.waitFor();
console.log("accepting it:", flat(await err.innerText()).slice(0, 200));
await page.screenshot({ path: `${SHOT}/160-warehouse-hold.png`, fullPage: true });

// ── the inspection page ──
await page.goto(`${BASE}/inspection`, { waitUntil: "networkidle" });
const irRow = page.locator("tr", { hasText: "MRR-0019" }).first();
await irRow.waitFor();
console.log("IR on the board:", flat(await irRow.innerText()).slice(0, 160));
console.log("ITP list has ITP-MAT-001:", await page.locator("td", { hasText: "ITP-MAT-001" }).count() > 0);
await page.getByRole("tab", { name: "پروندهٔ آیتم" }).click();
await page.selectOption("#i-scope", "material");
await page.waitForFunction(() => document.querySelectorAll("#i-item option").length > 1);
const opts = await page.locator("#i-item option").allInnerTexts();
console.log("lots offered for a file:", opts.length - 1, "| e.g.", opts.find((o) => o.includes("MRR-0019")));
await page.selectOption("#i-item", { label: opts.find((o) => o.includes("MRR-0019")) });
const file = page.locator(".card", { has: page.locator("h2", { hasText: "پروندهٔ بازرسی یک آیتم" }) });
await file.locator("tbody tr").first().waitFor();
console.log("lot file:", (await file.locator("tbody tr").allInnerTexts()).map((r) => flat(r).slice(0, 110)));
await page.screenshot({ path: `${SHOT}/161-inspection-material.png`, fullPage: true });
console.log("problems:", problems.length ? problems : "none");
await b.close();
