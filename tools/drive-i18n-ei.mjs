/**
 * Drive the electrical and instrumentation pages in English and Arabic
 * (owner's requirements of 2026-10-18, item 17) on the DM-pump scenario
 * played to the end. A cable, two instruments in one loop and an IR test are
 * made through the API in Latin names; then both pages — with the cable's and
 * the instrument's details open — are read in English and in Arabic, every
 * tab. A word of Persian of the page's own fails it; so does a page error.
 * Chain steps, ISA types and the loop's state are checked to be the reader's.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-ei.mjs
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
const soft = { timeout: 3000 };
// an ISA tag has digits after its letters, so the instruments are numbered
const num = String(Date.now()).slice(-5);
const cableNo = `EC-I${run}`, tagA = `PT-9${num}A`, tagB = `PT-9${num}B`, loopNo = `9${num}`;

await api("/api/electrical", { projectId, kind: "import",
  text: `Cable No,From,To,Cable Type,Voltage,Length (m)\n${cableNo},MCC-12,P-I${run},3Cx35 XLPE/SWA,0.6/1kV,85` });
const el = await api(`/api/electrical?projectId=${projectId}`);
const cable = el.cables.find((c) => c.cableNo === cableNo);
await api("/api/electrical", { projectId, kind: "ir", cableId: cable.id, testVoltageV: "1000", readings: "500 600 700", testedOn: new Date().toISOString().slice(0, 10) }).catch((e) => console.log("note:", e.message));
await api("/api/instrumentation", { projectId, kind: "import",
  text: `Tag No,Service,Type,Range,Loop\n${tagA},Pump discharge,Smart transmitter,0-25 bar,${loopNo}\n${tagB},Pump suction,Smart transmitter,0-10 bar,${loopNo}` });

const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2, .page h3, .page legend, .page th, .page label, .page button, .page summary, .page .empty-note,"
    + " .page .pagehead .sub, .page p.muted, .page .pill, .page [role=tab], .page option, .page .card > span.sm, .page .hint, .page input[placeholder]";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => (n.tagName === "INPUT" ? n.placeholder : (n.innerText || n.textContent || "")).replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ONLY = /[پچژگیک]/;
// the project's own records and the server's notes (a step's reason, the IR rule's citation) are data
const data = await page.evaluate(async (pid) => {
  const get = (p) => fetch(p).then((r) => r.json());
  const [el, ins] = await Promise.all([get(`/api/electrical?projectId=${pid}`), get(`/api/instrumentation?projectId=${pid}`)]);
  return [
    ...el.cables.flatMap((c) => [c.from, c.to, c.spec, c.ir.note?.text]),
    ...ins.instruments.flatMap((i) => [i.service, i.calibration.note?.text, i.range]),
  ].filter((x) => typeof x === "string" && /[؀-ۿ]/.test(x));
}, projectId);
const notes = [];
const unData = (w) => [...data, ...notes].reduce((x, d) => x.split(d).join(""), w);
const leftIn = async (rx, where) => (await chrome()).filter((w) => rx.test(unData(w))).map((w) => `${where}: ${w}`);

for (const [lang, rx] of [["en", PERSIAN], ["ar", PERSIAN_ONLY]]) {
  await setLang(lang);
  for (const [path, rowText] of [["/electrical", cableNo], ["/instrumentation", tagA]]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const tabs = page.locator(".page [role=tab]");
    const n = Math.max(await tabs.count(), 1);
    const left = [];
    let opened = false;
    for (let i = 0; i < n; i++) {
      if (await tabs.count()) { await tabs.nth(i).click(); await page.waitForTimeout(400); }
      await page.locator("input.search").first().fill(rowText, soft).catch(() => {});
      await page.waitForTimeout(300);
      const row = page.locator("tr", { hasText: rowText }).first();
      if (await row.isVisible().catch(() => false)) {
        await row.locator("button").last().click(soft).catch(() => {});
        await page.waitForTimeout(900);
        opened = opened || await page.locator("td > div > div.card").count() > 0;
        notes.push(...await page.locator(".card .card span.sm.err, .card .card span.sm.muted + span.sm").allInnerTexts().catch(() => []));
        notes.push(...await page.locator("td .card p.muted.sm").allInnerTexts().catch(() => []));
      }
      await page.locator("summary").evaluateAll((s) => s.forEach((x) => x.click())).catch(() => {});
      await page.waitForTimeout(300);
      left.push(...await leftIn(rx, `${path} tab ${i + 1}`));
    }
    check(opened, `${lang} ${path}: the new ${path === "/electrical" ? "cable's" : "instrument's"} details opened`);
    check(left.length === 0, `${lang} ${path}, every tab: Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
    await page.screenshot({ path: `${SHOT}/45${lang === "en" ? 0 : 1}-${path.slice(1)}-${lang}.png` });
  }
}

// the reader's words in the lists and the opened chains
await setLang("en");
await page.goto(`${BASE}/instrumentation`, { waitUntil: "networkidle" });
await page.locator("input.search").first().fill(tagA, soft).catch(() => {});
const iRow = (await page.locator("tr", { hasText: tagA }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
check(/Transmitter/.test(iRow) && !PERSIAN.test(iRow), `the instrument's ISA type in English (${iRow.slice(0, 110)})`);
await page.locator("tr", { hasText: tagA }).first().locator("button").last().click(soft).catch(() => {});
await page.waitForTimeout(900);
const steps = (await page.locator(".card .card b").allInnerTexts()).join(" | ");
check(steps.length > 10 && !PERSIAN.test(steps), `the instrument's chain steps in English (${steps.slice(0, 110)})`);
await page.goto(`${BASE}/electrical`, { waitUntil: "networkidle" });
await page.locator("input.search").first().fill(cableNo, soft).catch(() => {});
await page.locator("tr", { hasText: cableNo }).first().locator("button").last().click(soft).catch(() => {});
await page.waitForTimeout(900);
const cSteps = (await page.locator(".card .card b").allInnerTexts()).join(" | ");
check(cSteps.length > 10 && !PERSIAN.test(cSteps), `the cable's chain steps in English (${cSteps.slice(0, 110)})`);
await setLang("fa");
await page.goto(`${BASE}/instrumentation`, { waitUntil: "networkidle" });
await page.locator("input.search").first().fill(tagA, soft).catch(() => {});
const iFa = await page.locator("tr", { hasText: tagA }).first().innerText().catch(() => "");
check(/ترانسمیتر/.test(iFa), "…and in Persian as before");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
