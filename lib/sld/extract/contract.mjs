/**
 * The SLD extraction CONTRACT (Phase 12.3) — a versioned, backward-compatible layer ON TOP of the Phase 12.2 envelope (lib/sld/envelope.mjs, unchanged).
 * A draft opts in with `meta.contract = { name: "sld-extraction", version: 1 }`; a draft without it (Phase 12.2 opaque drafts) is not touched by any rule here.
 *
 *   item: { uid, kind: symbol|text|line, cls, page, bbox [0..1], bboxPt [display pt], text, textNormalized, confidence, confidenceBasis, method,
 *           basis: observed|inferred, classBasis, evidence: [{ source, ref, page, bboxPt, detail }], alternatives, attrs, warnings, associations, reviewStatus, review?, original? }
 *   edges: ALWAYS empty in this contract (extraction candidates are items; connectivity is Phase 12.4)
 *
 * A MACHINE (OCR, rules, model) can only produce reviewStatus "unreviewed". "confirmed" / "rejected" / "corrected" exist only with a person's `review` stamp
 * (by, at), made through `applyDecision`; the original machine values stay in `original`, the evidence is never removed.
 */
export const CONTRACT = Object.freeze({ name: "sld-extraction", version: 1 });
export const EVIDENCE_SOURCES = Object.freeze(["pdf_text_span", "ocr_text_block", "vector_primitive", "image_region", "symbol_detector", "model_interpretation"]);
export const REVIEW_STATUS = Object.freeze(["unreviewed", "confirmed", "rejected", "corrected"]);
const KINDS = new Set(["symbol", "text", "line"]);

import { CLASS_IDS } from "./vocab.mjs";

const bad = (message, details) => Object.assign(new Error(message), { status: 400, code: "INVALID_EXTRACTION", ...(details ? { details } : {}) });
export const isExtraction = (env) => env?.meta?.contract?.name === CONTRACT.name;

/**
 * @param origin "machine" (ingest of an extraction) | "human" (a person's edit). Throws 400 INVALID_EXTRACTION listing the first problems.
 */
export function validateExtractionContent(env, { origin = "machine" } = {}) {
  if (!isExtraction(env)) return env;
  const errs = [], push = (i, m) => { if (errs.length < 20) errs.push(`${i === null ? "draft" : `items[${i}]`}: ${m}`); };
  if (env.meta.contract.version !== CONTRACT.version) push(null, `contract version ${env.meta.contract.version} is not supported (expected ${CONTRACT.version})`);
  if (env.edges.length) push(null, "edges must be empty in the extraction contract (connectivity is not extracted)");
  const pages = Array.isArray(env.meta.pages) ? env.meta.pages : [];
  const pageOf = new Map(pages.map((p) => [p.number, p]));
  const uids = new Set();
  env.items.forEach((it, i) => {
    if (typeof it.uid !== "string" || !it.uid) return push(i, "uid is required");
    if (uids.has(it.uid)) push(i, `duplicate uid ${it.uid}`); uids.add(it.uid);
    if (!KINDS.has(it.kind)) push(i, `kind «${it.kind}» is not one of ${[...KINDS].join(", ")}`);
    if (!CLASS_IDS.has(it.cls)) push(i, `class «${it.cls}» is not in the vocabulary`);
    const pg = pageOf.get(it.page);
    if (!pg) push(i, `page ${it.page} is not a page of the draft`);
    if (!Array.isArray(it.bbox) || it.bbox.length !== 4 || it.bbox.some((v) => typeof v !== "number" || v < 0 || v > 1) || it.bbox[2] < it.bbox[0] || it.bbox[3] < it.bbox[1]) push(i, "bbox must be [x0,y0,x1,y1] within [0,1]");
    if (!Array.isArray(it.bboxPt) || it.bboxPt.length !== 4 || it.bboxPt.some((v) => typeof v !== "number")) push(i, "bboxPt must be four numbers");
    else if (pg && (it.bboxPt[0] < -0.01 || it.bboxPt[1] < -0.01 || it.bboxPt[2] > pg.width + 0.01 || it.bboxPt[3] > pg.height + 0.01)) push(i, "bboxPt lies outside the page");
    if (typeof it.confidence !== "number" || it.confidence < 0 || it.confidence > 1) push(i, "confidence must be a number in [0,1]");
    if (!REVIEW_STATUS.includes(it.reviewStatus)) push(i, `reviewStatus «${it.reviewStatus}» is not one of ${REVIEW_STATUS.join(", ")}`);
    if (!Array.isArray(it.evidence) || !it.evidence.length) push(i, "evidence is required: every decision must be inspectable");
    else for (const e of it.evidence) if (!EVIDENCE_SOURCES.includes(e?.source)) { push(i, `evidence source «${e?.source}» is not recognised`); break; }
    if (it.reviewStatus !== "unreviewed") {
      if (origin === "machine") push(i, `a machine reading cannot set reviewStatus «${it.reviewStatus}»`);
      else if (!it.review?.by || !it.review?.at) push(i, `reviewStatus «${it.reviewStatus}» needs review.by and review.at (a person's decision)`);
    }
  });
  if (errs.length) throw bad(`the extraction draft is not valid: ${errs[0]}`, { problems: errs });
  return env;
}

/**
 * A person's decision on ONE item, as a pure transform of the draft payload (the repo applies it under the stale-edit check).
 *   confirm · reject · reclassify { cls } · set { attrs }
 * The machine's values are kept in `original` the first time an item is changed; `review.history` keeps every decision; evidence is untouched.
 */
export function applyDecision(env, { uid, decision, cls, attrs, reason = null, userId, now = new Date().toISOString() }) {
  const i = env.items.findIndex((x) => x.uid === uid);
  if (i < 0) throw Object.assign(new Error(`no item ${uid} in this draft`), { status: 404, code: "ITEM_NOT_FOUND" });
  if (!userId) throw bad("a decision needs the deciding person");
  const it = env.items[i];
  const status = { confirm: "confirmed", reject: "rejected", reclassify: "corrected", set: "corrected" }[decision];
  if (!status) throw bad(`unknown decision «${decision}»`);
  if (decision === "reclassify" && !CLASS_IDS.has(cls)) throw bad(`class «${cls}» is not in the vocabulary`);
  if ((decision === "reject" || decision === "reclassify") && !String(reason || "").trim()) throw bad("a reason is required to reject or reclassify");
  if (decision === "set" && (typeof attrs !== "object" || attrs === null || Array.isArray(attrs))) throw bad("attrs must be an object");
  const next = { ...it, original: it.original ?? { cls: it.cls, attrs: it.attrs, text: it.text ?? null, textNormalized: it.textNormalized ?? null, confidence: it.confidence, method: it.method } };
  if (decision === "reclassify") { next.cls = cls; next.classBasis = "human"; }
  if (decision === "set") next.attrs = { ...it.attrs, ...attrs };
  next.reviewStatus = status;
  const entry = { decision, status, by: userId, at: now, reason: reason ? String(reason).slice(0, 400) : null, ...(decision === "reclassify" ? { from: it.cls, to: cls } : {}) };
  next.review = { status, by: userId, at: now, reason: entry.reason, history: [...(it.review?.history ?? []), entry] };
  const items = env.items.slice(); items[i] = next;
  return { ...env, items };
}
