/**
 * Drive inspection (production build, seeded DEMO): the request board and
 * its figures; a pre-pour step shown held on the phone — no button, the
 * request it waits on named — because its Hold is not released; a request raised from the form and
 * the contractor's own result on it; the ITP matrix; a new revision whose
 * preparer cannot approve it; one item's inspection file; the members'
 * inspection parties.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-inspection.mjs
 */
import { chromium } from "playwright";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
// A prefetch cut short by the next navigation is not a fault of the page.
page.on("console", (m) => { if (m.type() === "error" && !/40[0-9]|Failed to load resource|Failed to fetch RSC payload/.test(m.text())) problems.push("console: " + m.text()); });
const flat = (s) => s.replace(/\s+/g, " ").trim();

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

// ── the board ──
await page.goto(`${BASE}/inspection`, { waitUntil: "networkidle" });
await page.waitForSelector(".kpis");
console.log("head:", flat(await page.locator(".pagehead .sub").innerText()));
console.log("kpis:", (await page.locator(".kpi").allInnerTexts()).map(flat).join(" | "));
const rows = await page.locator("table.dtable tbody tr").allInnerTexts();
console.log("awaiting:", rows.map((r) => flat(r).slice(0, 110)));
await page.screenshot({ path: `${SHOT}/130-inspection-board.png`, fullPage: true });

// ── the gate, from the site, through the queue ──
const site = await ctx.newPage();
await site.goto(`${BASE}/field?p=DEMO&k=t&n=FDN-T-3102`, { waitUntil: "networkidle" });
await site.waitForSelector(".field-step");
const pre = site.locator(".field-step", { hasText: "پیش از بتن" });
console.log("FDN-T-3102 pre-pour on the phone:", flat(await pre.innerText()).slice(0, 80));
console.log("inspection on the item:", flat(await site.locator("b", { hasText: "بازرسی IR-" }).first().locator("..").innerText()).slice(0, 160));
// The phone does not offer "done" on a step its pack says is held; it says
// which request it waits on. (The server refuses it either way — the sync
// of a queued step is tested in db/test/inspection.mjs.)
console.log("buttons on the held step:", await pre.getByRole("button").count());
await site.screenshot({ path: `${SHOT}/131-field-hold.png`, fullPage: true });
await site.close();

// ── raise a request from the form, and sign the contractor's part ──
await page.bringToFront();
await page.reload({ waitUntil: "networkidle" });
await page.locator(".fold-head", { hasText: "درخواست بازرسی جدید" }).click();   // the form is folded until asked for
await page.selectOption("#r-scope", "foundation");
const actOpts = await page.locator("#r-act option").allInnerTexts();
await page.selectOption("#r-act", { label: actOpts.find((t) => t.includes("· 50 —")) });
await page.waitForFunction(() => document.querySelectorAll("#r-item option").length > 1);
// A foundation that has no request for row 50 yet (each run releases one).
const me = await (await ctx.request.get(`${BASE}/api/auth/me`)).json();
const pid = me.projects.find((x) => x.code === "DEMO").id;
const { items } = await (await ctx.request.get(`${BASE}/api/inspection?projectId=${pid}&scope=foundation`)).json();
let target = null;
for (const it of items) {
  const f = await (await ctx.request.get(`${BASE}/api/inspection?projectId=${pid}&itemKind=tag&itemId=${it.id}`)).json();
  if (!f.activities.find((a) => a.seq === 50).latest) { target = it.label; break; }
}
console.log("raising row 50 for:", target);
await page.selectOption("#r-item", { label: target });
await page.fill("#r-loc", "Unit 31");
console.log("notice line:", flat(await page.locator("form.card p.sm").last().innerText()));
await page.getByRole("button", { name: "ثبت درخواست" }).click();
await page.waitForTimeout(1200);
const newRow = page.locator("table.dtable tbody tr", { hasText: "Backfill" }).filter({ hasText: target }).first();
console.log("raised:", flat(await newRow.innerText()).slice(0, 140));
await newRow.getByRole("button", { name: "اقدام" }).click();
await page.locator("select[id^=o-]").selectOption("accepted");
await page.locator("input[id^=n-]").fill("S. Moradi");
await page.getByRole("button", { name: "ثبت و امضا" }).click();
await page.waitForTimeout(1200);
await page.selectOption("select[aria-label=فیلتر]", "released");
await page.waitForTimeout(300);
console.log("released now:", (await page.locator("table.dtable tbody tr").allInnerTexts()).map((r) => flat(r).slice(0, 90)));

// ── a rejected request: its NCR and re-inspection are on the board ──
await page.selectOption("select[aria-label=فیلتر]", "rejected");
await page.waitForTimeout(300);
console.log("rejected:", (await page.locator("table.dtable tbody tr").allInnerTexts()).map((r) => flat(r).slice(0, 130)));

// ── the ITP ──
await page.getByRole("tab", { name: "ITP" }).click();
await page.locator("table.dtable tbody tr", { hasText: "ITP-CIV-001" }).first().click();
console.log("matrix:", (await page.locator(".card", { has: page.locator("h2", { hasText: "ITP-CIV-001 rev 0" }) }).locator("tbody tr").allInnerTexts())
  .map((r) => flat(r).slice(0, 80)));
await page.screenshot({ path: `${SHOT}/132-inspection-itp.png`, fullPage: true });
await page.locator(".fold-head", { hasText: "ITP یا رویژن جدید" }).click();   // the form is folded until asked for
await page.fill("#n-no", "ITP-CIV-001"); await page.fill("#n-rev", "1"); await page.selectOption("#n-s", "foundation");
await page.locator("form", { has: page.locator("#n-no") }).getByRole("button", { name: "ITP یا رویژن جدید" }).click();
await page.waitForTimeout(1200);
const draft = page.locator(".card", { has: page.locator("h2", { hasText: "rev 1" }) });
console.log("rev 1 draft rows:", await draft.locator("tbody tr").count());
await draft.getByRole("button", { name: "تأیید و اجرا" }).click();
await page.waitForTimeout(800);
console.log("approving my own draft:", flat(await page.locator("p.err[role=alert]").innerText().catch(() => "—")));

// ── one item's file ──
await page.getByRole("tab", { name: "پروندهٔ آیتم" }).click();
await page.selectOption("#i-scope", "foundation");
await page.waitForFunction(() => document.querySelectorAll("#i-item option").length > 1);
await page.selectOption("#i-item", { label: "FDN-P-1203A" });
await page.waitForSelector("text=فعالیت آزاد شده");
console.log("FDN-P-1203A file:", flat(await page.locator("p.sm", { hasText: "فعالیت آزاد شده" }).innerText()));
console.log("  rows:", (await page.locator(".card table tbody tr").allInnerTexts()).map((r) => flat(r).slice(0, 90)));
await page.screenshot({ path: `${SHOT}/133-inspection-item.png`, fullPage: true });

// ── who signs for whom ──
await page.goto(`${BASE}/admin`, { waitUntil: "networkidle" });
// The users page (lib/db/repos/users.mjs) lists each member with the party they sign for.
const members = page.locator(".card", { has: page.locator("h2", { hasText: "اعضای پروژه" }) }).locator("tbody tr:not([hidden])");
await members.first().waitFor();
console.log("members:", (await members.allInnerTexts()).map((r) => flat(r).slice(0, 90)));
console.log("problems:", problems.length ? problems : "none");
await b.close();
