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
  const sent = [];
  await page.route("**/api/extract", async (route) => { sent.push(route.request().postDataJSON()); await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({error:"mock provider"}) }); });
  const send = section.locator("[data-send-masked]"); assert(await send.isDisabled());
  await section.getByRole("checkbox", { name: "همهٔ لوگوها را مشخص کرده‌ام و پیش‌نمایش را بررسی کرده‌ام" }).check();
  assert(await send.isEnabled()); await send.click();
  await page.waitForFunction(() => document.querySelector('[role="alert"]') || document.querySelector('.err'), null, {timeout:120000}).catch(() => {});
  assert(sent.length >= 4, `expected mocked model passes, got ${sent.length}`);
  for (const request of sent) {
    assert(request.images.length >= 5);
    const full = request.images.find((im) => im.label === "FULL SHEET"); assert(full);
    const rgb = await page.evaluate(async (data) => { const img = new Image(); img.src = `data:image/jpeg;base64,${data}`; await img.decode(); const c = document.createElement("canvas"); c.width=img.width; c.height=img.height; const x=c.getContext("2d"); x.drawImage(img,0,0); return [...x.getImageData(Math.floor(c.width*.3),Math.floor(c.height*.3),1,1).data]; }, full.data);
    assert(rgb[0] < 15 && rgb[1] < 15 && rgb[2] < 15, `model image did not cover region: ${rgb}`);
    const n = request.images.length === 10 ? 3 : 2;
    for (let i = 1; i < request.images.length; i++) {
      const row = Math.floor((i-1)/n), col=(i-1)%n, overlap=.14/n;
      const x0=Math.max(0,col/n-overlap), y0=Math.max(0,row/n-overlap);
      const cw=Math.min(1/n+2*overlap,1-x0), ch=Math.min(1/n+2*overlap,1-y0);
      if (.3 <= x0 || .3 >= x0+cw || .3 <= y0 || .3 >= y0+ch) continue;
      const xy = [(.3-x0)/cw,(.3-y0)/ch];
      const tilePixel = await page.evaluate(async ({data,xy}) => { const img=new Image(); img.src=`data:image/jpeg;base64,${data}`; await img.decode(); const c=document.createElement("canvas"); c.width=img.width; c.height=img.height; const x=c.getContext("2d"); x.drawImage(img,0,0); return [...x.getImageData(Math.floor(c.width*xy[0]),Math.floor(c.height*xy[1]),1,1).data]; }, {data:request.images[i].data,xy});
      assert(tilePixel[0] < 15 && tilePixel[1] < 15 && tilePixel[2] < 15, `tile ${i} exposed masked point: ${tilePixel}`);
    }
  }
  await section.getByRole("button", { name: "پاک‌کردن کادرها" }).click();
  assert.equal(await section.locator("[data-redaction-result]").count(), 0);
  const prior = sent.length;
  await page.goto(`${BASE_URL}/piping`, {waitUntil:"networkidle"});
  await page.locator('input[name="iso-reader"][value="model"]').check();
  await page.locator(".drop input[type=file]").setInputFiles("eval/cases/golden/drawings/25-1004-SH1-0.pdf");
  const direct = page.locator("[data-redaction-preview]"); await direct.waitFor({timeout:120000});
  assert.equal(sent.length, prior, "direct model upload must wait for logo review");
  await direct.locator("summary").click();
  const area = direct.locator("[data-redaction-source]"), bounds=await area.boundingBox(); assert(bounds);
  await page.mouse.move(bounds.x+bounds.width*.2,bounds.y+bounds.height*.2); await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.4,bounds.y+bounds.height*.4,{steps:5}); await page.mouse.up();
  await direct.getByRole("button",{name:"ساخت پیش‌نمایش پوشیده"}).click();
  assert(await direct.locator("[data-send-masked]").isDisabled());
  console.log("sample PDF OCR, masked model requests, tile coverage and direct upload confirmation passed");
 } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
