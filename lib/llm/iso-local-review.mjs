/** A vision review against the server operator's trusted, same-host model only. */
export function localReviewUrl(value) {
  let url;
  try { url = new URL(String(value || "")); } catch { throw new Error("LOCAL_MODEL_UNCONFIGURED"); }
  // A numeric loopback avoids DNS rebinding. No URL credentials, queries or fragments.
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash)
    throw new Error("LOCAL_MODEL_UNCONFIGURED");
  return `${url.href.replace(/\/+$/, "")}/chat/completions`;
}

export async function reviewIsoLocally({ url, model, image, marks, bom = [], fetchImpl = fetch }) {
  const endpoint = localReviewUrl(url);
  if (typeof model !== "string" || !model.trim() || model.length > 200) throw new Error("LOCAL_MODEL_UNCONFIGURED");
  if (typeof image !== "string" || image.length > 3_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) throw new Error("LOCAL_REVIEW_IMAGE");
  if (!Array.isArray(marks) || marks.length > 500) throw new Error("LOCAL_REVIEW_MARKS");
  const candidates = marks.map((m) => ({ no: String(m?.no ?? "").slice(0, 40), shape: String(m?.shape ?? "").slice(0, 40),
    at: Array.isArray(m?.at) && m.at.length === 2 && m.at.every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ? m.at : null }));
  if (!Array.isArray(bom) || bom.length > 500) throw new Error("LOCAL_REVIEW_MARKS");
  const materials = bom.map((b) => ({ pt: Number.isInteger(b?.pt) ? b.pt : null, group: String(b?.group ?? "").slice(0, 80),
    description: String(b?.description ?? "").slice(0, 200), diam: String(b?.diam ?? "").slice(0, 80),
    stockCode: String(b?.stockCode ?? "").slice(0, 80), qty: Number.isFinite(b?.qty) ? b.qty : null }));
  const response = await fetchImpl(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(90000),
    headers: { "content-type": "application/json" }, body: JSON.stringify({ model, stream: false, max_tokens: 1000,
      messages: [{ role: "user", content: [
        { type: "text", text: `Review the drawing and OCR weld-marker and BOM candidates. Identify possible missing, extra or unreadable welds or material items. Return JSON only: {"notes":["text"],"welds":[{"no":"printed number or empty", "x":0.5, "y":0.5, "reason":"why to inspect"}]}. Coordinates x and y are fractions of the image from the top left. Give coordinates only for points visible in this image; use an empty welds array if unsure. Never invent a number, dimensions, weld type, classification or approval. Output is only a proposal for an engineer. OCR candidates: ` + JSON.stringify(candidates) + "\nOCR BOM candidates: " + JSON.stringify(materials) },
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${image}` } },
      ] }] }) });
  if (!response.ok) throw new Error("LOCAL_MODEL_FAILED");
  const text = (await response.json())?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim() || text.length > 12000) throw new Error("LOCAL_MODEL_RESPONSE");
  let result;
  try { result = JSON.parse(text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "")); } catch { throw new Error("LOCAL_MODEL_RESPONSE"); }
  if (!Array.isArray(result?.notes) || !Array.isArray(result?.welds) || result.notes.length > 50 || result.welds.length > 50 ||
      !result.notes.every((n) => typeof n === "string" && n.length <= 500) ||
      !result.welds.every((w) => w && typeof w.no === "string" && w.no.length <= 40 && typeof w.reason === "string" && w.reason.length <= 500 &&
        [w.x, w.y].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1))) throw new Error("LOCAL_MODEL_RESPONSE");
  return { notes: result.notes, welds: result.welds.map(({ no, x, y, reason }) => ({ no, x, y, reason })) };
}
