/**
 * Drive the electrical page: the board, a rejected IR, an MV cable held
 * without a criterion, the issues filter, and a pump whose electrical step
 * is now answered by its cables.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-electrical.mjs
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

await page.goto(BASE + "/electrical", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
const board = page.locator(".dtable").first().locator("tbody > tr");
for (const r of await board.allInnerTexts()) console.log("  ", r.replace(/\s+/g, " ").slice(0, 170));
await page.screenshot({ path: `${SHOT}/50-electrical.png` });

await page.check("text=فقط موارد نیازمند اقدام");
console.log("issues filter rows:", await board.count());
await page.uncheck("text=فقط موارد نیازمند اقدام");

const open = async (no) => {
  await page.locator(".dtable").first().locator("tbody > tr", { hasText: no }).first().getByRole("button").click();
  await page.waitForSelector("text=تست مقاومت عایقی"); await page.waitForTimeout(400);
};
const close = async (no) => {
  await page.locator(".dtable").first().locator("tbody > tr", { hasText: no }).first().getByRole("button").click();
  await page.waitForTimeout(300);
};
const card = (t) => page.locator("td .card").filter({ hasText: t }).first();
const text = async (t) => (await card(t).innerText()).replace(/\s+/g, " ").slice(0, 200);

await open("EC-1203A-C");
console.log("C  ir     :", await text("تست مقاومت عایق (IR)"), "| buttons:", await card("تست مقاومت عایق (IR)").locator("button").count());
console.log("C  hv     :", await text("تست ولتاژ بالا"));
await page.locator("h2", { hasText: "تست مقاومت عایقی" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/51-electrical-detail.png` });
// Re-test after repair: the latest decides.
await page.fill("#ir-r", "900 900 850 900"); await page.click("text=ثبت تست"); await page.waitForTimeout(1500);
console.log("C  after re-test:", await text("تست مقاومت عایق (IR)"));
await close("EC-1203A-C");

await open("EC-2101-P");
console.log("MV ir     :", await text("تست مقاومت عایق (IR)"));
console.log("MV hv     :", await text("تست ولتاژ بالا"), "| buttons:", await card("تست ولتاژ بالا").locator("button").count());
await close("EC-2101-P");

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("horizontal overflow px:", overflow);

await page.goto(BASE + "/equipment", { waitUntil: "networkidle" }); await page.waitForTimeout(800);
// The pump's electrical step, as the running app answers it.
const step = await page.evaluate(async () => {
  const pid = (await (await fetch("/api/projects")).json()).projects?.[0]?.id
    || JSON.parse(localStorage.getItem("epc.project") || "null");
  const eq = await (await fetch(`/api/equipment?projectId=${pid}`)).json();
  const tag = eq.tags.find((t) => t.tag_no === "P-1203A");
  const s = await (await fetch(`/api/civil?projectId=${pid}&tagId=${tag.id}`)).json();
  const e = s.status.steps.find((x) => x.code === "electrical");
  return { derived: e.derived, status: e.status };
});
console.log("P-1203A electrical step:", JSON.stringify(step));
await page.goto(BASE + "/project", { waitUntil: "networkidle" }); await page.waitForTimeout(600);
console.log("project LV voltage:", await page.inputValue("#lv_system_voltage_v"));
console.log("problems:", problems.length ? problems : "none");
await b.close();
