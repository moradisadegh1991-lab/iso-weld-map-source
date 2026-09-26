/**
 * Drive the UI round (production build, seeded DEMO):
 *   theme switch (and it survives a reload) · menu search, folding, rail ·
 *   a table's search, column filter, sort and CSV · a form that opens when
 *   asked · the users page: invite with a one-time link, the link sets the
 *   password, the new member's menu is their areas and a write outside them
 *   is refused · a developer made from the command line sees every project ·
 *   the menu as a drawer on a phone.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-ui.mjs
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
const watch = (page) => {
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
};
const flat = (s) => s.replace(/\s+/g, " ").trim();
async function login(ctx, email, password) {
  const page = await ctx.newPage(); watch(page);
  await showAllTabs(page);
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  return page;
}
const stamp = Date.now().toString(36);

// ── theme and menu ──
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await login(ctx, EMAIL, PASSWORD);
await page.waitForSelector(".tiles");
await page.screenshot({ path: `${SHOT}/150-home-dark.png` });
await page.getByRole("button", { name: "تغییر تم" }).click();
console.log("theme after switch:", await page.evaluate(() => document.documentElement.dataset.theme));
await page.reload({ waitUntil: "networkidle" });
console.log("theme after reload:", await page.evaluate(() => document.documentElement.dataset.theme),
  "| body background:", await page.evaluate(() => getComputedStyle(document.body).backgroundImage.slice(0, 40)));
await page.screenshot({ path: `${SHOT}/151-home-light.png` });
console.log("menu groups:", (await page.locator(".nav-grp > button.grp").allInnerTexts()).map(flat).join(" | "));
await page.keyboard.press("Control+k");
await page.keyboard.type("بازرس");
console.log("menu search 'بازرس':", (await page.locator(".nav-groups a").allInnerTexts()).map(flat).join(" | "));
await page.keyboard.press("Enter");
await page.waitForURL("**/inspection");
console.log("Enter went to:", new URL(page.url()).pathname);
await page.locator(".nav-grp > button.grp", { hasText: "مدیریت پروژه" }).click();
console.log("folded group hides its items:", await page.locator(".nav-grp.closed", { hasText: "مدیریت پروژه" }).count() === 1);
await page.getByRole("button", { name: "جمع کردن منو" }).click();
console.log("rail width:", await page.locator(".sidenav").evaluate((n) => Math.round(n.getBoundingClientRect().width)));
await page.screenshot({ path: `${SHOT}/152-rail-light.png` });
await page.getByRole("button", { name: "باز کردن منو" }).click();

// ── a table ──
await page.goto(`${BASE}/quality`, { waitUntil: "networkidle" });
const punchKit = page.locator(".card", { has: page.locator("h2", { hasText: "Punch list" }) }).locator(".tk");
await punchKit.locator(".tk-bar").waitFor();
const count = async () => flat(await punchKit.locator(".tk-n").innerText());
console.log("punch table:", await count());
await punchKit.locator(".tk-q").fill("K-2101");
console.log("search K-2101:", await count(), "| rows:", (await punchKit.locator("tbody tr:not([hidden])").allInnerTexts()).map((r) => flat(r).slice(0, 40)));
await punchKit.locator(".tk-q").fill("");
await punchKit.locator("select[aria-label='فیلتر ستون']").selectOption({ label: "دسته" });
await punchKit.locator("select[aria-label='مقدار فیلتر']").selectOption("A");
console.log("category A:", await count());
await punchKit.getByRole("button", { name: "پاک کردن" }).click();
await punchKit.locator("th", { hasText: "مهلت" }).click();
const firstDue = async () => flat(await punchKit.locator("tbody tr:not([hidden])").first().locator("td").nth(5).innerText());
const asc = await firstDue();
await punchKit.locator("th", { hasText: "مهلت" }).click();
console.log("sorted by due, asc first:", asc, "| desc first:", await firstDue());
// Opening a row's panel keeps it under its own row, sorted.
const second = punchKit.locator("tbody tr:not([hidden])").nth(1);
const secondNo = flat(await second.locator("td").first().innerText());
await second.getByRole("button", { name: "اقدام" }).click();
await page.waitForTimeout(400);
const after = await punchKit.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.cells.length === 1 ? "PANEL" : r.cells[0].textContent.trim()));
console.log("panel opened under", secondNo, "→ next row is", after[after.indexOf(secondNo) + 1]);
const [dl] = await Promise.all([page.waitForEvent("download"), punchKit.getByRole("button", { name: "خروجی CSV" }).click()]);
const csv = await (await dl.createReadStream()).toArray().then((c) => Buffer.concat(c).toString("utf8"));
console.log("CSV:", dl.suggestedFilename(), csv.split("\r\n").length - 1, "rows, BOM", csv.charCodeAt(0) === 0xfeff, "| header:", csv.split("\r\n")[0].slice(1, 60));
await page.screenshot({ path: `${SHOT}/153-table-light.png`, fullPage: true });

// ── a form that opens when asked ──
// The button sits in the header of its part; the form opens under that header.
const foldBtn = page.locator(".fold-btn", { hasText: "ثبت Punch جدید" });
const fold = page.locator(".card", { has: foldBtn }).locator(".card-formslot");
console.log("punch form closed:", await fold.locator("form").count() === 0);
await foldBtn.click();
console.log("punch form open:", await fold.locator("form").count() === 1, "| its own heading hidden:",
  await fold.locator("form h2").first().evaluate((h) => getComputedStyle(h).display));

