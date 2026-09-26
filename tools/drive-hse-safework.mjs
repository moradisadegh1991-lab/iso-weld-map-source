/**
 * Drive HSE safe work on the seeded demo: the three seeded permits and why
 * each is or is not issuable, the rules, cards, scaffolds/cranes and JSA
 * registers; then record an inspection that clears a red tag, draft a JSA
 * the page refuses to let its preparer approve, and request a permit with a
 * crew through the form.
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
  if (r.status() === 400 && r.request().method() === "POST" && /\/api\/hse/.test(r.url())) refused.push(r.status());
  else if (r.status() >= 400 && !/favicon|auth\/me/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.url()}`);
});
const flat = (s) => s.replace(/\s+/g, " ").trim();
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push("check: " + what); };
const card = (h) => page.locator(".card", { has: page.locator("h2", { hasText: h }) }).first();
const row = (scope, text) => scope.locator("tbody > tr", { hasText: text }).first();
const settle = () => page.waitForTimeout(1200);

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
page.on("console", (m) => { if (m.type() === "error" && !/status of 400/.test(m.text())) problems.push("console: " + m.text()); });

await page.goto(BASE + "/hse", { waitUntil: "networkidle" }); await settle();
const ptw = card("مجوز کار (PTW)");
const r104 = flat(await row(ptw, "WAH-0104").innerText());
check(/فعال/.test(r104) && /SC-1201-03/.test(r104) && /JSA-WAH-01/.test(r104) && /رضا/.test(r104), `WAH-0104 issued with its scaffold, JSA and crew: «${r104.slice(0, 160)}»`);
const r105 = flat(await row(ptw, "WAH-0105").innerText());
check(/سارا/.test(r105) && /کار در ارتفاع/.test(r105), "WAH-0105 names Sara's lapsed height card");
check(/برچسب قرمز/.test(r105), "WAH-0105 names the red-tagged scaffold");
check(/JSA/.test(r105), "WAH-0105 names the missing JSA");
check(!/رضا کریمی \(دمو\): /.test(r105), "…and not Reza, who holds both cards");
const r106 = flat(await row(ptw, "LF-0106").innerText());
check(/CR-80T-01/.test(r106) && /بازرسی نشده/.test(r106), "LF-0106 is held by a crane never inspected");
await page.screenshot({ path: `${SHOT}/200-hse-permits.png`, fullPage: true });

const rules = card("قواعد کار ایمن پروژه");
check(/تعیین نشده/.test(flat(await row(rules, "حفاری").innerText())), "a permit type with no rule says so");
const people = card("افراد و کارت صلاحیت");
check(/منقضی/.test(flat(await row(people, "سارا").innerText())), "Sara's card shows expired");
check(/تاریخ انقضا ثبت نشده/.test(flat(await row(people, "علی").innerText())), "Ali's first-aid card: expiry unknown, not valid");
const eq = card("داربست و جرثقیل");
check(/برچسب قرمز/.test(flat(await row(eq, "SC-1101-01").innerText())), "SC-1101-01 red-tagged");
check(/بازرسی نشده/.test(flat(await row(eq, "CR-80T-01").innerText())), "CR-80T-01 never inspected");
const jsa = card("JSA / TRA");
check(/JSA-WAH-01 Rev 0/.test(flat(await jsa.innerText())) && /تأییدشده/.test(flat(await jsa.innerText())), "JSA-WAH-01 approved");
await page.screenshot({ path: `${SHOT}/201-hse-safework.png`, fullPage: true });

// A fresh pass by the scaffold inspector lifts the red tag from WAH-0105's list.
await eq.getByRole("button", { name: /ثبت بازرسی/ }).click();
await eq.locator("#in-e").selectOption({ label: "SC-1101-01 — داربست" });
await eq.locator("#in-d").fill(new Date().toISOString().slice(0, 10));
await eq.locator("#in-i").selectOption({ label: "حمید توکلی (دمو)" });
await eq.locator("#in-c").fill("TAG-1101-01/03");
await eq.getByRole("button", { name: "ثبت بازرسی", exact: true }).click(); await settle();
check(/معتبر تا/.test(flat(await row(card("داربست و جرثقیل"), "SC-1101-01").innerText())), "the new pass makes SC-1101-01 fit");
const r105b = flat(await row(card("مجوز کار (PTW)"), "WAH-0105").innerText());
check(!/برچسب قرمز/.test(r105b) && /سارا/.test(r105b), "WAH-0105 no longer names the scaffold; still names Sara");

// A JSA drafted here cannot be approved by the same person, over the limit or not.
const j = card("JSA / TRA");
await j.getByRole("button", { name: /JSA جدید/ }).click();
await j.locator("#jn-no").fill("JSA-DRV-01"); await j.locator("#jn-t").fill("Drive check");
await j.getByRole("button", { name: "ثبت پیش‌نویس" }).click(); await settle();
const draft = page.locator(".card", { has: page.locator("b", { hasText: "JSA-DRV-01 Rev 0" }) }).first();
await draft.getByRole("button", { name: /افزودن گام/ }).click();
await draft.getByLabel("گام کار").fill("Lift panel"); await draft.getByLabel("خطر").fill("Crush");
await draft.getByLabel("اقدام کنترلی").fill("Tag lines");
await draft.getByLabel("احتمال (۱–۵)").fill("4"); await draft.getByLabel("شدت (۱–۵)").fill("5");
await draft.getByLabel("احتمال پس از کنترل").fill("2"); await draft.getByLabel("شدت پس از کنترل").fill("5");
await draft.getByRole("button", { name: "ذخیرهٔ گام" }).click(); await settle();
const draft2 = page.locator(".card", { has: page.locator("b", { hasText: "JSA-DRV-01 Rev 0" }) }).first();
check(/از حد پذیرفتنی پروژه \(6\)/.test(flat(await draft2.innerText())), "the draft says its residual 10 is over the project's 6");
await draft2.getByRole("button", { name: "تأیید", exact: true }).click(); await settle();
const err = flat(await page.locator("p.err").first().innerText().catch(() => ""));
check(/تهیه‌کننده|حد پذیرفتنی/.test(err), `approval refused and says why: «${err.slice(0, 120)}»`);

// A permit requested through the form with a crew, the green scaffold and the approved JSA is ready.
const ptw2 = card("مجوز کار (PTW)");
await ptw2.getByRole("button", { name: /درخواست مجوز کار/ }).click();
await ptw2.locator("#pt-no").fill("WAH-DRV-1");
await ptw2.locator("#pt-type").selectOption("work_at_height");
await ptw2.locator("#pt-area").fill("PR-1201"); await ptw2.locator("#pt-desc").fill("Drive check");
await ptw2.locator("#pt-eq").selectOption({ index: 1 });
await ptw2.locator("#pt-jsa").selectOption({ index: 1 });
await ptw2.getByLabel("رضا کریمی (دمو)").check();
await ptw2.getByRole("button", { name: "ثبت درخواست" }).click(); await settle();
const drv = flat(await row(card("مجوز کار (PTW)"), "WAH-DRV-1").innerText());
check(/آمادهٔ صدور/.test(drv) && /رضا/.test(drv), `the new permit is ready to issue: «${drv.slice(0, 160)}»`);
await page.screenshot({ path: `${SHOT}/202-hse-after.png`, fullPage: true });

await page.goto(BASE + "/assumptions", { waitUntil: "networkidle" }); await settle();
const miss = flat(await page.locator("body").innerText());
check(/تاریخ انقضای کارت صلاحیت/.test(miss), "the card with no expiry is in the missing-information register");

const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log("overflow px:", overflow);
console.log("deliberate refusals (400):", refused.length);
console.log("problems:", problems.length ? problems : "none");
await b.close();
process.exit(problems.length ? 1 : 0);
