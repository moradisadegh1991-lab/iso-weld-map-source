/**
 * Read-only provenance UI checks after real register re-derivation/run/revision changes.
 * Creates synthetic runs attached to a sample PDF and material overrides in a dedicated TEST project.
 * Requires DRIVE_URL, DRIVE_PROJECT (code), DRIVE_EMAIL, DRIVE_PASSWORD; CHROME_PATH optional.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { DEMO } from "../lib/demo.js";
import { translate } from "../lib/i18n/index.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const { DRIVE_URL: base, DRIVE_PROJECT: projectCode, DRIVE_EMAIL: email, DRIVE_PASSWORD: password } = process.env;
if (!base || !projectCode || !email || !password) throw new Error("Set explicit test server, project and credentials");
const pdf = readFileSync(process.argv[2] || new URL("../docs/AISPC-10-DE-930-PI-ISO-0001-REV A0 .pdf", import.meta.url)).toString("base64");
const b = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await (await b.newContext({ viewport: { width: 1500, height: 1050 } })).newPage();
const checks = {}, errors = []; let unknownContract = false;
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, body) => page.evaluate(async ({ path, body }) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", headers: { "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const data = await r.json(); if (!r.ok) throw new Error(JSON.stringify({ status: r.status, data })); return data;
}, { path, body });
try {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.fill("#email", email); await page.fill("#password", password);
  await page.click('button[type="submit"]'); await page.waitForSelector(".shell");
  await page.route("**/api/piping/execution*", async (route) => {
    const url = new URL(route.request().url());
    if (unknownContract && route.request().method() === "GET" && url.searchParams.has("spoolId")) {
      const response = await route.fetch(), body = await response.json();
      body.overrides = body.overrides.map((o, i) => {
        const copy = { ...o }; if (i === 0) delete copy.match_basis; else copy.match_basis = 7; return copy;
      });
      await route.fulfill({ response, json: body }); return;
    }
    await route.continue();
  });
  const project = (await api("/api/projects")).projects.find((p) => p.code === projectCode);
  assert(project, "dedicated test project not found");
  const projectId = project.id, docNo = `HISTORY-${Date.now()}`, lineNo = `${docNo}-LINE`;
  const payload = (qty = 12.6, revision = "0") => {
    const p = structuredClone(DEMO); p.meta.drawingNo = docNo; p.meta.lineNo = lineNo; p.meta.rev = revision;
    p.bom[0].qty = qty; return p;
  };
  const document = async (revision) => (await api("/api/documents", {
    projectId, docNo, revision, sheetNo: "1/1", fileBase64: pdf, contentType: "application/pdf",
  })).document.id;
  const savedRun = async (documentId, data) => {
    const made = await api("/api/runs", { projectId, documentId, lineNo, payload: data });
    return api(`/api/runs/${made.run.id}?projectId=${projectId}`);
  };
  const target = async (run, no = null) => {
    const { board } = await api(`/api/piping/execution?projectId=${projectId}`);
    const w = board.find((w) => w.lineNo === lineNo && (!no || w.spoolNo === no));
    assert(w, "test spool missing from current execution board"); return { id: w.spoolId, no: w.spoolNo };
  };
  const detail = (spool) => api(`/api/piping/execution?projectId=${projectId}&spoolId=${spool.id}`);
  const override = async (spool, reason) => {
    const d = await detail(spool);
    for (const l of d.material.lines.filter((l) => l.stockCode)) await api("/api/warehouse", {
      projectId, kind: "item", code: l.stockCode, description: "History test material", category: l.kind === "pipe" ? "pipe" : "fitting", uom: l.uom,
    });
    for (const code of ["released", "fit_up"]) await api("/api/piping/execution", {
      projectId, kind: "activity", spoolId: spool.id, code, doneAt: new Date().toISOString().slice(0, 10),
      opId: crypto.randomUUID(), ...(code === "fit_up" ? { materialOverride: reason } : {}),
    });
  };
  const open = async (spool) => {
    const boardResponse = page.waitForResponse((r) => {
      const u = new URL(r.url()); return r.request().method() === "GET" && u.pathname === "/api/piping/execution" && !u.searchParams.has("spoolId");
    });
    await page.goto(`${base}/piping/execution`, { waitUntil: "networkidle" });
    const board = (await (await boardResponse).json()).board, index = board.findIndex((s) => s.spoolId === spool.id);
    assert(index >= 0, "target not on the current execution board");
    const row = page.locator("table.dtable").first().locator("tbody > tr").nth(index);
    await row.getByRole("button", { name: /^(مراحل|Steps|الخطوات)$/ }).click();
    await page.waitForSelector("[data-history-basis]");
  };
  const basis = (name) => page.locator(`[data-history-basis="${name}"]`);
  const snapshot = ({ match_basis, same_spool, ...event }) => event;
  const docA = await document("0");
  let r = await savedRun(docA, payload(40)), sp = await target(r);
  const no = sp.no;
  await override(sp, "history original decision");
  const firstEvent = (await detail(sp)).overrides[0];
  await open(sp);
  assert.equal(await basis("exact_spool").count(), 1);
  assert.equal(await basis("exact_spool").getAttribute("data-history-exact"), "true");
  checks.directRecordIsIdentified = true;

  await api(`/api/runs/${r.run.id}/edits`, { projectId, payload: payload(), baseHash: r.run.payloadHash, reason: "browser re-derivation" });
  r = await api(`/api/runs/${r.run.id}?projectId=${projectId}`); sp = await target(r, no);
  await open(sp);
  assert.equal(await basis("same_run_number_unverified").count(), 1);
  assert.equal(await page.locator('[data-history-exact="true"]').count(), 0);
  checks.sameRunReDerivationIsUnverified = true;

  r = await savedRun(docA, payload()); sp = await target(r, no);
  await open(sp);
  assert.equal(await basis("same_revision_number_unverified").count(), 1);
  checks.newRunOnSameRevisionIsUnverified = true;

  const docB = await document("B"); r = await savedRun(docB, payload(12.6, "B")); sp = await target(r, no);
  await override(sp, "history current decision"); await open(sp);
  assert.equal(await basis("exact_spool").count(), 1);
  assert.equal(await basis("cross_revision_number_unverified").count(), 1);
  checks.currentAndHistoricalAssociationsStayDistinct = true;
  const old = (await detail(sp)).overrides.find((o) => o.id === firstEvent.id);
  assert.deepEqual(snapshot(old), snapshot(firstEvent));
  checks.originalAuditEventIsUnchanged = true;

  for (const lang of ["fa", "en", "ar"]) {
    await api("/api/auth/prefs", { lang }); await open(sp);
    await page.waitForFunction((lang) => document.documentElement.lang === lang, lang);
    assert.equal((await basis("exact_spool").textContent()).trim(), translate(lang, "pi.ex.ovr.match.exact"));
    assert.equal((await basis("cross_revision_number_unverified").textContent()).trim(), translate(lang, "pi.ex.ovr.match.cross_revision_number_unverified"));
  }
  checks.labelsWorkInThreeLanguages = true;
  await page.setViewportSize({ width: 390, height: 844 }); await open(sp);
  assert(await basis("cross_revision_number_unverified").isVisible());
  checks.mobileHistoryRemainsReadable = true;

  unknownContract = true; await open(sp);
  assert.equal(await basis("unknown").count(), 2);
  assert.equal(await page.locator('[data-history-exact="true"]').count(), 0);
  checks.missingAndInvalidEvidenceStayUnknown = true;
  assert.deepEqual(errors, []); checks.noPageErrors = true;
  console.log(JSON.stringify({ checks, pageErrors: errors }, null, 2));
} finally {
  await api("/api/auth/prefs", { lang: "fa" }).catch(() => {});
  await b.close();
}
