/**
 * Drive offline recording of cables and instruments (production build):
 * with the network cut, a cable step and an IR test with a low reading
 * (the phone's provisional verdict says so), a transmitter's install step
 * and a calibration (provisional pass); then the network back, the sync,
 * and the server's own verdicts on what was sent.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-field-ei.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const CABLE = process.env.DRIVE_CABLE || "EC-1204A-P";
const INST = process.env.DRIVE_INSTRUMENT || "TT-2101";
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
const flat = (s) => s.replace(/\s+/g, " ").trim();

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(BASE + "/field", { waitUntil: "networkidle" });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=روی گوشی:");
console.log("pack:", flat(await page.locator("text=روی گوشی:").innerText()));

await ctx.setOffline(true);
// ── the cable, as a label would open it ──
await page.goto(`${BASE}/field?p=DEMO&k=c&n=${CABLE}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".field-step", { timeout: 15000 });
const card = (no) => page.locator(".card", { has: page.locator("h2", { hasText: no }) });
console.log("cable:", flat(await card(CABLE).locator("p.sm").first().innerText()).slice(0, 120));
await card(CABLE).locator(".field-step", { hasText: "کابل‌کشی" }).getByRole("button", { name: "انجام شد" }).click();
await page.fill(`input[id^=irr-]`, "0.4 2000 >2000");
console.log("IR provisional:", flat(await card(CABLE).locator("p", { hasText: "پیش‌داوری" }).innerText()));
await card(CABLE).getByRole("button", { name: "ثبت تست" }).click(); await page.waitForTimeout(400);

// ── the instrument ──
await page.fill("#fq", INST); await page.getByRole("button", { name: "برو", exact: true }).click();
await page.waitForSelector(`h2:has-text("${INST}")`);
await card(INST).locator(".field-step", { hasText: "نصب در محل" }).getByRole("button", { name: "انجام شد" }).click();
await page.fill(`input[id^=cp-]`, "0:4.00 50:8.00 100:12.01 150:15.99 200:20.00");
console.log("cal provisional:", flat(await card(INST).locator("p", { hasText: "پیش‌داوری" }).innerText()));
await card(INST).getByRole("button", { name: "ثبت کالیبراسیون" }).click(); await page.waitForTimeout(400);
console.log("loop:", flat(await card(INST).locator("b", { hasText: "لوپ" }).locator("..").innerText()).slice(0, 160));
const queued = await page.locator(".card", { has: page.locator("h2", { hasText: "صف روی این گوشی" }) }).locator(".queued").allInnerTexts();
console.log("queued:", queued.map(flat));
await page.screenshot({ path: `${SHOT}/112-field-instrument-offline.png`, fullPage: true });

// ── back online ──
await ctx.setOffline(false);
await page.reload({ waitUntil: "networkidle" });
await page.waitForFunction(() => !document.querySelector(".card h2")?.textContent.includes("صف") || true);
const syncBtn = page.getByRole("button", { name: "همگام‌سازی" });
if (await syncBtn.count() && await syncBtn.isEnabled()) await syncBtn.click();
await page.waitForFunction(() => document.querySelectorAll(".queued").length === 0, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1000);
console.log("after sync:", flat(await page.locator("p[role=status]").first().innerText().catch(() => "—")));
const me = await (await ctx.request.get(`${BASE}/api/auth/me`)).json();
const pid = me.projects.find((x) => x.code === "DEMO").id;
const recent = (await (await ctx.request.get(`${BASE}/api/field?projectId=${pid}&recent=1`)).json()).ops.slice(0, 4);
console.log("server received:", recent.map((o) => `${o.kind}:${o.status}`).join(", "));
const pack = await (await ctx.request.get(`${BASE}/api/field?projectId=${pid}`)).json();
const c = pack.cables.find((x) => x.no === CABLE), i = pack.instruments.find((x) => x.no === INST);
console.log("server verdicts:", `IR ${c.lastIr ? (c.lastIr.ok ? "pass" : "fail: " + c.lastIr.reason) : "none"}`,
  `· ${INST} calibrated: ${i.steps.find((x) => x.code === "calibrated").status}, installed: ${i.steps.find((x) => x.code === "installed").status}`,
  `· ${CABLE} pulled: ${c.steps.find((x) => x.code === "pulled").status}`);
console.log("problems:", problems.length ? problems : "none");
await b.close();
