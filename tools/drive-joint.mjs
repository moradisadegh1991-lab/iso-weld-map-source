/**
 * Drive the joint history (production build, seeded DEMO): the menu item,
 * search, a weld with NDT opened from the list, its timeline and sections,
 * the link from the QC handover gap, and the page on a phone.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-joint.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
const flat = (s) => s.replace(/\s+/g, " ").trim();
async function open(viewport) {
  const page = await (await b.newContext({ viewport })).newPage();
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  return page;
}
const page = await open({ width: 1366, height: 900 });

await page.locator(".sidenav a", { hasText: "سابقهٔ جوش" }).click();
await page.waitForURL("**/piping/joint");
const rows = page.locator(".tk tbody tr:not([hidden])");
await rows.first().waitFor();
console.log("welds listed:", await rows.count(), "| first:", flat(await rows.first().innerText()).slice(0, 110));

// The weld with the most to tell: a repair if there is one, else any examined one.
const texts = await rows.allInnerTexts();
let pick = texts.findIndex((t) => /NDT باز/.test(t));
if (pick < 0) pick = texts.findIndex((t) => /پذیرفته/.test(t));
if (pick < 0) pick = 0;
await rows.nth(pick).getByRole("button", { name: "سابقه" }).click();
await page.waitForSelector("ol.timeline, .empty-note");
console.log("address:", new URL(page.url()).search);
console.log("header:", flat(await page.locator(".card h2").first().innerText()));
const attn = page.locator(".card", { has: page.locator("h2", { hasText: "نیاز به توجه" }) });
console.log("attention:", (await attn.count()) ? (await attn.locator("li").allInnerTexts()).map(flat) : "none");
console.log("timeline:", (await page.locator("ol.timeline li").allInnerTexts()).map((t) => flat(t).slice(0, 100)));
for (const h of ["جوشکاری", "NDT و تعمیر", "رویژن‌های نقشه", "مواد و ردیابی ذوب", "اسپول، فیت‌آپ و تست"]) {
  const c = page.locator(".card", { has: page.locator("h2", { hasText: h }) });
  console.log(`· ${h}:`, flat(await c.innerText()).slice(h.length, h.length + 150));
}
await page.screenshot({ path: `${SHOT}/170-joint-history.png`, fullPage: true });

// The QC handover gap links each weld to its history.
await page.goto(`${BASE}/qc`, { waitUntil: "networkidle" });
const link = page.locator(".tk tbody a[href^='/piping/joint']").first();
if (await link.count()) {
  const no = flat(await link.innerText());
  await link.click();
  await page.waitForSelector("ol.timeline, .empty-note");
  console.log("from the QC gap:", no, "→", flat(await page.locator(".card h2").first().innerText()));
} else console.log("from the QC gap: no weld awaiting NDT in the demo");

// A phone.
const phone = await open({ width: 412, height: 915 });
await phone.goto(`${BASE}/piping/joint`, { waitUntil: "networkidle" });
await phone.locator(".tk tbody tr").first().waitFor();
await phone.locator(".tk tbody tr").first().getByRole("button", { name: "سابقه" }).click();
await phone.waitForSelector("ol.timeline, .empty-note");
console.log("phone scrolls sideways:", await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await phone.screenshot({ path: `${SHOT}/171-joint-phone.png`, fullPage: true });

console.log("problems:", problems.length ? problems : "none");
await b.close();
