/**
 * Drive the section layout on the seeded demo: the merged menu (one entry
 * per section), the section's pages as tabs across the top, a page's parts
 * as tabs, the «+ form» button in the header of its part with the form
 * opening under that header, and a table's search / view / edit / delete —
 * a delete refused with the reason while the row is used, and done when
 * nothing uses it.
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await b.newPage({ viewport: { width: 1440, height: 1000 } });
const problems = [], refused = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() === 409 && /\/api\/records/.test(r.url())) refused.push(r.status());
  else if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push("check: " + what); };
const settle = () => page.waitForTimeout(900);
const visibleCards = () => page.locator(".ptab-panel > .card:visible").evaluateAll((els) => els.map((e) => e.querySelector("h2")?.textContent.trim()));

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
page.on("console", (m) => { if (m.type() === "error" && !/status of 409/.test(m.text())) problems.push("console: " + m.text()); });

// ── the menu is sections ──
const menu = await page.locator(".sidenav a").allInnerTexts();
console.log("menu:", menu.map(flat).join(" | "));
check(menu.length <= 16, `the menu holds sections, not every page (${menu.length} entries)`);
check(menu.some((t) => /پایپینگ/.test(t)) && !menu.some((t) => /^NDT و جوشکار$/.test(flat(t))), "piping pages are not menu entries of their own");

await page.locator(".sidenav a", { hasText: "پایپینگ" }).first().click(); await page.waitForURL(/\/piping\/overview/); await settle();
const stabs = flat(await page.locator(".section-tabs").innerText());
check(/داشبورد/.test(stabs) && /ایزومتریک/.test(stabs) && /اجرا/.test(stabs) && /NDT و جوشکار/.test(stabs) && /سابقهٔ جوش/.test(stabs), `piping's pages are tabs across the top: «${stabs}»`);
check(await page.locator(".pnav").count() === 0, "the old piping sub-menu is gone");
await page.locator(".section-tabs a", { hasText: "NDT و جوشکار" }).click(); await page.waitForURL(/\/qc/); await settle();
check(await page.locator(".section-tabs a.on", { hasText: "NDT و جوشکار" }).count() === 1, "the open page is the highlighted tab");
check(await page.locator(".sidenav a.on", { hasText: "پایپینگ" }).count() === 1, "…and piping stays the highlighted menu entry");
await page.screenshot({ path: `${SHOT}/300-section-tabs.png` });

// ── a page's parts are tabs ──
await page.goto(BASE + "/hse", { waitUntil: "networkidle" }); await settle();
const ptabs = await page.locator(".ptabs [role=tab]").allInnerTexts();
console.log("hse tabs:", ptabs.map(flat).join(" | "));
check(ptabs.length >= 6, "HSE's parts are tabs");
let shown = await visibleCards();
check(shown.length === 1 && /مجوز کار/.test(shown[0]), `one part at a time: «${shown.join(" | ")}»`);
await page.locator(".ptabs [role=tab]", { hasText: "رویدادها" }).click(); await settle();
shown = await visibleCards();
check(shown.length === 1 && /رویدادها/.test(shown[0]), "a tab shows its part");
check(/#/.test(page.url()), `the tab is in the address: ${page.url().split("#")[1] ? decodeURIComponent(page.url().split("#")[1]) : ""}`);
await page.reload({ waitUntil: "networkidle" }); await settle();
shown = await visibleCards();
check(shown.length === 1 && /رویدادها/.test(shown[0]), "a reload lands on the same tab");

// ── the form is a button at the top of its part ──
const inc = page.locator(".ptab-panel > .card:visible").first();
const btn = inc.locator(".card-actions .fold-btn", { hasText: "گزارش رویداد" });
check(await btn.count() === 1, "the incident form is a button in the part's header");
const headY = (await inc.locator("h2").first().boundingBox()).y, btnY = (await btn.boundingBox()).y;
check(Math.abs(btnY - headY) < 30, `…beside the title, not under the table (Δy ${Math.round(btnY - headY)})`);
await btn.click(); await settle();
const panel = inc.locator(".card-formslot .fold-panel");
check(await panel.count() === 1, "the form opens");
const tableY = (await inc.locator("table").first().boundingBox())?.y ?? 1e9, panelY = (await panel.boundingBox()).y;
check(panelY < tableY, "…under the header, above the table");
await page.screenshot({ path: `${SHOT}/301-fold-at-top.png` });
await panel.getByRole("button", { name: /بستن/ }).click(); await settle();
check(await inc.locator(".fold-panel").count() === 0, "and closes");

// ── table: search, select, view, edit, delete ──
await page.goto(BASE + "/contractors", { waitUntil: "networkidle" }); await settle();
const card = page.locator(".ptab-panel > .card:visible").first();
check(/شرکت‌ها/.test(await card.locator("h2").first().innerText()), "contractors open on the companies tab");
const q = card.locator(".tk-q");
check(await q.count() === 1, "every table has its search box");
const rows0 = await card.locator("tbody tr:visible").count();
const firstCode = flat(await card.locator("tbody tr").first().locator("td").first().innerText());
await q.fill(firstCode); await settle();
check(await card.locator("tbody tr:visible").count() >= 1 && await card.locator("tbody tr:visible").count() <= rows0, `search narrows to «${firstCode}»`);
await q.fill(""); await settle();

const view = card.getByRole("button", { name: "مشاهده" });
check(await view.isDisabled(), "view waits for a row to be picked");
await card.locator("tbody tr").first().locator("td").nth(1).click();
check(await card.locator("tbody tr[data-tk-sel]").count() === 1, "a click picks the row");
await view.click(); await settle();
const dlg = page.locator(".tk-view [role=dialog]");
const dtext = flat(await dlg.innerText());
check(/کد/.test(dtext) && dtext.includes(firstCode) && /وضعیت/.test(dtext), `view shows each column beside its value: «${dtext.slice(0, 120)}»`);
await page.screenshot({ path: `${SHOT}/302-row-view.png` });
await dlg.getByRole("button", { name: /بستن/ }).click();

// A contractor holding a package: the server says where it is used, and there is nothing to confirm.
const del = card.getByRole("button", { name: "حذف", exact: true });
await del.click(); await settle();
const why = flat(await page.locator(".tk-view .tk-blocked").innerText().catch(() => ""));
check(/حذف نمی‌شود/.test(why) && /پکیج کاری/.test(why), `a used contractor: the reason, before any confirmation: «${why}»`);
check(await page.locator(".tk-view").getByRole("button", { name: "حذف قطعی" }).count() === 0, "…and nothing to confirm");
await page.screenshot({ path: `${SHOT}/304-delete-refused.png` });
await page.keyboard.press("Escape"); await settle();
check(await page.locator(".tk-view").count() === 0, "Escape closes the dialog");

// Edit: the same form, filled, code fixed.
await card.getByRole("button", { name: "ویرایش" }).click(); await settle();
const ef = card.locator(".fold-panel");
check(await ef.count() === 1 && (await ef.locator("#ce-code").inputValue()) === firstCode, "edit opens the form filled with the row");
check(await ef.locator("#ce-code").evaluate((i) => i.readOnly), "…with its code fixed");
const oldName = await ef.locator("#ce-name").inputValue();
await ef.locator("#ce-name").fill(oldName + " (ed)");
await ef.getByRole("button", { name: "ذخیرهٔ تغییرات" }).click(); await settle();
check((await card.locator("tbody").innerText()).includes(oldName + " (ed)"), "the edit is saved and shown");

// New contractor through the header button, then delete it.
await card.locator(".fold-btn", { hasText: "افزودن پیمانکار" }).click(); await settle();
await card.locator("#c-code").fill("DRV-TMP"); await card.locator("#c-name").fill("Entered by mistake");
await card.getByRole("button", { name: "ثبت", exact: true }).click(); await settle();
const tmpRow = card.locator("tbody tr", { hasText: "DRV-TMP" });
check(await tmpRow.count() === 1, "a contractor added from the header button");
await tmpRow.locator("td").nth(1).click();
check(!(await del.isDisabled()), "an unused contractor can be deleted");
await del.click(); await settle();
const confirm = page.locator(".tk-view [role=dialog]");
check(/برنمی‌گردد/.test(flat(await confirm.innerText())), "delete asks first");
await page.screenshot({ path: `${SHOT}/303-delete-confirm.png` });
await confirm.getByRole("button", { name: "حذف قطعی" }).click(); await settle();
check(await card.locator("tbody tr", { hasText: "DRV-TMP" }).count() === 0, "…and it is gone");

// A person with a competence card, in a tab reached by its address: edit is the same form, delete refused.
await page.goto(BASE + "/hse#" + encodeURIComponent("افراد-و-کارت-صلاحیت"), { waitUntil: "networkidle" }); await settle();
const people = page.locator(".ptab-panel > .card:visible").first();
check(/افراد و کارت صلاحیت/.test(await people.locator("h2").first().innerText()), "a link opens the named tab");
const carded = people.locator("tbody tr").filter({ has: page.locator(".pill") }).first();
await carded.locator("td").first().click();
await people.getByRole("button", { name: "حذف", exact: true }).click(); await settle();
const whyP = flat(await page.locator(".tk-view .tk-blocked").innerText().catch(() => ""));
check(/حذف نمی‌شود/.test(whyP) && /کارت صلاحیت/.test(whyP), `a person with a card stays: «${whyP}»`);
await page.keyboard.press("Escape"); await settle();
await people.getByRole("button", { name: "ویرایش" }).click(); await settle();
check(await people.locator("#pe-id").evaluate((i) => i.readOnly), "a person's ID number is fixed when editing");

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("refusals (409):", refused.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
process.exit(problems.length ? 1 : 0);
