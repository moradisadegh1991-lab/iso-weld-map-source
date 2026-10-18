/**
 * Drive the settings, languages and table views (production build, seeded DEMO):
 *   the sign-in page in English before signing in · Settings: language
 *   (fa / en / ar → lang, dir and the menu follow), colour mode, accent,
 *   density, text size — applied at once and kept on the account, so a
 *   second browser opens with them · a table as a grid (hide, pin, move,
 *   resize, sort from the column menu, filter by value, group, totals,
 *   pages, Excel) and as cards.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n.mjs
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
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const watch = (page) => {
  page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
};
const flat = (s) => s.replace(/\s+/g, " ").trim();
const html = (page) => page.evaluate(() => { const e = document.documentElement; return { lang: e.lang, dir: e.dir, ...e.dataset }; });
async function signIn(page) {
  await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
}
const setting = (page, group, value) => page.locator(`[aria-labelledby="set-${group}"] button[data-value="${value}"]`).click();
const saved = (page) => page.waitForResponse((r) => r.url().includes("/api/auth/prefs") && r.request().method() === "POST");

// ── before signing in: the visitor picks the language ──
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage(); watch(page);
await showAllTabs(page);
await page.goto(BASE, { waitUntil: "networkidle" });
await page.locator(".lang-pick button", { hasText: "English" }).click();
check(flat(await page.locator(".signin h1").innerText()) === "Sign in", "sign-in page in English");
check((await html(page)).dir === "ltr", "…left to right");
await page.screenshot({ path: `${SHOT}/300-signin-en.png` });
await page.locator(".lang-pick button", { hasText: "فارسی" }).click();
check(flat(await page.locator(".signin h1").innerText()) === "ورود به سامانه", "back to Persian");
await signIn(page);

// ── settings: language ──
await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
await page.waitForSelector(".settings-grid");
await page.screenshot({ path: `${SHOT}/301-settings-fa.png`, fullPage: true });
await Promise.all([saved(page), setting(page, "language", "en")]);
let h = await html(page);
check(h.lang === "en" && h.dir === "ltr", `English: lang ${h.lang}, dir ${h.dir}`);
check(flat(await page.locator(".pagehead h1").innerText()) === "Settings", "the settings page in English");
const navEn = flat(await page.locator("nav.sidenav").innerText());
check(/Workspace/.test(navEn) && /Project/.test(navEn), "the menu in English");
check(await page.locator(".sidenav").evaluate((n) => n.getBoundingClientRect().left < 50), "the menu on the left");
await page.screenshot({ path: `${SHOT}/302-settings-en.png`, fullPage: true });
await page.reload({ waitUntil: "networkidle" });
check((await html(page)).lang === "en", "English survives a reload");

await Promise.all([saved(page), setting(page, "language", "ar")]);
h = await html(page);
check(h.lang === "ar" && h.dir === "rtl", `Arabic: lang ${h.lang}, dir ${h.dir}`);
check(flat(await page.locator(".pagehead h1").innerText()) === "الإعدادات", "the settings page in Arabic");
check(/مساحة العمل/.test(flat(await page.locator("nav.sidenav").innerText())), "the menu in Arabic");
await page.screenshot({ path: `${SHOT}/303-settings-ar.png`, fullPage: true });

// ── settings: appearance ──
await Promise.all([saved(page), setting(page, "theme", "light")]);
await Promise.all([saved(page), setting(page, "accent", "rose")]);
await Promise.all([saved(page), setting(page, "density", "compact")]);
await Promise.all([saved(page), setting(page, "scale", "l")]);
h = await html(page);
check(h.theme === "light" && h.accent === "rose" && h.density === "compact" && h.scale === "l", `appearance on <html>: ${h.theme} ${h.accent} ${h.density} ${h.scale}`);
const btnBg = await page.locator(".settings-preview .btn").first().evaluate((n) => getComputedStyle(n).backgroundColor);
check(btnBg === "rgb(199, 54, 95)", `the accent reaches a button (${btnBg})`);
const font = await page.evaluate(() => getComputedStyle(document.body).fontFamily);
check(/Vazirmatn/.test(font), `Arabic/Persian body font: ${font.split(",")[0]}`);
await page.screenshot({ path: `${SHOT}/304-settings-light-rose.png`, fullPage: true });

// ── a second browser: the account's settings, not this one's ──
const ctx2 = await b.newContext({ viewport: { width: 1366, height: 900 } });
const p2 = await ctx2.newPage(); watch(p2);
await p2.goto(BASE, { waitUntil: "networkidle" });
await signIn(p2);
await p2.waitForFunction(() => document.documentElement.lang === "ar", null, { timeout: 8000 }).catch(() => {});
h = await html(p2);
check(h.lang === "ar" && h.theme === "light" && h.accent === "rose", `another browser opens in the account's settings (${h.lang} ${h.theme} ${h.accent})`);
await ctx2.close();

// English for the table views, normal size
await Promise.all([saved(page), setting(page, "language", "en")]);
await Promise.all([saved(page), setting(page, "scale", "m")]);
check(/Inter/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily)), "English body font is Inter");

// ── a table as a grid ──
await page.goto(`${BASE}/quality`, { waitUntil: "networkidle" });
const kit = page.locator(".card", { has: page.locator("h2", { hasText: /Punch list|قائمة النواقص/ }) }).locator(".tk");
await kit.locator(".tk-bar").waitFor();
const rowsText = async () => flat(await kit.locator(".tk-n").innerText());
console.log("punch rows:", await rowsText());
await kit.locator(".tk-modes button[data-mode=grid]").click();
check(await kit.evaluate((n) => n.dataset.tkMode) === "grid", "grid view");
check(await kit.locator(".dtable").evaluate((n) => getComputedStyle(n).display) === "grid", "the table is laid out as a grid");
const heads = async () => kit.locator("thead th").evaluateAll((ths) => ths.filter((t) => getComputedStyle(t).display !== "none")
  .map((t) => ({ t: t.textContent.trim(), x: Math.round(t.getBoundingClientRect().left) })).sort((a, b) => a.x - b.x).map((x) => x.t));
const before = await heads();
console.log("columns:", before.join(" | "));
// the column menu: sort descending on «Due»
const dueTh = kit.locator("thead th", { hasText: /^Due$|مهلت/ }).first();
const openMenu = async (th) => { await th.click({ button: "right" }); await page.locator(".tk-pop").waitFor(); };
await openMenu(dueTh);
await page.locator(".tk-pop button", { hasText: "Sort descending" }).click();
await page.keyboard.press("Escape");
check(await dueTh.evaluate((n) => n.classList.contains("desc")), "sorted descending from the column menu");
// hide a column from the chooser, then pin another
await kit.locator(".tk-cols").click();
const chooser = page.locator(".tk-pop");
const lastCol = before[before.length - 2];
await chooser.locator("li", { hasText: lastCol }).locator("input[type=checkbox]").uncheck();
const pinCol = before[2];
await chooser.locator("li", { hasText: pinCol }).locator("button[aria-pressed]").click();
await page.keyboard.press("Escape");
const afterHide = await heads();
check(!afterHide.includes(lastCol), `«${lastCol}» hidden`);
check(afterHide[0] === pinCol, `«${pinCol}» pinned first (${afterHide[0]})`);
await kit.locator(".wrap").evaluate((n) => { n.scrollLeft = n.scrollWidth; });
const pinnedStuck = await kit.locator("thead th", { hasText: pinCol }).first().evaluate((n) => getComputedStyle(n).position === "sticky");
check(pinnedStuck, "the pinned column is sticky");
// move a column by dragging its heading
const [c1, c2] = [afterHide[1], afterHide[2]];
await kit.locator("thead th", { hasText: c2 }).first().dragTo(kit.locator("thead th", { hasText: c1 }).first());
const moved = await heads();
check(moved.indexOf(c2) < moved.indexOf(c1), `dragging «${c2}» onto «${c1}» moves it before`);
// resize a column by its edge
const th = kit.locator("thead th", { hasText: c1 }).first();
const box = await th.boundingBox();
const w0 = box.width;
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
await page.mouse.down(); await page.mouse.move(box.x + box.width + 80, box.y + box.height / 2, { steps: 6 }); await page.mouse.up();
const w1 = (await th.boundingBox()).width;
check(w1 > w0 + 40, `resized «${c1}»: ${Math.round(w0)} → ${Math.round(w1)} px`);
// filter by value from the column menu: category A only
const catTh = kit.locator("thead th", { hasText: /^Category$|^دسته$/ }).first();
if (await catTh.count()) {
  await openMenu(catTh);
  await page.locator(".tk-pop button", { hasText: "None" }).click();
  await page.locator(".tk-pop-vals label", { hasText: /^A/ }).locator("input").check();
  await page.keyboard.press("Escape");
  console.log("category A:", await rowsText());
  check(/of/.test(await rowsText()), "value filter narrows the rows");
  check(await catTh.evaluate((n) => n.classList.contains("tk-filtered")), "…and the heading shows it");
  await kit.getByRole("button", { name: "Clear" }).click();
}
// group by status, count totals, pages
await kit.locator("select[aria-label='Group by']").selectOption({ index: 1 });
const groups = await kit.locator("tr.tk-grp:not([hidden])").count();
check(groups > 0, `${groups} group headings`);
await kit.locator("tr.tk-grp:not([hidden])").first().click();
check(await kit.locator("tr.tk-grp").first().evaluate((n) => n.dataset.tkShut === "1"), "a group folds");
await openMenu(kit.locator("thead th").filter({ hasText: /\S/ }).first());
await page.locator(".tk-pop-agg select").selectOption("count");
await page.keyboard.press("Escape");
check(await kit.locator("tfoot.tk-foot td").filter({ hasText: /\d/ }).count() > 0, "a totals row");
await kit.locator("select[aria-label='Per page']").selectOption("25");
await page.screenshot({ path: `${SHOT}/305-grid-en.png`, fullPage: true });
const [xl] = await Promise.all([page.waitForEvent("download"), kit.getByRole("button", { name: "Export Excel" }).click()]);
check(/\.xlsx$/.test(xl.suggestedFilename()), `Excel export: ${xl.suggestedFilename()}`);
// the layout is remembered
await page.reload({ waitUntil: "networkidle" });
await kit.locator(".tk-bar").waitFor();
check(await kit.evaluate((n) => n.dataset.tkMode) === "grid" && !(await heads()).includes(lastCol), "the grid layout survives a reload");

// ── cards ──
await kit.locator(".tk-modes button[data-mode=cards]").click();
await kit.locator("select[aria-label='Group by']").selectOption("");
const card = kit.locator("tbody tr:not(.tk-grp):not([hidden]):not([data-tk-off])").first();
check(await card.evaluate((n) => getComputedStyle(n).display) === "flex", "rows are cards");
const label = await card.locator("td").nth(1).evaluate((n) => getComputedStyle(n, "::before").content);
check(label && label !== "none" && label !== '""', `each value beside its heading (${label})`);
await page.screenshot({ path: `${SHOT}/306-cards-en.png`, fullPage: true });

// ── Arabic grid, dark ──
await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
await Promise.all([saved(page), setting(page, "language", "ar")]);
await Promise.all([saved(page), setting(page, "theme", "dark")]);
await page.goto(`${BASE}/quality`, { waitUntil: "networkidle" });
await kit.locator(".tk-bar").waitFor();
await kit.locator(".tk-modes button[data-mode=grid]").click();
check(flat(await kit.locator(".tk-modes button[data-mode=grid]").innerText()).includes("شبكة"), "the table bar in Arabic");
await page.screenshot({ path: `${SHOT}/307-grid-ar-dark.png`, fullPage: true });

// back to how the drives expect it: Persian, dark, teal, comfortable, the table as designed
await kit.locator(".tk-cols").click();
await page.locator(".tk-pop button", { hasText: "↺" }).click();
await kit.locator(".tk-modes button[data-mode=table]").click();
await page.goto(`${BASE}/account`, { waitUntil: "networkidle" });
for (const [g, v] of [["language", "fa"], ["accent", "teal"], ["density", "comfortable"], ["grid", "table"]]) await Promise.all([saved(page), setting(page, g, v)]);
h = await html(page);
check(h.lang === "fa" && h.dir === "rtl" && h.theme === "dark", "restored to Persian, dark");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
