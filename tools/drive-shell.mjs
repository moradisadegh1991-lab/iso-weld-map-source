/**
 * Walk the whole platform in a real browser, signed in as a real account.
 * Compiling is not working: this is what says the shell actually works.
 */
import { chromium } from "playwright";

const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";

// Credentials come from the environment, never from this file. A password
// committed to a repository is a password that stays valid long after
// everyone has forgotten it is there.
//
//   DRIVE_EMAIL=you@example.com DRIVE_PASSWORD=... node tools/drive-shell.mjs
const EMAIL = process.env.DRIVE_EMAIL;
const PASSWORD = process.env.DRIVE_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("set DRIVE_EMAIL and DRIVE_PASSWORD (see npm run auth:admin)");
  process.exit(1);
}

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push("console: " + m.text()));
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() >= 400 && !r.url().includes("favicon")) {
    problems.push(`HTTP ${r.status()} ${r.url().replace(BASE, "")}`);
  }
});

// ── the gate ─────────────────────────────────────────────────────────────
await page.goto(BASE, { waitUntil: "networkidle" });
const gated = await page.locator(".signin form").count();
console.log("signed out shows the login form :", gated === 1);
console.log("and no navigation leaks through  :", await page.locator(".sidenav").count() === 0);
await page.screenshot({ path: `${SHOT}/01-signin.png` });

// A wrong password must not say which half was wrong.
await page.fill("#email", EMAIL);
await page.fill("#password", "definitely-not-it");
await page.click("button[type=submit]");
await page.waitForSelector("p.err[role=alert]");
const wrongPw = await page.locator("p.err[role=alert]").innerText();
await page.fill("#email", "nobody@kavian.ir");
await page.fill("#password", "definitely-not-it");
await page.click("button[type=submit]");
await page.waitForTimeout(600);
const unknownUser = await page.locator("p.err[role=alert]").innerText();
console.log("wrong password and unknown email read the same :", wrongPw === unknownUser);

// ── sign in ──────────────────────────────────────────────────────────────
await page.fill("#email", EMAIL);
await page.fill("#password", PASSWORD);
await page.click("button[type=submit]");
await page.waitForSelector(".shell", { timeout: 15000 });
console.log("signed in                        :", await page.locator(".shell").count() === 1);

const cookies = await page.context().cookies();
const sess = cookies.find((c) => c.name === "epc_session");
console.log("cookie httpOnly / sameSite       :", sess?.httpOnly, sess?.sameSite);
console.log("token unreachable from script    :",
  await page.evaluate(() => !document.cookie.includes("epc_session")));

await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOT}/02-launchpad.png`, fullPage: true });
const tiles = await page.locator(".tiles .tile").count();
console.log("launchpad tiles                  :", tiles);

// ── every live route ─────────────────────────────────────────────────────
const routes = [
  ["/project", "مشخصات پروژه"], ["/contractors", "پیمانکاران"],
  ["/subsystems", "سیستم و ساب‌سیستم"], ["/equipment", "تجهیزات"],
  ["/reports", "گزارش‌ها"], ["/qc", "کنترل کیفیت"], ["/admin", "کاربران و دسترسی"],
  ["/piping", "پایپینگ"], ["/civil", "سیویل"],
];
for (const [href, heading] of routes) {
  await page.goto(BASE + href, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const h1 = await page.locator("h1").first().innerText().catch(() => "(none)");
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const ok = h1.includes(heading) || heading.includes(h1.split("—")[0].trim());
  console.log(`${href.padEnd(16)} h1="${h1.slice(0, 28)}" overflow=${overflow}px ${ok ? "" : "  <-- HEADING MISMATCH"}`);
}

// ── a form actually saves ────────────────────────────────────────────────
await page.goto(BASE + "/project", { waitUntil: "networkidle" });
await page.waitForSelector("#client_name");
await page.fill("#client_name", "پتروشیمی کاویان");
await page.fill("#site_location", "عسلویه — پارس جنوبی");
await page.click("button[type=submit]");
await page.waitForTimeout(900);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("#client_name");
console.log("project profile persisted        :",
  (await page.inputValue("#client_name")) === "پتروشیمی کاویان");
await page.screenshot({ path: `${SHOT}/03-project.png`, fullPage: true });

await page.goto(BASE + "/contractors", { waitUntil: "networkidle" });
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOT}/04-contractors.png`, fullPage: true });

// ── narrow reflow ────────────────────────────────────────────────────────
await page.setViewportSize({ width: 420, height: 900 });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const narrowOverflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("narrow reflow overflow           :", narrowOverflow + "px");
await page.screenshot({ path: `${SHOT}/05-narrow.png`, fullPage: true });

console.log("\nproblems:", problems.length ? problems : "none");
await browser.close();
