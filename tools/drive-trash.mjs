/**
 * Drive the project's trash: a contractor entered by mistake is deleted on
 * the contractors page (picked, then Delete), lands in the trash with the
 * day it goes for good, comes back from there to the contractors page; a
 * second one is let go of for good. The trash tab is under «Project».
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-trash.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const page = await (await b.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
const problems = [];
let failed = 0;
const check = (ok, what) => { console.log(ok ? "ok  " : "FAIL", what); if (!ok) failed++; };
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
const asked = [];
page.on("dialog", (d) => { asked.push(d.message()); d.accept(); });
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([p, x]) => {
  const r = await fetch(p, x ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(x) } : {});
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${j.error}`);
  return j;
}, [path, body]);
await api("/api/auth/prefs", { lang: "en" });
await page.evaluate(() => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: "en" })));
const me = await api("/api/auth/me");
const projectId = me.projects.find((p) => p.code === "DMW").id;
await page.evaluate((id) => localStorage.setItem("epc.lastProject", id), projectId);

const tag = Date.now().toString(36).slice(-4).toUpperCase();
const typo = (await api("/api/contractors", { projectId, code: `TYPO${tag}`, name: `Entered by mistake ${tag}` })).contractor;
const spare = (await api("/api/contractors", { projectId, code: `SPARE${tag}`, name: `Spare ${tag}` })).contractor;

async function deleteOnPage(c) {
  await page.goto(`${BASE}/contractors`, { waitUntil: "networkidle" });
  const row = page.locator(`tr[data-key="${c.id}"]`).first();
  await row.waitFor();
  await row.locator("td").nth(1).click({ modifiers: ["Control"] });    // Ctrl-click picks the row
  await page.locator("[data-tk-bulk-delete]").first().click();
  await page.locator(`tr[data-key="${c.id}"]`).first().waitFor({ state: "detached" });
}
await deleteOnPage(typo);
check(true, `«${typo.code}» deleted on the contractors page`);
await deleteOnPage(spare);

await page.goto(`${BASE}/trash`, { waitUntil: "networkidle" });
check(await page.locator(".tabs a, nav a", { hasText: "Project trash" }).count() > 0 || await page.locator("h1", { hasText: "Project trash" }).count() === 1, "the trash page, in English");
const item = page.locator(`tr[data-trash-item*="TYPO${tag}"]`);
await item.waitFor();
const text = await item.innerText();
check(text.startsWith("Contractor"), `its kind, in English (${text.replace(/\s+/g, " ").slice(0, 120)})`);
const expires = await item.locator("td").nth(5).innerText();
check(/\d/.test(expires), `the day it goes for good (${expires})`);
await page.screenshot({ path: `${SHOT}/440-trash-en.png` });

asked.length = 0;
await item.locator("[data-restore]").click();
await page.locator(".okmsg").waitFor();
check(/^Restore «TYPO/.test(asked[0] || ""), `asked before restoring (${asked[0]})`);
check(await page.locator(`tr[data-trash-item*="TYPO${tag}"]`).count() === 0, "restored, it leaves the trash");
await page.goto(`${BASE}/contractors`, { waitUntil: "networkidle" });
check(await page.locator(`tr[data-key="${typo.id}"]`).count() > 0, "and is back on the contractors page, under its own id");

await page.goto(`${BASE}/trash`, { waitUntil: "networkidle" });
const s = page.locator(`tr[data-trash-item*="SPARE${tag}"]`);
await s.waitFor();
asked.length = 0;
await s.locator("[data-purge]").click();
await page.locator(".okmsg").waitFor();
check(/forever/.test(asked[0] || ""), `asked before deleting forever (${asked[0]})`);
check(await page.locator(`tr[data-trash-item*="SPARE${tag}"]`).count() === 0, "let go of for good");
await page.screenshot({ path: `${SHOT}/441-trash-after-en.png` });

// back in Persian: the page keeps no English of its own
await api("/api/auth/prefs", { lang: "fa" });
await page.evaluate(() => localStorage.setItem("epc.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("epc.prefs") || "{}"), lang: "fa" })));
await page.goto(`${BASE}/trash`, { waitUntil: "networkidle" });
check(await page.locator("h1", { hasText: "سطل بازیافت پروژه" }).count() === 1, "and in Persian");

console.log(problems.length ? problems.join("\n") : "no page errors");
await b.close();
process.exit(failed || problems.length ? 1 : 0);
