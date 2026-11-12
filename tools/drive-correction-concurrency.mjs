/**
 * Production-build browser check for versioned correction saves in two windows.
 * Creates one synthetic document/run in DRIVE_PROJECT (a dedicated TEST project code).
 * Requires a running server and an existing test account. No model call or PDF extraction.
 * DRIVE_URL=... DRIVE_PROJECT=... DRIVE_EMAIL=... DRIVE_PASSWORD=... [CHROME_PATH=...] node tools/drive-correction-concurrency.mjs
 */
import { createRequire } from "node:module";
import assert from "node:assert/strict";
import { DEMO } from "../lib/demo.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const { DRIVE_EMAIL: email, DRIVE_PASSWORD: password, DRIVE_URL: base, DRIVE_PROJECT: projectCode } = process.env;
if (!email || !password || !base || !projectCode) throw new Error("Set DRIVE_EMAIL, DRIVE_PASSWORD, DRIVE_URL and DRIVE_PROJECT (the dedicated test project's code)");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors = [], checks = {};
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click('button[type="submit"]');
  await page.waitForSelector(".shell");
  checks.passwordLogin = true;
  const made = await page.evaluate(async ({ payload, projectCode }) => {
    const call = async (url, body) => {
      const response = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(JSON.stringify({ status: response.status, data }));
      return data;
    };
    const project = (await call("/api/projects")).projects.find((p) => p.code === projectCode);
    if (!project) throw new Error(`Test project ${projectCode} not found`);
    const projectId = project.id;
    const documentId = (await call("/api/documents", { projectId, docNo: `CORRECTION-BROWSER-${Date.now()}`, revision: "0", noFile: true })).document.id;
    const runId = (await call("/api/runs", { projectId, documentId, lineNo: "BROWSER-TEST", payload })).run.id;
    return { projectId, documentId, runId };
  }, { payload: structuredClone(DEMO), projectCode });
  const second = await context.newPage();
  second.on("pageerror", (e) => errors.push(e.message));
  const open = async (p) => {
    await p.goto(`${base}/piping`, { waitUntil: "networkidle" });
    await p.locator(`tr[data-key="${made.runId}"] button`).first().click();
    await p.waitForSelector(".tabnav");
  };
  await open(page); await open(second);
  checks.twoWindowsOpenedSameRun = true;
  const edit = async (p, note) => {
    await p.locator('.tabnav button[title="دادهٔ خام و ویرایش"]').click();
    const editor = p.locator(".pane textarea");
    const payload = JSON.parse(await editor.inputValue()); payload.meta.browserNote = note;
    await editor.fill(JSON.stringify(payload, null, 2));
    await p.locator('.tabnav button[title="ثبت و تأیید"]').click();
    const response = p.waitForResponse((r) => r.url().includes(`/api/runs/${made.runId}/edits`) && r.request().method() === "POST");
    await p.getByRole("button", { name: "اعمال و ثبت اصلاح", exact: true }).click();
    const r = await response; return { status: r.status(), body: await r.json() };
  };
  const one = await edit(page, "first-window");
  assert.equal(one.status, 200, JSON.stringify(one.body));
  assert.equal(one.body.payloadHash.length, 32);
  checks.validBrowserSave = true;
  const stale = await edit(second, "stale-window");
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_RUN");
  await second.waitForSelector('[data-edit-state="STALE_RUN"]');
  await second.waitForSelector("[data-reload-run]");
  checks.staleWindowShowsReload = true;
  const saved = await page.evaluate(async ({ projectId, runId }) =>
    (await fetch(`/api/runs/${runId}?projectId=${projectId}`)).json(), made);
  assert.equal(saved.payload.meta.browserNote, "first-window");
  assert.equal(saved.run.payloadHash, one.body.payloadHash);
  checks.staleWindowDidNotOverwrite = true;
  checks.responseTokenMatchesStoredVersion = true;
  await second.locator("[data-reload-run]").click();
  await second.waitForSelector('.tabnav button[title="رجیستر جوش‌ها"][aria-current="page"]');
  const next = await edit(second, "fresh-window");
  assert.equal(next.status, 200, JSON.stringify(next.body));
  checks.reloadAllowsNextSave = true;
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} finally {
  await browser.close();
}
