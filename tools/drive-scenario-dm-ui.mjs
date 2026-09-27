/**
 * The DM-water pump scenario, done the way the guide tells a person to do
 * it: in the browser, through the forms it names, as the person it names.
 *
 *   npm run scenario:dm -- you@… --creds /tmp/creds.json     (a fresh project at 0.1)
 *   DRIVE_EMAIL=you@… DRIVE_PASSWORD=… SCENARIO_CREDS=/tmp/creds.json node tools/drive-scenario-dm-ui.mjs
 *
 * Three signed-in browsers: you (the EPC's project engineer), the
 * contractor's QC inspector and the client's representative. Every step
 * fills the fields docs/digital-epc/03-scenario-dm-pump.md names, and
 * checks what the guide says should appear — refusals included.
 * `SCENARIO_UNTIL=2.10` stops after that step; `SCENARIO_FROM=5` starts at
 * phase 5 of a project the CLI already played to the end of phase 4.
 */
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { ISO_7001 } from "../lib/scenario/dm-pump.mjs";

const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const UNTIL = process.env.SCENARIO_UNTIL || null;
// Start at a later phase: `npm run scenario:dm -- … --upto 4.5` plays the
// earlier steps into the database, and SCENARIO_FROM=5 drives from phase 5.
const FROM = Number(process.env.SCENARIO_FROM || 0);
const skipPhase = (n) => n < FROM;
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD, SCENARIO_CREDS } = process.env;
if (!EMAIL || !PASSWORD || !SCENARIO_CREDS) { console.error("set DRIVE_EMAIL, DRIVE_PASSWORD and SCENARIO_CREDS"); process.exit(1); }
const creds = JSON.parse(await readFile(SCENARIO_CREDS, "utf8"));
const t0 = new Date(`${creds.start}T00:00:00Z`).getTime();
const d = (n) => new Date(t0 + n * 86400000).toISOString().slice(0, 10);
const dt = (n, h) => new Date(t0 + n * 86400000 + h * 3600000).toISOString().slice(0, 16);

const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
const flat = (s) => String(s).replace(/\s+/g, " ").trim();
const check = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) problems.push("check: " + what); };

