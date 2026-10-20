/**
 * Drive the piping pages (dashboard, execution, welding and NDT, joint
 * history) and the NDT dashboard in English and Arabic (owner's requirements
 * of 2026-10-18, item 17) on the DM-pump scenario played to the end. A welder
 * and a support are made through the API in Latin names; then every page —
 * with a spool's chain open and a weld's history shown — is read in English
 * and in Arabic, every tab. A word of Persian of the page's own fails it; so
 * does a page error. The isometric tool (/piping) is not in this drive.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-piping.mjs
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

await api("/api/welders", { projectId, stampNo: `W-I${run}`, name: "John Welder", employer: "Acme" });
await api("/api/piping/execution", { projectId, kind: "support", supportNo: `SUP-I${run}`, supportKind: "shoe", loadKn: "", drawingRef: "STD-1" }).catch((e) => console.log("note:", e.message));
const exec = await api(`/api/piping/execution?projectId=${projectId}`);
const welds = (await api(`/api/welds?projectId=${projectId}&q=`)).welds;
const weldUid = (welds.find((w) => w.is_welded) || welds[0])?.weld_uid;

const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2, .page h3, .page legend, .page th, .page label, .page button, .page summary, .page .empty-note,"
    + " .page .pagehead .sub, .page p.muted, .page .pill, .page [role=tab], .page option, .page .card > span.sm, .page .hint, .page .kpi .l, .page .kpi .b,"
    + " .page .timeline .pill, .page .kv .muted, .page li.sm, .page input[placeholder]";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => (n.tagName === "INPUT" ? n.placeholder : (n.innerText || n.textContent || "")).replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ONLY = /[پچژگیک]/;
// every Persian string the project's own data and the server's notes carry, except the ones the page must translate
const SKIP = new Set(["statusText", "title", "medium"]);
const collect = (v, out) => {
  if (typeof v === "string") { if (PERSIAN.test(v)) out.push(v); }
  else if (Array.isArray(v)) v.forEach((x) => collect(x, out));
  else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) if (!SKIP.has(k)) collect(x, out);
};
const data = [];
for (const p of ["/api/piping/hub", "/api/piping/execution", "/api/welders", "/api/reports/dashboard", "/api/piping-classes"]) {
  collect(await api(`${p}?projectId=${projectId}`).catch(() => ({})), data);
}
if (weldUid) collect(await api(`/api/welds/${encodeURIComponent(weldUid)}?projectId=${projectId}`).catch(() => ({})), data);
// a server note on a timeline line, an attention line or a material state is the server's text
const notes = [];
const unData = (w) => [...data, ...notes].sort((a, b) => b.length - a.length).reduce((x, d) => x.split(d).join(""), w);
const leftIn = async (rx, where) => (await chrome()).filter((w) => rx.test(unData(w))).map((w) => `${where}: ${w}`);

const PAGES = [["/piping/overview", "dashboard"], ["/piping/execution", "execution"], ["/piping/welding", "welding"], ["/qc", "qc"], ["/piping/joint", "joint"]];
for (const [lang, rx] of [["en", PERSIAN], ["ar", PERSIAN_ONLY]]) {
  await setLang(lang);
  for (const [path, name] of PAGES) {
    const url = name === "joint" && weldUid ? `${BASE}${path}?uid=${encodeURIComponent(weldUid)}` : `${BASE}${path}`;
    await page.goto(url, { waitUntil: "networkidle" });
    await page.waitForTimeout(700);
    const tabs = page.locator(".page [role=tab]");
    const n = Math.max(await tabs.count(), 1);
    const left = [];
    let opened = name !== "execution";
    for (let i = 0; i < n; i++) {
      if (await tabs.count()) { await tabs.nth(i).click(); await page.waitForTimeout(400); }
      if (name === "execution") {
        const row = page.locator("tr", { has: page.locator("a[href*='/piping/joint?q=']") }).first();
        if (await row.isVisible().catch(() => false)) {
          await row.locator("button").last().click(soft).catch(() => {});
          await page.waitForTimeout(900);
          opened = opened || await page.locator("td .card").count() > 0;
        }
      }
      await page.locator("summary").evaluateAll((s) => s.forEach((x) => x.click())).catch(() => {});
      await page.waitForTimeout(300);
      left.push(...await leftIn(rx, `${path} tab ${i + 1}`));
    }
    check(opened, `${lang} ${path}: the detail opened`);
    check(left.length === 0, `${lang} ${path}: Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
    await page.screenshot({ path: `${SHOT}/46${lang === "en" ? 0 : 1}-${name}-${lang}.png` });
  }
}

// the reader's words in the lists
await setLang("en");
await page.goto(`${BASE}/piping/overview`, { waitUntil: "networkidle" });
const kp = (await page.locator(".kpis").innerText()).replace(/\s+/g, " ");
check(/Welded/.test(kp) && /Inch-dia welded/.test(kp) && !PERSIAN.test(kp), `the dashboard's figures in English (${kp.slice(0, 100)})`);
await page.goto(`${BASE}/piping/welding`, { waitUntil: "networkidle" });
const th = (await page.locator("thead").first().innerText()).replace(/\s+/g, " ");
check(/line \/ spool/i.test(th) && /welding/i.test(th), `the welding table's heads in English (${th.slice(0, 90)})`);
await setLang("fa");
await page.goto(`${BASE}/piping/welding`, { waitUntil: "networkidle" });
check(await page.locator("th", { hasText: "خط / اسپول" }).count() > 0, "…and in Persian as before");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
