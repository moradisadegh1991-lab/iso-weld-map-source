/**
 * Work the contractor hands over and the employer accepts, in the browser:
 * the project manager turns the approval on; the contractor's QC records a
 * step, which waits as a claim; the client's representative approves one
 * and rejects another with a reason; the steps read accordingly.
 *
 *   npm run scenario:dm -- you@… --upto 3.5 --creds creds.json
 *   DRIVE_EMAIL=… DRIVE_PASSWORD=… SCENARIO_CREDS=creds.json node --import ./tools/register.mjs tools/drive-claims.mjs
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";

const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, SCENARIO_CREDS } = process.env;
const creds = JSON.parse(await readFile(SCENARIO_CREDS, "utf8"));
const t0 = new Date(`${creds.start}T00:00:00Z`).getTime();
const d = (n) => new Date(t0 + n * 86400000).toISOString().slice(0, 10);
const problems = [];
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
const flat = (t) => String(t || "").replace(/\s+/g, " ").trim();
const b = await chromium.launch({ executablePath: CHROME });

async function signIn(email, password) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  p.on("pageerror", (e) => problems.push(`[${email}] pageerror: ${e.message}`));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#email", email); await p.fill("#password", password);
  await p.click("button[type=submit]"); await p.waitForSelector(".shell");
  const sel = p.locator(".topbar select").first();
  await sel.selectOption(await sel.locator("option").evaluateAll((os, c) => os.find((o) => o.textContent.includes(`${c} —`))?.value, creds.project));
  await p.waitForTimeout(800);
  return p;
}
const settle = (p) => p.waitForTimeout(900);
const open = async (p, path) => { await p.goto(BASE + path, { waitUntil: "networkidle" }); await settle(p); };
const errorOf = async (p) => flat(await p.locator(".page p.err:not(.sm)").first().innerText({ timeout: 1500 }).catch(() => ""));
const card = (p, h) => p.locator(".card", { has: p.locator("h2", { hasText: h }) }).first();

const pm = await signIn(EMAIL, PASSWORD);
const qc = await signIn(creds.people.qc.email, creds.people.qc.password);
const client = await signIn(creds.people.client.email, creds.people.client.password);

async function tagStep(p, tag, title) {
  await open(p, "/equipment");
  const t = p.locator(".ptabs [role=tab]", { hasText: "تگ‌ها" }).first(); if (await t.count()) { await t.click(); await settle(p); }
  const row = card(p, "تگ‌ها").locator("tr", { has: p.locator("td.mono a", { hasText: new RegExp(`^${tag}$`) }) }).first();
  const btn = row.getByRole("button", { name: "مراحل" }); if (await btn.count()) { await btn.click(); await settle(p); }
  return row.locator("xpath=following-sibling::tr[1]").locator(".card", { has: p.locator("b", { hasText: title }) }).first();
}
async function claim(tag, on, ref) {
  const c = await tagStep(qc, tag, "استقرار");
  await qc.fill("#work-date", on);
  await c.getByLabel(/^مرجع /).fill(ref);
  await c.getByRole("button", { name: "ثبت انجام" }).click(); await settle(qc);
  const e = await errorOf(qc); if (e) problems.push(`claim ${tag}: ${e}`);
  return flat(await (await tagStep(qc, tag, "استقرار")).innerText());
}

console.log("1  the project manager turns the employer's approval on");
await open(pm, "/work-approval");
await pm.getByLabel(/تأیید کارفرما لازم دارد/).click(); await settle(pm);
const e1 = await errorOf(pm); if (e1) problems.push(`setting: ${e1}`);
check(/روشن/.test(flat(await pm.locator(".card[data-keep]").innerText())), "approval is on");

console.log("2  the contractor's QC records two steps: both wait as claims");
const t1 = await claim("P-7001", d(90), "SET-P-7001");
check(/منتظر تأیید کارفرما/.test(t1) && !/انجام شد/.test(t1), `the pump's «set» waits for the employer («${t1.slice(0, 90)}»)`);
await claim("D-7002", d(90), "SET-D-7002");
await open(qc, "/work-approval");
const qcView = flat(await card(qc, "منتظر تأیید کارفرما").innerText());
check(/P-7001/.test(qcView) && /D-7002/.test(qcView), "both are listed as waiting");
check((await card(qc, "منتظر تأیید کارفرما").locator("input[type=checkbox]").count()) === 0, "the contractor is offered no approval");

console.log("3  the client's representative approves one and rejects the other");
await open(client, "/work-approval");
const pc = card(client, "منتظر تأیید کارفرما");
await pc.getByLabel(/انتخاب P-7001/).check();
await pc.getByRole("button", { name: /تأیید 1 مورد انتخاب‌شده/ }).click(); await settle(client);
const e3 = await errorOf(client); if (e3) problems.push(`approve: ${e3}`);
await card(client, "منتظر تأیید کارفرما").getByLabel(/انتخاب D-7002/).check();
const rej = card(client, "منتظر تأیید کارفرما").getByRole("button", { name: "رد", exact: true });
check(await rej.isDisabled(), "a rejection waits for its reason");
await client.getByLabel("دلیل رد").fill("Baseplate shims not per GA");
await rej.click(); await settle(client);
check(/موردی منتظر تأیید نیست/.test(flat(await card(client, "منتظر تأیید کارفرما").innerText())), "nothing is left waiting");
const decided = flat(await card(client, "تصمیم‌های کارفرما").innerText().catch(async () => {
  await client.locator(".ptabs [role=tab]", { hasText: "تصمیم‌های کارفرما" }).first().click(); await settle(client);
  return card(client, "تصمیم‌های کارفرما").innerText();
}));
check(/P-7001.*تأیید/.test(decided) && /D-7002.*رد.*Baseplate shims/.test(decided), `the decisions («${decided.slice(0, 160)}»)`);

console.log("4  the steps read the decisions");
const a1 = flat(await (await tagStep(qc, "P-7001", "استقرار")).innerText());
check(/انجام شد/.test(a1), `the pump is set — on the day claimed («${a1.slice(0, 80)}»)`);
const a2 = flat(await (await tagStep(qc, "D-7002", "استقرار")).innerText());
check(/رد کارفرما: Baseplate shims not per GA/.test(a2), `the drum is open, with the reason («${a2.slice(0, 90)}»)`);

console.log("5  the log");
await open(pm, "/log/workplan");
const lg = flat(await pm.locator(".loglist").innerText());
for (const a of ["ارسال", "تأیید", "برگشت"]) check(lg.includes(a), `the handover log has «${a}»`);
await client.screenshot({ path: `${SHOT}/work-approval.png`, fullPage: true });

console.log(`\nproblems: ${problems.length ? "\n  " + problems.join("\n  ") : "none"}`);
await b.close();
process.exit(problems.length ? 1 : 0);
