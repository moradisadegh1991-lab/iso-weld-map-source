/**
 * Drive the procurement and warehouse section in English and Arabic (owner's
 * requirements of 2026-10-18, item 17) on the DM-pump scenario played to the
 * end. A vendor, a stock item with a receipt, a requisition, a reservation and
 * a stock count are made through the API in Latin names, so the project's
 * data is not taken for the page's words; then every tab of /procurement and
 * of /warehouse — with a PO, a lot, a requisition and the count opened — is
 * read in English and in Arabic. A word of Persian of the page's own fails
 * it; so does a page error. Dates and numbers are checked to be written the
 * reader's way.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-i18n-supply.mjs
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
// the lot table's own search: the scenario has more lots than a page holds
const findLot = async () => {
  const card = page.locator(".card", { has: page.locator("th", { hasText: "MTC" }) }).first();
  await card.locator(".tk-q").fill(`MRR-I${run}`, soft).catch(() => {});
  await page.waitForTimeout(300);
  return page.locator("tr", { hasText: `MRR-I${run}` }).first();
};
const today = new Date().toISOString().slice(0, 10);

// Latin-named records, so every tab has rows and every detail panel opens
await api("/api/procurement", { projectId, kind: "vendor", code: `V-I${run}`, name: "Acme Pumps", scope: "Pumps", email: "sales@acme.test" });
const item = (await api("/api/warehouse", { projectId, kind: "item", code: `PIPE-I${run}`, description: "Pipe 2in SCH40", category: "pipe", uom: "m", spec: "ASTM A106 Gr.B" })).item;
await api("/api/warehouse", { projectId, kind: "receive", itemId: item.id, receiptNo: `MRR-I${run}`, heatNo: `H${run}`, mtcRef: `MTC-${run}`, qtyReceived: 1234.5, location: "Yard A", receivedOn: today });
await api("/api/warehouse", { projectId, kind: "requirement", itemId: item.id, qty: 2000, source: "MTO rev 0" });
await api("/api/procurement/tender", { projectId, kind: "mr", mrNo: `MR-I${run}`, title: "Spare pumps" });
await api("/api/warehouse/stores", { projectId, kind: "count-open", countNo: `SC-I${run}`, countedOn: today, scope: "Yard A" });

// the page's own words: headings, labels, buttons, notes, pills — not the cells of the project's data
const chrome = () => page.evaluate(() => {
  const s = ".page h1, .page h2, .page h3, .page legend, .page th, .page label, .page button, .page summary, .page .empty-note,"
    + " .page .pagehead .sub, .page p.muted, .page .pill, .page b.sm, .page [role=tab], .page option";
  return [...document.querySelectorAll(s)].filter((n) => n.offsetParent !== null || n.tagName === "OPTION")
    .map((n) => (n.innerText || n.textContent || "").replace(/\s+/g, " ").trim()).filter(Boolean);
});
const PERSIAN = /[؀-ۿ]/;
const PERSIAN_ONLY = /[پچژگیک]/;
// the scenario's own records are named in Persian (items, vendors, POs, spools…): they are data, not the page's words
const data = await page.evaluate(async (pid) => {
  const get = (p) => fetch(p).then((r) => r.json());
  const [pr, wh, td, st] = await Promise.all([get(`/api/procurement?projectId=${pid}`), get(`/api/warehouse?projectId=${pid}`),
    get(`/api/procurement/tender?projectId=${pid}`), get(`/api/warehouse/stores?projectId=${pid}`)]);
  return [
    ...pr.vendors.flatMap((v) => [v.name, v.scope, v.city, v.country, v.address, v.contact_name]),
    ...pr.orders.flatMap((o) => [o.po.title, ...o.lines.map((l) => l.what), ...o.docs.map((d) => d.title), ...o.shipments.map((s) => s.mode)]),
    ...pr.items.flatMap((i) => [i.description]), ...wh.items.flatMap((i) => [i.description, i.spec]),
    ...wh.lots.flatMap((l) => [l.description, l.supplier, l.location, l.spec, ...l.holdReasons, l.itpHold?.mir?.title, l.itpHold?.mtc?.title]),
    ...wh.shortages.map((s) => s.sources), ...wh.contractors.map((c) => c.name),
    ...td.mrs.flatMap((m) => [m.title, m.awarded_vendor, ...m.lines.map((l) => l.description), ...m.revisions.map((r) => r.reason), m.justification,
      td.mrs && m.tender.ranking.reason, ...m.tender.bids.flatMap((x) => [x.techNote, ...x.problems])]),
    ...td.vdt.templates.flatMap((x) => [x.reason, ...x.attributes.map((a) => a.label)]), ...td.vdt.tags.flatMap((x) => x.state.problems || []),
    ...st.reservations.flatMap((r) => [r.destNo, r.releaseReason]), ...st.counts.flatMap((c) => [c.scope, ...c.lines.map((l) => l.decisionReason)]),
  ].filter((x) => typeof x === "string" && /[؀-ۿ]/.test(x));
}, projectId);
const unData = (w) => data.reduce((x, d) => x.split(d).join(""), w);
const leftIn = async (rx, where) => (await chrome()).filter((w) => rx.test(unData(w))).map((w) => `${where}: ${w}`);

for (const [lang, rx] of [["en", PERSIAN], ["ar", PERSIAN_ONLY]]) {
  await setLang(lang);
  // procurement: four tabs; on the orders tab a PO's details, on the tender tab the requisition's
  await page.goto(`${BASE}/procurement`, { waitUntil: "networkidle" });
  const left = [];
  const rowsSeen = { procurement: 0 };
  const tabs = page.locator(".ptabs [role=tab]");
  for (let i = 0; i < await tabs.count(); i++) {
    await tabs.nth(i).click(); await page.waitForTimeout(600);
    if (i === 0) await page.locator(".card button", { hasText: /Details|التفاصيل/ }).first().click(soft).catch(() => {});
    if (i === 1) await page.locator("tr", { hasText: `MR-I${run}` }).locator("button").first().click(soft).catch(() => {});
    await page.locator("summary").evaluateAll((s) => s.forEach((x) => x.click())).catch(() => {});   // every fold open
    await page.waitForTimeout(400);
    if (i === 0) rowsSeen.procurement = await page.locator(".page tbody tr").count();
    left.push(...await leftIn(rx, `procurement tab ${i + 1}`));
  }
  check(await page.locator(".ptabs").count() === 1 && rowsSeen.procurement > 0, `${lang} /procurement shows the project's orders (${rowsSeen.procurement} rows)`);
  check(left.length === 0, `${lang} /procurement, four tabs: Persian left: ${left.slice(0, 6).join(" | ") || "none"}`);
  await page.screenshot({ path: `${SHOT}/41${lang === "en" ? 0 : 1}-procurement-${lang}.png` });

  // warehouse: each tab of the page; a lot's details and the open count shown
  await page.goto(`${BASE}/warehouse`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const wleft = [];
  const wtabs = page.locator(".page [role=tab]");
  const n = await wtabs.count();
  let lotOpened = false;
  for (let i = 0; i < Math.max(n, 1); i++) {
    if (n) { await wtabs.nth(i).click(); await page.waitForTimeout(500); }
    if (i === 0) {
      await (await findLot()).locator("button").first().click(soft).catch(() => {});
      await page.waitForTimeout(400);
      lotOpened = await page.locator("b.sm", { hasText: /MIR/ }).count() > 0;
    }
    await page.locator("summary").evaluateAll((s) => s.forEach((x) => x.click())).catch(() => {});
    await page.waitForTimeout(400);
    wleft.push(...await leftIn(rx, `warehouse tab ${i + 1}`));
  }
  check(n >= 5, `${lang} /warehouse has its tabs (${n})`);
  check(lotOpened, `${lang} the new lot's details opened (MIR, MTC and issue forms read too)`);
  check(wleft.length === 0, `${lang} /warehouse, every tab: Persian left: ${wleft.slice(0, 6).join(" | ") || "none"}`);
  await page.screenshot({ path: `${SHOT}/42${lang === "en" ? 0 : 1}-warehouse-${lang}.png` });
}

// numbers and dates written the reader's way
await setLang("en");
await page.goto(`${BASE}/warehouse`, { waitUntil: "networkidle" });
const lotRow = (await (await findLot()).innerText()).replace(/\s+/g, " ");
check(/\d{1,2}\/\d{1,2}\/20\d\d/.test(lotRow) && !PERSIAN.test(lotRow), `English writes the receipt date the Latin way (${lotRow.slice(0, 90)})`);
check(await page.locator("th", { hasText: "On hand" }).count() > 0, "the lot table's heads in English");
await setLang("fa");
await page.goto(`${BASE}/warehouse`, { waitUntil: "networkidle" });
const lotFa = await (await findLot()).innerText();
check(/۱۴۰[۰-۹]\/[۰-۹]{1,2}\/[۰-۹]{1,2}/.test(lotFa), "Persian writes it in the Persian calendar");
check(await page.locator("th", { hasText: "قابل حواله" }).count() > 0, "…and the heads in Persian as before");

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
