export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { authenticate } from "../../../../lib/server/session.mjs";
import { withProject } from "../../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../../lib/authz.mjs";
import { ingestDraft, sldDocumentFile } from "../../../../lib/db/repos/sld.mjs";
import { extractSld } from "../../../../lib/sld/extract/run.mjs";
import { assistCandidates, assistPrompt, sanitizeSuggestions } from "../../../../lib/sld/extract/model.mjs";
import { getStore } from "../../../../lib/storage/index.mjs";
import { createLlmRouter } from "../../../../lib/llm/index.mjs";
import { resolveEndpoints } from "../../../../lib/db/repos/llm-endpoints.mjs";
import { parseLoose, cleanJsonText } from "../../../../lib/llm/parse.mjs";
import { recordUsage, monthTokens, monthlyLimit } from "../../../../lib/llm/accounting.mjs";
import { createLimiter } from "../../../../lib/sld/extract/limiter.mjs";
import { readerMissing, readerMissingText } from "../../../../lib/server/reader-deps.mjs";

/**
 * SLD extraction (Phase 12.3) — read the stored file of an SLD document and file the result as a DRAFT (lib/db/repos/sld.mjs).
 *   POST { projectId, documentId, options?: { mode: auto|native|ocr|both, dpi, lang, maxPages, assist?: <model id> }, acknowledgeHumanDecisions? }
 *   → 201 { run, created: true, stats, warnings } · 200 { run, created: false } when this file + settings were already read (no duplicate draft)
 * Needs RUN_EXTRACTION and EDIT_EXTRACTION. The document must be type 'sld' (409 NOT_AN_SLD_DOCUMENT). Nothing is approved or promoted: every item is `unreviewed`.
 * A re-reading with different settings is refused while a person's decisions exist (409 HUMAN_DECISIONS_EXIST) unless acknowledged — then it is ADDED beside the old draft.
 * Errors carry a code: FILE_TOO_LARGE 413, UNSUPPORTED_FILE 415, TOO_MANY_PAGES 413, PDF_ENCRYPTED/PDF_UNREADABLE 422, PAGE_TOO_COMPLEX 413, EXTRACTION_TIMEOUT 504,
 * TOOL_MISSING 501 (names the package), EXTRACTION_BUSY 429 (retry), NO_FILE 404. A failed reading writes nothing; repeating the request is safe.
 */
const limiter = createLimiter(Number(process.env.SLD_EXTRACT_CONCURRENCY) > 0 ? Number(process.env.SLD_EXTRACT_CONCURRENCY) : 2);
const out = (e) => {
  const status = e?.status || 500;
  if (status >= 500 && !e?.code) { console.error("sld extract:", e); return Response.json({ error: "internal error", code: "INTERNAL" }, { status: 500 }); }
  return Response.json({ error: e.message, code: e.code, ...(e.details ? { details: e.details } : {}) }, { status });
};

export async function POST(request) {
  let release = null;
  try {
    const raw = await request.text();
    if (raw.length > 100_000) return Response.json({ error: "the request body is too large", code: "PAYLOAD_TOO_LARGE" }, { status: 413 });
    let b; try { b = JSON.parse(raw); } catch { b = null; }
    if (!b || typeof b !== "object") return Response.json({ error: "a JSON body is required" }, { status: 400 });
    if (!b.projectId || !b.documentId) return Response.json({ error: "projectId and documentId are required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId: b.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RUN_EXTRACTION);
    assertCan(membership, ACTIONS.EDIT_EXTRACTION);

    // the document (project scope, type 'sld') and its file — the database connection is released before the slow part
    const doc = await withProject(db, b.projectId, () => sldDocumentFile(db, { projectId: b.projectId, documentId: b.documentId }));
    if (!doc.storageUri || /^(pending|none):\/\//.test(doc.storageUri)) return Response.json({ error: "this document has no stored file", code: "NO_FILE" }, { status: 404 });
    const bytes = Buffer.from(await (await getStore()).get(doc.storageUri));

    release = limiter.acquire();
    if (!release) return Response.json({ error: "the server is reading other diagrams; try again shortly", code: "EXTRACTION_BUSY" }, { status: 429, headers: { "Retry-After": "20" } });
    let result;
    try { result = await extractSld(bytes, b.options && typeof b.options === "object" ? b.options : {}); }
    catch (e) {
      if (e?.code === "TOOL_MISSING" || e?.code === "RASTER_READER_FAILED") { const m = await readerMissing().catch(() => []); if (m.length) return Response.json({ error: readerMissingText(m), code: "TOOL_MISSING", missing: m.map((x) => x.pkg) }, { status: 501 }); }
      throw e;
    }
    let { draft } = result;
    const warnings = [...result.warnings];

    // optional model assistance: suggestions only, after the rules, never fatal
    if (draft.meta.config.assist) {
      try {
        const cands = assistCandidates(draft);
        if (cands.length) {
          const { endpoints } = await withProject(db, b.projectId, () => resolveEndpoints(db, { projectId: b.projectId }));
          const client = createLlmRouter({ endpoints }).clientFor(draft.meta.config.assist);
          const limit = monthlyLimit();
          const spent = limit != null ? await withProject(db, b.projectId, () => monthTokens(db, { projectId: b.projectId })) : 0;
          if (!client.configured) warnings.push({ code: "ASSIST_NOT_CONFIGURED", provider: client.id });
          else if (limit != null && spent >= limit) warnings.push({ code: "ASSIST_MONTHLY_LIMIT" });
          else {
            const t0 = Date.now();
            let o = null;
            try { o = await client.complete({ model: draft.meta.config.assist, maxTokens: 2000, temperature: 0, images: [], prompt: assistPrompt(cands) }); }
            catch (e) { warnings.push({ code: "ASSIST_FAILED", reason: e.code || "LLM_ERROR" }); }
            const parsed = o?.text?.trim() ? parseLoose(cleanJsonText(o.text)) : null;
            await withProject(db, b.projectId, () => recordUsage(db, { projectId: b.projectId, userId: user?.id, provider: client.id, via: client.via || null, model: o?.model || draft.meta.config.assist, pass: "sld-assist", usage: o?.usage, ok: !!parsed, errorCode: parsed ? null : o ? "LLM_BAD_JSON" : "LLM_ERROR", stopReason: o?.stopReason, ms: Date.now() - t0 })).catch(() => {});
            if (parsed) {
              const s = sanitizeSuggestions(draft, parsed, { provider: client.id, model: o.model });
              draft = s.draft; if (s.rejected.length) warnings.push({ code: "ASSIST_SUGGESTIONS_REJECTED", count: s.rejected.length });
              draft.meta = { ...draft.meta, assist: { provider: client.id, model: o.model, accepted: s.accepted, rejected: s.rejected.length } };
            }
          }
        }
      } catch (e) { warnings.push({ code: "ASSIST_FAILED", reason: String(e?.code || "error") }); }
    }

    const r = await withProject(db, b.projectId, () => ingestDraft(db, { projectId: b.projectId, documentId: b.documentId, draft, userId: user.id,
      protectHumanDecisions: true, acknowledgeHumanDecisions: b.acknowledgeHumanDecisions === true }));
    return Response.json({ ...r, stats: draft.meta.stats, warnings }, { status: r.created ? 201 : 200 });
  } catch (e) { return out(e); }
  finally { if (release) release(); }
}
