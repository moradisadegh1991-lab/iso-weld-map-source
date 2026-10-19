/**
 * Drive the HSE section in English and Arabic (owner's requirements of
 * 2026-10-18, item 17) on the DM-pump scenario played to the end. A person
 * with a card, a scaffold with an inspection, a JSA with a step, a permit, an
 * incident, an observation and a day's hours are made through the API in
 * Latin names, so the project's data is not taken for the page's words; then
 * every tab of /hse — with the incident's details and the gas-test form
 * open — is read in English and in Arabic. A word of Persian of the page's
 * own fails it; so does a page error. Rates, dates and states are checked to
 * be written the reader's way.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-hse.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
const page = await (await b.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
const setLang = async (lang) => {
  await api("/api/auth/prefs", { lang });
  await page.evaluate((l) => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: l })), lang);
};
const projectId = (await api("/api/auth/me")).projects.find((p) => p.code === "DMW").id;
// the pages read the project picked in the top bar: the DM-pump one
await page.locator(".topbar select").selectOption(`p:${projectId}`); await page.waitForTimeout(500);
const run = Date.now().toString(36).slice(-4).toUpperCase();
const soft = { timeout: 3000 };   // a click on something a tab may not show: try, do not wait long
const today = new Date().toISOString().slice(0, 10);
const post = (body) => api("/api/hse", { projectId, ...body });

// Latin-named records, so every tab has rows and every panel opens
const person = (await post({ kind: "person", idNo: `ID-${run}`, fullName: `John Smith ${run}`, trade: "Rigger" })).result
  ?? (await api(`/api/hse?projectId=${projectId}`)).safeWork.people.find((p) => p.id_no === `ID-${run}`);
const personId = person.id;
await post({ kind: "card", personId, cardKind: "scaffold_inspector", certNo: `C-${run}`, issuer: "Acme", issuedOn: "2026-01-01", expiresOn: "2027-12-31" });
await post({ kind: "card", personId, cardKind: "induction", certNo: `I-${run}`, issuer: "Acme", issuedOn: "2026-01-01", noExpiry: true });
await post({ kind: "equipment", equipmentKind: "scaffold", refNo: `SC-${run}`, area: "Area 10" });
const board = await api(`/api/hse?projectId=${projectId}`);
const eq = board.safeWork.equipment.find((e) => e.ref_no === `SC-${run}`);
await post({ kind: "equipment-inspect", equipmentId: eq.id, inspectedOn: today, result: "pass", inspectorId: personId, certRef: `T-${run}` }).catch((e) => console.log("note:", e.message));
await post({ kind: "jsa", jsaNo: `JSA-${run}`, revision: "0", title: "Pump lifting", area: "Area 10" });
const jsa = (await api(`/api/hse?projectId=${projectId}`)).safeWork.jsas.find((j) => j.jsa_no === `JSA-${run}`);
await post({ kind: "jsa-step", jsaId: jsa.id, seq: "10", step: "Rig the pump", hazard: "Dropped load", controls: "Exclusion zone", likelihood: "3", severity: "4", residualLikelihood: "1", residualSeverity: "4" });
const from = new Date(), to = new Date(Date.now() + 6 * 3600_000);
await post({ kind: "permit", permitNo: `PTW-${run}`, type: "hot", area: "Area 10", description: "Welding of a nozzle", validFrom: from.toISOString(), validTo: to.toISOString(), crew: [personId] });
await post({ kind: "incident", refNo: `INC-${run}`, occurredAt: from.toISOString(), area: "Area 10", description: "Hand cut", injured: "true", fatal: "false", daysAway: "0", restrictedDays: "0", treatment: "first_aid" });
await post({ kind: "observation", observedOn: today, obsKind: "unsafe_condition", severity: "high", area: "Area 10", description: "Open trench", action: "Barricade", dueOn: today });
await post({ kind: "manhours", workDate: today, hours: "160", headcount: "20" });

// the page's own words: headings, labels, buttons, notes, pills — not the cells of the project's data
const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2, .page h3, .page legend, .page th, .page label, .page button, .page summary, .page .empty-note,"
    + " .page .pagehead .sub, .page p.muted, .page .pill, .page .kpi .l, .page .kpi .b, .page [role=tab], .page option, .page td p.sm";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ONLY = /[پچژگیک]/;
// the scenario's own records (names, areas, descriptions) and the server's reasons are data, not the page's words
const data = await page.evaluate(async (pid) => {
  const b = await fetch(`/api/hse?projectId=${pid}`).then((r) => r.json());
  const sw = b.safeWork;
  return [
    ...b.contractors.map((c) => c.name), ...b.incidents.flatMap((i) => [i.description, i.area, i.clsReason]),
    ...b.permits.flatMap((p) => [p.area, p.description, p.requester_name, p.issued_by_name, p.gasVerdict?.reason, ...(p.gasVerdict?.failures || []),
      ...(p.readiness?.reasons || []), ...(p.readiness?.notes || []), ...p.crew.map((c) => c.name), p.jsa?.title]),
    ...b.observations.flatMap((o) => [o.description, o.action, o.area, o.closed_note]),
    ...sw.people.flatMap((p) => [p.full_name, p.trade, ...p.cards.flatMap((c) => [c.issuer, c.revokedReason])]),
    ...sw.equipment.flatMap((e) => [e.area, e.description, e.last?.inspector_name, e.last?.findings]),
    ...sw.jsas.flatMap((j) => [j.title, j.area, j.prepared_by_name, j.approved_by_name, ...j.problems, ...j.steps.flatMap((x) => [x.step, x.hazard, x.controls])]),
  ].filter((x) => typeof x === "string" && /[؀-ۿ]/.test(x));
}, projectId);
const unData = (w) => data.reduce((x, d) => x.split(d).join(""), w);
const leftIn = async (rx, where) => (await chrome()).filter((w) => rx.test(unData(w))).map((w) => `${where}: ${w}`);

for (const [lang, rx] of [["en", PERSIAN], ["ar", PERSIAN_ONLY]]) {
  await setLang(lang);
  await page.goto(`${BASE}/hse`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const left = [];
  const tabs = page.locator(".page [role=tab]");
  const n = await tabs.count();
  let seen = { permit: false, incident: false, card: false };
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click(); await page.waitForTimeout(500);
    const permit = page.locator("tr", { hasText: `PTW-${run}` }).first();
    if (await permit.isVisible().catch(() => false)) {
      seen.permit = true;
      await permit.locator("button", { hasText: /Gas test|اختبار الغاز/ }).first().click(soft).catch(() => {});
    }
    const inc = page.locator("tr", { hasText: `INC-${run}` }).first();
    if (await inc.isVisible().catch(() => false)) {
      seen.incident = true;
      await inc.locator("button").first().click(soft).catch(() => {});
    }
    if (await page.locator("tr", { hasText: `John Smith ${run}` }).first().isVisible().catch(() => false)) seen.card = true;
    await page.locator("summary").evaluateAll((s) => s.forEach((x) => x.click())).catch(() => {});   // every fold open
    await page.waitForTimeout(400);
    left.push(...await leftIn(rx, `hse tab ${i + 1}`));
  }
  check(n >= 8, `${lang} /hse has its tabs (${n})`);
  check(seen.permit && seen.incident && seen.card, `${lang} the new permit, incident and person were seen (${JSON.stringify(seen)})`);
  check(left.length === 0, `${lang} /hse, every tab: Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
  await page.screenshot({ path: `${SHOT}/43${lang === "en" ? 0 : 1}-hse-${lang}.png` });
}

// numbers, dates and states written the reader's way
await setLang("en");
await page.goto(`${BASE}/hse`, { waitUntil: "networkidle" });
const kpis = (await page.locator(".kpis").innerText()).replace(/\s+/g, " ");
check(/per 1,000,000 man-hours \(IOGP\)/.test(kpis) && !PERSIAN.test(kpis), `English KPIs with a Latin base (${kpis.slice(0, 120)})`);
const cardTab = page.locator(".page [role=tab]", { hasText: "People and competence cards" });
await cardTab.click(soft).catch(() => {});
const personRow = (await page.locator("tr", { hasText: `ID-${run}` }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
check(/Valid until 31\/12\/2027/.test(personRow) && /Valid — no expiry/.test(personRow), `card states in English with the date the reader's way (${personRow.slice(0, 120)})`);
await setLang("fa");
await page.goto(`${BASE}/hse`, { waitUntil: "networkidle" });
const kpisFa = await page.locator(".kpis").innerText();
check(/۱٬۰۰۰٬۰۰۰/.test(kpisFa), "Persian writes the base in Persian digits");
await page.locator(".page [role=tab]", { hasText: "افراد و کارت صلاحیت" }).click(soft).catch(() => {});
const personFa = await page.locator("tr", { hasText: `ID-${run}` }).first().innerText().catch(() => "");
check(/معتبر تا ۱۴۰[۰-۹]\/[۰-۹]{1,2}\/[۰-۹]{1,2}/.test(personFa), "…and the card's date in the Persian calendar");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
