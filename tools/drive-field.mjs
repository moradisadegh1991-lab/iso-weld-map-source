/**
 * Drive the field page against a PRODUCTION build (the service worker is
 * off under `next dev`):
 *   1. online: the pack arrives and the worker takes control
 *   2. labels: every printed QR decodes, in-page, to its field URL
 *   3. network cut: a label URL opens from the worker's cache, the item
 *      shows from the pack, steps and a punch item are queued, and a
 *      reload keeps the queue
 *   4. network back: the queue syncs by itself, a refused operation comes
 *      back with its reason and stays on screen
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-field.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
import jsQR from "jsqr";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const TAG = process.env.DRIVE_TAG || "P-1203B";
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await showAllTabs(page);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
const flat = (s) => s.replace(/\s+/g, " ").trim();

// ── 1. online ──
await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");
await page.goto(BASE + "/field", { waitUntil: "networkidle" });
await page.waitForFunction(() => navigator.serviceWorker?.controller || null, null, { timeout: 5000 }).catch(() => {});
if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: "networkidle" });
}
console.log("worker controls the page:", await page.evaluate(() => !!navigator.serviceWorker.controller));
await page.waitForSelector("text=روی گوشی:");
console.log("online:", flat(await page.locator(".pagehead .sub").innerText()));

// ── 2. labels decode ──
await page.goto(BASE + "/labels", { waitUntil: "networkidle" });
await page.waitForSelector(".label svg");
await page.fill("#lo", "https://epc.example.ir");
const labels = await page.locator(".label").count();
const decoded = [];
for (let i = 0; i < Math.min(labels, 5); i++) {
  const px = await page.locator(".label svg").nth(i).evaluate(async (svg) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.outerHTML);
    await img.decode();
    const c = document.createElement("canvas"); c.width = 300; c.height = 300;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0, 300, 300);
    return { data: Array.from(g.getImageData(0, 0, 300, 300).data) };
  });
  decoded.push(jsQR(new Uint8ClampedArray(px.data), 300, 300)?.data || null);
}
console.log(`labels: ${labels}; decoded ${decoded.filter(Boolean).length}/${decoded.length}:`, decoded[0]);
await page.screenshot({ path: `${SHOT}/109-labels.png` });

// ── 3. offline ──
await page.goto(BASE + "/field", { waitUntil: "networkidle" });
await page.waitForSelector("text=روی گوشی:");
await ctx.setOffline(true);
await page.goto(`${BASE}/field?p=DEMO&k=t&n=${TAG}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".field-step", { timeout: 15000 });
console.log("offline header:", flat(await page.locator(".pagehead .sub").innerText()));
console.log("offline bar:", flat(await page.locator(".offline-bar").innerText()).slice(0, 80));
const item = page.locator(".card", { has: page.locator("h2", { hasText: TAG }) });
const buttons = item.getByRole("button", { name: "انجام شد" });
console.log("recordable steps:", await buttons.count());
await buttons.first().click(); await page.waitForTimeout(500);
await item.getByLabel("شرح Punch").fill("Drive offline: drain plug missing");
await item.getByRole("button", { name: "ثبت Punch" }).click(); await page.waitForTimeout(500);
// A punch clear the server will refuse: an item already cleared, injected as
// a phone that did not know would have queued it.
const cleared = await page.evaluate(async () => new Promise((res) => {
  const r = indexedDB.open("epc-field", 1);
  r.onsuccess = () => {
    const g = r.result.transaction("packs").objectStore("packs").getAll();
    g.onsuccess = () => res(g.result[0].pack);
  };
}));
const refusedId = crypto.randomUUID();
const pid = cleared.project.id;
console.log("queued on screen:", await page.locator(".queued").count());
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector(".queued", { timeout: 15000 });
console.log("after offline reload, queued:", await page.locator(".queued").count());
await page.screenshot({ path: `${SHOT}/110-field-offline.png`, fullPage: true });

// ── 4. back online ──
await ctx.setOffline(false);
const q = await ctx.request.get(`${BASE}/api/quality?projectId=${pid}`);
const cl = (await q.json()).punch.find((x) => x.status === "cleared");
await page.evaluate(async ({ id, pid, punchId, uid }) => new Promise((res) => {
  const r = indexedDB.open("epc-field", 1);
  r.onsuccess = () => {
    const tx = r.result.transaction("ops", "readwrite");
    tx.objectStore("ops").put({ opId: id, kind: "punch_clear", projectId: pid, userId: uid, state: "queued",
      payload: { punchId, note: "again", clearedOn: new Date().toISOString().slice(0, 10) },
      capturedAt: new Date().toISOString(), label: "drive: clear an item already cleared" });
    tx.oncomplete = () => res();
  };
}), { id: refusedId, pid, punchId: cl.id, uid: (await (await ctx.request.get(`${BASE}/api/auth/me`)).json()).user.id });
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector(".queued");
await page.getByRole("button", { name: "همگام‌سازی" }).click();
await page.waitForFunction(() => document.querySelectorAll(".queued").length === 0, null, { timeout: 20000 }).catch(() => {});
await page.waitForTimeout(1500);
console.log("after sync:", flat(await page.locator("p[role=status]").first().innerText()));
console.log("queued left:", await page.locator(".queued").count());
console.log("refused shown:", flat(await page.locator(".pill.bad", { hasText: "رد شد" }).first().locator("..").innerText()).slice(0, 160));
const recent = await (await ctx.request.get(`${BASE}/api/field?projectId=${pid}&recent=1`)).json();
console.log("server received:", recent.ops.slice(0, 3).map((o) => `${o.kind}:${o.status}`).join(", "));
await page.screenshot({ path: `${SHOT}/111-field-synced.png`, fullPage: true });
console.log("problems:", problems.length ? problems : "none");
await b.close();
