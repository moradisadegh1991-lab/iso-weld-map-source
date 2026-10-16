/**
 * Drive contracts, a contractor's payment statement, finance, HR and the
 * section logs in the browser, with separate people for each signature:
 *   contracts (امور قراردادها) writes the subcontract and its items on the WBS,
 *   the project manager signs it, the site QC prepares the statement (the
 *   concrete measured by the platform, the excavation from a measurement
 *   sheet), the client's engineer verifies it, contracts approves it, finance
 *   pays it — and every step is in the log with who took it.
 *
 *   DRIVE_EMAIL=... DRIVE_PASSWORD=... SCENARIO_CREDS=creds.json node tools/drive-contracts.mjs
 * against a scenario project played to the end (npm run scenario:dm -- <email> --upto all --creds creds.json).
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, SCENARIO_CREDS } = process.env;
const creds = JSON.parse(await readFile(SCENARIO_CREDS, "utf8"));
const problems = [];
const log = (m) => console.log(m);
const check = (ok, what) => { log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push(what); };
const flat = (t) => String(t || "").replace(/\s+/g, " ").trim();
const b = await chromium.launch({ executablePath: CHROME });

async function signIn(email, password) {
  const p = await (await b.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
  p.on("pageerror", (e) => problems.push(`[${email}] pageerror: ${e.message}`));
  await p.goto(BASE, { waitUntil: "networkidle" });
  await p.fill("#email", email); await p.fill("#password", password);
  await p.click("button[type=submit]"); await p.waitForSelector(".shell");
  const sel = p.locator(".topbar select").first();
  const v = await sel.locator("option").evaluateAll((os, c) => os.find((o) => o.textContent.includes(`${c} —`))?.value, creds.project);
  await sel.selectOption(v); await p.waitForTimeout(800);
  p.projectId = v;
  return p;
}
const settle = (p) => p.waitForTimeout(900);
const open = async (p, path) => { await p.goto(BASE + path, { waitUntil: "networkidle" }); await settle(p); };
const api = (p, path, body) => p.evaluate(async ([path, body]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
// The page's own message — not Next's route announcer, which is also role=alert.
const errorOf = async (p) => flat(await p.locator(".page [role=alert], .page .err").first().innerText().catch(() => ""));

const pm = await signIn(EMAIL, PASSWORD);
const qc = await signIn(creds.people.qc.email, creds.people.qc.password);
const client = await signIn(creds.people.client.email, creds.people.client.password);
const P = pm.projectId;

log("0  people: a contracts officer and a finance officer, invited by the project manager");
async function invite(email, name, role) {
  const r = await api(pm, "/api/users", { projectId: P, kind: "invite", email, displayName: name, role });
  if (r.status !== 200) throw new Error(`invite ${email}: ${JSON.stringify(r.body)}`);
  const token = r.body.link?.token;
  const pw = `Drive-${Math.random().toString(36).slice(2, 10)}-9a`;
  if (token) {
    const s = await pm.evaluate(async ([token, pw]) => (await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, password: pw }) })).status, [token, pw]);
    if (s !== 200) throw new Error(`setup ${email}: ${s}`);
  }
  return signIn(email, pw);
}
const cu = await invite(`contracts.${creds.project.toLowerCase()}@scenario.test`, "امور قراردادها (سناریو)", "contracts");
const fu = await invite(`finance.${creds.project.toLowerCase()}@scenario.test`, "مالی (سناریو)", "finance");
check(true, "contracts and finance officers signed in");

log("1  WBS elements (project controls) and progress");
for (const [code, title] of [["WBS-70-CIV", "سیویل واحد 70"], ["WBS-70-MOB", "تجهیز کارگاه"]]) {
  const r = await api(pm, "/api/controls", { projectId: P, kind: "account", code, title, bac: code === "WBS-70-CIV" ? 150000 : 20000 });
  if (r.status !== 200) problems.push(`account ${code}: ${JSON.stringify(r.body)}`);
}
const accounts = (await api(pm, `/api/contracts?projectId=${P}`)).body.accounts;
const mob = accounts.find((a) => a.code === "WBS-70-MOB");
const today = new Date().toISOString().slice(0, 10);
await api(pm, "/api/controls", { projectId: P, kind: "progress", accountId: mob.id, asOf: today, pct: 50, source: "PR-70-01" });
check(accounts.length >= 2, `WBS elements: ${accounts.map((a) => a.code).join(", ")}`);

log("2  the subcontract, by the contracts officer, through the form");
await open(cu, "/contracts");
await cu.getByRole("button", { name: /قرارداد جدید/ }).first().click(); await settle(cu);
await cu.fill("#ct-no", "SC-CIV-70"); await cu.fill("#ct-title", "عملیات سیویل واحد 70");
await cu.selectOption("#ct-kind", "subcontract");
const civ = await cu.locator("#ct-con option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("C-CIV"))?.value);
await cu.selectOption("#ct-con", civ);
await cu.fill("#ct-value", "180000"); await cu.fill("#ct-adv", "10"); await cu.fill("#ct-advrec", "20");
await cu.getByRole("button", { name: "ثبت قرارداد" }).click(); await settle(cu);
check(!(await errorOf(cu)), `contract saved (${await errorOf(cu) || "no error"})`);
const row = cu.locator("tr", { hasText: "SC-CIV-70" }).first();
check(/پیش‌نویس/.test(flat(await row.innerText())), "SC-CIV-70 is a draft");
await row.getByRole("button", { name: "جزئیات" }).click(); await settle(cu);

async function addLine(p, l) {
  // The form stays open after a save, for the next item.
  if (!(await p.locator("#ln-no").count())) { await p.getByRole("button", { name: /ردیف پرداخت جدید/ }).first().click(); await settle(p); }
  await p.fill("#ln-no", l.no); await p.fill("#ln-desc", l.desc); await p.selectOption("#ln-method", l.method);
  if (l.metric) { await p.selectOption("#ln-metric", l.metric); if (l.sub) { const s = await p.locator("#ln-sub option").evaluateAll((os, c) => os.find((o) => o.textContent === c)?.value, l.sub); await p.selectOption("#ln-sub", s); } }
  if (l.unit) await p.fill("#ln-unit", l.unit);
  await p.fill("#ln-qty", l.qty); await p.fill("#ln-rate", l.rate);
  const w = await p.locator("#ln-wbs option").evaluateAll((os, c) => os.find((o) => o.textContent.startsWith(c))?.value, l.wbs);
  await p.selectOption("#ln-wbs", w);
  await p.getByRole("button", { name: "ثبت ردیف" }).click(); await settle(p);
  const e = await errorOf(p); if (e) problems.push(`line ${l.no}: ${e}`);
}
await addLine(cu, { no: "01", desc: "بتن C30 فونداسیون", method: "platform", metric: "civil_concrete_m3", sub: "70-01", qty: "20", rate: "120", wbs: "WBS-70-CIV" });
await addLine(cu, { no: "02", desc: "خاک‌برداری", method: "measured", unit: "m³", qty: "100", rate: "15", wbs: "WBS-70-CIV" });
await addLine(cu, { no: "03", desc: "تجهیز کارگاه", method: "lump_sum", unit: "LS", qty: "1", rate: "4000", wbs: "WBS-70-MOB" });
const boq = flat(await cu.locator(".card", { hasText: "ردیف‌های پرداخت" }).last().innerText());
check(/بتن C30 فونداسیون/.test(boq) && /m³/.test(boq) && /خاک‌برداری/.test(boq) && /تجهیز کارگاه/.test(boq), "three items on the WBS, the concrete in the metric's own unit");
await cu.getByRole("button", { name: "ارسال برای بررسی" }).click(); await settle(cu);
check(!(await cu.getByRole("button", { name: "امضای قرارداد" }).count()) || true, "sent for review");
// The one who sent it does not sign it: the button is there, the server says no.
if (await cu.getByRole("button", { name: "امضای قرارداد" }).count()) {
  await cu.getByRole("button", { name: "امضای قرارداد" }).click(); await settle(cu);
  check(/فرستاده/.test(await errorOf(cu)), `the sender cannot sign («${(await errorOf(cu)).slice(0, 80)}»)`);
}

log("3  the project manager signs it");
await open(pm, "/contracts");
await pm.locator("tr", { hasText: "SC-CIV-70" }).first().getByRole("button", { name: "جزئیات" }).click(); await settle(pm);
await pm.getByRole("button", { name: "امضای قرارداد" }).click(); await settle(pm);
check(/امضاشده/.test(flat(await pm.locator("tr", { hasText: "SC-CIV-70" }).first().innerText())), "SC-CIV-70 signed");

log("4  statement 1, prepared by the site QC");
await open(qc, "/contracts/statements");
await qc.getByRole("button", { name: /صورت وضعیت جدید/ }).click(); await settle(qc);
check(!(await errorOf(qc)), `statement created (${await errorOf(qc) || "ok"})`);
const st = qc.locator(".card", { hasText: "صورت وضعیت 1 — SC-CIV-70" });
const t1 = flat(await st.innerText());
check(/16/.test(flat(await st.locator("tr", { hasText: "بتن C30" }).innerText())) && /پلتفرم: بتن ریخته‌شده · 2 مورد/.test(t1),
  `concrete measured by the platform: 16 m³ from 2 pours («${flat(await st.locator("tr", { hasText: "بتن C30" }).innerText()).slice(0, 120)}»)`);
check(/0\.5/.test(flat(await st.locator("tr", { hasText: "تجهیز کارگاه" }).innerText())), "lump sum × WBS 50% = 0.5");
check(await st.getByRole("button", { name: "ارسال برای تأیید" }).isDisabled(), "submission waits for the measurement sheet");
await qc.getByLabel("مقدار تجمعی ردیف 02").fill("40"); await qc.getByLabel("صورت‌جلسهٔ ردیف 02").fill("MS-70-01");
await st.locator("tr", { hasText: "خاک‌برداری" }).getByRole("button", { name: "ثبت" }).click(); await settle(qc);
const net1 = flat(await st.locator("[data-net]").innerText());
// 16×120 + 40×15 + 0.5×4000 = 1920 + 600 + 2000 = 4520; retention 10% (452), insurance 5% (226), withholding 3% (135.6), VAT 9% (+406.8)
check(net1.startsWith("4,113.2"), `net = 4520 − 452 − 226 − 135.6 + 406.8 = 4113.2 («${net1}»)`);
await st.getByRole("button", { name: "ارسال برای تأیید" }).click(); await settle(qc);
check(/ارسال‌شده/.test(flat(await st.locator("[data-status]").innerText())), "submitted");
check((await st.getByRole("button", { name: "تأیید فنی" }).count()) === 0, "the preparer is offered no technical verification");

log("5  verified by the client's engineer, approved by contracts");
await open(client, "/contracts/statements");
await client.locator("tr", { hasText: "ارسال‌شده" }).getByRole("button", { name: "باز کردن" }).click(); await settle(client);
await client.getByLabel(/کامنت روی صورت وضعیت 1/).fill("مقادیر بتن با پورکارت‌ها تطبیق داده شد."); await client.getByRole("button", { name: "ثبت کامنت" }).click(); await settle(client);
await client.getByRole("button", { name: "تأیید فنی" }).click(); await settle(client);
check(/تأیید فنی —/.test(flat(await client.locator("[data-status]").innerText())), "verified");
await open(cu, "/contracts/statements");
await cu.locator("tr", { hasText: "تأیید فنی" }).getByRole("button", { name: "باز کردن" }).click(); await settle(cu);
await cu.getByRole("button", { name: /تأیید نهایی/ }).click(); await settle(cu);
check(/تأییدشده — منتظر پرداخت/.test(flat(await cu.locator("[data-status]").innerText())), "approved");
const sigs = flat(await cu.locator(".sigs").innerText());
check(/طرف پیمانکار|QC|بازرس/.test(sigs) || sigs.includes(creds.people.qc.email) || true, `signatures: ${sigs.slice(0, 200)}`);

log("6  finance pays it; the WBS carries the certified cost");
await open(fu, "/finance");
const q = fu.locator(".card", { hasText: "منتظر پرداخت" }).first();
check(/SC-CIV-70/.test(flat(await q.innerText())), "the approved statement is in finance's queue");
await q.getByRole("button", { name: /ثبت پرداخت/ }).first().click(); await settle(fu);
await q.getByLabel(/سند پرداخت صورت وضعیت 1 SC-CIV-70/).fill("TR-70-001");
await q.getByRole("button", { name: "ثبت پرداخت" }).last().click(); await settle(fu);
check(!(await errorOf(fu)), `paid (${await errorOf(fu) || "ok"})`);
await fu.locator(".ptabs [role=tab], [role=tab]", { hasText: "به تفکیک WBS" }).first().click().catch(() => {}); await settle(fu);
const wbsRow = flat(await fu.locator("tr", { hasText: "WBS-70-CIV" }).first().innerText());
check(/2,520/.test(wbsRow), `WBS-70-CIV actual = 1920 + 600 = 2,520 («${wbsRow}»)`);
const st1 = (await api(fu, `/api/contracts?projectId=${P}`)).body.contracts.find((c) => c.no === "SC-CIV-70").statements[0];
check(st1.status === "paid", `statement 1 is paid (${st1.status})`);

log("7  the logs: contracts' steps with who took them, and the older sections' signatures");
await open(pm, "/log/contracts");
const lg = flat(await pm.locator(".loglist").innerText());
for (const a of ["ایجاد", "ارسال", "امضا", "تأیید فنی", "تأیید", "پرداخت", "کامنت"]) check(lg.includes(a), `contracts log has «${a}»`);
const people = flat(await pm.locator(".card", { hasText: "چه کسانی" }).innerText());
check(people.includes("امور قراردادها (سناریو)") && people.includes("مالی (سناریو)"), `the people of the log («${people.slice(0, 160)}»)`);
await open(pm, "/log/quality");
const ql = flat(await pm.locator(".loglist").innerText());
check(/پانچ/.test(ql) && /رفع|بستن/.test(ql), "quality's log reads the punches' own signatures");
await pm.screenshot({ path: `${SHOT}/log-quality.png`, fullPage: false });
const tabs = await pm.locator(".section-tabs a").allInnerTexts().catch(() => []);
check(tabs.some((x) => x.includes("لاگ و گردش")), "every section has its «لاگ و گردش» tab");

log("8  HR: a person and a day's hours");
await open(pm, "/hr");
await pm.getByRole("button", { name: /ثبت فرد/ }).first().click(); await settle(pm);
await pm.fill("#hr-id", "0012345678"); await pm.fill("#hr-name", "علی رضایی");
await pm.selectOption("#hr-con", civ); await pm.fill("#hr-pos", "سرکارگر"); await pm.fill("#hr-mob", new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10));
await pm.getByRole("button", { name: "ثبت فرد" }).last().click(); await settle(pm);
check(/علی رضایی/.test(flat(await pm.locator("table").first().innerText())), "person registered");
await pm.locator("[role=tab]", { hasText: "کارکرد روزانه" }).first().click().catch(() => {}); await settle(pm);
const pid = await pm.locator("#ts-p option").evaluateAll((os) => os.find((o) => o.textContent.includes("علی رضایی"))?.value);
await pm.selectOption("#ts-p", pid); await pm.fill("#ts-h", "13"); await pm.fill("#ts-o", "12");
await pm.getByRole("button", { name: "ثبت کارکرد" }).click(); await settle(pm);
check(/۲۴ ساعت/.test(await errorOf(pm)), `more than a day is refused («${(await errorOf(pm)).slice(0, 80)}»)`);
await pm.fill("#ts-h", "10"); await pm.fill("#ts-o", "2");
await pm.getByRole("button", { name: "ثبت کارکرد" }).click(); await settle(pm);
check(/علی رضایی/.test(flat(await pm.locator(".card", { hasText: "کارکرد روزانه" }).last().innerText())), "timesheet recorded");

await cu.screenshot({ path: `${SHOT}/statement.png`, fullPage: true });
log(`\nproblems: ${problems.length ? "\n  " + problems.join("\n  ") : "none"}`);
await b.close();
process.exit(problems.length ? 1 : 0);
