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
  await page.route("**/api/extract", async (route) => {
    sent.push(route.request().postDataJSON());
    if (sent.length > 1) { await route.fulfill({status:502,contentType:"application/json",body:JSON.stringify({error:"mock failure"})}); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({data:{notes:["check BOM"],welds:[{no:"W7",x:.3,y:.3,reason:"check"}]},model:"fake",usage:{input_tokens:100,output_tokens:20},ms:10}) });
  });
  const review = section.locator("[data-review-masked]"); assert(await review.isDisabled());
  await section.getByRole("checkbox", { name: "همهٔ لوگوها را مشخص کرده‌ام و پیش‌نمایش را بررسی کرده‌ام" }).check();
  assert(await review.isEnabled()); await review.click();
  await page.locator("[data-local-ai-proposals]").waitFor({timeout:120000});
  assert.equal(sent.length,1); assert.equal(sent[0].pass,"ocr_review");
  assert(Array.isArray(sent[0].ocrContext.marks) && sent[0].ocrContext.marks.length > 0);
  const full=sent[0].images.find((im)=>im.label==="FULL SHEET"); assert(full);
  const rgb=await page.evaluate(async (data)=>{const im=new Image();im.src=`data:image/jpeg;base64,${data}`;await im.decode();const c=document.createElement("canvas");c.width=im.width;c.height=im.height;const x=c.getContext("2d");x.drawImage(im,0,0);return [...x.getImageData(Math.floor(c.width*.3),Math.floor(c.height*.3),1,1).data]},full.data);
  assert(rgb[0]<15 && rgb[1]<15 && rgb[2]<15, `mask missing: ${rgb}`);
  assert((await page.locator("[data-local-ai-proposals]").innerText()).includes("W7"));
  assert(await section.locator("[data-send-masked]").isEnabled());
  await review.click();
  await page.locator("[data-local-ai-review] .err").waitFor({timeout:120000});
  assert.equal(sent.length,2,"a failed review is not automatically retried");
  console.log("sample PDF OCR and one masked model review passed");
 } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
