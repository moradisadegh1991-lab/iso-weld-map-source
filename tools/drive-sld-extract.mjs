/**
 * Integration evidence for Phase 12.3 (docs/audit/phase-12-sld-intelligence.md §19): the SLD EXTRACTION against the real server, through a signed-in browser session (cookie auth).
 * There is no SLD workspace UI in this phase, so the browser is only the authenticated HTTP client.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… node tools/drive-sld-extract.mjs
 * A SYNTHETIC sheet (eval/sld) is uploaded as an SLD document, read on the server (poppler / tesseract / OpenCV), decided on and signed. Nothing here is a real drawing.
 */
import { createRequire } from "node:module";
import { pdfOf, scannedPdf } from "../eval/sld/synth.mjs";
import { CASES } from "../eval/sld/cases.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const url = process.env.DRIVE_URL || "http://localhost:3100";
const { DRIVE_EMAIL: email, DRIVE_PASSWORD: password } = process.env;
const b = await chromium.launch(), page = await (await b.newContext()).newPage();
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
const upload = (docNo, docType, pdf) => api("/api/documents", { projectId, docNo, revision: "0", sheetNo: "1/1", docType, contentType: "application/pdf", fileBase64: pdf.toString("base64") });
const sheet = (id) => pdfOf(CASES.find((c) => c.id === id).build().map((d) => d.page));

const ovBefore = JSON.stringify((await api(`/api/overview?projectId=${projectId}`)).body.documents);
const doc = await upload(`SLD-EX-${stamp}`, "sld", sheet("vector-rotated-90"));
ok("SLD document uploaded", doc.status === 201 && doc.body.document.doc_type === "sld");
const documentId = doc.body.document.id;
const r1 = await api("/api/sld/extract", { projectId, documentId });
ok("extraction files a draft (201)", r1.status === 201 && r1.body.created && r1.body.stats.symbols >= 8);
const r2 = await api("/api/sld/extract", { projectId, documentId });
ok("same file and settings again → 200, same run, no duplicate", r2.status === 200 && r2.body.created === false && r2.body.run.id === r1.body.run.id);
const g = (await api(`/api/sld?projectId=${projectId}&documentId=${documentId}&draft=1`)).body;
ok("draft carries the extraction contract, rotated page recorded (90°, landscape display)", g.draft.meta.contract.name === "sld-extraction" && g.draft.meta.pages[0].rotation === 90 && g.draft.meta.pages[0].width === 600);
ok("every item unreviewed, evidence on every item, edges empty", g.draft.items.every((i) => i.reviewStatus === "unreviewed" && i.evidence.length > 0) && g.draft.edges.length === 0);
const tr = g.draft.items.find((i) => i.cls === "transformer");
ok("transformer found with its tag and ratings as UNCONFIRMED candidates", tr && tr.attrs.tagCandidate.text === "T-101" && tr.attrs.tagCandidate.status === "unconfirmed" && tr.attrs.ratingCandidates.every((r) => r.status === "unconfirmed"));
const stale = await api("/api/sld/review", { projectId, runId: g.run.id, action: "decide", uid: tr.uid, decision: "confirm", baseHash: "0".repeat(32) });
ok("stale decision → 409 STALE_RUN", stale.status === 409 && stale.body.code === "STALE_RUN");
const dec = await api("/api/sld/review", { projectId, runId: g.run.id, action: "decide", uid: tr.uid, decision: "confirm", baseHash: g.run.payloadHash });
ok("decision accepted, stamped with the person", dec.status === 200 && dec.body.changed);
const g2 = (await api(`/api/sld?projectId=${projectId}&documentId=${documentId}&draft=1`)).body;
const t2 = g2.draft.items.find((i) => i.uid === tr.uid);
ok("confirmed item keeps original + evidence", t2.reviewStatus === "confirmed" && t2.review.by && t2.original.cls === "transformer" && t2.evidence.length === tr.evidence.length);
const re = await api("/api/sld/extract", { projectId, documentId, options: { dpi: 300 } });
ok("re-reading with different settings is refused while a person's decisions exist (409)", re.status === 409 && re.body.code === "HUMAN_DECISIONS_EXIST");
const ap = await api("/api/sld/review", { projectId, runId: g.run.id, action: "approve" });
ok("approval signs and locks", ap.status === 200 && ap.body.run.status === "approved" && ap.body.run.approvedSha256);
const locked = await api("/api/sld/review", { projectId, runId: g.run.id, action: "decide", uid: tr.uid, decision: "reject", reason: "x", baseHash: g2.run.payloadHash });
ok("decision after approval → 409 RUN_LOCKED", locked.status === 409 && locked.body.code === "RUN_LOCKED");
const iso = await upload(`ISO-EX-${stamp}`, undefined, sheet("vector-basic"));
const wrong = await api("/api/sld/extract", { projectId, documentId: iso.body.document.id });
ok("an isometric document is refused (409 NOT_AN_SLD_DOCUMENT)", wrong.status === 409 && wrong.body.code === "NOT_AN_SLD_DOCUMENT");
const junk = await upload(`SLD-EX-JUNK-${stamp}`, "sld", Buffer.from("%PDF-1.4\nnot a pdf"));
const jr = await api("/api/sld/extract", { projectId, documentId: junk.body.document.id });
ok("a corrupt file → 422 PDF_UNREADABLE with a code, no draft", jr.status === 422 && jr.body.code === "PDF_UNREADABLE" && (await api(`/api/sld?projectId=${projectId}&documentId=${junk.body.document.id}`)).body.drafts.length === 0);
const sc = CASES.find((c) => c.id === "vector-basic"); const v = pdfOf(sc.build().map((d) => d.page)); const img = scannedPdf(v, { dpi: 150 });
const sdoc = await upload(`SLD-EX-SCAN-${stamp}`, "sld", pdfOf([{ width: img.Wu, height: img.Hu, image: img }]));
const sr = await api("/api/sld/extract", { projectId, documentId: sdoc.body.document.id, options: { dpi: 200 } });
ok("a scanned sheet is read by OCR + OpenCV (or TOOL_MISSING names the package)", (sr.status === 201 && sr.body.run.items > 5) || (sr.status === 501 && sr.body.code === "TOOL_MISSING"));
ok("the isometric overview does not list SLD documents", JSON.stringify((await api(`/api/overview?projectId=${projectId}`)).body.documents).indexOf("SLD-EX-") === -1 && ovBefore.indexOf("SLD-EX-") === -1);
ok("/piping still loads", (await page.goto(`${url}/piping`, { waitUntil: "networkidle" })) && (await page.locator(".shell").count()) > 0);
out.pageErrors = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();
process.exit(Object.values(out.checks).every(Boolean) && !errs.length ? 0 : 1);
