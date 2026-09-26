/**
 * Drive the instrumentation page: the board, the loops, a rejected
 * calibration and its re-calibration, and a loop waiting on wiring.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-instrumentation.mjs
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
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/instrumentation", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
for (const t of await page.locator(".card", { hasText: "لوپ‌ها" }).first().locator("tbody tr").allInnerTexts())
  console.log("  loop", t.replace(/\s+/g, " "));
const board = page.locator(".card", { hasText: "ابزارها" }).last().locator(".dtable tbody > tr");
for (const r of await board.allInnerTexts()) console.log("  ", r.replace(/\s+/g, " ").slice(0, 170));
await page.screenshot({ path: `${SHOT}/60-instrumentation.png` });

const toggle = async (no) => {
  await page.locator(".card", { hasText: "ابزارها" }).last().locator("tbody > tr", { hasText: no }).first()
    .getByRole("button").click();
  await page.waitForTimeout(600);
};
const card = (t) => page.locator("td .card").filter({ hasText: t }).first();
const text = async (t) => (await card(t).innerText()).replace(/\s+/g, " ").slice(0, 200);

await toggle("FT-2101");
console.log("FT cal   :", await text("کالیبراسیون / تست"), "| buttons:", await card("کالیبراسیون / تست").locator("button").count());
await page.locator("h2", { hasText: /^کالیبراسیون$/ }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/61-instrumentation-cal.png` });
await page.fill("#cal-p", "0:4.00 15000:8.01 30000:12.01 45000:16.01 60000:20.00");
await page.click("text=ثبت کالیبراسیون"); await page.waitForTimeout(1500);
console.log("FT after :", await text("کالیبراسیون / تست"));
await toggle("FT-2101");

await toggle("LT-3102");
console.log("LT loop  :", await text("لوپ چک"));
await toggle("LT-3102");

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow px:", overflow);
const step = await page.evaluate(async () => {
  const pid = (await (await fetch("/api/projects")).json()).projects?.[0]?.id;
  const eq = await (await fetch(`/api/equipment?projectId=${pid}`)).json();
  const out = {};
  for (const no of ["P-1203A", "K-2101"]) {
    const tag = eq.tags.find((t) => t.tag_no === no);
    const s = await (await fetch(`/api/civil?projectId=${pid}&tagId=${tag.id}`)).json();
    const e = s.status.steps.find((x) => x.code === "instrument");
    out[no] = `${e.derived ? "derived" : "manual"} ${e.status}`;
  }
  return out;
});
console.log("equipment instrument steps:", JSON.stringify(step));
console.log("problems:", problems.length ? problems : "none");
await b.close();
