/**
 * Drive the fittings the reader used to miss (owner's report 2026-10-29,
 * finding F-20) in the real piping page: the geometry of eval cases R28 (a
 * 60" lug butterfly valve and a blind & open spacer, each bolted between WN
 * flanges) and R26 (a weldolet with a blind-flanged branch) typed into the JSON
 * tab, applied, and seen in the register, the checks, the 2-D map and the 3-D
 * view — the welds the rules give, no weld inside a valve, no page error; and
 * R30 / R31 (finding F-21): a mis-read elbow angle and overlapping fittings
 * called out in the checks.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-bolted-olet.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const caseOf = (id) => JSON.parse(readFileSync(new URL(`../eval/cases/rules/${id}.json`, import.meta.url), "utf8"));
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1440, height: 1100 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload|WebGL|GPU stall/.test(m.text())) problems.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(`${BASE}/piping`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /نقشه دوبعدی/ }).first().click();
await page.getByRole("button", { name: /نمونه بدون سرور/ }).click();
await page.locator("nav.tabnav").waitFor();

async function apply(id, shot) {
  const c = caseOf(id);
  await page.locator("nav.tabnav button", { hasText: "JSON" }).click();
  await page.locator(".pane textarea").fill(JSON.stringify(c.input, null, 2));
  await page.getByRole("button", { name: "اعمال محلی" }).click();
  await page.waitForTimeout(600);
  await page.locator("nav.tabnav button", { hasText: "سرجوش" }).click();
  const rows = await page.locator(".pane table tbody tr").allInnerTexts();
  await page.locator("nav.tabnav button", { hasText: "اعتبارسنجی" }).click();
  const checks = await page.locator(".pane").first().innerText();
  await page.screenshot({ path: `${SHOT}/${shot}`, fullPage: false });
  return { c, rows, checks };
}

// R28: 60" — valve and spacer bolted between flanges
const r28 = await apply("R28-wafer-valve-and-spacer-60in", "510-bolted-60in-fa.png");
check(r28.rows.length === r28.c.expect.weldCount, `R28 in the page: ${r28.rows.length} welds — two tie-ins and four flange hubs, none inside the valve or the spacer`);
check(!/شیر .* در MTO نیست|در MTO نیست/.test(r28.checks), "the valve and the spacer the MTO lists are not taken for hallucinations");
check(/تطبیق اتصالات با MTO/.test(r28.checks) && /شیر ×1/.test(r28.checks) && /اسپیسر ×1/.test(r28.checks), "the MTO match counts the valve and the spacer by family");
// the 3-D view renders the bolted bodies (they have a curve point)
await page.getByRole("button", { name: "سه‌بعدی" }).first().click().catch(() => {});
await page.waitForTimeout(1200);
await page.screenshot({ path: `${SHOT}/511-bolted-60in-3d-fa.png` });

// R26: a weldolet with a blind-flanged branch
const r26 = await apply("R26-weldolet-branch", "512-weldolet-fa.png");
check(r26.rows.length === r26.c.expect.weldCount && r26.rows.some((t) => /BR/.test(t)), `R26 in the page: ${r26.rows.length} welds, one of them the olet's branch weld (BR)`);
check(/اولت ×1/.test(r26.checks) && /فلنج ×2/.test(r26.checks), "the weldolet, the WN and the blind flange matched against the MTO");
// R27: the same with no height printed — said, not guessed
const r27 = await apply("R27-weldolet-height-unknown", "513-weldolet-no-height-fa.png");
check(r27.rows.length === 5 && /ارتفاع olet/.test(r27.checks), "an olet with no printed height: still two welds, and the warning says so");

// R30 / R31: a reading that does not hold together is said in the checks (and so reaches the repair pass)
const r30 = await apply("R30-elbow-angle-mistyped", "514-elbow-angle-fa.png");
check(/زاویهٔ زانو/.test(r30.checks) && /135°/.test(r30.checks), "an elbow90 on a 135° turn is called out with its angle");
const r31 = await apply("R31-fittings-overlap", "515-overlap-fa.png");
check(/تداخل اتصالات/.test(r31.checks), "two elbows closer than their take-outs are called out");

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
