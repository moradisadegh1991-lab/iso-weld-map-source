/** Bound the OCR context sent to a model; never trust browser-supplied object shapes. */
export function ocrReviewContext(input) {
  if (!input || !Array.isArray(input.marks) || input.marks.length > 500 || !Array.isArray(input.bom) || input.bom.length > 500) throw new Error("INVALID_OCR_CONTEXT");
  const text = (v, n) => String(v ?? "").slice(0, n);
  return {
    marks: input.marks.map((m) => ({ no: text(m?.no, 40), shape: text(m?.shape, 40),
      at: Array.isArray(m?.at) && m.at.length === 2 && m.at.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) ? m.at : null })),
    bom: input.bom.map((b) => ({ pt: Number.isInteger(b?.pt) ? b.pt : null, group: text(b?.group, 80), description: text(b?.description, 200),
      diam: text(b?.diam, 80), stockCode: text(b?.stockCode, 80), qty: Number.isFinite(b?.qty) ? b.qty : null })),
  };
}

/** Invalid or partial output is not an engineering verdict. */
export function checkedOcrReview(value) {
  if (!value || !Array.isArray(value.notes) || value.notes.length > 50 || !Array.isArray(value.welds) || value.welds.length > 50 ||
      !value.notes.every((n) => typeof n === "string" && n.length <= 500) ||
      !value.welds.every((w) => w && typeof w.no === "string" && w.no.length <= 40 && typeof w.reason === "string" && w.reason.length <= 500 &&
        [w.x, w.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1))) return null;
  return { notes: value.notes, welds: value.welds.map(({ no, x, y, reason }) => ({ no, x, y, reason })) };
}
