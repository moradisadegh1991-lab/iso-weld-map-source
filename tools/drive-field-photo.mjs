/**
 * Drive punch photos (production build): with the network cut, a photo of
 * an open punch item's defect, and a new punch item raised with its photo;
 * then the network back, the sync, and what the server kept — a JPEG,
 * redrawn on the phone (no EXIF), served as an image and nothing else.
 * Last, the quality page shows the photos and adds one from the desk.
 *   BASE_URL=http://localhost:3000 DRIVE_EMAIL=... DRIVE_PASSWORD=... node tools/drive-field-photo.mjs
 */
import { chromium } from "playwright";
import { showAllTabs } from "./drive-tabs.mjs";
const CHROME = process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = process.env.BASE_URL || "http://localhost:3000";
const SHOT = process.env.SHOT_DIR || "/tmp/shots";
const { DRIVE_EMAIL: EMAIL, DRIVE_PASSWORD: PASSWORD } = process.env;
if (!EMAIL || !PASSWORD) { console.error("set DRIVE_EMAIL and DRIVE_PASSWORD"); process.exit(1); }
const b = await chromium.launch({ executablePath: CHROME });
const ctx = await b.newContext({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
await showAllTabs(page);
const problems = [];
page.on("pageerror", (e) => problems.push("pageerror: " + e.message));
const flat = (s) => s.replace(/\s+/g, " ").trim();

await page.goto(BASE, { waitUntil: "networkidle" });
await page.fill("#email", EMAIL); await page.fill("#password", PASSWORD);
await page.click("button[type=submit]"); await page.waitForSelector(".shell");

// A "camera photo": a large PNG with a fake EXIF-like marker would be
// rejected by the decoder, so take a real screenshot at 3x — 1236×2745 px.
const big = await b.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 3 });
const bp = await big.newPage(); await bp.goto(BASE, { waitUntil: "networkidle" });
const camera = await bp.screenshot(); await big.close();
console.log("camera photo:", camera.length, "bytes PNG");

const me = await (await ctx.request.get(`${BASE}/api/auth/me`)).json();
const pid = me.projects.find((x) => x.code === "DEMO").id;
const pack0 = await (await ctx.request.get(`${BASE}/api/field?projectId=${pid}`)).json();
const target = pack0.punch.find((x) => x.status === "open" && x.tag_id);
const tagNo = pack0.tags.find((t) => t.id === target.tag_id).no;
console.log("punch item:", target.punch_no, "on", tagNo, "— photos before:", target.photos.length);

await page.goto(BASE + "/field", { waitUntil: "networkidle" });
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: "networkidle" });
await page.waitForSelector("text=روی گوشی:");

await ctx.setOffline(true);
await page.goto(`${BASE}/field?p=DEMO&k=t&n=${tagNo}`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".field-step", { timeout: 15000 });
const row = page.locator("div", { has: page.locator(".field-step", { hasText: target.punch_no }) }).last();
await row.locator("input[type=file]").setInputFiles({ name: "IMG_0001.png", mimeType: "image/png", buffer: camera });
await page.waitForSelector(".photo-thumb.is-queued img");
// A new item, and its photo before either has reached the server.
await page.getByLabel("شرح Punch").fill("Drive: bolt missing on coupling guard");
await page.getByRole("button", { name: "ثبت Punch" }).click();
await page.waitForSelector("text=Punch در صف");
const raised = page.locator("div", { has: page.locator("p.queued", { hasText: "Punch در صف" }) }).last();
await raised.locator("input[type=file]").setInputFiles({ name: "IMG_0002.png", mimeType: "image/png", buffer: camera });
await page.waitForFunction(() => document.querySelectorAll(".photo-thumb.is-queued img").length === 2);
const q = await page.evaluate(async () => {
  const db = await new Promise((r) => { const o = indexedDB.open("epc-field"); o.onsuccess = () => r(o.result); });
  const all = await new Promise((r) => { const g = db.transaction("ops").objectStore("ops").getAll(); g.onsuccess = () => r(g.result); });
  return all.filter((o) => o.kind === "punch_photo").map((o) => ({ size: o.blob.size, type: o.blob.type, ref: o.payload.punchId ? "item" : "queued raise" }));
});
console.log("queued photos on the phone:", JSON.stringify(q));
console.log("queue list:", (await page.locator(".card", { has: page.locator("h2", { hasText: "صف روی این گوشی" }) }).locator(".queued").allInnerTexts()).map(flat));
await page.screenshot({ path: `${SHOT}/120-field-photo-offline.png`, fullPage: true });