// ── users: invite, link, set password, restricted menu ──
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
await page.locator(":is(.fold-btn, .fold-head)", { hasText: "دعوت کاربر جدید" }).click();
const who = `civil.${stamp}@demo.test`;
await page.fill("#u-email", who); await page.fill("#u-name", "سرپرست سیویل (آزمون)");
await page.selectOption("#u-role", "qc");
for (const a of ["سیویل", "کیفیت، بازرسی، Punch و NCR"]) await page.getByLabel(a, { exact: true }).check();
await page.getByRole("button", { name: "دعوت و ساخت لینک" }).click();
const linkInput = page.getByLabel("لینک");
await linkInput.waitFor();
const url = await linkInput.inputValue();
console.log("invite link:", url.replace(/token=.*/, "token=…"), "| row:", flat(await page.locator("tr", { hasText: who }).innerText()).slice(0, 120));
await page.screenshot({ path: `${SHOT}/154-users-light.png`, fullPage: true });

const ctx2 = await b.newContext({ viewport: { width: 1366, height: 900 } });
const setup = await ctx2.newPage(); watch(setup);
await setup.goto(url, { waitUntil: "networkidle" });
await setup.waitForSelector("text=برای حساب");
console.log("setup page:", flat(await setup.locator("form").innerText()).slice(0, 90), "| address bar:", new URL(setup.url()).search || "(token cleared)");
await setup.fill("#pw1", "civil supervisor passphrase"); await setup.fill("#pw2", "civil supervisor passphrase");
await setup.getByRole("button", { name: "تنظیم رمز" }).click();
await setup.waitForSelector("text=رمز تنظیم شد");
const again = await ctx2.newPage();
await again.goto(url.replace(/token=.*/, `token=${new URL(url).searchParams.get("token")}`), { waitUntil: "networkidle" });
await again.waitForSelector(".err");
console.log("the same link again:", flat(await again.locator(".err").innerText()));
const civil = await login(ctx2, who, "civil supervisor passphrase");
const hrefs = await civil.locator(".sidenav a").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
console.log("civil member's menu:", hrefs.join(" "));
const me = await civil.evaluate(async () => (await (await fetch("/api/auth/me")).json()).projects.find((p) => p.code === "DEMO").id);
const w = await civil.evaluate(async (pid) => {
  const post = (u, b) => fetch(u, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) }).then(async (r) => [r.status, (await r.json()).error]);
  return { hse: await post("/api/hse", { projectId: pid, kind: "manhours" }), read: (await fetch(`/api/hse?projectId=${pid}`)).status };
}, me);
console.log("write to HSE:", w.hse.join(" — "), "| read HSE:", w.read);
await civil.screenshot({ path: `${SHOT}/155-civil-member.png` });

// ── a developer, from the command line ──
// The link comes from `npm run auth:developer` run BEFORE the server starts:
// with the in-process database (PGlite) only one process may hold it.
const devPath = process.env.DRIVE_DEV_LINK;
if (!devPath) console.log("developer: skipped (set DRIVE_DEV_LINK to the /setup?token=… path the CLI printed)");
else {
  const ctx3 = await b.newContext({ viewport: { width: 1366, height: 900 } });
  const s3 = await ctx3.newPage(); watch(s3);
  await s3.goto(BASE + devPath, { waitUntil: "networkidle" });
  const devEmail = await s3.locator("form b.mono").innerText();
  await s3.fill("#pw1", "developer drive passphrase"); await s3.fill("#pw2", "developer drive passphrase");
  await s3.getByRole("button", { name: "تنظیم رمز" }).click();
  await s3.waitForSelector("text=رمز تنظیم شد");
  const d = await login(ctx3, devEmail, "developer drive passphrase");
  console.log("developer:", flat(await d.locator(".usermenu > button").innerText()), "| projects:",
    (await d.locator(".topbar select option").allInnerTexts()).length, "| menu items:", await d.locator(".sidenav a").count());
  await d.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
  await d.locator("tr", { hasText: who }).getByRole("button", { name: "ویرایش" }).click();
  console.log("developer-only controls:", (await d.locator("button", { hasText: /غیرفعال کردن حساب|توسعه‌دهنده کردن|لینک بازنشانی رمز/ }).allInnerTexts()).join(" | "));
  await d.screenshot({ path: `${SHOT}/157-developer-admin.png`, fullPage: true });
}

// ── a phone ──
const ctx4 = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const phone = await login(ctx4, EMAIL, PASSWORD);
console.log("phone: drawer closed, menu x:", await phone.locator(".sidenav").evaluate((n) => Math.round(n.getBoundingClientRect().left)));
await phone.getByRole("button", { name: "منو", exact: true }).click();
await phone.waitForTimeout(300);
console.log("phone: drawer open, menu x:", await phone.locator(".sidenav").evaluate((n) => Math.round(n.getBoundingClientRect().left)),
  "| page scrolls sideways:", await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth));
await phone.screenshot({ path: `${SHOT}/156-phone-drawer.png` });
await phone.locator(".sidenav a", { hasText: "Punch و NCR" }).click();
await phone.waitForURL("**/quality");
console.log("phone: drawer closes on navigation:", !(await phone.locator(".shell.drawer").count()));

console.log("problems:", problems.length ? problems : "none");
await b.close();