async function signIn(email, password) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => problems.push(`[${email}] pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  const sel = page.locator(".topbar select").first();
  const v = await sel.locator("option").evaluateAll((os, code) => os.find((o) => o.textContent.includes(`${code} —`))?.value, creds.project);
  if (!v) throw new Error(`${email} cannot see project ${creds.project}`);
  await sel.selectOption(v); await page.waitForTimeout(800);
  return page;
}
const pm = await signIn(EMAIL, PASSWORD);
const qc = await signIn(creds.people.qc.email, creds.people.qc.password);
const client = await signIn(creds.people.client.email, creds.people.client.password);

const settle = (p) => p.waitForTimeout(900);
async function open(p, path, tab = null) {
  await p.goto(BASE + path, { waitUntil: "networkidle" }); await settle(p);
  // A page with one part has no tab bar; then the part is simply there.
  const t = tab && p.locator(".ptabs [role=tab]", { hasText: tab }).first();
  if (t && await t.count()) { await t.click(); await settle(p); }
}
const card = (p, h) => p.locator(".card", { has: p.locator("h2", { hasText: h }) }).first();
/** The platform's own words after an action: the page's error line, or nothing. */
const errorOf = async (p) => flat(await p.locator(".page p.err:not(.sm)").first().innerText({ timeout: 1500 }).catch(() => ""));
async function fold(scope, title) {
  const btn = scope.locator(".fold-btn, .fold-head", { hasText: title }).first();
  if ((await btn.getAttribute("aria-expanded")) !== "true") await btn.click();
  await scope.page().waitForTimeout(300);
}
let step = "";
/** Pre-commissioning › subsystem 70-01's panel, opened. */
async function precomPanel(p) {
  const c = card(p, "ساب‌سیستم‌ها");
  const row = c.locator("tr", { hasText: "70-01" }).first();
  const btn = row.getByRole("button", { name: "جزئیات" });
  if (await btn.count()) { await btn.click(); await settle(p); }
  return row.locator("xpath=following-sibling::tr[1]");
}
/** One checklist attempt: «ثبت» on its row, then the form under it. */
async function attempt(p, panel, code, result, on, witness, note) {
  const row = panel.locator("tr", { hasText: code }).first();
  await row.getByRole("button", { name: "ثبت", exact: true }).click(); await settle(p);
  const f = row.locator("xpath=following-sibling::tr[1]");
  await f.locator("select[id^=r-]").selectOption(result); await f.locator("input[id^=d-]").fill(on);
  await f.locator("input[id^=w-]").fill(witness); await f.locator("input[id^=n-]").fill(note);
  await f.getByRole("button", { name: "ثبت", exact: true }).click(); await settle(p);
  const e = await errorOf(p); if (e) problems.push(`${step} ${code} ${result}: ${e}`);
}

/** Quality › a punch item's panel: its action on the given day. */
async function punchAct(p, desc, button, note, on) {
  const c = card(p, "Punch list");
  const row = c.locator("tr", { hasText: desc }).first();
  await row.getByRole("button", { name: "اقدام" }).click(); await settle(p);
  const panel = row.locator("xpath=following-sibling::tr[1]");
  if (note) await panel.locator("input[id^=pn-]").fill(note);
  await panel.locator("input[id^=pd-]").fill(on);
  await panel.getByRole("button", { name: button }).click(); await settle(p);
  const e = await errorOf(p); if (e) problems.push(`${step} ${button}: ${e}`);
}

async function pressureTest(p, scope, on, barg, hold, gauge, witness) {
  await scope.locator("input[id^=td-]").fill(on); await scope.locator("input[id^=ta-]").fill(barg);
  await scope.locator("input[id^=th-]").fill(hold); await scope.locator("input[id^=tg-]").fill(gauge);
  const leaks = scope.locator("select[id^=tl-]");
  const no = await leaks.locator("option").evaluateAll((os) => os.find((o) => /ندارد|بدون|خیر/.test(o.textContent))?.value);
  if (no !== undefined) await leaks.selectOption(no);
  await scope.locator("input[id^=tw-]").fill(witness);
  await scope.getByRole("button", { name: "ثبت تست" }).click(); await settle(p);
  const e = await errorOf(p); if (e) problems.push(`${step} test: ${e}`);
}

/** Piping execution › a spool's chain, opened under its row. */
async function spoolSteps(p, sp) {
  const row = p.locator("tr", { has: p.locator("td", { hasText: new RegExp(`^${sp}$`) }) }).first();
  const alt = p.locator("tr", { hasText: sp }).first();
  const r = (await row.count()) ? row : alt;
  const btn = r.getByRole("button", { name: "مراحل" });
  if (await btn.count()) { await btn.click(); await settle(p); }
  return r.locator("xpath=following-sibling::tr[1]");
}
async function closeSpool(p, sp) {
  const r = p.locator("tr", { hasText: sp }).first();
  const btn = r.getByRole("button", { name: "بستن" });
  if (await btn.count()) { await btn.click(); await settle(p); }
}
/** Welding & NDT: tick exactly these weld numbers. */
async function pickWelds(p, nos) {
  const c = card(p, "ثبت جوشکاری و NDT");
  for (const box of await c.locator("tbody input[type=checkbox]").all()) {
    const label = await box.getAttribute("aria-label");
    const want = nos.some((n) => label.startsWith(`انتخاب ${n} `));
    if ((await box.isChecked()) !== want) await box.click();
  }
}
async function weldThem(p, stamp, on, process, position) {
  const c = card(p, "ثبت جوشکاری و NDT");
  await fold(c, "ثبت جوشکاری");
  const v = await p.locator("#wa-welder option").evaluateAll((os, s) => os.find((o) => o.textContent.startsWith(s))?.value, stamp);
  await p.selectOption("#wa-welder", v); await p.fill("#wa-on", on); await p.selectOption("#wa-proc", process); await p.fill("#wa-pos", position);
  await c.getByRole("button", { name: /^ثبت جوشکاری برای/ }).click(); await p.waitForTimeout(2500);
  for (const t of await c.locator("li .err").allInnerTexts()) problems.push(`${step} welding: ${flat(t)}`);
}
async function ndtThem(p, method, result, report, on) {
  const c = card(p, "ثبت جوشکاری و NDT");
  await fold(c, "ثبت نتیجهٔ NDT");
  await p.selectOption("#nd-m", method); await p.selectOption("#nd-r", result); await p.fill("#nd-no", report); await p.fill("#nd-on", on);
  await c.getByRole("button", { name: /^ثبت NDT برای/ }).click(); await p.waitForTimeout(2500);
  for (const t of await c.locator("li .err").allInnerTexts()) problems.push(`${step} NDT: ${flat(t)}`);
}

/** A one-page PDF that pdf.js opens — enough to stand for a drawing file. */
function tinyPdf(text) {
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 842 595] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    null,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  const stream = `BT /F1 24 Tf 72 500 Td (${text}) Tj ET`;
  objs[3] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  let out = "%PDF-1.4\n";
  const offs = [];
  objs.forEach((o, k) => { offs.push(out.length); out += `${k + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

/** Equipment › a tag's chain, opened under its row. */
async function tagSteps(tag) {
  const c = card(pm, "تگ‌ها");
  const row = c.locator("tr", { has: pm.locator("td.mono a", { hasText: new RegExp(`^${tag}$`) }) }).first();
  const btn = row.getByRole("button", { name: "مراحل" });
  if (await btn.count()) { await btn.click(); await settle(pm); }
  return row.locator("xpath=following-sibling::tr[1]");
}
async function closeTagSteps(tag) {
  const row = card(pm, "تگ‌ها").locator("tr", { has: pm.locator("td.mono a", { hasText: new RegExp(`^${tag}$`) }) }).first();
  const btn = row.getByRole("button", { name: "بستن" });
  if (await btn.count()) { await btn.click(); await settle(pm); }
}

/** Civil › a foundation's detail (its chain steps and pours), opened. */
async function foundation(no) {
  const c = card(pm, "فونداسیون‌ها");
  const row = c.locator("tr", { hasText: no }).first();
  const btn = row.getByRole("button", { name: "جزئیات" });
  if (await btn.count()) { await btn.click(); await settle(pm); }
  return row.locator("xpath=following-sibling::tr[1]");
}
/** A chain step's «ثبت انجام», on the day set in the page's «تاریخ انجام کار». */
async function tickStep(p, scope, title, on, ref = null) {
  await p.fill("#work-date", on);
  const stepCard = scope.locator(".card", { has: p.locator("b", { hasText: title }) }).first();
  if (ref) await stepCard.getByLabel(/^مرجع /).fill(ref);
  await stepCard.getByRole("button", { name: "ثبت انجام" }).click(); await settle(p);
  const e = await errorOf(p); if (e) problems.push(`${step} «${title}»: ${e}`);
  const t = flat(await scope.locator(".card", { has: p.locator("b", { hasText: title }) }).first().innerText().catch(() => ""));
  if (!t.includes(fa(on))) problems.push(`${step} «${title}»: recorded, but not on ${on} («${t.slice(0, 80)}»)`);
}

/** Procurement › MR: the MR's detail panel, opened. */
async function mrDetail(no) {
  const c = card(pm, "درخواست‌های خرید (MR)");
  const panel = c.locator(".card", { has: pm.locator("h3", { hasText: `${no} —` }) });
  if (!(await panel.count())) { await c.locator("tr", { hasText: no }).getByRole("button", { name: "جزئیات" }).click(); await settle(pm); }
  return panel.first();
}
async function vendor(code, name) {
  await fold(pm.locator("main"), "PO یا فروشندهٔ جدید");
  await pm.fill("#vd-c", code); await pm.fill("#vd-n", name); await pm.fill("#vd-k", code === "V-PIPE" ? "IR" : "DE");
  await pm.getByRole("button", { name: "ثبت فروشنده" }).click(); await settle(pm);
  const e = await errorOf(pm); if (e) problems.push(`${step} vendor ${code}: ${e}`);
}
async function award(mrNo, vendorCode, poNo, on) {
  const m = await mrDetail(mrNo);
  await fold(m, "واگذاری و صدور PO");
  const f = m.locator(".card-formslot");
  const v = await f.locator("select[id^=a-b-] option").evaluateAll((os, c) => os.find((o) => o.textContent.startsWith(c))?.value, vendorCode);
  await f.locator("select[id^=a-b-]").selectOption(v);
  await f.locator("input[id^=a-p-]").fill(poNo); await f.locator("input[id^=a-d-]").fill(on);
  await f.getByRole("button", { name: "واگذاری و صدور PO", exact: true }).click(); await settle(pm);
}
/** Procurement › orders: a PO's card with its detail open. */
async function poDetail(no, p = pm) {
  const c = card(p, no);
  const btn = c.getByRole("button", { name: "جزئیات" });
  if (await btn.count()) { await btn.first().click(); await settle(p); }
  return c;
}
async function fat(p, poNo, what, on, irn, inspector) {
  const c = await poDetail(poNo, p);
  await c.locator("tr", { hasText: what }).getByRole("button", { name: "FAT" }).click(); await settle(p);
  await c.locator("input[id^=fd-]").fill(on); await c.locator("select[id^=fr-]").selectOption("pass");
  await c.locator("input[id^=fi-]").fill(irn); await c.locator("input[id^=fn-]").fill(inspector);
  await c.getByRole("button", { name: "ثبت FAT" }).click(); await settle(p);
}
const fa = (iso) => new Date(iso).toLocaleDateString("fa-IR");

/** Documents › incoming: one designer transmittal, a file per row. */
async function incoming(no, from, sent, recv, purpose, rows) {
  const c = card(pm, "ترانسمیتال‌های ورودی از طراح");
  await fold(c, "ثبت ترانسمیتال ورودی");
  await pm.fill("#in-no", no); await pm.fill("#in-from", from);
  await pm.fill("#in-sent", sent); await pm.fill("#in-recv", recv); await pm.fill("#in-purpose", purpose);
  for (const [k, [doc, rev, purp]] of rows.entries()) {
    if (k > 0) await c.getByRole("button", { name: "ردیف دیگر" }).click();
    await pm.getByLabel(`مدرک ${k + 1}`, { exact: true }).fill(doc);
    await pm.getByLabel(`رویژن ${k + 1}`, { exact: true }).fill(rev);
    await pm.getByLabel(`هدف ${k + 1}`, { exact: true }).selectOption(purp);
    await pm.getByLabel(`فایل ${k + 1}`, { exact: true }).setInputFiles({ name: `${doc}_Rev${rev}.pdf`, mimeType: "application/pdf",
      buffer: Buffer.from(`%PDF-1.4\n% ${doc} Rev.${rev}\n%%EOF\n`) });
  }
  await c.getByRole("button", { name: "ثبت ترانسمیتال", exact: true }).click(); await settle(pm);
  const e = await errorOf(pm); if (e) problems.push(`${step} ${no}: ${e}`);
}
/** One incoming transmittal's block: its heading line, table, item panel and reply form. */
const trBlock = (no) => card(pm, "ترانسمیتال‌های ورودی از طراح").locator(`xpath=./div[p/b[normalize-space()="${no}"]]`);
/** Open a row's review panel («بررسی») and return it. */
async function review(block, doc, rev) {
  const panel = block.locator(".card", { has: pm.locator("h3", { hasText: `${doc} Rev.${rev}` }) });
  if (!(await panel.count())) { await block.locator("tr", { hasText: doc }).getByRole("button", { name: "بررسی" }).click(); await settle(pm); }
  return panel.first();
}
async function finishAll(panel) {
  for (let n = 0; n < 5; n++) {
    const b2 = panel.getByRole("button", { name: "پایان بررسی" });
    if (!(await b2.count())) return;
    await b2.first().click(); await settle(pm);
  }
}
/** «پاسخ به …» — a Fold, so its form opens at the head of the card, not beside the transmittal. */
async function reply(trNo, codes, replyNo, on) {
  const c = card(pm, "ترانسمیتال‌های ورودی از طراح");
  await fold(c, `پاسخ به ${trNo}`);
  const f = c.locator(".card-formslot");
  for (const [doc, code] of Object.entries(codes)) await f.getByLabel(`کد ${doc}`).selectOption(code);
  await f.locator("input[id^=rp-no-]").fill(replyNo);
  await f.locator("input[id^=rp-on-]").fill(on);
  await f.getByRole("button", { name: "ثبت پاسخ" }).click(); await settle(pm);
}
const at = (id, title) => { step = id; console.log(`\n${id}  ${title}`); };
const stop = (id) => UNTIL && id === UNTIL;

try {
  if (!skipPhase(0)) {
    // ── 0 ────────────────────────────────────────────────────────────────
    at("0.2", "project specification");
    await open(pm, "/project");
    const spec = {
      contract_currency: "EUR", grade_elevation_mm: "100000", min_cover_mm: "800", concrete_curing_days: "7",
      lv_system_voltage_v: "400", calibration_tolerance_pct: "0.25", coating_max_rh_pct: "85",
      hse_o2_min_pct: "19.5", hse_o2_max_pct: "23.5", hse_lel_max_pct: "10", hse_h2s_max_ppm: "10", hse_co_max_ppm: "25",
      hse_gas_test_validity_min: "120", hse_permit_max_hours: "12", hse_scaffold_inspection_days: "7",
      hse_crane_inspection_days: "30", hse_risk_max_residual: "8", ncr_escalation_days: "14", doc_review_days: "10",
      vdrl_resubmit_days: "14", cmms_plant_code: "DMW", floc_template: "{plant}-{unit}-{tag}", criticality_levels: "A,B,C",
    };
    for (const [k, v] of Object.entries(spec)) await pm.fill(`#${k}`, v);
    await pm.getByRole("button", { name: "ذخیره", exact: true }).first().click(); await settle(pm);
    check(/ذخیره شد/.test(flat(await pm.locator("main").innerText())), "the specification is saved");
    await open(pm, "/inspection", "ITP");
    await pm.fill("#n-h", "24");
    await pm.locator("#n-h").locator("xpath=../..").getByRole("button", { name: "ذخیره" }).click(); await settle(pm);
    check(/24 h/.test(flat(await pm.locator(".kpis").innerText())), "inspection notice: 24 h");

    at("0.3", "equipment list");
    await open(pm, "/equipment");
    const csv = "Tag No,Description,Type,Subsystem,Unit\nP-7001,DM Water Transfer Pump,Centrifugal,70-01,70\nD-7002,DM Water Drum,Horizontal,70-01,70\n";
    await pm.locator("input[type=file]").first().setInputFiles({ name: "dmw-equipment.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await settle(pm);
    const imp = pm.getByRole("button", { name: /ثبت|وارد|تأیید/ }).filter({ hasNotText: "ثبت‌نام" });
    if (await imp.count()) { await imp.first().click(); await settle(pm); }
    const eq = flat(await pm.locator("main").innerText());
    check(/P-7001/.test(eq) && /D-7002/.test(eq), `both tags registered («${eq.slice(0, 120)}»)`);
    if (stop("0.3")) throw new Error("stop");
  }

  if (!skipPhase(1)) {
    // ── 1 ────────────────────────────────────────────────────────────────
    at("1.1", "MDR");
    await open(pm, "/documents");
    const mdr = card(pm, "رجیستر مدارک (MDR)");
    for (const [no, title, disc, type, tag, appr] of [
      ["DMW-PID-7001", "P&ID — DM water transfer to drum", "process", "P&ID", null, true],
      ["DMW-DS-P-7001", "Datasheet — DM water transfer pump P-7001", "mechanical", "DS", "P-7001", true],
      ["DMW-DS-D-7002", "Datasheet — DM water drum D-7002", "mechanical", "DS", "D-7002", true],
      ["DMW-ISO-7001", "Isometric — 70-DMW-7001 pump discharge to drum", "piping", "ISO", null, false],
    ]) {
      await fold(mdr, "مدرک جدید در رجیستر");
      await pm.fill("#md-no", no); await pm.fill("#md-t", title); await pm.fill("#md-d", disc); await pm.fill("#md-y", type);
      await pm.selectOption("#md-s", { label: "70-01" });
      if (tag) await pm.selectOption("#md-g", { label: tag });
      await pm.fill("#md-p", d(30));
      if (appr) await mdr.getByLabel(/تأیید کارفرما پیش از IFC لازم است/).check();
      await mdr.getByRole("button", { name: "ثبت در رجیستر" }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`1.1 ${no}: ${e}`);
    }
    const reg = flat(await mdr.innerText());
    check(["DMW-PID-7001", "DMW-DS-P-7001", "DMW-DS-D-7002", "DMW-ISO-7001"].every((n) => reg.includes(n)), "four register rows");
    check(/DMW-DS-P-7001.*P-7001/.test(reg), "the pump datasheet names its tag");
    if (stop("1.1")) throw new Error("stop");

    at("1.2", "incoming transmittal DES-TR-7001 (IFR)");
    await open(pm, "/documents", "ترانسمیتال‌های ورودی");
    await incoming("DES-TR-7001", "Designer", d(1), d(2), "برای بررسی",
      ["DMW-PID-7001", "DMW-DS-P-7001", "DMW-DS-D-7002"].map((no) => [no, "A", "IFR"]));
    const tr1 = trBlock("DES-TR-7001");
    const tr1Text = flat(await tr1.innerText());
    check((tr1Text.match(/Rev\.A · IFR/g) || []).length === 3, "three rows, Rev.A · IFR");
    check(tr1Text.includes(fa(d(12))), `reply due = received + 10 days (${fa(d(12))})`);
    if (stop("1.2")) throw new Error("stop");

    at("1.3", "distribution and a comment on the pump datasheet");
    const pumpItem = await review(tr1, "DMW-DS-P-7001", "A");
    await pumpItem.locator("input[id^=as-]").fill("mechanical, electrical");
    await pumpItem.getByRole("button", { name: "توزیع" }).click(); await settle(pm);
    await pumpItem.locator("select[id^=cd-]").selectOption("mechanical");
    await pumpItem.locator("input[id^=cr-]").fill("Sec. 4");
    await pumpItem.locator("textarea[id^=ct-]").fill("NPSHr at rated flow missing; state it on the curve");
    await pumpItem.getByRole("button", { name: "ثبت کامنت" }).click(); await settle(pm);
    await finishAll(pumpItem);
    for (const no of ["DMW-PID-7001", "DMW-DS-D-7002"]) {
      const item = await review(tr1, no, "A");
      await item.locator("input[id^=as-]").fill("process");
      await item.getByRole("button", { name: "توزیع" }).click(); await settle(pm);
      await finishAll(item);
    }
    const e13 = await errorOf(pm); if (e13) problems.push(`1.3: ${e13}`);
    check(/(\d+) کامنت باز/.exec(flat(await pm.locator(".pagehead").innerText()))?.[1] === "1", "one open comment");
    if (stop("1.3")) throw new Error("stop");

    at("1.4", "negative: code 1 on a document with an open comment");
    await reply("DES-TR-7001", { "DMW-DS-P-7001": "1" }, "EPC-RT-7001", d(8));
    const e14 = await errorOf(pm);
    check(/کامنت باز/.test(e14), `refused: «${e14.slice(0, 120)}»`);

    at("1.5", "reply EPC-RT-7001");
    await reply("DES-TR-7001", { "DMW-PID-7001": "1", "DMW-DS-D-7002": "1", "DMW-DS-P-7001": "2" }, "EPC-RT-7001", d(8));
    const e15 = await errorOf(pm); if (e15) problems.push(`1.5: ${e15}`);
    const tr1After = flat(await trBlock("DES-TR-7001").innerText());
    check((tr1After.match(/EPC-RT-7001/g) || []).length === 3, "all three rows answered by EPC-RT-7001");
    check(/1 کامنت باز/.test(flat(await pm.locator(".pagehead").innerText())), "the pump datasheet's comment is still open");
    if (stop("1.5")) throw new Error("stop");

    at("1.6", "DES-TR-7002 for construction (IFC)");
    await incoming("DES-TR-7002", "Designer", d(14), d(15), "برای ساخت",
      ["DMW-PID-7001", "DMW-DS-P-7001", "DMW-DS-D-7002", "DMW-ISO-7001"].map((no) => [no, "0", "IFC"]));
    const tr2 = trBlock("DES-TR-7002");
    const pump0 = await review(tr2, "DMW-DS-P-7001", "0");
    await pump0.getByLabel("پاسخ طراح").fill("NPSHr 2.1 m added to curve, Rev.0");
    await pump0.getByRole("button", { name: "بستن کامنت" }).click(); await settle(pm);
    const e16a = await errorOf(pm); if (e16a) problems.push(`1.6 close comment: ${e16a}`);
    check(/بسته در Rev\.0/.test(flat(await review(tr2, "DMW-DS-P-7001", "0").then((c) => c.innerText()))), "the NPSHr comment is closed on Rev.0");
    await reply("DES-TR-7002", Object.fromEntries(["DMW-PID-7001", "DMW-DS-P-7001", "DMW-DS-D-7002", "DMW-ISO-7001"].map((n) => [n, "1"])), "EPC-RT-7002", d(18));
    const e16 = await errorOf(pm); if (e16) problems.push(`1.6: ${e16}`);
    await open(pm, "/documents", "رجیستر");
    const regRows = await card(pm, "رجیستر مدارک (MDR)").locator("tbody tr").allInnerTexts();
    for (const no of ["DMW-PID-7001", "DMW-DS-P-7001", "DMW-DS-D-7002", "DMW-ISO-7001"]) {
      const row = flat(regRows.find((r) => r.includes(no)) || "");
      check(/Rev\.0 · IFC.*Rev\.0/.test(row), `${no}: construction revision Rev.0 («${row.slice(0, 90)}»)`);
    }
    if (stop("1.6")) throw new Error("stop");
  }

  if (!skipPhase(2)) {
    // ── 2 ────────────────────────────────────────────────────────────────
    at("2.1", "MR-7001 for the pump, issued for enquiry");
    await open(pm, "/procurement", "درخواست خرید و مناقصه");
    const mrs = card(pm, "درخواست‌های خرید (MR)");
    await fold(mrs, "درخواست خرید جدید");
    await pm.fill("#mr-no", "MR-7001"); await pm.fill("#mr-title", "DM water transfer pump"); await pm.fill("#mr-disc", "mechanical");
    await mrs.getByRole("button", { name: "ثبت پیش‌نویس" }).click(); await settle(pm);
    const mr = await mrDetail("MR-7001");
    await mr.locator("select[id^=ml-w-]").selectOption({ label: "تگ P-7001" });
    await mr.locator("input[id^=ml-q-]").fill("1"); await mr.locator("input[id^=ml-n-]").fill(d(70));
    await mr.getByLabel(/بازرسی کارخانه \(FAT\) لازم است/).check();
    await mr.getByRole("button", { name: "افزودن ردیف" }).click(); await settle(pm);
    await mr.locator("input[id^=mi-]").fill("برای استعلام");
    await mr.getByRole("button", { name: /^صدور Rev 0/ }).click(); await settle(pm);
    const e21 = await errorOf(pm); if (e21) problems.push(`2.1: ${e21}`);
    const mrText = flat(await mr.innerText());
    check(/P-7001.*لازم/.test(mrText) && /Rev 0/.test(mrText), "MR-7001 Rev 0 issued, its P-7001 line needs FAT");

    at("2.2", "two bids, both technically acceptable");
    await open(pm, "/procurement");
    for (const [code, name] of [["V-PMP-A", "Pump Maker A"], ["V-PMP-B", "Pump Maker B"], ["V-PIPE", "Pipe Stockist"]]) await vendor(code, name);
    await open(pm, "/procurement", "درخواست خرید و مناقصه");
    const mr2 = await mrDetail("MR-7001");
    for (const [code, price, weeks] of [["V-PMP-A", 38000, 10], ["V-PMP-B", 41500, 8]]) {
      await fold(mr2, "ثبت پیشنهاد");
      const f = mr2.locator(".card-formslot");
      await f.locator("select[id^=b-v-]").selectOption({ label: `${code} — ${code === "V-PMP-A" ? "Pump Maker A" : "Pump Maker B"}` });
      await f.locator("input[id^=b-r-]").fill(`${code}-Q1`); await f.locator("input[id^=b-d-]").fill(d(20));
      await f.locator("input[id^=b-u-]").fill(d(500)); await f.locator("input[id^=b-c-]").fill("EUR");
      await f.locator("input[id^=b-p-]").fill(String(price)); await f.locator("input[id^=b-w-]").fill(String(weeks));
      await f.getByRole("button", { name: "ثبت پیشنهاد", exact: true }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`2.2 ${code}: ${e}`);
      await mr2.locator("tr", { hasText: `${code}-Q1` }).getByRole("button", { name: "قابل‌قبول" }).click(); await settle(pm);
    }
    const bids = flat(await mr2.innerText());
    check(/V-PMP-A V-PMP-A-Q1.*کمترین/.test(bids) && (bids.match(/قابل‌قبول/g) || []).length >= 2, "both acceptable; V-PMP-A is the lowest");
    if (stop("2.2")) throw new Error("stop");

    at("2.3", "negative: award to the dearer bid with no reason");
    await award("MR-7001", "V-PMP-B", "PO-7001", d(25));
    const e23 = await errorOf(pm);
    check(/کمترین قیمت نیست/.test(e23), `refused: «${e23.slice(0, 120)}»`);

    at("2.4", "award to the lowest, PO-7001");
    await award("MR-7001", "V-PMP-A", "PO-7001", d(25));
    const e24 = await errorOf(pm); if (e24) problems.push(`2.4: ${e24}`);
    await open(pm, "/procurement");
    const po1 = await poDetail("PO-7001");
    check(/P-7001.*لازم/.test(flat(await po1.innerText())), "PO-7001 has the P-7001 line, FAT required (from the MR)");

    at("2.5", "vendor documents before FAT");
    for (const [code, title] of [["VD-01", "General arrangement drawing"], ["VD-02", "Performance curve & FAT procedure"]]) {
      const f = po1.locator("form", { has: pm.locator("b", { hasText: "مدرک فروشنده (VDRL)" }) });
      await f.locator("input[id^=dk-]").fill(code); await f.locator("input[id^=dt-]").fill(title); await f.locator("input[id^=dd-]").fill(d(40));
      await f.getByLabel("پیش از FAT لازم است").check();
      await f.getByRole("button", { name: "افزودن مدرک" }).click(); await settle(pm);
      const row = po1.locator("tr", { hasText: code });
      await row.locator("input[id^=dr-]").fill("A"); await row.locator("input[id^=ds-]").fill(d(35));
      await row.getByRole("button", { name: "ارسال شد" }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`2.5 ${code}: ${e}`);
    }
    const vd = flat(await po1.innerText());
    check((vd.match(/در بررسی/g) || []).length === 2 && vd.includes(fa(d(35))), "both under review, submitted on day 35");

    at("2.6", "negative: FAT before the vendor documents are accepted (QC)");
    await open(qc, "/procurement");
    await fat(qc, "PO-7001", "P-7001", d(45), "IRN-7001", "TPI inspector");
    const e26 = await errorOf(qc);
    check(/مدارک پیش از FAT تأیید نشده/.test(e26), `refused: «${e26.slice(0, 120)}»`);

    at("2.7", "vendor documents code 1, then FAT passed");
    await open(pm, "/procurement");
    const po1b = await poDetail("PO-7001");
    for (const code of ["VD-01", "VD-02"]) {
      const row = po1b.locator("tr", { hasText: code });
      await row.locator("select[id^=dc-]").selectOption("1"); await row.locator("input[id^=do-]").fill(d(40));
      await row.getByRole("button", { name: "برگشت" }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`2.7 ${code}: ${e}`);
    }
    await open(qc, "/procurement");
    await fat(qc, "PO-7001", "P-7001", d(45), "IRN-7001", "TPI inspector");
    const e27 = await errorOf(qc); if (e27) problems.push(`2.7 FAT: ${e27}`);
    check(/IRN-7001/.test(flat(await card(qc, "PO-7001").innerText())), "P-7001: FAT passed · IRN-7001");

    at("2.8", "shipment SH-7001 and arrival");
    await open(pm, "/procurement");
    const po1c = await poDetail("PO-7001");
    const shf = po1c.locator("form", { has: pm.locator("b", { hasText: "محمولهٔ جدید" }) });
    await shf.locator("input[id^=sn-]").fill("SH-7001"); await shf.locator("input[id^=sd-]").fill(d(50)); await shf.locator("input[id^=se-]").fill(d(58));
    await shf.getByLabel(/^ردیف 1 — P-7001/).fill("1");
    await shf.getByRole("button", { name: "ثبت محموله" }).click(); await settle(pm);
    const e28 = await errorOf(pm); if (e28) problems.push(`2.8: ${e28}`);
    await po1c.getByLabel("تاریخ ورود SH-7001").fill(d(58));
    await po1c.getByRole("button", { name: "ورود به سایت" }).click(); await settle(pm);
    const e28b = await errorOf(pm); if (e28b) problems.push(`2.8 arrival: ${e28b}`);
    const po1d = flat(await po1c.innerText());
    check(/P-7001.*رسید سایت/.test(po1d) && po1d.includes(`SH-7001 ${fa(d(50))} ${fa(d(58))} ${fa(d(58))}`), "PO-7001: P-7001 «رسید سایت», SH-7001 arrived on day 58");
    check(!/P-7001/.test(flat(await card(pm, "فهرست پیگیری").innerText())), "P-7001 has left the open expediting list");
    if (stop("2.8")) throw new Error("stop");

    at("2.9", "line pipe: item, direct PO, receipt against it");
    await open(pm, "/warehouse");
    const lots = card(pm, "موجودی به تفکیک لات");
    await fold(lots, "کالای جدید");
    await pm.fill("#it-code", "PIPE-3-S40-A106B"); await pm.fill("#it-desc", 'Pipe 3" SCH40 SMLS A106 Gr.B');
    await pm.selectOption("#it-cat", "pipe"); await pm.fill("#it-uom", "m"); await pm.fill("#it-spec", "ASTM A106 Gr.B");
    await lots.getByRole("button", { name: "ثبت کالا" }).click(); await settle(pm);
    const e29a = await errorOf(pm); if (e29a) problems.push(`2.9 item: ${e29a}`);
    await open(pm, "/procurement");
    await fold(pm.locator("main"), "PO یا فروشندهٔ جدید");
    await pm.fill("#po-no", "PO-7002"); await pm.selectOption("#po-v", { label: "V-PIPE — Pipe Stockist" });
    await pm.fill("#po-t", "Line pipe 3in"); await pm.fill("#po-c", "EUR"); await pm.fill("#po-d", d(30));
    await pm.getByRole("button", { name: "ثبت PO" }).click(); await settle(pm);
    const po2 = await poDetail("PO-7002");
    const lf = po2.locator("form", { has: pm.locator("b", { hasText: "ردیف جدید" }) });
    await lf.locator("select[id^=li-]").selectOption({ label: "PIPE-3-S40-A106B (m)" });
    await lf.locator("input[id^=lq-]").fill("36"); await lf.locator("input[id^=lp-]").fill(d(55)); await lf.locator("input[id^=ln-]").fill(d(60));
    await lf.getByRole("button", { name: "افزودن ردیف" }).click(); await settle(pm);
    const e29b = await errorOf(pm); if (e29b) problems.push(`2.9 PO line: ${e29b}`);
    await po2.locator("tr", { hasText: "PIPE-3-S40-A106B" }).getByRole("button", { name: "رسید" }).click(); await settle(pm);
    for (const [pre, v] of [["rn", "MRR-7001"], ["rd", d(55)], ["rq", "36"], ["rh", "H-70011"], ["rm", "MTC-70011"], ["rl", "Laydown A"]]) await po2.locator(`input[id^=${pre}-]`).fill(v);
    await po2.getByRole("button", { name: "رسید به انبار" }).click(); await settle(pm);
    const e29c = await errorOf(pm); if (e29c) problems.push(`2.9 receipt: ${e29c}`);
    await open(pm, "/warehouse");
    const lotRow = flat(await card(pm, "موجودی به تفکیک لات").locator("tr", { hasText: "MRR-7001" }).first().innerText().catch(() => ""));
    check(/MRR-7001/.test(lotRow), `warehouse lot MRR-7001 («${lotRow.slice(0, 120)}»)`);

    at("2.10", "MIR and MTC review (QC)");
    await open(qc, "/warehouse");
    const qlots = card(qc, "موجودی به تفکیک لات");
    await qlots.locator("tr", { hasText: "MRR-7001" }).getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
    const quar = flat(await qlots.innerText());
    check(/قابل حواله نیست/.test(quar), "before MIR: not issuable");
    await qlots.locator("input[id^=ia-]").fill("36"); await qlots.locator("input[id^=ir-]").fill("0");
    await qlots.locator("input[id^=im-]").fill("MIR-7001"); await qlots.locator("input[id^=id-]").fill(d(56));
    await qlots.getByRole("button", { name: "ثبت MIR" }).click(); await settle(qc);
    const e210 = await errorOf(qc); if (e210) problems.push(`2.10 MIR: ${e210}`);
    await qlots.getByRole("button", { name: "پذیرش" }).click(); await settle(qc);
    const e210b = await errorOf(qc); if (e210b) problems.push(`2.10 MTC: ${e210b}`);
    check(!/قابل حواله نیست/.test(flat(await qlots.innerText())), "after MIR and MTC: issuable");
    if (stop("2.10")) throw new Error("stop");
  }

  if (!skipPhase(3)) {
    // ── 3 ────────────────────────────────────────────────────────────────
    at("3.1", "foundations");
    await open(pm, "/civil");
    const fdns = card(pm, "فونداسیون‌ها");
    for (const [no, tag, vol, ab] of [["FDN-P-7001", "P-7001", "6", "VND-P7001-AB"], ["FDN-D-7002", "D-7002", "10", ""]]) {
      await fold(fdns, "ثبت فونداسیون جدید");
      await pm.fill("#f-no", no);
      const v = await pm.locator("#f-carries option").evaluateAll((os, t) => os.find((o) => o.textContent.startsWith(`${t} —`))?.value, tag);
      await pm.selectOption("#f-carries", v);
      await pm.fill("#f-cls", "C30"); await pm.fill("#f-fc", "30"); await pm.fill("#f-vol", vol); await pm.fill("#f-ab", ab);
      await fdns.getByRole("button", { name: "ثبت فونداسیون", exact: true }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`3.1 ${no}: ${e}`);
    }
    for (const no of ["FDN-P-7001", "FDN-D-7002"]) {
      const row = flat(await fdns.locator("tr", { hasText: no }).first().innerText());
      check(/70-01/.test(row) && /خاک‌برداری/.test(row), `${no}: filed under 70-01, next is excavation («${row.slice(0, 100)}»)`);
    }

    at("3.2", "work before the pour, each on its own day");
    for (const no of ["FDN-P-7001", "FDN-D-7002"]) {
      const det = await foundation(no);
      for (const [title, day] of [["خاک‌برداری", 52], ["بتن مگر", 53], ["آرماتوربندی", 55], ["انکر بولت", 56], ["بازرسی پیش از بتن‌ریزی", 58]]) {
        await tickStep(pm, det, title, d(day));
      }
      await fdns.locator("tr", { hasText: no }).getByRole("button", { name: "بستن" }).click(); await settle(pm);
    }
    const f1 = flat(await fdns.locator("tr", { hasText: "FDN-P-7001" }).first().innerText());
    check(/بتن‌ریزی/.test(f1), `next is the pour («${f1.slice(0, 100)}»)`);

    at("3.3", "negative: tick the pour by hand");
    const det33 = await foundation("FDN-P-7001");
    const pourCard = det33.locator(".card", { has: pm.locator("b", { hasText: /^بتن‌ریزی$/ }) });
    check((await pourCard.getByRole("button", { name: "ثبت انجام" }).count()) === 0,
      "the pour step has no «ثبت انجام» button — it is read from the pour card (the guide's refusal is the API's; the page does not offer it)");
    await fdns.locator("tr", { hasText: "FDN-P-7001" }).getByRole("button", { name: "بستن" }).click(); await settle(pm);

    at("3.4", "pours and cylinder breaks (QC)");
    await open(qc, "/civil");
    const qf = card(qc, "فونداسیون‌ها");
    for (const [no, pourNo, vol, breaks] of [["FDN-P-7001", "PC-P-7001", "6", [[7, "22.0 23.0"], [28, "36.5 37.5"]]],
      ["FDN-D-7002", "PC-D-7002", "10", [[28, "35.0 36.0"]]]]) {
      await qf.locator("tr", { hasText: no }).getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
      await qc.fill("#p-no", pourNo); await qc.fill("#p-on", d(60)); await qc.fill("#p-vol", vol);
      await qc.fill("#p-cls", "C30"); await qc.fill("#p-fc", "30");
      const con = await qc.locator("#p-con option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("C-CIV"))?.value);
      if (con) await qc.selectOption("#p-con", con); else problems.push("3.4: contractor C-CIV not offered on the pour form");
      await qc.getByRole("button", { name: "ثبت بتن‌ریزی" }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`3.4 ${pourNo}: ${e}`);
      for (const [age, res] of breaks) {
        await qc.fill("#s-no", "S1"); await qc.selectOption("#s-type", "cyl150"); await qc.fill("#s-age", String(age));
        await qc.fill("#s-res", res); await qc.fill("#s-on", d(60 + age)); await qc.fill("#s-lab", `LAB-${pourNo}-${age}`);
        await qc.getByRole("button", { name: "ثبت نتایج" }).click(); await settle(qc);
        const e2 = await errorOf(qc); if (e2) problems.push(`3.4 ${pourNo} ${age}d: ${e2}`);
      }
      await qf.locator("tr", { hasText: no }).getByRole("button", { name: "بستن" }).click(); await settle(qc);
    }
    for (const no of ["FDN-P-7001", "FDN-D-7002"]) {
      check(/پذیرفته/.test(flat(await qf.locator("tr", { hasText: no }).first().innerText())), `${no}: strength accepted (ACI 318)`);
    }
    // A 28-day break dated the day after the pour: the platform must refuse it.
    await qf.locator("tr", { hasText: "FDN-D-7002" }).getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
    await qc.fill("#s-no", "S2"); await qc.fill("#s-age", "28"); await qc.fill("#s-res", "40 41"); await qc.fill("#s-on", d(61));
    await qc.getByRole("button", { name: "ثبت نتایج" }).click(); await settle(qc);
    const e34 = await errorOf(qc);
    check(/زودتر از/.test(e34), `a 28-day break on day 61 is refused («${e34.slice(0, 100)}»)`);
    await qf.locator("tr", { hasText: "FDN-D-7002" }).getByRole("button", { name: "بستن" }).click(); await settle(qc);

    at("3.5", "backfill and hand-over to mechanical");
    await open(pm, "/civil");
    for (const no of ["FDN-P-7001", "FDN-D-7002"]) {
      const det = await foundation(no);
      await tickStep(pm, det, "خاک‌ریزی", d(70));
      await tickStep(pm, det, "تحویل به مکانیک", d(89));
      await fdns.locator("tr", { hasText: no }).getByRole("button", { name: "بستن" }).click(); await settle(pm);
      check(/تحویل‌شده/.test(flat(await fdns.locator("tr", { hasText: no }).first().innerText())), `${no}: handed over`);
    }
    if (stop("3.5")) throw new Error("stop");
  }

  if (!skipPhase(4)) {
    // ── 4 ────────────────────────────────────────────────────────────────
    at("4.1", "rotating-equipment ITP with a client hold point on alignment");
    await open(pm, "/inspection", "ITP");
    const itps = card(pm, "ITPها");
    await fold(itps, "ITP یا رویژن جدید");
    await pm.fill("#n-no", "ITP-ROT-70"); await pm.fill("#n-rev", "0"); await pm.fill("#n-t", "Rotating equipment installation");
    await pm.selectOption("#n-s", { label: "تجهیز دوّار" }).catch(async () => {
      const opts = await pm.locator("#n-s option").allInnerTexts(); problems.push(`4.1: no «تجهیز دوّار» scope (${opts.join(" | ")})`); });
    await itps.getByRole("button", { name: "ITP یا رویژن جدید", exact: true }).click(); await settle(pm);
    const e41a = await errorOf(pm); if (e41a) problems.push(`4.1 ITP: ${e41a}`);
    await pm.fill("#a-seq", "10"); await pm.fill("#a-title", "Cold alignment check");
    await pm.selectOption("#a-step", { label: "الایمنت سرد" });
    await pm.fill("#a-ref", "API 686 ch.7"); await pm.fill("#a-cr", "≤0.05 mm TIR"); await pm.fill("#a-rec", "ALN-form");
    await pm.selectOption("#a-company", "H");
    await pm.getByRole("button", { name: "افزودن ردیف" }).click(); await settle(pm);
    const e41b = await errorOf(pm); if (e41b) problems.push(`4.1 activity: ${e41b}`);
    await pm.getByRole("button", { name: "تأیید و اجرا" }).click(); await settle(pm);
    const e41c = await errorOf(pm);
    check(/تهیه|تأیید/.test(e41c), `the preparer cannot approve («${e41c.slice(0, 100)}»)`);
    await open(client, "/inspection", "ITP");
    await card(client, "ITPها").locator("tr", { hasText: "ITP-ROT-70" }).click(); await settle(client);
    await client.getByRole("button", { name: "تأیید و اجرا" }).click(); await settle(client);
    const e41d = await errorOf(client); if (e41d) problems.push(`4.1 client approval: ${e41d}`);
    check(/در حال اجرا/.test(flat(await card(client, "ITPها").locator("tr", { hasText: "ITP-ROT-70" }).innerText())), "ITP-ROT-70 is in force");

    at("4.2", "set and grout the pump and the drum");
    await open(pm, "/equipment", "تگ‌ها");
    for (const t of ["P-7001", "D-7002"]) {
      const st = await tagSteps(t);
      await tickStep(pm, st, "استقرار", d(90), `SET-${t}`);
      await tickStep(pm, st, "گروت‌ریزی", d(92), `GRT-${t}`);
      await closeTagSteps(t);
    }

    at("4.3", "negative: alignment before the hold point is released");
    const p43 = await tagSteps("P-7001");
    const align = flat(await p43.locator(".card", { has: pm.locator("b", { hasText: "الایمنت سرد" }) }).innerText());
    check(/نقطهٔ توقف ITP-ROT-70 ردیف 10/.test(align) && !/ثبت انجام/.test(align),
      `alignment shows the hold (ITP-ROT-70 row 10) and no button («${align.slice(0, 120)}»)`);
    await closeTagSteps("P-7001");

    at("4.4", "IR by QC, accepted by the client");
    await open(qc, "/inspection", "درخواست‌های بازرسی");
    const tomorrow = new Date(Date.now() + 86400000); tomorrow.setHours(9, 0, 0, 0);
    const local = new Date(tomorrow.getTime() - tomorrow.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    await fold(qc.locator("main"), "درخواست بازرسی جدید");
    await qc.selectOption("#r-scope", { label: "تجهیز دوّار" });
    await settle(qc);
    const act = await qc.locator("#r-act option").evaluateAll((os) => os.find((o) => o.textContent.includes("ITP-ROT-70 · 10"))?.value);
    await qc.selectOption("#r-act", act);
    const item = await qc.locator("#r-item option").evaluateAll((os) => os.find((o) => o.textContent.includes("P-7001"))?.value);
    await qc.selectOption("#r-item", item);
    await qc.fill("#r-at", local); await qc.fill("#r-loc", "Unit 70, pump bay");
    await qc.getByRole("button", { name: "ثبت درخواست" }).click(); await settle(qc);
    const e44 = await errorOf(qc); if (e44) problems.push(`4.4 IR: ${e44}`);
    await open(client, "/inspection", "درخواست‌های بازرسی");
    const board = card(client, "درخواست‌های بازرسی");
    await board.locator("tr", { hasText: "P-7001" }).getByRole("button", { name: "اقدام" }).click(); await settle(client);
    const irCard = board;
    await irCard.locator("select[id^=o-]").selectOption("accepted");
    await irCard.locator("input[id^=n-]").fill("Client mech. inspector");
    await irCard.getByRole("button", { name: "ثبت و امضا" }).click(); await settle(client);
    const e44b = await errorOf(client); if (e44b) problems.push(`4.4 result: ${e44b}`);
    check(/آزاد/.test(flat(await client.locator("main").innerText())), "the IR is released");

    at("4.5", "cold alignment");
    await open(pm, "/equipment", "تگ‌ها");
    const p45 = await tagSteps("P-7001");
    await tickStep(pm, p45, "الایمنت سرد", d(96), "ALN-7001");
    const pumpSteps = flat(await p45.innerText());
    check(/اتصال پایپینگ.*منتظر/.test(pumpSteps) || /اتصال پایپینگ.*آمادهٔ شروع/.test(pumpSteps), `piping connection waits for the line («${pumpSteps.slice(0, 200)}»)`);
    await closeTagSteps("P-7001");
    if (stop("4.5")) throw new Error("stop");
  }

  if (!skipPhase(5)) {
    // ── 5 ────────────────────────────────────────────────────────────────
    at("5.1", "piping class A1DM");
    await open(pm, "/piping/overview", "کلاس‌های لوله");
    const pcs = card(pm, "کلاس‌های لوله");
    await fold(pcs, "کلاس لولهٔ جدید یا ویرایش");
    await pm.fill("#pc-code", "A1DM"); await pm.fill("#pc-desc", "DM water, CS, 150#"); await pm.selectOption("#pc-svc", "category_d");
    await pm.fill("#pc-mat", "A106 Gr.B"); await pm.fill("#pc-ca", "1.5"); await pm.fill("#pc-t", "60"); await pm.fill("#pc-p", "16");
    await pcs.getByRole("button", { name: "ثبت کلاس" }).click(); await settle(pm);
    const e51 = flat(await pcs.locator("p.err").first().innerText({ timeout: 1000 }).catch(() => "")); if (e51) problems.push(`5.1: ${e51}`);
    check(/A1DM.*Category D.*16/.test(flat(await pcs.innerText())), "A1DM: Category D, 16 barg");

    at("5.2", "isometric DMW-ISO-7001, keyed by hand and saved with its file");
    await pm.goto(BASE + "/piping", { waitUntil: "networkidle" }); await settle(pm);
    await pm.getByRole("button", { name: /نقشه دوبعدی/ }).click();
    await pm.locator("input[type=file][accept*=pdf]").setInputFiles({ name: "DMW-ISO-7001_Rev0.pdf", mimeType: "application/pdf", buffer: tinyPdf("DMW-ISO-7001 Rev.0") });
    await pm.waitForTimeout(3000);
    await pm.getByRole("button", { name: "ورود دستی (JSON) برای همین نقشه" }).click(); await settle(pm);
    await pm.locator(".pane textarea").fill(JSON.stringify(ISO_7001, null, 2));
    await pm.getByRole("button", { name: "اعمال محلی" }).click(); await settle(pm);
    await pm.locator(".tabnav button", { hasText: "سرجوش" }).click(); await settle(pm);
    const wreg = flat(await pm.locator(".pane").first().innerText());
    check(/6 جوش · 2 اسپول/.test(wreg), `the engine makes 6 welds on 2 spools («${wreg.slice(0, 80)}»)`);
    await pm.getByRole("button", { name: "ذخیره در سامانه" }).click();
    await pm.waitForFunction(() => /جوش ثبت شد|\.err/.test(document.querySelector(".savebar")?.innerText || "")
      || !!document.querySelector(".savebar p.err"), null, { timeout: 60000 }).catch(() => {});
    const saved = flat(await pm.locator(".savebar").innerText());
    check(/6 جوش ثبت شد/.test(saved), `saved («${saved.slice(0, 100)}»)`);
    await pm.getByRole("button", { name: "تأیید رجیستر (مهندس)" }).click();
    await pm.waitForFunction(() => /تأیید شد|err/.test(document.querySelector(".savebar")?.innerText || ""), null, { timeout: 30000 }).catch(() => {});
    const appr = flat(await pm.locator(".savebar").innerText());
    check(/تأیید شد|قفل است/.test(appr), `approved («${appr.slice(0, 100)}»)`);
    await open(pm, "/subsystems");
    const unfiled = pm.locator(".card", { has: pm.locator("h2", { hasText: "خطوطی که زیر هیچ ساب‌سیستمی نیستند" }) });
    check(!(await unfiled.count()) || !/70-DMW-7001/.test(await unfiled.innerText()), "70-DMW-7001 is not among the unfiled lines — it went under 70-01");
    await open(pm, "/equipment", "تگ‌ها");
    const p52 = flat(await (await tagSteps("P-7001")).innerText());
    check(/⚙ اتصال پایپینگ/.test(p52), `P-7001's piping connection is now read from its line («${p52.slice(0, 60)}»)`);
    await closeTagSteps("P-7001");
    if (stop("5.2")) throw new Error("stop");

    at("5.3", "welder W-701 and his WPQ (QC)");
    await open(qc, "/piping/welding", "جوشکاران");
    const wcard = card(qc, "جوشکاران");
    await fold(wcard, "جوشکار جدید");
    await qc.fill("#wl-stamp", "W-701"); await qc.fill("#wl-name", "جوشکار سناریو"); await qc.fill("#wl-emp", "C-MEC");
    await wcard.getByRole("button", { name: "ثبت جوشکار" }).click(); await settle(qc);
    await fold(wcard, "صلاحیت جوشکار (WPQ)");
    const wv = await qc.locator("#wq-w option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("W-701"))?.value);
    await qc.selectOption("#wq-w", wv); await qc.fill("#wq-p", "GTAW"); await qc.fill("#wq-pos", "6G");
    await qc.fill("#wq-od", "88.9"); await qc.fill("#wq-t", "5.49");
    await wcard.getByRole("button", { name: "ثبت صلاحیت" }).click(); await settle(qc);
    const e53 = await errorOf(qc); if (e53) problems.push(`5.3: ${e53}`);
    check(/W-701.*جوشکار سناریو.*C-MEC.*1/.test(flat(await wcard.innerText())), "W-701 with one live qualification");

    at("5.4", "pipe issued, spools released and fitted, shop welds welded and RT'd");
    await open(qc, "/warehouse");
    const wl = card(qc, "موجودی به تفکیک لات");
    await wl.locator("tr", { hasText: "MRR-7001" }).getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
    await wl.locator("select[id^=mk-]").selectOption("issue"); await wl.locator("input[id^=mq-]").fill("12");
    const spv = await wl.locator("select[id^=ms-] option").evaluateAll((os) => os.find((o) => o.textContent.includes("SP-01"))?.value);
    if (spv) await wl.locator("select[id^=ms-]").selectOption(spv); else problems.push("5.4: spool SP-01 not offered on the issue form");
    await wl.locator("input[id^=mn-]").fill("MIV-7001"); await wl.locator("input[id^=mo-]").fill(d(61));
    await wl.getByRole("button", { name: "ثبت", exact: true }).click(); await settle(qc);
    const e54a = await errorOf(qc); if (e54a) problems.push(`5.4 issue: ${e54a}`);
    await open(qc, "/piping/execution", "مراحل اجرا");
    for (const [sp, fu] of [["SP-01", "FU-7001"], ["SP-02", null]]) {
      const det = await spoolSteps(qc, sp);
      await tickStep(qc, det, "صدور", d(62));
      if (fu) await tickStep(qc, det, "فیت‌آپ", d(64), fu);
      else check(/فیت‌آپ و بازرسی آن ندارد/.test(flat(await det.innerText())), `${sp} has no shop welds: fit-up «ندارد»`);
      await closeSpool(qc, sp);
    }
    await open(qc, "/piping/welding");
    const wj = card(qc, "ثبت جوشکاری و NDT");
    await qc.fill("#wj-q", "70-DMW-7001"); await wj.getByRole("button", { name: "جستجو" }).click(); await settle(qc);
    await pickWelds(qc, ["W-02", "W-03", "W-04"]);
    await weldThem(qc, "W-701", d(66), "GTAW", "V");
    await pickWelds(qc, ["W-02", "W-03", "W-04"]);
    await ndtThem(qc, "RT", "accept", "RT-7001", d(68));
    const wjt = flat(await wj.innerText());
    check((wjt.match(/پذیرفته/g) || []).length >= 3, "three shop welds: RT accepted");
    await open(qc, "/piping/execution", "مراحل اجرا");
    const sp1 = flat(await (await spoolSteps(qc, "SP-01")).innerText());
    check(/⚙ جوشکاری کارگاهی[^⚙]*انجام شد/.test(sp1) && /⚙ NDT جوش‌های کارگاهی انجام شد/.test(sp1), `SP-01: shop welding and shop NDT read done («${sp1.slice(0, 160)}»)`);
    await closeSpool(qc, "SP-01");
    if (stop("5.4")) throw new Error("stop");

    at("5.5", "hot-work permit: requested by the contractor, issued by the EPC after a gas test");
    await open(qc, "/hse", "مجوز کار");
    const ptw = card(qc, "مجوز کار (PTW)");
    await fold(ptw, "درخواست مجوز کار");
    await qc.fill("#pt-no", "HW-7001"); await qc.selectOption("#pt-type", "hot"); await qc.fill("#pt-area", "Unit 70 pipe rack");
    await qc.fill("#pt-desc", "Field welds W-01, W-05, W-06 on 70-DMW-7001");
    const cm = await qc.locator("#pt-c option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("C-MEC"))?.value);
    if (cm) await qc.selectOption("#pt-c", cm);
    await qc.fill("#pt-req", "C-MEC foreman");
    await ptw.getByRole("button", { name: "ثبت درخواست" }).click(); await settle(qc);
    const e55a = await errorOf(qc); if (e55a) problems.push(`5.5 request: ${e55a}`);
    await open(pm, "/hse", "مجوز کار");
    const prow = () => card(pm, "مجوز کار (PTW)").locator("tr", { hasText: "HW-7001" }).first();
    await prow().getByRole("button", { name: "صدور" }).click(); await settle(pm);
    const e55b = await errorOf(pm);
    check(/گاز/.test(e55b), `issuing before a gas test is refused («${e55b.slice(0, 120)}»)`);
    await open(qc, "/hse", "مجوز کار");
    const qrow = card(qc, "مجوز کار (PTW)").locator("tr", { hasText: "HW-7001" }).first();
    await qrow.getByRole("button", { name: "تست گاز" }).click(); await settle(qc);
    const gas = card(qc, "مجوز کار (PTW)");
    for (const [pre, v] of [["g-o", "20.9"], ["g-l", "0"], ["g-h", "0"], ["g-c", "0"], ["g-n", "Gas tester"], ["g-i", "GD-701"]]) await gas.locator(`input[id^=${pre}-]`).fill(v);
    await gas.getByRole("button", { name: "ثبت تست گاز" }).click(); await settle(qc);
    const e55c = await errorOf(qc); if (e55c) problems.push(`5.5 gas: ${e55c}`);
    await open(pm, "/hse", "مجوز کار");
    await prow().getByRole("button", { name: "صدور" }).click(); await settle(pm);
    const e55d = await errorOf(pm); if (e55d) problems.push(`5.5 issue: ${e55d}`);
    check(/فعال/.test(flat(await prow().innerText())), "HW-7001 is active");

    at("5.6", "erection, field welds, supports (QC); permit closed");
    await open(qc, "/piping/execution", "مراحل اجرا");
    for (const sp of ["SP-01", "SP-02"]) { const det = await spoolSteps(qc, sp); await tickStep(qc, det, "نصب در محل", d(92)); await closeSpool(qc, sp); }
    await open(qc, "/piping/welding");
    const wj6 = card(qc, "ثبت جوشکاری و NDT");
    await qc.fill("#wj-q", "70-DMW-7001"); await wj6.getByRole("button", { name: "جستجو" }).click(); await settle(qc);
    await pickWelds(qc, ["W-01", "W-05", "W-06"]);
    await weldThem(qc, "W-701", d(93), "GTAW", "V");
    await pickWelds(qc, ["W-01", "W-05", "W-06"]);
    await ndtThem(qc, "RT", "accept", "RT-7002", d(94));
    await open(qc, "/piping/execution", "ساپورت‌ها");
    const sup = card(qc, "ساپورت‌ها");
    for (const [no, kind, sp] of [["G-7001", "guide", "SP-01"], ["SH-7002", "shoe", "SP-02"]]) {
      await fold(sup, "ساپورت جدید");
      await qc.fill("#s-no", no); await qc.selectOption("#s-kind", kind);
      const sv = await qc.locator("#s-spool option").evaluateAll((os, x) => os.find((o) => o.textContent.endsWith(`/ ${x}`))?.value, sp);
      await qc.selectOption("#s-spool", sv); await qc.fill("#s-ref", "STD-PS-02");
      await sup.getByRole("button", { name: "افزودن ساپورت" }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`5.6 support ${no}: ${e}`);
    }
    for (const [no, step2, day] of [["G-7001", "نصب شد", 94], ["SH-7002", "نصب شد", 94], ["G-7001", "بازرسی شد", 95], ["SH-7002", "بازرسی شد", 95]]) {
      await qc.fill("#work-date", d(day));
      await sup.locator("tr", { hasText: no }).getByRole("button", { name: step2 }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`5.6 ${no} ${step2}: ${e}`);
    }
    const supText = flat(await sup.innerText());
    check(/G-7001.*70-DMW-7001.*SP-01/.test(supText) && /SH-7002.*70-DMW-7001.*SP-02/.test(supText), "both supports on 70-DMW-7001, on their spools");
    await open(qc, "/piping/execution", "مراحل اجرا");
    for (const [sp, no] of [["SP-01", "G-7001"], ["SP-02", "SH-7002"]]) { const det = await spoolSteps(qc, sp); await tickStep(qc, det, "نصب ساپورت دائم", d(95), no); await closeSpool(qc, sp); }
    const sp2 = flat(await (await spoolSteps(qc, "SP-02")).innerText());
    check(/جوش و NDT سایت انجام شد/.test(sp2) && /تست فشار[^]*آمادهٔ شروع/.test(sp2), `SP-02: field welds done, pressure test next («${sp2.slice(0, 200)}»)`);
    await closeSpool(qc, "SP-02");
    await open(qc, "/hse", "مجوز کار");
    await card(qc, "مجوز کار (PTW)").locator("tr", { hasText: "HW-7001" }).first().getByRole("button", { name: "بستن" }).click(); await settle(qc);
    const e56 = await errorOf(qc); if (e56) problems.push(`5.6 close permit: ${e56}`);

    at("5.7", "test pack TP-70-01");
    await open(pm, "/completions", "پکیج‌های تست فشار");
    const packs = card(pm, "پکیج‌های تست فشار");
    await fold(packs, "پکیج تست جدید");
    await pm.fill("#pk-no", "TP-70-01"); await pm.selectOption("#pk-s", { label: "70-01" }); await pm.selectOption("#pk-m", "hydrostatic");
    await pm.fill("#pk-rr", "1.0"); await pm.fill("#pk-d", "DM water pump discharge to drum");
    await packs.getByRole("button", { name: "ثبت پکیج" }).click(); await settle(pm);
    const e57 = await errorOf(pm); if (e57) problems.push(`5.7 pack: ${e57}`);
    await packs.locator("tr", { hasText: "TP-70-01" }).getByRole("button", { name: "جزئیات" }).click(); await settle(pm);
    const lv = await packs.locator("select[id^=pl-] option").evaluateAll((os) => os.find((o) => o.textContent === "70-DMW-7001")?.value);
    await packs.locator("select[id^=pl-]").selectOption(lv);
    await packs.getByRole("button", { name: "افزودن", exact: true }).click(); await settle(pm);
    const e57b = await errorOf(pm); if (e57b) problems.push(`5.7 line: ${e57b}`);
    check(/= 24 barg/.test(flat(await packs.innerText())), "required test pressure 1.5 × 16 × 1.0 = 24 barg");

    at("5.8", "negative: a test below the required pressure (QC)");
    await open(qc, "/completions", "پکیج‌های تست فشار");
    const qp = card(qc, "پکیج‌های تست فشار");
    await qp.locator("tr", { hasText: "TP-70-01" }).getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
    await pressureTest(qc, qp, d(97), "20", "30", "PG-CAL-701", "");
    const t58 = flat(await qp.innerText());
    check(/رد/.test(t58) && /24/.test(t58), "20 barg is judged a fail against 24");
    check(!(await qp.locator("tr", { hasText: "PG-CAL-701" }).getByRole("button", { name: "پذیرش" }).count()), "a failed test offers no «پذیرش»");

    at("5.9", "hydrotest passed; the recorder cannot accept it, the client does");
    await pressureTest(qc, qp, d(98), "24.5", "30", "PG-CAL-701", "Client");
    const passRow = qp.locator("tr", { hasText: "24.5" }).first();
    await passRow.getByRole("button", { name: "پذیرش" }).click(); await settle(qc);
    const e59 = await errorOf(qc);
    check(/ثبت‌کنندهٔ تست/.test(e59), `the recorder's acceptance is refused («${e59.slice(0, 100)}»)`);
    await open(client, "/completions", "پکیج‌های تست فشار");
    const cp = card(client, "پکیج‌های تست فشار");
    await cp.locator("tr", { hasText: "TP-70-01" }).getByRole("button", { name: "جزئیات" }).click(); await settle(client);
    const cBtn = cp.locator("tr", { hasText: "24.5" }).first().getByRole("button", { name: "پذیرش" });
    if (await cBtn.count()) { await cBtn.click(); await settle(client); } else problems.push("5.9: the client has no «پذیرش» on the passed test");
    const e59b = await errorOf(client); if (e59b) problems.push(`5.9 client: ${e59b}`);
    await open(qc, "/piping/execution", "مراحل اجرا");
    for (const sp of ["SP-01", "SP-02"]) {
      const t = flat(await (await spoolSteps(qc, sp)).innerText());
      check(/⚙ تست فشار[^⚙]*انجام شد/.test(t), `${sp}: the pressure test reads done from the accepted pack`);
      await closeSpool(qc, sp);
    }
    if (stop("5.9")) throw new Error("stop");
  }
  if (!skipPhase(6)) {
    // ── 6 ────────────────────────────────────────────────────────────────
    at("6.1", "paint system, assigned to both spools, prep, two coats, final (QC)");
    await open(pm, "/coating", "سیستم‌های رنگ");
    const sysCard = card(pm, "سیستم‌های رنگ");
    await fold(sysCard, "سیستم رنگ جدید");
    await pm.fill("#cs-code", "CS-DM-01"); await pm.fill("#cs-title", "Epoxy primer / epoxy finish, C3");
    await pm.selectOption("#cs-prep", "Sa 2½"); await pm.fill("#cs-pmin", "40"); await pm.fill("#cs-pmax", "75"); await pm.fill("#cs-max", "350");
    await pm.fill("#cs-coats", "Epoxy zinc phosphate primer: 75\nEpoxy finish: 125");
    await sysCard.getByRole("button", { name: "ثبت سیستم" }).click(); await settle(pm);
    const e61a = await errorOf(pm); if (e61a) problems.push(`6.1 system: ${e61a}`);
    await open(pm, "/coating", "آیتم‌ها");
    const items = card(pm, "آیتم‌ها");
    await fold(items, "تخصیص سیستم رنگ و عایق");
    await pm.fill("#as-area", "3");
    for (const sp of ["SP-01", "SP-02"]) await items.locator("label", { hasText: `70-DMW-7001 / ${sp}` }).locator("input").check();
    await items.getByRole("button", { name: /^تخصیص به 2 آیتم/ }).click(); await settle(pm);
    const e61b = await errorOf(pm); if (e61b) problems.push(`6.1 assign: ${e61b}`);
    await open(qc, "/coating", "آیتم‌ها");
    const qi = card(qc, "آیتم‌ها");
    for (const sp of ["SP-01", "SP-02"]) {
      const row = qi.locator("tr", { hasText: sp }).first();
      await row.getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
      await qc.fill("#work-date", d(100));
      await qc.selectOption("#pp-grade", "Sa 2½"); await qc.fill("#pp-prof", "55 60 58");
      await qc.getByRole("button", { name: "ثبت آماده‌سازی" }).click(); await settle(qc);
      for (const [no, day, dft] of [["1", 100, "80 87 94 81 88 95 82 89 96 83"], ["2", 101, "205 212 219 206 213 220 207 214 221 208"]]) {
        await qc.fill("#work-date", d(day));
        await qc.selectOption("#ct-no", no); await qc.fill("#ct-air", "30"); await qc.fill("#ct-rh", "55"); await qc.fill("#ct-steel", "33");
        await qc.fill("#ct-dft", dft);
        await qc.getByRole("button", { name: "ثبت لایه" }).click(); await settle(qc);
        const e = await errorOf(qc); if (e) problems.push(`6.1 ${sp} coat ${no}: ${e}`);
      }
      const det = row.locator("xpath=following-sibling::tr[1]");
      await tickStep(qc, det, "بازرسی نهایی رنگ", d(102));
      await tickStep(qc, det, "تحویل رنگ و عایق", d(102));
      await row.getByRole("button", { name: "بستن" }).click(); await settle(qc);
    }
    await open(qc, "/piping/execution", "مراحل اجرا");
    const sp61 = flat(await (await spoolSteps(qc, "SP-01")).innerText());
    check(/⚙ رنگ و عایق[^⚙]*انجام شد/.test(sp61), `SP-01: paint and insulation read done from coating («${sp61.slice(-160)}»)`);
    await closeSpool(qc, "SP-01");

    at("6.2", "cable list: the pump motor cable");
    await open(pm, "/electrical", "کابل‌ها");
    const cab = card(pm, "کابل‌ها");
    await fold(cab, "ورود لیست کابل");
    await pm.fill("#imp", "Cable No,From,To,Cable Type,Voltage,Length (m)\nCBL-P-7001,MCC-70,P-7001,3Cx16 XLPE/SWA/PVC,0.6/1kV,60");
    await cab.getByRole("button", { name: "ورود", exact: true }).click(); await settle(pm);
    const e62 = await errorOf(pm); if (e62) problems.push(`6.2: ${e62}`);
    check(/CBL-P-7001.*P-7001/.test(flat(await cab.innerText())), "CBL-P-7001 to P-7001");

    at("6.3", "cable pulled and terminated; a failed IR, then a pass (QC)");
    await open(qc, "/electrical", "کابل‌ها");
    const qcab = card(qc, "کابل‌ها");
    const crow = qcab.locator("tr", { hasText: "CBL-P-7001" }).first();
    await crow.getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
    const cdet = crow.locator("xpath=following-sibling::tr[1]");
    await tickStep(qc, cdet, "مسیر آماده", d(94));
    await tickStep(qc, cdet, "کابل‌کشی", d(95));
    await tickStep(qc, cdet, "گلند و ترمینیشن", d(97));
    for (const [readings, day] of [["300 0.4 280", 98], [">2000 >2000 >2000", 99]]) {
      await qc.fill("#ir-v", "500"); await qc.fill("#ir-r", readings); await qc.fill("#ir-on", d(day));
      await qc.fill("#ir-inst", "MIT-525 / CAL-701"); await qc.fill("#ir-by", "C-EI tester");
      await qc.getByRole("button", { name: "ثبت تست" }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`6.3 IR ${day}: ${e}`);
      if (day === 98) check(/رد/.test(flat(await cdet.innerText())), "the first IR is a fail, with the core named");
    }
    await tickStep(qc, cdet, "پیوستگی و توالی فاز", d(99));
    await tickStep(qc, cdet, "آماده برای برق‌دار شدن", d(100));
    check(/تست مقاومت عایق \(IR\)[^]*انجام شد/.test(flat(await cdet.innerText())), "after the second IR the IR step is done");

    at("6.4", "instrument index: FT-7001 and LT-7002");
    await open(pm, "/instrumentation", "ابزارها");
    const ins = card(pm, "ابزارها");
    await fold(ins, "ورود لیست ابزار");
    await pm.fill("#iimp", "Tag No,Service,Type,Range,Equipment,Tolerance\nFT-7001,DM water pump discharge flow,Magnetic flowmeter,0-40 m3/h,P-7001,\nLT-7002,DM water drum level,Guided wave radar,0-100 %,D-7002,");
    await ins.getByRole("button", { name: "ورود", exact: true }).click(); await settle(pm);
    const e64 = await errorOf(pm); if (e64) problems.push(`6.4: ${e64}`);
    const insText = flat(await ins.innerText());
    check(/FT-7001/.test(insText) && /LT-7002/.test(insText), "two instruments registered");

    at("6.5", "calibration, installation, hook-up, wiring, loop checks (QC)");
    await open(qc, "/instrumentation", "ابزارها");
    const qins = card(qc, "ابزارها");
    for (const [tag, pts] of [["FT-7001", "0:4.00 10:8.00 20:12.01 30:16.00 40:20.00"], ["LT-7002", "0:4.00 25:8.01 50:12.00 75:16.00 100:20.00"]]) {
      const r = qins.locator("tr", { hasText: tag }).first();
      await r.getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
      const det = r.locator("xpath=following-sibling::tr[1]");
      await qc.fill("#work-date", d(85));
      await qc.fill("#cal-p", pts); await qc.fill("#cal-ref", "Fluke 754 / CAL-702");
      await qc.getByRole("button", { name: "ثبت کالیبراسیون" }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`6.5 ${tag} cal: ${e}`);
      await tickStep(qc, det, "نصب در محل", d(95));
      await tickStep(qc, det, "هوک‌آپ", d(96));
      await tickStep(qc, det, "سیم‌بندی", d(97));
      await r.getByRole("button", { name: "بستن" }).click(); await settle(qc);
    }
    await open(qc, "/instrumentation", "لوپ‌ها");
    const loopsCard = card(qc, "لوپ‌ها");
    await qc.fill("#work-date", d(103));
    for (const [k, row] of (await loopsCard.locator("tbody tr").all()).entries()) {
      const loopNo = flat(await row.locator("td").first().innerText());
      await row.getByLabel(`شمارهٔ فرم ${loopNo}`).fill(`LC-700${k + 1}`);
      await row.getByLabel(`شاهد ${loopNo}`).fill("Client");
      await row.getByRole("button", { name: "امضای لوپ چک" }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`6.5 loop ${loopNo}: ${e}`);
    }
    check(((flat(await loopsCard.innerText())).match(/لوپ‌چک‌شده/g) || []).length === 2, "both loops checked");
    await open(qc, "/instrumentation", "ابزارها");
    for (const tag of ["FT-7001", "LT-7002"]) {
      const r = card(qc, "ابزارها").locator("tr", { hasText: tag }).first();
      await r.getByRole("button", { name: "جزئیات" }).click(); await settle(qc);
      await tickStep(qc, r.locator("xpath=following-sibling::tr[1]"), "آماده برای راه‌اندازی", d(104));
      await r.getByRole("button", { name: "بستن" }).click(); await settle(qc);
    }
    if (stop("6.5")) throw new Error("stop");
  }
  if (!skipPhase(7)) {
    // ── 7 ────────────────────────────────────────────────────────────────
    at("7.1", "pipe strain check, final alignment, both machines ready");
    await open(pm, "/equipment", "تگ‌ها");
    const p71 = await tagSteps("P-7001");
    const p71t = flat(await p71.innerText());
    check(/⚙ اتصال پایپینگ انجام شد/.test(p71t) && /⚙ ترمینیشن برق انجام شد/.test(p71t) && /⚙ نصب و تست ابزار دقیق انجام شد/.test(p71t),
      `P-7001: piping, electrical and instrument read done («${p71t.slice(0, 220)}»)`);
    await tickStep(pm, p71, "کنترل تنش لوله", d(104), "STR-7001");
    await tickStep(pm, p71, "آمادگی راه‌اندازی", d(105));
    await closeTagSteps("P-7001");
    const d71 = await tagSteps("D-7002");
    await tickStep(pm, d71, "اتصال پایپینگ", d(99), "70-DMW-7001");
    await tickStep(pm, d71, "ترمینیشن برق", d(99), "ERT-D-7002");
    await tickStep(pm, d71, "آمادگی راه‌اندازی", d(105));
    await closeTagSteps("D-7002");

    at("7.2", "MC walk-down punches (QC)");
    await open(qc, "/quality", "Punch");
    const pl = card(qc, "Punch list");
    for (const [tag, cat, desc] of [["P-7001", "A", "Coupling guard not installed"], ["D-7002", "B", "Drum nameplate photo missing in dossier"], [null, "C", "Touch-up paint at shoe SH-7002"]]) {
      await fold(pl, "ثبت Punch جدید");
      await qc.selectOption("#pf-s", { label: "70-01" });
      if (tag) await qc.selectOption("#pf-t", { label: tag });
      await qc.selectOption("#pf-c", cat);
      const ck = await qc.locator("#pf-k option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("C-MEC"))?.value);
      if (ck) await qc.selectOption("#pf-k", ck);
      await qc.fill("#pf-d", desc); await qc.fill("#pf-r", d(106)); await qc.fill("#pf-u", d(110));
      await pl.getByRole("button", { name: "ثبت", exact: true }).click(); await settle(qc);
      const e = await errorOf(qc); if (e) problems.push(`7.2 ${cat}: ${e}`);
    }
    check((flat(await pl.innerText()).match(/Coupling guard|nameplate|Touch-up/g) || []).length === 3, "three punch items");

    at("7.3", "negative: MC with a punch A open");
    await open(pm, "/completions", "ساب‌سیستم‌ها");
    const mcRow = () => card(pm, "ساب‌سیستم‌ها").locator("tr", { hasText: "70-01" }).first();
    const mc73 = flat(await mcRow().innerText());
    check(await mcRow().getByRole("button", { name: "امضای MC" }).isDisabled() && /Punch A/.test(mc73) && /Coupling guard/.test(mc73),
      `«امضای MC» is disabled and the open column names the punch A («${mc73.slice(0, 160)}»)`);

    at("7.4", "punch A cleared (EPC) and verified (QC)");
    await open(pm, "/quality", "Punch");
    await punchAct(pm, "Coupling guard not installed", "رفع شد", "Guard fitted, photo attached", d(107));
    await open(qc, "/quality", "Punch");
    await punchAct(qc, "Coupling guard not installed", "تأیید و بستن", "", d(107));
    await open(pm, "/completions", "ساب‌سیستم‌ها");
    check(/چیزی باز نیست/.test(flat(await mcRow().innerText())), "70-01: nothing open");

    at("7.5", "MC signed; the signer cannot accept; the client does");
    await mcRow().getByRole("button", { name: "امضای MC" }).click(); await settle(pm);
    const e75 = await errorOf(pm); if (e75) problems.push(`7.5 sign: ${e75}`);
    await mcRow().getByRole("button", { name: "پذیرش کارفرما" }).click(); await settle(pm);
    const e75b = await errorOf(pm);
    check(!!e75b, `the signer's acceptance is refused («${e75b.slice(0, 100)}»)`);
    await open(client, "/completions", "ساب‌سیستم‌ها");
    const cRow = card(client, "ساب‌سیستم‌ها").locator("tr", { hasText: "70-01" }).first();
    await cRow.getByRole("button", { name: "پذیرش کارفرما" }).click(); await settle(client);
    const e75c = await errorOf(client); if (e75c) problems.push(`7.5 accept: ${e75c}`);
    check(/پذیرفته/.test(flat(await cRow.innerText())), "70-01: MC accepted by the client");
    if (stop("7.5")) throw new Error("stop");
  }
  if (!skipPhase(8)) {
    // ── 8 ────────────────────────────────────────────────────────────────
    at("8.1", "pre-commissioning checklists and commissioning procedures");
    await open(pm, "/precom", "چک‌لیست‌ها و روال‌ها");
    const tpl = card(pm, "چک‌لیست‌ها و روال‌های راه‌اندازی پروژه");
    for (const [code, title, applies, phase, criteria] of [
      ["B-PIP-01", "Line flushing with DM water & reinstatement", "line", "precom", "Clear water at outlet, no debris on temporary strainer"],
      ["B-ROT-01", "Motor solo run & rotation check", "rotating", "precom", "Rotation per arrow; vibration < 2.8 mm/s"],
      ["C-ROT-01", "Pump run test on DM water, 4 h", "rotating", "commissioning", "Flow ≥ 30 m³/h at rated head; bearing temp < 80 °C"],
      ["C-SUB-01", "Drum level control in automatic", "subsystem", "commissioning", "LT-7002 holds 50 % ± 5 % for 30 min"],
    ]) {
      await fold(tpl, "چک‌لیست جدید");
      await pm.fill("#t-code", code); await pm.fill("#t-title", title);
      await pm.selectOption("#t-ph", phase); await pm.selectOption("#t-app", applies); await pm.fill("#t-cr", criteria);
      await tpl.getByRole("button", { name: "ذخیرهٔ چک‌لیست" }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`8.1 ${code}: ${e}`);
    }
    const tplText = flat(await tpl.innerText());
    check(["B-PIP-01", "B-ROT-01", "C-ROT-01", "C-SUB-01"].every((c) => tplText.includes(c)), "four templates registered");

    at("8.2", "negative: a commissioning procedure before RFC (QC)");
    await open(qc, "/precom", "ساب‌سیستم‌ها");
    const qpanel = await precomPanel(qc);
    const c82 = qpanel.locator("tr", { hasText: "C-ROT-01" }).first();
    check(!(await c82.getByRole("button", { name: "ثبت" }).count()) && /پس از پذیرش RFC ثبت می‌شود/.test(flat(await qpanel.innerText())),
      "commissioning rows have no «ثبت» and say «پس از پذیرش RFC ثبت می‌شود»");

    at("8.3", "flushing; a failed then a passed motor solo run; client accepts (QC, client)");
    await attempt(qc, qpanel, "B-PIP-01", "pass", d(109), "Client", "");
    await attempt(qc, qpanel, "B-ROT-01", "fail", d(109), "Client", "Reverse rotation — phases swapped at MCC");
    await attempt(qc, qpanel, "B-ROT-01", "pass", d(110), "Client", "");
    check(/2 بار/.test(flat(await qpanel.locator("tr", { hasText: "B-ROT-01" }).first().innerText())), "B-ROT-01 keeps both attempts");
    await open(client, "/precom", "ساب‌سیستم‌ها");
    const cpanel = await precomPanel(client);
    for (const code of ["B-PIP-01", "B-ROT-01"]) {
      await cpanel.locator("tr", { hasText: code }).first().getByRole("button", { name: "پذیرش" }).click(); await settle(client);
      const e = await errorOf(client); if (e) problems.push(`8.3 accept ${code}: ${e}`);
    }

    at("8.4", "RFC signed (EPC), accepted (client)");
    await open(pm, "/precom", "ساب‌سیستم‌ها");
    const ppanel = await precomPanel(pm);
    await ppanel.getByRole("button", { name: "امضای RFC" }).click(); await settle(pm);
    const e84 = await errorOf(pm); if (e84) problems.push(`8.4 sign: ${e84}`);
    await open(client, "/precom", "ساب‌سیستم‌ها");
    await (await precomPanel(client)).getByRole("button", { name: "پذیرش RFC (کارفرما)" }).click(); await settle(client);
    const e84b = await errorOf(client); if (e84b) problems.push(`8.4 accept: ${e84b}`);

    at("8.5", "pump run test and drum level control (QC); client accepts");
    await open(qc, "/precom", "ساب‌سیستم‌ها");
    const qp5 = await precomPanel(qc);
    await attempt(qc, qp5, "C-ROT-01", "pass", d(114), "Client", "Flow 32 m³/h, bearing 61 °C");
    await attempt(qc, qp5, "C-SUB-01", "pass", d(115), "Client", "");
    await open(client, "/precom", "ساب‌سیستم‌ها");
    const cp5 = await precomPanel(client);
    for (const code of ["C-ROT-01", "C-SUB-01"]) {
      await cp5.locator("tr", { hasText: code }).first().getByRole("button", { name: "پذیرش" }).click(); await settle(client);
      const e = await errorOf(client); if (e) problems.push(`8.5 accept ${code}: ${e}`);
    }

    at("8.6", "negative: RFSU with punch B open — the refusal names it");
    await open(pm, "/precom", "ساب‌سیستم‌ها");
    const pp6 = flat(await (await precomPanel(pm)).innerText());
    check(/RFSU — باز: Punch A\/B باز \(1\): [^،]*Drum nameplate photo missing in dossier/.test(pp6), `RFSU is held by the named punch B («${(pp6.match(/RFSU — باز:.*$/) || [""])[0].slice(0, 140)}»)`);

    at("8.7", "punch B closed; RFSU signed and accepted");
    await open(pm, "/quality", "Punch");
    await punchAct(pm, "Drum nameplate photo missing", "رفع شد", "Photo added to dossier", d(116));
    await open(qc, "/quality", "Punch");
    await punchAct(qc, "Drum nameplate photo missing", "تأیید و بستن", "", d(116));
    await open(pm, "/precom", "ساب‌سیستم‌ها");
    await (await precomPanel(pm)).getByRole("button", { name: "امضای RFSU" }).click(); await settle(pm);
    const e87 = await errorOf(pm); if (e87) problems.push(`8.7 sign: ${e87}`);
    await open(client, "/precom", "ساب‌سیستم‌ها");
    await (await precomPanel(client)).getByRole("button", { name: "پذیرش RFSU (کارفرما)" }).click(); await settle(client);
    const e87b = await errorOf(client); if (e87b) problems.push(`8.7 accept: ${e87b}`);
    check(/RFSU — امضا:.*پذیرش:/.test(flat(await (await precomPanel(client)).innerText())), "70-01: RFSU signed and accepted");
    if (stop("8.7")) throw new Error("stop");
  }
  if (!skipPhase(9)) {
    // ── 9 ────────────────────────────────────────────────────────────────
    at("9.0", "vendor O&M manual (IOM) for the pump");
    await open(pm, "/procurement");
    const po9 = await poDetail("PO-7001");
    const vf = po9.locator("form", { has: pm.locator("b", { hasText: "مدرک فروشنده (VDRL)" }) });
    await vf.locator("input[id^=dk-]").fill("IOM"); await vf.locator("input[id^=dt-]").fill("Operation and maintenance manual"); await vf.locator("input[id^=dd-]").fill(d(110));
    await vf.getByRole("button", { name: "افزودن مدرک" }).click(); await settle(pm);
    const iom = () => po9.locator("tr", { has: pm.locator("td", { hasText: /^IOM$/ }) }).first();
    await iom().locator("input[id^=dr-]").fill("0"); await iom().locator("input[id^=ds-]").fill(d(105));
    await iom().getByRole("button", { name: "ارسال شد" }).click(); await settle(pm);
    await iom().locator("select[id^=dc-]").selectOption("1"); await iom().locator("input[id^=do-]").fill(d(108));
    await iom().getByRole("button", { name: "برگشت" }).click(); await settle(pm);
    const e90 = await errorOf(pm); if (e90) problems.push(`9.0: ${e90}`);
    check(/پذیرفته/.test(flat(await iom().innerText())), "IOM accepted (code 1)");

    at("9.1", "asset master: the pump from its datasheet, the drum as far as known");
    await open(pm, "/handover", "شناسنامهٔ تجهیزات");
    const am = card(pm, "شناسنامهٔ نگهداری تجهیزات");
    const amRow = (tag) => am.locator("tr", { has: pm.locator("td a", { hasText: new RegExp(`^${tag}$`) }) }).first();
    await amRow("P-7001").getByRole("button", { name: "ویرایش" }).click(); await settle(pm);
    const pf = amRow("P-7001").locator("xpath=following-sibling::tr[1]");
    await pf.locator("select[id^=ic-]").selectOption("PU"); await pf.locator("select[id^=cr-]").selectOption("A");
    await pf.locator("input[id^=cb-]").fill("CA-DMW-01 (boiler feed make-up, single pump)");
    await pf.locator("input[id^=mf-]").fill("Pump Maker A"); await pf.locator("input[id^=md-]").fill("ISO 2858 end-suction 50-32-200");
    await pf.locator("input[id^=sn-]").fill("PMA-24-7001"); await pf.locator("input[id^=yb-]").fill("2026");
    const dsv = await pf.locator("select[id^=ds-] option").evaluateAll((os) => os.find((o) => /DMW-DS-P-7001/.test(o.textContent) && /0/.test(o.textContent))?.value);
    if (dsv) await pf.locator("select[id^=ds-]").selectOption(dsv); else problems.push("9.1: the pump datasheet DMW-DS-P-7001 Rev.0 is not offered");
    await pf.locator("input[id^=dp-]").fill("16"); await pf.locator("input[id^=tmin-]").fill("5"); await pf.locator("input[id^=tmax-]").fill("60");
    await pf.getByRole("button", { name: "ذخیره", exact: true }).click(); await settle(pm);
    const e91 = await errorOf(pm); if (e91) problems.push(`9.1 P-7001: ${e91}`);
    for (const [label, dcs, hist, uom] of [["Discharge flow", "70FT7001.PV", "DMW:70FT7001.PV", "m3/h"], ["Run status", "P7001_RUN.STS", "", ""]]) {
      await pf.locator("input[id^=pl-]").fill(label); await pf.locator("input[id^=pd-]").fill(dcs);
      await pf.locator("input[id^=ph-]").fill(hist); await pf.locator("input[id^=pu-]").fill(uom);
      await pf.getByRole("button", { name: "افزودن" }).click(); await settle(pm);
      const e = await errorOf(pm); if (e) problems.push(`9.1 DCS ${label}: ${e}`);
    }
    await amRow("P-7001").getByRole("button", { name: "بستن" }).click(); await settle(pm);
    await amRow("D-7002").getByRole("button", { name: "ویرایش" }).click(); await settle(pm);
    const df = amRow("D-7002").locator("xpath=following-sibling::tr[1]");
    await df.locator("select[id^=ic-]").selectOption("VE"); await df.locator("select[id^=cr-]").selectOption("B");
    await df.locator("input[id^=cb-]").fill("CA-DMW-01"); await df.locator("input[id^=mf-]").fill("Local fabricator");
    await df.getByRole("button", { name: "ذخیره", exact: true }).click(); await settle(pm);
    const e91b = await errorOf(pm); if (e91b) problems.push(`9.1 D-7002: ${e91b}`);
    await amRow("D-7002").getByRole("button", { name: "بستن" }).click(); await settle(pm);
    const pRow = flat(await amRow("P-7001").innerText());
    check(/16 barg/.test(pRow) && /DCS\/Historian: 2/.test(pRow) && /DMW-70-P-7001/.test(pRow), `P-7001: design conditions, 2 DCS points, FLOC DMW-70-P-7001 («${pRow.slice(0, 160)}»)`);

    at("9.2", "PM plan (drafted by EPC, approved by the client) and a spare part");
    await open(pm, "/handover", "برنامهٔ PM");
    await fold(pm.locator("main"), "تسک نگهداری جدید");
    const pmTag = await pm.locator("#pm-tag option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("P-7001"))?.value);
    await pm.selectOption("#pm-tag", pmTag);
    await pm.fill("#pm-code", "PM-01"); await pm.fill("#pm-title", "Bearing lubrication"); await pm.selectOption("#pm-strategy", "time_based");
    await pm.fill("#pm-iv", "3"); await pm.selectOption("#pm-unit", "month"); await pm.selectOption("#pm-craft", "mechanical");
    await pm.fill("#pm-dur", "1"); await pm.selectOption("#pm-src", "oem"); await pm.fill("#pm-ref", "IOM PMA §6.2");
    await pm.getByRole("button", { name: "ذخیره به‌عنوان پیش‌نویس" }).click(); await settle(pm);
    const e92 = await errorOf(pm); if (e92) problems.push(`9.2 PM draft: ${e92}`);
    check(!(await card(pm, "برنامهٔ نگهداری (PM)").locator("tr", { hasText: "PM-01" }).first().getByRole("button", { name: "تأیید" }).count()),
      "the preparer is offered no «تأیید»");
    await open(client, "/handover", "برنامهٔ PM");
    await card(client, "برنامهٔ نگهداری (PM)").locator("tr", { hasText: "PM-01" }).first().getByRole("button", { name: "تأیید" }).click(); await settle(client);
    const e92b = await errorOf(client); if (e92b) problems.push(`9.2 PM approve: ${e92b}`);
    await open(pm, "/handover", "قطعات یدکی");
    const spc = card(pm, "قطعات یدکی (SPIR)");
    await fold(pm.locator("main"), "ثبت قطعهٔ یدکی");
    const spTag = await pm.locator("#sp-tag option").evaluateAll((os) => os.find((o) => o.textContent.startsWith("P-7001"))?.value);
    await pm.selectOption("#sp-tag", spTag); await pm.fill("#sp-no", "MS-50-PMA"); await pm.fill("#sp-mf", "Pump Maker A");
    await pm.fill("#sp-desc", "Mechanical seal cartridge"); await pm.selectOption("#sp-cat", "commissioning"); await pm.fill("#sp-uom", "EA");
    await pm.fill("#sp-inst", "1"); await pm.fill("#sp-rec", "1"); await pm.fill("#sp-app", "1"); await pm.fill("#sp-ref", "SPIR-P-7001");
    await pm.locator("form", { has: pm.locator("#sp-no") }).getByRole("button", { name: "ذخیره", exact: true }).click(); await settle(pm);
    const e92c = await errorOf(pm); if (e92c) problems.push(`9.2 spare: ${e92c}`);
    check(/MS-50-PMA/.test(flat(await spc.innerText())), "the seal is on the pump's SPIR");

    at("9.3", "CMMS export");
    await open(pm, "/handover", "شناسنامهٔ تجهیزات");
    const csv = await pm.evaluate(async () => (await fetch([...document.querySelectorAll("a")].find((a) => a.textContent.includes("خروجی CSV (همه)"))?.href || "")).text()).catch(() => "");
    const pLine = csv.split("\n").find((l) => l.includes("P-7001")) || "", dLine = csv.split("\n").find((l) => l.includes("D-7002")) || "";
    check(/DMW-70-P-7001/.test(pLine) && /"yes"/.test(pLine), `P-7001: DMW-70-P-7001, ready = yes («${pLine.slice(0, 120)}»)`);
    check(/"no"/.test(dLine), `D-7002: ready = no, and says why («${dLine.slice(0, 160)}»)`);

    at("9.4", "performance guarantee PG-01 and test PT-7001");
    await open(pm, "/precom", "تضمین‌های عملکرد");
    const gc = card(pm, "تضمین‌های عملکرد");
    await fold(gc, "تضمین جدید");
    await pm.fill("#gu-code", "PG-01"); await pm.fill("#gu-par", "DM water transfer capacity at rated head");
    const u70 = await pm.locator("#gu-unit option").evaluateAll((os) => os.find((o) => /70/.test(o.textContent))?.value);
    if (u70) await pm.selectOption("#gu-unit", u70);
    await pm.selectOption("#gu-dir", "min"); await pm.fill("#gu-val", "30"); await pm.fill("#gu-uom", "m3/h"); await pm.fill("#gu-dur", "4");
    await pm.fill("#gu-basis", "PO-7001 Annex B §2");
    await gc.getByRole("button", { name: "ذخیرهٔ تضمین" }).click(); await settle(pm);
    const e94 = await errorOf(pm); if (e94) problems.push(`9.4 guarantee: ${e94}`);
    await open(pm, "/precom", "آزمون عملکرد");
    const tc = card(pm, "آزمون عملکرد (Performance Test)");
    await fold(tc, "ثبت آزمون");
    await pm.fill("#pt-no2", "PT-7001");
    const tu = await pm.locator("#pt-unit option").evaluateAll((os) => os.find((o) => /واحد 70/.test(o.textContent))?.value);
    if (tu) await pm.selectOption("#pt-unit", tu);
    await pm.fill("#pt-from2", `${d(120)}T08:00`); await pm.fill("#pt-to2", `${d(120)}T14:00`); await pm.fill("#pt-note", "After RFSU");
    await tc.getByRole("button", { name: "ثبت آزمون", exact: true }).click(); await settle(pm);
    const e94b = await errorOf(pm); if (e94b) problems.push(`9.4 test: ${e94b}`);
    const tcard = tc.locator(".card", { hasText: "PT-7001" }).first();
    await tcard.locator("input[id^=pr-m-]").fill("32"); await tcard.locator("input[id^=pr-x-]").fill("Magflow FT-7001 average");
    await tcard.getByRole("button", { name: "ثبت نتیجه" }).click(); await settle(pm);
    await tcard.getByRole("button", { name: "امضای آزمون" }).click(); await settle(pm);
    const e94c = await errorOf(pm); if (e94c) problems.push(`9.4 sign: ${e94c}`);
    await open(client, "/precom", "آزمون عملکرد");
    const ctc = card(client, "آزمون عملکرد (Performance Test)").locator(".card", { hasText: "PT-7001" }).first();
    await ctc.getByRole("button", { name: "پذیرش (کارفرما)" }).click(); await settle(client);
    const e94d = await errorOf(client); if (e94d) problems.push(`9.4 accept: ${e94d}`);
    const pt = flat(await ctc.innerText());
    check(/پذیرفته/.test(pt) && /PG-01.*32.*برآورده/.test(pt), `PT-7001 accepted; PG-01 met at 32 («${pt.slice(0, 160)}»)`);
  }
} catch (e) {
  if (e.message !== "stop") { problems.push(`${step}: ${e.message.split("\n")[0]}`); for (const [who, p] of [["pm", pm], ["qc", qc], ["client", client]]) await p.screenshot({ path: `${SHOT}/scenario-ui-${step}-${who}.png`, fullPage: true }).catch(() => {}); }
}
console.log("\nproblems:", problems.length ? problems : "none");
await b.close();
process.exit(problems.length ? 1 : 0);
