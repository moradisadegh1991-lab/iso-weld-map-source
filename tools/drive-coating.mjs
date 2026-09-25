/**
 * Drive the painting and insulation page: systems, items, a coat applied
 * near the dew point, insulation held for the leak test, the live dew-point
 * hint, and the spool and structure paint steps it answers.
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-coating.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }

const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => { if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`); });

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

await page.goto(BASE + "/coating", { waitUntil: "networkidle" });
await page.waitForSelector("h1"); await page.waitForTimeout(800);
console.log("header :", (await page.locator(".pagehead .sub").innerText()).replace(/\s+/g, " "));
const itemsCard = page.locator(".card", { has: page.locator("h2", { hasText: /^آیتم‌ها$/ }) });
const rows = itemsCard.locator(".dtable tbody > tr");
for (const r of await rows.allInnerTexts()) console.log("  ", r.replace(/\s+/g, " ").slice(0, 170));
await page.screenshot({ path: `${SHOT}/70-coating.png` });

const toggle = async (i) => { await rows.nth(i).getByRole("button").click(); await page.waitForTimeout(700); };
const card = (t) => page.locator("td .card").filter({ hasText: t }).first();
const text = async (t) => (await card(t).innerText()).replace(/\s+/g, " ").slice(0, 220);
const labels = (await rows.allInnerTexts()).map((r) => r.split(/\s+/)[0]);

// The hot-insulated spool: insulation measured, held for the leak test.
const insulatedRow = (await rows.allInnerTexts()).findIndex((r) => /عایق گرم/.test(r));
await toggle(insulatedRow);
console.log("insulated:", await text("عایق‌کاری (ضخامت)"));
await toggle(insulatedRow);

// The spool whose primer went on near the dew point.
const dewRow = (await rows.allInnerTexts()).findIndex((r) => /رد/.test(r) && /PS-3/.test(r) && !/PR-/.test(r));
await toggle(dewRow);
console.log("dew-point coat:", await text("اعمال لایه‌ها"));
// Live dew point as the inspector types.
await page.fill("#ct-air", "30"); await page.fill("#ct-rh", "85"); await page.fill("#ct-steel", "29");
console.log("live hint (29 °C steel):", (await page.locator("#ct-steel").locator("xpath=..").locator(".hint").innerText()));
await page.fill("#ct-steel", "31");
console.log("live hint (31 °C steel):", (await page.locator("#ct-steel").locator("xpath=..").locator(".hint").innerText()));
await page.locator("h2", { hasText: "لایه‌ها — DFT" }).scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOT}/71-coating-detail.png` });
await toggle(dewRow);

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const stray = await page.evaluate(() => [...document.querySelectorAll(".field .hint")].filter((h) => {
  const f = h.closest(".field").getBoundingClientRect(), r = h.getBoundingClientRect();
  return r.top < f.top - 1 || r.bottom > f.bottom + 1; }).length);
console.log("overflow px:", overflow, "· hints outside field:", stray);

// What the coating sign-off answers elsewhere.
const other = await page.evaluate(async () => {
  const pid = (await (await fetch("/api/projects")).json()).projects?.[0]?.id;
  const board = await (await fetch(`/api/coating?projectId=${pid}`)).json();
  const out = {};
  const spoolItem = board.items.find((i) => i.spoolId && i.ready);
  const sp = await (await fetch(`/api/piping/execution?projectId=${pid}&spoolId=${spoolItem.spoolId}`)).json();
  const steps = (sp.status || sp).steps;
  const painted = steps.find((x) => x.code === "painted");
  out[`${spoolItem.label} painted`] = `${painted.derived ? "derived" : "manual"} ${painted.status}`
    + ` outOfOrder=${painted.outOfOrder} test=${steps.find((x) => x.code === "test").status}`;
  const st = await (await fetch(`/api/structural?projectId=${pid}`)).json();
  const pr = st.structures.find((x) => x.tag_no === "PR-1201");
  const d = await (await fetch(`/api/structural?projectId=${pid}&tagId=${pr.id}`)).json();
  const pa = d.status.steps.find((x) => x.code === "painting");
  out["PR-1201 painting"] = `${pa.derived ? "derived" : "manual"} ${pa.status}`;
  return out;
});
console.log("elsewhere:", JSON.stringify(other));
console.log("problems:", problems.length ? problems : "none");
await b.close();
