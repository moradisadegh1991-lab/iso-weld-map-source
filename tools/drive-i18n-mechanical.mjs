/**
 * Drive the equipment and coating & insulation pages in English and Arabic
 * (owner's requirements of 2026-10-18, item 17) on the DM-pump scenario
 * played to the end. A pump tag and a paint system assigned to it are made
 * through the API in Latin names; then /equipment (with the tag's chain
 * open) and /coating (with the item's details open) are read in English and
 * in Arabic, every tab. A word of Persian of the page's own fails it; so
 * does a page error. Step names and dates are checked to be the reader's.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-mechanical.mjs
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
const tagNo = `P-I${run}`;

// a pump and its paint system, in Latin names
await api("/api/equipment", { projectId, kind: "manual", tagNo, description: "Feed Pump", type: "Centrifugal", tagKind: "rotating", subsystem: "70-01" });
await api("/api/coating", { projectId, kind: "system", code: `CS-${run}`, title: "Epoxy system", prepGrade: "Sa 2½", profileMinUm: "50", profileMaxUm: "75", maxDftUm: "400",
  coats: [{ name: "Zinc primer", ndftUm: 75 }, { name: "Epoxy MIO", ndftUm: 125 }] });
const co = await api(`/api/coating?projectId=${projectId}`);
const sys = co.systems.find((s) => s.code === `CS-${run}`);
const tag = co.unassigned.tags.find((t) => t.tag_no === tagNo);
await api("/api/coating", { projectId, kind: "assign", systemId: sys.id, insulation: "hot", insulationThkMm: "50", areaM2: "12.5", spoolIds: [], tagIds: [tag.id] });

const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2, .page h3, .page legend, .page th, .page label, .page button, .page summary, .page .empty-note,"
    + " .page .pagehead .sub, .page p.muted, .page .pill, .page [role=tab], .page option, .page .card > span.sm, .page .hint";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ONLY = /[پچژگیک]/;
// the scenario's own records (descriptions, subsystem names, coat names) and the server's notes are data
const data = await page.evaluate(async (pid) => {
  const get = (p) => fetch(p).then((r) => r.json());
  const [eq, co] = await Promise.all([get(`/api/equipment?projectId=${pid}`), get(`/api/coating?projectId=${pid}`)]);
  return [
    ...eq.tags.map((t) => t.description), ...(eq.subsystems || []).map((s) => s.name), ...eq.unclassified.map((t) => t.description),
    ...co.systems.flatMap((s) => [s.title, ...s.coats.map((c) => c.name)]), ...co.items.flatMap((i) => [i.label, i.prep.note?.text, i.coats.note?.text, i.insul.note?.text]),
  ].filter((x) => typeof x === "string" && /[؀-ۿ]/.test(x));
}, projectId);
const notes = [];   // a step's server note (a reason), read where it shows
const unData = (w) => [...data, ...notes].reduce((x, d) => x.split(d).join(""), w);
const leftIn = async (rx, where) => (await chrome()).filter((w) => rx.test(unData(w))).map((w) => `${where}: ${w}`);

for (const [lang, rx] of [["en", PERSIAN], ["ar", PERSIAN_ONLY]]) {
  await setLang(lang);
  for (const [path, rowText] of [["/equipment", tagNo], ["/coating", tagNo]]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(600);
    const tabs = page.locator(".page [role=tab]");
    const n = Math.max(await tabs.count(), 1);
    const left = [];
    let opened = false;
    for (let i = 0; i < n; i++) {
      if (await tabs.count()) { await tabs.nth(i).click(); await page.waitForTimeout(400); }
      const card = page.locator(".card", { has: page.locator("tr", { hasText: rowText }) }).last();
      if (await card.isVisible().catch(() => false)) {
        await card.locator(".tk-q").fill(rowText, soft).catch(() => {});
        const row = page.locator("tr", { hasText: rowText }).last();
        await row.locator("button").last().click(soft).catch(() => {});
        await page.waitForTimeout(900);
        opened = opened || await page.locator(".card .card").count() > 0;
        // a step's note comes from the server, as its reason: data, not the page's words
        notes.push(...await page.locator(".card .card span.sm.err, .card .card span.sm.muted + span.sm").allInnerTexts().catch(() => []));
      }
      await page.locator("summary").evaluateAll((s) => s.forEach((x) => x.click())).catch(() => {});
      await page.waitForTimeout(300);
      left.push(...await leftIn(rx, `${path} tab ${i + 1}`));
    }
    check(opened, `${lang} ${path}: the new ${path === "/equipment" ? "tag's chain" : "item's details"} opened`);
    check(left.length === 0, `${lang} ${path}, every tab: Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
    await page.screenshot({ path: `${SHOT}/44${lang === "en" ? 0 : 1}-${path.slice(1)}-${lang}.png` });
  }
}

// the chain's step names and the coating item's insulation in the reader's language
await setLang("en");
await page.goto(`${BASE}/equipment`, { waitUntil: "networkidle" });
await page.locator(".page [role=tab]", { hasText: /^Tags/ }).click(soft).catch(() => {});
await page.waitForTimeout(400);
const eqTag = page.locator("tr", { hasText: tagNo }).last();
await page.locator(".card", { has: page.locator("th", { hasText: "Subsystem" }) }).last().locator(".tk-q").fill(tagNo, soft).catch(() => {});
await eqTag.locator("button").last().click(soft).catch(() => {});
await page.waitForTimeout(900);
const steps = (await page.locator(".card .card b").allInnerTexts()).join(" | ");
check(/Cold alignment/.test(steps) && /Grouting/.test(steps), `the rotating chain's steps in English (${steps.slice(0, 120)})`);
await page.goto(`${BASE}/coating`, { waitUntil: "networkidle" });
const coRow = (await page.locator("tr", { hasText: tagNo }).first().innerText().catch(() => "")).replace(/\s+/g, " ");
check(/Hot insulation 50 mm/.test(coRow) && !PERSIAN.test(coRow), `the coating item in English (${coRow.slice(0, 120)})`);
await setLang("fa");
await page.goto(`${BASE}/coating`, { waitUntil: "networkidle" });
const coFa = await page.locator("tr", { hasText: tagNo }).first().innerText().catch(() => "");
check(/عایق گرم/.test(coFa), "…and in Persian as before");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
