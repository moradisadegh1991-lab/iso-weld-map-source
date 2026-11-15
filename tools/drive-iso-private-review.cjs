/** Runs against an isolated test server configured with a fake same-host vision service and a fake Gemini key. */
const { chromium } = require('playwright');
const { BASE_URL, DRIVE_EMAIL, DRIVE_PASSWORD, DRIVE_PROJECT = 'DEMO', CHROME_PATH } = process.env;
if (!BASE_URL || !DRIVE_EMAIL || !DRIVE_PASSWORD) throw new Error('Set BASE_URL, DRIVE_EMAIL and DRIVE_PASSWORD for a dedicated test project');
const assert = require('node:assert/strict');
(async () => {
 const browser = await chromium.launch({...(CHROME_PATH ? { executablePath: CHROME_PATH } : {})});
 const context = await browser.newContext(); const page=await context.newPage(); const requests=[];
 page.on('request',r=>requests.push(new URL(r.url()).pathname));
 await page.goto(BASE_URL,{waitUntil:'networkidle'});
 await page.fill('#email',DRIVE_EMAIL); await page.fill('#password',DRIVE_PASSWORD); await page.click('button[type=submit]'); await page.waitForSelector('.shell');
 const me=await page.evaluate(()=>fetch('/api/auth/me').then(r=>r.json())); const project=me.projects.find(p=>p.code===DRIVE_PROJECT); assert(project); await page.locator('.topbar select').selectOption(`p:${project.id}`); await page.evaluate(()=>localStorage.setItem('epc.isoReader','model'));
 await page.goto(`${BASE_URL}/piping`,{waitUntil:'networkidle'});
 assert(await page.locator('input[name=iso-reader][value=local]').isChecked()); await page.check('input[name=iso-reader][value=model]'); assert(await page.getByRole('note').isVisible()); await page.check('input[name=iso-reader][value=local]');
 const read = page.waitForResponse(r=>r.url().includes('/api/read-local') && r.request().method()==='POST',{timeout:120000});
 await page.locator('.drop input[type=file]').setInputFiles('eval/cases/golden/drawings/25-1004-SH1-0.pdf');
 const response=await read; const body=await response.json(); assert.equal(response.status(),200,JSON.stringify(body)); assert.equal(body.marks.length,15);
 assert(requests.includes('/api/read-local')); assert(!requests.includes('/api/extract'));
 await page.locator('[data-local-ai-review] button').click(); await page.getByText('Review marker 12 manually').waitFor(); assert.equal(await page.locator('[data-local-ai-proposals] span[title="manual check"]').count(),1); assert(requests.includes('/api/iso-local-review'));
 const blocked=await page.evaluate(async (projectId)=>{const r=await fetch('/api/extract',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({projectId,pass:'meta',model:'gemini-4-argon',images:[{data:'YQ=='}]})}); return {status:r.status,body:await r.json()};},project.id);
 assert.equal(blocked.status,403); assert.equal(blocked.body.code,'ISO_EXTERNAL_BLOCKED');
 console.log('default OCR, stale browser preference, sample PDF and model warning passed'); await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
