/**
 * Browser/API evidence for Phase 12.2 (docs/audit/phase-12-sld-intelligence.md §16.3): SLD document intake and isolated draft persistence, against the real server
 * through a signed-in browser session (cookie auth).
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… node tools/drive-sld-intake.mjs
 * A SYNTHETIC envelope is filed (there is no real SLD sample); nothing here interprets its content. Checks: unknown document type refused; an SLD document filed through
 * the normal upload route; draft ingest idempotent; stale edit 409; approval records who/when/hash and locks; the isometric weld-register figures (overview, review queue)
 * do not move; the isometric run routes refuse the SLD run; /piping still loads.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const url = process.env.DRIVE_URL || "http://localhost:3100";
const { DRIVE_EMAIL: email, DRIVE_PASSWORD: password } = process.env;
const b = await chromium.launch(), page = await (await b.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = [], out = { checks: {} };
page.on("pageerror", (e) => errs.push(e.message));
const ok = (k, v) => { out.checks[k] = Boolean(v); };
await page.goto(url, { waitUntil: "networkidle" });
await page.fill("#email", email); await page.fill("#password", password); await page.click("button[type=submit]"); await page.waitForSelector(".shell");
const api = (path, body) => page.evaluate(async ([path, body]) => {
  const r = await fetch(path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);
const projectId = (await api("/api/projects")).body.projects[0].id;
const stamp = Date.now() % 1e6;
const upload = (docNo, docType, extra = {}) => api("/api/documents", { projectId, docNo, revision: "0", sheetNo: "1/1", ...(docType === undefined ? {} : { docType }), contentType: "application/pdf", fileBase64: Buffer.from(`synthetic ${docNo}`).toString("base64"), ...extra });

const ovBefore = (await api(`/api/overview?projectId=${projectId}`)).body.documents;
const queueBefore = JSON.stringify((await api(`/api/review-queue?projectId=${projectId}`)).body);

const bad = await upload(`SLD-DRV-BAD-${stamp}`, "datasheet");
ok("unknown document type → 400 INVALID_DOC_TYPE", bad.status === 400 && bad.body.code === "INVALID_DOC_TYPE");
const doc = await upload(`SLD-DRV-${stamp}`, "sld");
ok("SLD document filed through the normal upload route", doc.status === 201 && doc.body.document.doc_type === "sld");
const conflict = await upload(`SLD-DRV-${stamp}`, "pid", {}); ok("same number as another type → 200 same row only if identical type; a different type is 409", conflict.status === 409 && conflict.body.code === "DOC_TYPE_CONFLICT");
const documentId = doc.body.document.id;
const env = (hash, items) => ({ kind: "sld", schema: 1, meta: { note: "synthetic drive envelope" }, page: { number: 1, width: 1000, height: 800 }, items, edges: [], source: { kind: "synthetic-drive", reader: "drive", hash, generatedAt: new Date().toISOString() } });
const i1 = await api("/api/sld", { projectId, documentId, draft: env(`d-${stamp}`, [{ opaque: 1 }, { opaque: 2 }]) });
ok("draft filed (201, pass sld, extracted)", i1.status === 201 && i1.body.run.status === "extracted");
const i2 = await api("/api/sld", { projectId, documentId, draft: env(`d-${stamp}`, [{ opaque: 1 }, { opaque: 2 }]) });
ok("same reading again → 200, same run (idempotent)", i2.status === 200 && i2.body.created === false && i2.body.run.id === i1.body.run.id);
const runId = i1.body.run.id, h0 = i1.body.run.payloadHash;
const g = (await api(`/api/sld?projectId=${projectId}&documentId=${documentId}&draft=1`)).body;
ok("draft readable with its payloadHash", g.run.payloadHash === h0 && g.draft.items.length === 2);
const e1 = await api("/api/sld/review", { projectId, runId, action: "edit", draft: env(`d-${stamp}`, [{ opaque: 1 }]), baseHash: h0, reason: "drive edit" });
ok("edit with the current baseHash → 200 changed", e1.status === 200 && e1.body.changed === true);
const e2 = await api("/api/sld/review", { projectId, runId, action: "edit", draft: env(`d-${stamp}`, []), baseHash: h0 });
ok("edit on a stale baseHash → 409 STALE_RUN", e2.status === 409 && e2.body.code === "STALE_RUN");
const iso = await api(`/api/runs/${runId}?projectId=${projectId}`);
ok("the isometric run route refuses the SLD run → 409 NOT_AN_ISOMETRIC_RUN", iso.status === 409 && iso.body.code === "NOT_AN_ISOMETRIC_RUN");
const isoApprove = await api(`/api/runs/${runId}/approve`, { projectId });
ok("the isometric approve route refuses the SLD run", isoApprove.status === 409 && isoApprove.body.code === "NOT_AN_ISOMETRIC_RUN");
const ap = await api("/api/sld/review", { projectId, runId, action: "approve" });
ok("approval records approver, time and sha256 and locks", ap.status === 200 && ap.body.run.status === "approved" && ap.body.run.approvedBy && ap.body.run.approvedAt && /^[0-9a-f]{64}$/.test(ap.body.run.approvedSha256));
const g2 = (await api(`/api/sld?projectId=${projectId}&documentId=${documentId}&draft=1`)).body;
const e3 = await api("/api/sld/review", { projectId, runId, action: "edit", draft: env(`d-${stamp}`, []), baseHash: g2.run.payloadHash });
ok("edit after approval → 409 RUN_LOCKED", e3.status === 409 && e3.body.code === "RUN_LOCKED");
const ovAfter = (await api(`/api/overview?projectId=${projectId}`)).body.documents;
ok("overview (weld registers) unchanged by the SLD document, draft and approval", JSON.stringify(ovAfter) === JSON.stringify(ovBefore));
ok("review queue unchanged", JSON.stringify((await api(`/api/review-queue?projectId=${projectId}`)).body) === queueBefore);
await page.goto(`${url}/piping`, { waitUntil: "networkidle" }); await page.waitForTimeout(500);
ok("/piping still loads without page errors", errs.length === 0);
await b.close();
console.log(JSON.stringify({ ...out, pageErrors: errs }, null, 1));
