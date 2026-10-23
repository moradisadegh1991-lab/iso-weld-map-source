/**
 * Drive live row editing across the platform's tables (owner's requirements
 * of 2026-10-18, item 18) on the DM-pump scenario played to the end: a click
 * on a row opens it where it stands — no dialog — with save, cancel and
 * delete; leaving it changed asks to save or discard; a row that is not open
 * for editing (an approved ITP's line) only selects.
 *   HR personnel (text), piping classes (number and a choice), an ITP line
 *   in draft (its hold/witness points), and the same line once approved.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-row-edit.mjs
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
const page = await (await b.newContext({ viewport: { width: 1440, height: 950 } })).newPage();
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
page.on("dialog", (d) => d.accept());
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
await api("/api/auth/prefs", { lang: "fa" });
const projectId = (await api("/api/auth/me")).projects.find((p) => p.code === "DMW").id;
const contractId = (await api(`/api/contract-reports?projectId=${projectId}`)).contracts[0].id;
await page.locator(".topbar select").selectOption(`c:${contractId}`); await page.waitForTimeout(500);   // the pages show the project picked here
const run = Date.now().toString(36).slice(-4).toUpperCase();
/** Click the page's tabs until `loc` shows. */
const reveal = async (loc) => {
  for (const tab of await page.locator(".ptabs button, [role=tab]").all()) {
    if (await loc.first().isVisible().catch(() => false)) return;
    await tab.click().catch(() => {}); await page.waitForTimeout(300);
  }
};
const editRow = () => page.locator("tr.tk-edit");
const field = (label) => editRow().locator(`[aria-label="${label}"]`);

// ── HR: a person's position and department, typed where they stand ──
const hr = await api(`/api/hr?projectId=${projectId}`);
await api("/api/hr", { projectId, kind: "person", idNo: `D${run}1`, fullName: `Row Edit ${run}`, employer: Object.keys(hr.employers)[0] });
await api("/api/hr", { projectId, kind: "person", idNo: `D${run}2`, fullName: `Second ${run}`, employer: Object.keys(hr.employers)[0] });
await page.goto(`${BASE}/hr`, { waitUntil: "networkidle" });
await page.locator(".tk-q").first().fill(run);                // the table's own search: the scenario has more people than a page
await page.waitForTimeout(400);
const person = page.locator("tr[data-key]", { hasText: `Row Edit ${run}` });
await person.locator("td").nth(1).click();
check(await editRow().count() === 1 && await person.isHidden(), "a click opens the person's row for editing in place, no dialog");
const blue = await editRow().locator("td").first().evaluate((td) => getComputedStyle(td).color);
await field("سمت").fill("سرپرست جوشکاری");
await field("واحد").fill("اجرا");
await page.locator("tr[data-key]", { hasText: `Second ${run}` }).locator("td").nth(1).click();
check(await page.locator("[data-tk-leave]").count() === 1, "leaving the changed row asks to save or discard");
await page.locator("[data-tk-leave] button").first().click();
await page.waitForTimeout(1200);
const saved = (await api(`/api/hr?projectId=${projectId}`)).people.find((p) => p.idNo === `D${run}1`);
check(saved.position === "سرپرست جوشکاری" && saved.department === "اجرا", `saved from the prompt (${saved.position} / ${saved.department}; text ${blue})`);
check(await editRow().count() === 1 && (await page.locator("tr[data-key]", { hasText: `Second ${run}` }).isHidden()), "and the next row is open now");
await editRow().locator("button", { hasText: "انصراف" }).click();
check(await editRow().count() === 0, "cancel closes it unchanged");

// ── piping classes: numbers and a choice ──
await api("/api/piping-classes", { projectId, code: `C${run}`, serviceCategory: "normal", designPressBarg: 10 });
await page.goto(`${BASE}/piping/overview`, { waitUntil: "networkidle" });
const cls = page.locator("tr[data-key]", { hasText: `C${run}` });
await reveal(page.locator("h2", { hasText: "کلاس‌های لوله" }));
await page.locator(".card", { has: cls }).locator(".tk-q").fill(run).catch(() => {});
await page.waitForTimeout(400);
await cls.scrollIntoViewIfNeeded();
await cls.locator("td").nth(1).click();
await field("P طراحی barg").fill("16.5");
const svc = field("سرویس B31.3");
await svc.selectOption({ index: 2 });
const chosen = await svc.inputValue();
await editRow().locator("[data-tk-save]").click();
await page.waitForTimeout(1200);
const c = (await api(`/api/piping-classes?projectId=${projectId}`)).classes.find((x) => x.code === `C${run}`);
check(Number(c.design_press_barg) === 16.5 && c.service_category === chosen, `the class's design pressure and service saved in the row (${c.design_press_barg} barg, ${c.service_category})`);
await page.screenshot({ path: `${SHOT}/390-row-edit-class.png` });

// ── an ITP line: open while the ITP is a draft, only selected once approved ──
const insp = await api(`/api/inspection?projectId=${projectId}`);
const approved = insp.itps.find((i) => i.status === "approved" && i.activities.length);
const draft = (await api("/api/inspection", { projectId, kind: "itp", itpNo: `ITP-${run}`, revision: "0", title: "Row edit", scope: approved?.scope || "foundation" })).itp;
await api("/api/inspection", { projectId, kind: "activity", itpId: draft.id, seq: 10, title: "Rebar check", points: { contractor: "W" } }).catch((e) => problems.push("activity: " + e.message));
const line = (await api(`/api/inspection?projectId=${projectId}`)).itps.find((i) => i.id === draft.id).activities[0];
await page.goto(`${BASE}/inspection`, { waitUntil: "networkidle" });
const openItp = async (no) => {
  await reveal(page.locator("tr", { hasText: no }));
  await page.locator("tr", { hasText: no }).first().click();
  await page.waitForTimeout(500);
};
await openItp(`ITP-${run}`);
await page.locator(`tr[data-key="${line.id}"] td`).nth(1).click();
check(await editRow().count() === 1, "a draft ITP's line opens for editing");
const pts = await editRow().locator("select").all();
if (pts.length) await pts[1].selectOption("H").catch(() => pts[1].selectOption({ index: 1 }));
await field("شرح فعالیت").fill("Rebar & cover check").catch(async () => { await editRow().locator("input").first().fill("Rebar & cover check"); });
await editRow().locator("[data-tk-save]").click();
await page.waitForTimeout(1200);
const after = (await api(`/api/inspection?projectId=${projectId}`)).itps.find((i) => i.id === draft.id).activities[0];
check(after.title === "Rebar & cover check" && Object.values(after.points).includes("H"), `the line's text and a hold point saved in place (${after.title}; ${JSON.stringify(after.points)})`);
if (approved) {
  await openItp(approved.itp_no);
  await page.locator(`tr[data-key="${approved.activities[0].id}"] td`).nth(1).click();
  check(await editRow().count() === 0 && await page.locator(`tr[data-key="${approved.activities[0].id}"][data-tk-sel]`).count() === 1,
    "an approved ITP's line only selects; it does not open for editing");
} else check(true, "no approved ITP in this scenario to try the lock on");
await page.screenshot({ path: `${SHOT}/391-row-edit-itp.png` });

console.log(problems.length ? `problems:\n  ${problems.join("\n  ")}` : "no page errors");
await b.close();
if (failed || problems.length) process.exit(1);
