/** Real page and sample-PDF preview, in an isolated test project. */
const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const { BASE_URL, DRIVE_EMAIL, DRIVE_PASSWORD, DRIVE_PROJECT = "DEMO", CHROME_PATH } = process.env;
if (!BASE_URL || !DRIVE_EMAIL || !DRIVE_PASSWORD) throw Error("Set explicit test server and test credentials");
(async () => {
 const browser = await chromium.launch({ headless: true, ...(CHROME_PATH ? { executablePath: CHROME_PATH } : {}) });
 try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), paths = [];
  page.on("request", (r) => paths.push(new URL(r.url()).pathname));
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.fill("#email", DRIVE_EMAIL); await page.fill("#password", DRIVE_PASSWORD);
  await page.click("button[type=submit]"); await page.waitForSelector(".shell");
  const me = await page.evaluate(() => fetch("/api/auth/me").then((r) => r.json()));
  const project = me.projects.find((p) => p.code === DRIVE_PROJECT); assert(project);
  await page.locator(".topbar select").selectOption(`p:${project.id}`);
  await page.goto(`${BASE_URL}/piping`, { waitUntil: "networkidle" });
  const response = page.waitForResponse((r) => r.url().includes("/api/read-local") && r.request().method() === "POST", { timeout: 120000 });
  await page.locator(".drop input[type=file]").setInputFiles("eval/cases/golden/drawings/25-1004-SH1-0.pdf");
  const read = await response; assert.equal(read.status(), 200, JSON.stringify(await read.json()));
  const section = page.locator("[data-redaction-preview]"); await section.locator("summary").click();
  const source = section.locator("[data-redaction-source]"), rect = await source.boundingBox(); assert(rect?.width > 0 && rect?.height > 0);
  await page.mouse.move(rect.x + rect.width * 0.2, rect.y + rect.height * 0.2); await page.mouse.down();
  await page.mouse.move(rect.x + rect.width * 0.4, rect.y + rect.height * 0.4, { steps: 5 }); await page.mouse.up();
  await section.getByRole("button", { name: "ساخت پیش‌نمایش پوشیده" }).click();
  const img = section.locator("[data-redaction-result] img"); await img.waitFor();
  const pixel = await img.evaluate(async (im) => { await im.decode(); const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext("2d"); x.drawImage(im, 0, 0); return [...x.getImageData(Math.floor(c.width * 0.3), Math.floor(c.height * 0.3), 1, 1).data]; });
  assert(pixel[0] < 5 && pixel[1] < 5 && pixel[2] < 5, `expected black preview pixel: ${pixel}`);
  assert(!paths.includes("/api/extract") && !paths.includes("/api/iso-local-review"), "preview must not call a model");
  await section.getByRole("button", { name: "پاک‌کردن کادرها" }).click();
  assert.equal(await section.locator("[data-redaction-result]").count(), 0);
  console.log("sample PDF OCR, local masking preview and no model request passed");
 } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
