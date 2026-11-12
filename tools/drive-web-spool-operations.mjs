/**
 * Lost-response/refresh-failure browser checks on /piping/execution.
 * Creates synthetic runs attached to a sample PDF and warehouse catalogue items in a dedicated TEST project.
 * DRIVE_URL, DRIVE_PROJECT (code), DRIVE_EMAIL, DRIVE_PASSWORD required; CHROME_PATH optional.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DEMO } from "../lib/demo.js";
const { chromium } = createRequire(import.meta.url)("playwright");
const { DRIVE_URL: base, DRIVE_PROJECT: projectCode, DRIVE_EMAIL: email, DRIVE_PASSWORD: password } = process.env;
if (!base || !projectCode || !email || !password) throw new Error("Set DRIVE_URL, DRIVE_PROJECT, DRIVE_EMAIL, DRIVE_PASSWORD for a dedicated test project");
const pdf = readFileSync(process.argv[2] || new URL("../docs/AISPC-10-DE-930-PI-ISO-0001-REV A0 .pdf", import.meta.url)).toString("base64");
const b = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const context = await b.newContext({ viewport: { width: 1500, height: 1050 } });
const page = await context.newPage(), errors = [], checks = {};
page.on("pageerror", (e) => errors.push(e.message));
let prompts = 0, mode = "", dropped = false, dropRefresh = false, droppedRefresh = false, lostOp = null;
const posts = [];
page.on("dialog", async (d) => { if (d.type() === "prompt") { prompts++; await d.accept("browser retry yard stock"); } else await d.accept(); });
const waitFor = async (predicate, label) => {
  const until = Date.now() + 15000;
  while (Date.now() < until) { if (await predicate()) return; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error(`Timed out: ${label}`);
};
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click('button[type="submit"]'); await page.waitForSelector(".shell");
  await page.route("**/api/piping/execution*", async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === "POST") {
      const cmd = req.postDataJSON();
      if (cmd.kind === "activity" && cmd.code === "fit_up") {
        posts.push(cmd);
        if (cmd.materialOverride && mode === "lost" && !dropped) {
          const response = await route.fetch(); assert.equal(response.status(), 200, await response.text());
          lostOp = cmd.opId; dropped = true; await route.abort("failed"); return;
        }
        if (cmd.materialOverride && mode === "refresh" && !droppedRefresh) dropRefresh = true;
      }
    } else if (req.method() === "GET" && url.searchParams.has("spoolId") && dropRefresh) {
      dropRefresh = false; droppedRefresh = true; await route.abort("failed"); return;
    }
    await route.continue();
  });
  let seq = 0;
  const fixture = async () => {
    mode = "";
    const value = await page.evaluate(async ({ pdf, demo, projectCode, seq }) => {
      const api = async (url, body) => {
        const r = await fetch(url, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        const data = await r.json(); if (!r.ok) throw new Error(JSON.stringify({ status: r.status, data })); return data;
      };
      const project = (await api("/api/projects")).projects.find((p) => p.code === projectCode);
      if (!project) throw new Error("Dedicated test project not found");
      const projectId = project.id, lineNo = `WEB-RETRY-${Date.now()}-${seq}`;
      const d = await api("/api/documents", { projectId, docNo: lineNo, revision: "0", fileBase64: pdf, contentType: "application/pdf" });
      demo.meta.drawingNo = lineNo; demo.meta.lineNo = lineNo;
      await api("/api/runs", { projectId, documentId: d.document.id, lineNo, payload: demo });
      const board = await api(`/api/piping/execution?projectId=${projectId}`);
      const sp = board.board.find((s) => s.lineNo === lineNo);
      if (!sp) throw new Error("Fixture spool missing");
      const detail = await api(`/api/piping/execution?projectId=${projectId}&spoolId=${sp.spoolId}`);
      for (const l of detail.material.lines.filter((l) => l.stockCode)) await api("/api/warehouse", {
        projectId, kind: "item", code: l.stockCode, description: "Browser test material", category: l.kind === "pipe" ? "pipe" : "fitting", uom: l.uom,
      });
      const now = new Date().toISOString().slice(0, 10);
      await api("/api/piping/execution", { projectId, kind: "activity", spoolId: sp.spoolId, code: "released", doneAt: now, opId: crypto.randomUUID() });
      return { projectId, lineNo, spoolId: sp.spoolId, spoolNo: sp.spoolNo };
    }, { pdf, demo: structuredClone(DEMO), projectCode, seq: ++seq });
    await page.goto(`${base}/piping/execution`, { waitUntil: "networkidle" });
    const row = page.locator("tr").filter({ hasText: value.lineNo }).filter({ has: page.getByRole("link", { name: value.spoolNo, exact: true }) });
    await row.getByRole("button", { name: /^(مراحل|Steps|الخطوات)$/ }).click();
    const detailRow = row.locator("xpath=following-sibling::tr[1]");
    const button = detailRow.locator(".card").filter({ hasText: /فیت|Fit-up/ }).getByRole("button", { name: /ثبت انجام|Record as done|تسجيل الإنجاز/ });
    await button.waitFor();
    return { ...value, button };
  };
  const history = (f) => page.evaluate(async ({ projectId, spoolId }) => {
    const r = await fetch(`/api/piping/execution?projectId=${projectId}&spoolId=${spoolId}`);
    const d = await r.json(); return d.overrides.filter((o) => o.same_spool && o.code === "fit_up");
  }, { projectId: f.projectId, spoolId: f.spoolId });
  const pending = (f) => page.evaluate((id) => Object.keys(sessionStorage).filter((k) => k.startsWith("piping-op:v1:") && k.includes(id))
    .map((k) => JSON.parse(sessionStorage.getItem(k))), f.spoolId);
  const retry = async (f) => {
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/piping/execution"));
    await f.button.click(); const r = await response;
    assert.equal(r.status(), 200); assert.equal((await r.json()).replayed, true);
    await waitFor(async () => (await pending(f)).length === 0, "acknowledgement after successful refresh");
  };

  const first = await fixture(); mode = "lost";
  await first.button.click();
  await waitFor(() => dropped && first.button.isEnabled(), "server commit followed by lost response");
  const saved = await pending(first);
  assert.equal(saved[0].command.opId, lostOp);
  assert.equal(saved[0].command.materialOverride, "browser retry yard stock");
  checks.completeCommandRetainedAfterLostResponse = true;
  const beforePrompts = prompts;
  await retry(first);
  assert.equal(posts.at(-1).opId, lostOp); assert.equal(prompts, beforePrompts);
  checks.retryKeepsUuidAndDoesNotAskForAnotherReason = true;
  assert.equal((await history(first)).length, 1);
  checks.lostResponseCreatesOneOverride = true;

  const second = await fixture(); mode = "refresh";
  await second.button.click();
  await waitFor(() => droppedRefresh && second.button.isEnabled(), "successful save followed by refresh failure");
  const savedSecond = await pending(second);
  assert.equal(savedSecond.length, 1);
  checks.successfulSaveRetainedUntilRefresh = true;
  await retry(second);
  assert.equal(posts.at(-1).opId, savedSecond[0].command.opId);
  assert.equal((await history(second)).length, 1);
  checks.refreshFailureRetryCreatesOneOverride = true;

  const third = await fixture(); mode = "";
  const count = posts.length;
  await page.evaluate(() => Object.defineProperty(window, "sessionStorage", { configurable: true, get() { throw new DOMException("blocked", "SecurityError"); } }));
  await third.button.click();
  await page.getByText(/ذخیره‌سازی مرورگر|Enable browser storage|فعّل تخزين المتصفح/).waitFor();
  assert.equal(posts.length, count);
  checks.unavailableStorageSendsNothing = true;
  assert.deepEqual(errors, []); checks.noPageErrors = true;
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} finally { await b.close(); }
