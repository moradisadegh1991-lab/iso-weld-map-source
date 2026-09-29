/**
 * Form numbers in the browser: a number field left empty says which number
 * it will take, and takes it; the project page renames a form's code and
 * the next record follows it.
 *
 *   npm run scenario:dm -- you@… --upto 0.2 --creds creds.json
 *   DRIVE_EMAIL=… DRIVE_PASSWORD=… SCENARIO_CREDS=creds.json node --import ./tools/register.mjs tools/drive-numbering.mjs
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, SCENARIO_CREDS } = process.env;
const creds = JSON.parse(await readFile(SCENARIO_CREDS, "utf8"));
const problems = [];
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
const flat = (t) => String(t || "").replace(/\s+/g, " ").trim();
const b = await chromium.launch({ executablePath: CHROME });

const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
p.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
await p.goto(BASE, { waitUntil: "networkidle" });
await p.fill("#email", EMAIL); await p.fill("#password", PASSWORD);
await p.click("button[type=submit]"); await p.waitForSelector(".shell");
const sel = p.locator(".topbar select").first();
await sel.selectOption(await sel.locator("option").evaluateAll((os, c) => os.find((o) => o.textContent.includes(`${c} —`))?.value, creds.project));
await p.waitForTimeout(800);
const settle = () => p.waitForTimeout(900);
const errorOf = async () => flat(await p.locator(".page p.err:not(.sm)").first().innerText({ timeout: 1500 }).catch(() => ""));
async function packs() {
  await p.goto(BASE + "/completions", { waitUntil: "networkidle" }); await settle();
  const t = p.locator(".ptabs [role=tab]", { hasText: "پکیج‌های تست فشار" }).first();
  if (await t.count()) { await t.click(); await settle(); }
  const btn = p.locator(".fold-btn", { hasText: "پکیج تست جدید" }).first();
  if (await btn.count() && (await btn.getAttribute("aria-expanded")) !== "true") { await btn.click(); await settle(); }
}
async function newPack(desc) {
  await packs();
  const hint = await p.locator("#pk-no").getAttribute("placeholder");
  const sub = await p.locator("#pk-s option").evaluateAll((os) => os.find((o) => o.textContent === "70-01")?.value);
  await p.selectOption("#pk-s", sub); await p.selectOption("#pk-m", "hydrostatic"); await p.fill("#pk-rr", "1"); await p.fill("#pk-d", desc);
  await p.getByRole("button", { name: "ثبت پکیج" }).click(); await settle();
  const e = await errorOf(); if (e) problems.push(`pack ${desc}: ${e}`);
  return hint;
}

console.log("1  a test pack with its number left empty");
const hint1 = await newPack("first");
check(hint1 === "خودکار: TP-0001", `the empty field says what it will take («${hint1}»)`);
await packs();
check(/TP-0001/.test(flat(await p.locator("main").innerText())), "the pack is TP-0001");

console.log("2  the project renames the form; the next pack follows");
await p.goto(BASE + "/project", { waitUntil: "networkidle" }); await settle();
await p.locator(".ptabs [role=tab]", { hasText: "کد فرم‌ها" }).first().click(); await settle();
const row = p.locator("tr[data-form=test_pack]");
await row.getByLabel(/کد فرم/).fill("DMW-TP"); await row.getByRole("button", { name: "ذخیره" }).click(); await settle();
check(/DMW-TP-0002/.test(flat(await row.innerText())), `next number under the new code («${flat(await row.innerText())}»)`);
const hint2 = await newPack("second");
check(hint2 === "خودکار: DMW-TP-0002", `the form says so too («${hint2}»)`);
await packs();
check(/DMW-TP-0002/.test(flat(await p.locator("main").innerText())), "the pack is DMW-TP-0002");
await p.screenshot({ path: `${SHOT}/numbering.png`, fullPage: false });

console.log(`\nproblems: ${problems.length ? "\n  " + problems.join("\n  ") : "none"}`);
await b.close();
process.exit(problems.length ? 1 : 0);
