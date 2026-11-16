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
  const img = section.locator("[data-redaction-result] img").first(); await img.waitFor();
  const pixel = await img.evaluate(async (im) => { await im.decode(); const c = document.createElement("canvas"); c.width = im.naturalWidth; c.height = im.naturalHeight; const x = c.getContext("2d"); x.drawImage(im, 0, 0); return [...x.getImageData(Math.floor(c.width * 0.3), Math.floor(c.height * 0.3), 1, 1).data]; });
  assert(pixel[0] < 5 && pixel[1] < 5 && pixel[2] < 5, `expected black preview pixel: ${pixel}`);
  const fingerprint = await section.locator("[data-redaction-result]").evaluate(async (el) => {
    const items = [...el.querySelectorAll("[data-redaction-image]")].map((e) => {
      const [header, data] = e.querySelector("img").getAttribute("src").split(",");
      return [e.dataset.imageLabel, header.slice(5, header.indexOf(";")), data];
    });
    const bytes = new TextEncoder().encode(JSON.stringify(items));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return { expected: el.dataset.previewSha256, actual: [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join(""), count: items.length };
  });
  assert.equal(fingerprint.actual, fingerprint.expected); assert.equal(fingerprint.count, 5);
  const issue = section.locator("[data-receipt-issue]"); assert(await issue.isDisabled(), "must inspect all tiles before requesting a receipt");
  for (let i = 0; i < fingerprint.count; i++) {
    const detail = section.locator(`[data-redaction-image="${i}"]`);
    if (!(await detail.evaluate((el) => el.open))) await detail.locator("summary").click();
    await detail.locator("input[type=checkbox]").check();
  }
  assert(await issue.isEnabled());
  const issuedResponse = page.waitForResponse((r) => r.url().includes("/api/iso-redaction-receipt") && r.request().method() === "POST");
  await issue.click(); const issued = await issuedResponse; assert.equal(issued.status(), 200);
  const issuedBody = await issued.json(); assert.equal(issuedBody.digest, fingerprint.expected); assert(issuedBody.receipt);
  await section.locator("[data-receipt-verify]").click();
  await section.getByText("تصاویر با رسید موقت همین نشست مطابقت دارند.").waitFor();
  const altered = await section.locator("[data-redaction-result]").evaluate(async (el, { projectId, receipt }) => {
    const images = [...el.querySelectorAll("[data-redaction-image]")].map((e) => ({ label: e.dataset.imageLabel, mediaType: "image/jpeg", data: e.querySelector("img").getAttribute("src").split(",")[1] }));
    const original = images[0].data; const at = Math.floor(original.length / 2);
    images[0].data = original.slice(0, at) + (original[at] === "A" ? "B" : "A") + original.slice(at + 1);
    const res = await fetch(`/api/iso-redaction-receipt?projectId=${projectId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "verify", images, receipt }) });
    return { status: res.status, body: await res.json() };
  }, { projectId: project.id, receipt: issuedBody.receipt });
  assert.equal(altered.status, 200); assert.equal(altered.body.valid, false);
  assert(!paths.includes("/api/extract") && !paths.includes("/api/iso-local-review"), "preview must not call a model");
  // Hold hashing open while the reviewer changes a mask: stale results must never reappear.
  await page.evaluate(() => { const original = crypto.subtle.digest.bind(crypto.subtle); Object.defineProperty(crypto.subtle, "digest", { configurable: true, value: (...args) => new Promise((resolve, reject) => setTimeout(() => original(...args).then(resolve, reject), 1200)) }); });
  await section.getByRole("button", { name: "ساخت پیش‌نمایش پوشیده" }).click();
  await section.getByRole("button", { name: "پاک‌کردن کادرها" }).click();
  await page.waitForTimeout(1700);
  assert.equal(await section.locator("[data-redaction-result]").count(), 0);
  // An HTTP origin can lack Web Crypto: preview remains usable, with no claimed fingerprint.
  await page.evaluate(() => Object.defineProperty(crypto, "subtle", { configurable: true, value: undefined }));
  await source.scrollIntoViewIfNeeded(); const second = await source.boundingBox();
  await page.mouse.move(second.x + second.width * 0.2, second.y + second.height * 0.2); await page.mouse.down();
  await page.mouse.move(second.x + second.width * 0.4, second.y + second.height * 0.4, { steps: 4 }); await page.mouse.up();
  await section.getByRole("button", { name: "ساخت پیش‌نمایش پوشیده" }).click();
  const httpResult = section.locator("[data-redaction-result]"); await httpResult.waitFor();
  assert.equal(await httpResult.getAttribute("data-preview-sha256"), null);
  assert((await httpResult.innerText()).includes("HTTPS"));
  console.log("sample PDF OCR, local masking preview and no model request passed");
 } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
