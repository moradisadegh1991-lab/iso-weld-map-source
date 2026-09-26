/**
 * Drive commissioning on the seeded demo: the board's MC / pre-commissioning
 * / RFC / commissioning / RFSU columns, checklists and procedures by phase,
 * the performance guarantees all "not tested", a performance test refused
 * because no RFSU is accepted, and a procedure declared through the form.
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
const problems = [], refused = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("response", (r) => {
  if (r.status() === 400 && r.request().method() === "POST" && /\/api\/precom/.test(r.url())) refused.push(r.status());
  else if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push("check: " + what); };
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
const settle = () => page.waitForTimeout(1200);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
page.on("console", (m) => { if (m.type() === "error" && !/status of 400/.test(m.text())) problems.push("console: " + m.text()); });

await page.goto(BASE + "/precom", { waitUntil: "networkidle" }); await settle();
const head = flat(await page.locator(".pagehead").innerText());
check(/RFC/.test(head) && /6 چک‌لیست پیش‌راه‌اندازی/.test(head) && /3 روال راه‌اندازی/.test(head), `header counts both phases: «${head.slice(0, 140)}»`);
const subs = card("ساب‌سیستم‌ها");
const cols = flat(await subs.locator("thead").first().innerText());
check(["MC", "پیش‌راه‌اندازی", "RFC", "راه‌اندازی", "RFSU"].every((c) => cols.includes(c)), `board columns: «${cols}»`);
const firstRow = flat(await subs.locator("tbody > tr").first().innerText());
check(/MC پذیرفته نشده/.test(firstRow), `a subsystem before MC says RFC waits on MC: «${firstRow.slice(0, 160)}»`);

await subs.getByRole("button", { name: "جزئیات" }).first().click(); await settle();
const panel = flat(await subs.locator("tbody > tr").nth(1).innerText());
check(/چک‌لیست‌های پیش‌راه‌اندازی/.test(panel) && /روال‌های راه‌اندازی/.test(panel), "the panel shows both phases");
check(/پس از پذیرش MC ثبت می‌شود/.test(panel) && /پس از پذیرش RFC ثبت می‌شود/.test(panel), "each phase says what it waits for");
await page.screenshot({ path: `${SHOT}/220-precom-board.png`, fullPage: true });

const tpl = card("چک‌لیست‌ها و روال‌های راه‌اندازی پروژه");
const tplText = flat(await tpl.innerText());
check(/C-MEC-01/.test(tplText) && /راه‌اندازی \(بین RFC و RFSU\)/.test(tplText), "procedures listed with their phase");
await tpl.getByRole("button", { name: /چک‌لیست جدید/ }).click();
await tpl.locator("#t-code").fill("C-ELE-01"); await tpl.locator("#t-title").fill("Motor coupled run under load");
await tpl.locator("#t-ph").selectOption("commissioning"); await tpl.locator("#t-app").selectOption("rotating");
await tpl.getByRole("button", { name: "ذخیرهٔ چک‌لیست" }).click(); await settle();
check(/C-ELE-01/.test(flat(await card("چک‌لیست‌ها و روال‌های راه‌اندازی پروژه").innerText())), "a procedure declared through the form");
check(/4 روال راه‌اندازی/.test(flat(await page.locator(".pagehead").innerText())), "…and counted in the header");

const perf = card("آزمون عملکرد");
const perfText = flat(await card("تضمین‌های عملکرد").innerText());
check(/PG-01/.test(perfText) && /PG-21/.test(perfText) && /Annex G/.test(perfText), "guarantees with their contract clause, plant and unit");
check((perfText.match(/آزموده نشده/g) || []).length >= 4, "every guarantee reads not tested");
check(/در قرارداد نیامده/.test(perfText), "a guarantee with no stated duration says so rather than assuming one");
await perf.getByRole("button", { name: /ثبت آزمون/ }).click();
const opts = flat(await perf.locator("#pt-unit").innerText());
check(/0\/\d+ ساب‌سیستم با RFSU پذیرفته/.test(opts), `the scope says how many subsystems have RFSU: «${opts.slice(0, 120)}»`);
await perf.locator("#pt-no2").fill("PT-DRV-01");
await perf.locator("#pt-from2").fill("2026-09-01T08:00"); await perf.locator("#pt-to2").fill("2026-09-04T08:00");
await perf.getByRole("button", { name: "ثبت آزمون", exact: true }).click(); await settle();
const err = flat(await page.locator("p.err").first().innerText().catch(() => ""));
check(/RFSU پذیرفته نشده/.test(err), `a performance test before RFSU is refused, and says why: «${err.slice(0, 120)}»`);
await page.screenshot({ path: `${SHOT}/221-precom-performance.png`, fullPage: true });

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("deliberate refusals (400):", refused.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
process.exit(problems.length ? 1 : 0);