await ctx.setOffline(false);
await page.reload({ waitUntil: "networkidle" });
const syncBtn = page.getByRole("button", { name: "همگام‌سازی" });
if (await syncBtn.count() && await syncBtn.isEnabled()) await syncBtn.click();
await page.waitForFunction(() => document.querySelectorAll(".queued, .photo-thumb.is-queued").length === 0, null, { timeout: 30000 }).catch(() => {});
await page.waitForTimeout(800);
console.log("after sync:", flat(await page.locator("p[role=status]").first().innerText().catch(() => "—")));
const recent = (await (await ctx.request.get(`${BASE}/api/field?projectId=${pid}&recent=1`)).json()).ops.slice(0, 3);
console.log("server received:", recent.map((o) => `${o.kind}:${o.status}${o.payload.data ? " (bytes in record!)" : ""}`).join(", "));
const pack = await (await ctx.request.get(`${BASE}/api/field?projectId=${pid}`)).json();
const item = pack.punch.find((x) => x.id === target.id);
const fresh = pack.punch.find((x) => x.description === "Drive: bolt missing on coupling guard");
console.log("photos now:", `${target.punch_no}: ${item.photos.map((f) => f.stage)}`, `· ${fresh?.punch_no}: ${fresh?.photos.map((f) => f.stage)}`);
const res = await ctx.request.get(`${BASE}/api/quality/photo?projectId=${pid}&id=${item.photos[0].id}`);
const bytes = await res.body();
console.log("served:", res.status(), res.headers()["content-type"], res.headers()["x-content-type-options"], res.headers()["cache-control"],
  `${bytes.length} bytes, JPEG ${bytes[0] === 0xff && bytes[1] === 0xd8}, EXIF ${bytes.includes(Buffer.from("Exif\0"))}`);
const anon = await (await b.newContext()).request.get(`${BASE}/api/quality/photo?projectId=${pid}&id=${item.photos[0].id}`);
console.log("without a session:", anon.status());
await page.goto(`${BASE}/field?p=DEMO&k=t&n=${tagNo}`, { waitUntil: "networkidle" });
await page.waitForSelector(".photo-thumb img");
const shown = await page.$$eval(".photo-thumb img", (xs) => xs.map((x) => `${x.naturalWidth}x${x.naturalHeight}`));
console.log("thumbnails from the server:", shown.join(", "));
await page.screenshot({ path: `${SHOT}/121-field-photo-synced.png`, fullPage: true });

// ── the desk ──
await page.setViewportSize({ width: 1366, height: 900 });
await page.goto(`${BASE}/quality`, { waitUntil: "networkidle" });
const tr = page.locator("tr", { hasText: target.punch_no });
await tr.getByRole("button", { name: "اقدام" }).click();
await page.waitForSelector(".photo-thumb img");
await page.locator(`#ps-${target.id}`).selectOption("other");
const settled = () => page.waitForFunction(() => !document.querySelector("label.photo-btn")?.textContent.includes("در حال ارسال"), null, { timeout: 15000 })
  .then(() => page.waitForTimeout(800));
await page.getByLabel("افزودن عکس").setInputFiles({ name: "desk.png", mimeType: "image/png", buffer: camera });
await settled();
console.log("quality page, the phone's photo again:", (await page.$$eval(".photo-thumb .photo-tag", (xs) => xs.map((x) => x.textContent))).join(" | "),
  "— the same bytes are the same photo");
await page.getByLabel("افزودن عکس").setInputFiles({ name: "desk.png", mimeType: "image/png", buffer: await page.screenshot() });
await settled();
console.log("quality page, a new one:", (await page.$$eval(".photo-thumb .photo-tag", (xs) => xs.map((x) => x.textContent))).join(" | "));
const html = await page.getByLabel("افزودن عکس").setInputFiles({ name: "evil.jpg", mimeType: "image/jpeg", buffer: Buffer.from("<html><script>alert(1)</script>") })
  .then(settled).then(() => page.locator("td .err").first().innerText().catch(() => "—"));
console.log("a script named .jpg:", flat(html));
await page.screenshot({ path: `${SHOT}/122-quality-photos.png`, fullPage: true });
console.log("problems:", problems.length ? problems : "none");
await b.close();
