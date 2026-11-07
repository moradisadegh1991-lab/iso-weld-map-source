/**
 * Model-assisted interpretation (Phase 12.3) — OPTIONAL, and bounded: the model sees a TEXT description of the symbols the rules left UNKNOWN (their shape evidence and the
 * words near them), never the drawing's pixels, and may only SUGGEST a class. A suggestion is added to the item's `alternatives` (source "model") with a confidence capped
 * at MODEL_CAP and a `model_interpretation` evidence entry; the item's class, status and every other value stay as the rules left them. A model cannot create an item,
 * cannot confirm anything and cannot suggest a topology-only class. Everything it returns is validated here; anything else is dropped and counted.
 */
import { CLASS_IDS, TOPOLOGY_CLASSES, UNKNOWN } from "./vocab.mjs";
import { box } from "./geometry.mjs";

export const MODEL_CAP = 0.5;
export const MAX_ASSIST_ITEMS = 60;
const CLASSES_FOR_PROMPT = [...CLASS_IDS].filter((c) => c !== UNKNOWN && !TOPOLOGY_CLASSES.has(c) && !["connection_line", "text_label", "equipment_tag", "voltage_annotation", "rating_annotation", "cable_annotation"].includes(c));

/** the unknown symbols (with the nearest text) to ask about */
export function assistCandidates(draft, { limit = MAX_ASSIST_ITEMS } = {}) {
  const texts = draft.items.filter((i) => i.kind === "text");
  return draft.items.filter((i) => i.kind === "symbol" && i.cls === UNKNOWN).slice(0, limit).map((i) => ({
    uid: i.uid, page: i.page, rule: i.evidence.find((e) => e.source === "symbol_detector")?.ref ?? null,
    shape: i.evidence.filter((e) => e.source === "vector_primitive" || e.source === "image_region").map((e) => e.note || `${e.detail?.type}`).slice(0, 6),
    sizePt: [Math.round(box.w(i.bboxPt) * 10) / 10, Math.round(box.h(i.bboxPt) * 10) / 10],
    nearText: texts.filter((t) => t.page === i.page && box.gap(i.bboxPt, t.bboxPt) < 40).slice(0, 5).map((t) => t.text),
    ruleAlternatives: i.alternatives }));
}

export function assistPrompt(cands) {
  return `You help read an electrical single-line diagram. For each UNKNOWN symbol below, the shape rules could not decide its class. You are given only a text description (shape facts and nearby printed words), not the picture.
Reply with JSON only: {"suggestions":[{"uid":"…","class":"<one of the allowed classes>","confidence":0..1,"reason":"…"}]}. Omit a symbol you cannot place; never invent one. Do not suggest a class from a nearby word alone.
Allowed classes: ${CLASSES_FOR_PROMPT.join(", ")}.
SYMBOLS:\n${JSON.stringify(cands)}`;
}

/** apply a (parsed) model reply to a copy of the draft. @returns { draft, accepted: n, rejected: [{uid, why}] } */
export function sanitizeSuggestions(draft, reply, { provider = null, model = null } = {}) {
  const list = Array.isArray(reply?.suggestions) ? reply.suggestions : [];
  const byUid = new Map(draft.items.map((i, n) => [i.uid, n]));
  const items = draft.items.slice(), rejected = [];
  let accepted = 0;
  for (const s of list.slice(0, MAX_ASSIST_ITEMS * 2)) {
    const n = byUid.get(s?.uid);
    if (n === undefined) { rejected.push({ uid: String(s?.uid ?? "").slice(0, 60), why: "no such item" }); continue; }
    const it = items[n];
    if (it.kind !== "symbol" || it.cls !== UNKNOWN) { rejected.push({ uid: it.uid, why: "only UNKNOWN symbols can receive a suggestion" }); continue; }
    if (!CLASS_IDS.has(s.class) || s.class === UNKNOWN || TOPOLOGY_CLASSES.has(s.class)) { rejected.push({ uid: it.uid, why: `class «${String(s.class).slice(0, 40)}» is not allowed` }); continue; }
    const conf = Math.min(MODEL_CAP, Math.max(0, Number(s.confidence) || 0));
    items[n] = { ...it, alternatives: [...it.alternatives, { cls: s.class, confidence: Math.round(conf * 100) / 100, source: "model" }],
      evidence: [...it.evidence, { source: "model_interpretation", ref: model || "model", page: it.page, bboxPt: it.bboxPt, detail: { provider, model, suggested: s.class, reason: String(s.reason ?? "").slice(0, 200), capped: Number(s.confidence) > MODEL_CAP } }],
      warnings: it.warnings.includes("MODEL_SUGGESTION") ? it.warnings : [...it.warnings, "MODEL_SUGGESTION"] };
    accepted++;
  }
  return { draft: { ...draft, items }, accepted, rejected };
}
