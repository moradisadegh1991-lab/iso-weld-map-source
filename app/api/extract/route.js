export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby caps this at 60 s; Pro honours up to 300 s.
export const maxDuration = 300;

import { ELL90, ELL45, TEE_C } from "../../../lib/standards";

/* Give the model the real B16.9 take-outs instead of one hard-coded size —
   it can then self-check every dimension it reads, at any diameter. */
const TAKEOUT_TABLE = (() => {
  const sizes = Object.keys(ELL90).map(Number).sort((a, b) => a - b);
  const row = (n) => `  ${String(n).padStart(2)}"  ELL90 ${String(ELL90[n]).padStart(4)}   ELL45 ${String(ELL45[n]).padStart(4)}   TEE ${String(TEE_C[n]).padStart(4)}`;
  return sizes.map(row).join("\n");
})();

const COMMON = `You are a senior piping engineer reading a piping isometric drawing.

You are given the FULL SHEET plus overlapping high-resolution QUADRANT crops of the same
drawing. Use the quadrants to read small text and the full sheet for overall routing.
The quadrants overlap, so the same item may appear twice - do not double count it.

Return ONLY a JSON object. No markdown fences, no preamble, no commentary, no explanation.
Be terse: no trailing prose, no repeated fields.
ALL COORDINATES AND LENGTHS IN MILLIMETRES.
If a value is genuinely unreadable use null and list it in "unreadable". Never invent a number.

ASME B16.9 centre-to-face, mm (LR elbows; TEE keyed on the RUN size):
${TAKEOUT_TABLE}

Use this table to verify every dimension you read. On these drawings the dimension printed
between a fitting vertex and the adjacent weld equals the table value PLUS the pup length
from the DETAIL note. If a dimension you read does not decompose that way, you have
mis-read either the dimension or the fitting type — re-read the quadrant crop before answering.`;

const META_PROMPT = `${COMMON}

Extract ONLY the title block, line data and bill of material. Do NOT output geometry.

{
  "meta": {
    "drawingNo": string, "rev": string, "sheet": string, "project": string,
    "unit": string, "area": string, "pipingClass": string,
    "nps": number, "schedule": string, "clLengthM": number|null,
    "testFluid": string, "testPressureBarg": number|null,
    "insulation": string, "heatTrace": string,
    "pipeSpec": string, "fittingSpec": string,
    "pupLength": number|null, "pupNote": string,
    "mtoCoversWholeLine": boolean
  },
  "bom": [{ "pt": number, "group": string, "description": string,
            "diam": number, "stockCode": string, "qty": number }],
  "notes": [string],
  "unreadable": [string]
}

"pupLength" is set only when a DETAIL note adds short pipe pieces at every fitting
(e.g. "pipe length 150 mm typ."). Otherwise null.
Keep each BOM "description" under 90 characters.
Set "mtoCoversWholeLine" true when the sheet is one of several (e.g. SHEET 2/2) and the
quantities plainly cover the whole line rather than this sheet alone.
"pupLength" applies per fitting END: a tee with three ends therefore consumes 3 x pupLength.`;

const NODES_PROMPT = `${COMMON}

Extract ONLY the route geometry. Do NOT output the BOM or the title block.

{
  "nps": number,
  "nodes": [{ "id": string,
              "type": "tie-in"|"elbow90"|"elbow45"|"tee"|"reducer"|"flange-wn"|"valve-bw"|"valve-flanged",
              "ref": string,
              "E": number, "N": number, "EL": number }],
  "edges": [{ "from": string, "to": string, "nps": number }],
  "unreadable": [string]
}

The route is a GRAPH, not a chain. "edges" lists every pipe leg and its own nominal
size in inches. A tee therefore has THREE incident edges and a branch runs to its own
tie-in node. For a single unbranched line the edges simply chain the nodes in order.

CRITICAL RULES
1. "nodes" must be ordered along the pipe route, from the first tie-in to the last tie-in.
2. Tie-in coordinates are printed on the drawing. Derive INTERMEDIATE node coordinates
   (fitting vertices) from the running dimensions. A fitting node coordinate is the
   intersection of the two centrelines, NOT a weld point.
3. Cross-check every node against the B16.9 table above before you output it.
4. "ref" holds the continuation drawing number for tie-in nodes, "" otherwise.
5. Do NOT number welds and do NOT define spools. That is computed downstream.
6. A reduced tee (e.g. 32X18) is ONE node with three edges: two collinear run edges at
   the run size and one branch edge at the branch size. Give each edge its correct "nps".
7. Every "FOR CONT. SEE ..." callout is its own tie-in node, including continuations to
   another SHEET of the same drawing. A sheet with three callouts has three tie-in nodes.
8. NEVER refuse and NEVER explain. If you cannot work out the intermediate fitting
   vertices, still output every tie-in node whose coordinates are printed on the drawing,
   and name what is missing in "unreadable". An incomplete node list is useful;
   prose is not. Your entire reply must be the JSON object and nothing else.`;

const REPAIR_PROMPT = `${COMMON}

Below is a JSON extraction of this drawing together with the automated checks that FAILED.
A failed check means a number was mis-read — the standards arithmetic does not lie.

Re-read the drawing crops and return the SAME JSON structure, corrected. Keep every field
that was already right. Change only what the failed checks point at. Common causes, in order
of likelihood:
  - a digit mis-read in a running dimension (6 vs 8, 1 vs 7, 3 vs 9)
  - a fitting typed as elbow90 when the drawing shows elbow45, or vice versa
  - a missing node: a fitting present on the drawing but absent from the node list
  - a missing edge, especially the branch leg of a tee
  - "pupLength" wrong, which shifts every take-out at once
  - the MTO covers several sheets while the geometry is one sheet - if so set
    meta.mtoCoversWholeLine true and leave the geometry alone

HARD RULES FOR THIS PASS
  - NEVER delete a node or an edge unless a failed check explicitly names it as spurious.
    Deleting geometry to make a check pass is a failure, not a fix. Prefer correcting a
    coordinate, a type or a size over removing anything.
  - The result must keep AT LEAST two tie-in nodes and at least as many nodes as the input,
    unless a check literally says a node is duplicated.
  - "nps" must be one of the diameters listed in the MTO DIAM column. If your previous answer
    disagrees with the MTO, the MTO wins.
  - If you cannot find the mis-read number, return the input UNCHANGED with
    repairNotes ["no change - could not identify the error"]. That is a valid, correct answer.

Return the corrected object with the same keys as the input, plus "repairNotes": [string]
saying what you changed and why. Nothing else.`;

const PASSES = {
  meta: { prompt: META_PROMPT, maxTokens: 4000 },
  nodes: { prompt: NODES_PROMPT, maxTokens: 4000 },
  repair: { prompt: REPAIR_PROMPT, maxTokens: 5000 },
};

/** Parse JSON, and if it was cut off mid-structure, close it and retry. */
function parseLoose(t) {
  try { return JSON.parse(t); } catch { /* fall through */ }
  let inStr = false, esc = false;
  const stack = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  let s = t;
  if (inStr) s = s.slice(0, s.lastIndexOf('"'));
  s = s.replace(/,\s*$/, "");
  s = s.replace(/,\s*"[^"]*"?\s*:?\s*[^,{}[\]]*$/, "");
  for (let i = stack.length - 1; i >= 0; i--) s += stack[i] === "{" ? "}" : "]";
  try { return JSON.parse(s); } catch { return null; }
}

export async function POST(req) {
  const started = Date.now();
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "بدنه درخواست خوانده نشد؛ احتمالاً از سقف ۴.۵ مگابایت Vercel رد شده." }, { status: 413 });
    }

    const { images, imageBase64, mediaType, apiKey, model, pass, json, issues } = body || {};
    const cfg = PASSES[pass] || PASSES.meta;

    const list = Array.isArray(images) && images.length
      ? images
      : imageBase64
        ? [{ label: "FULL SHEET", data: imageBase64, mediaType: mediaType || "image/jpeg" }]
        : [];
    if (!list.length) return Response.json({ error: "تصویری دریافت نشد." }, { status: 400 });

    const bytes = list.reduce((a, i) => a + (i.data ? i.data.length : 0), 0);
    if (bytes > 4_000_000) {
      return Response.json({ error: `حجم ارسالی ${(bytes / 1e6).toFixed(1)} MB و بیش از سقف Vercel است.` }, { status: 413 });
    }

    const keyToUse = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!keyToUse) {
      return Response.json({
        error: "کلید API تنظیم نشده. ANTHROPIC_API_KEY را در Vercel \u203a Settings \u203a Environment Variables بگذارید یا کلید را در صفحه وارد کنید.",
      }, { status: 400 });
    }

    const content = [];
    list.forEach((im) => {
      content.push({ type: "text", text: `--- ${im.label || "IMAGE"} ---` });
      content.push({ type: "image", source: { type: "base64", media_type: im.mediaType || "image/jpeg", data: im.data } });
    });
    content.push({ type: "text", text: cfg.prompt });
    if (pass === "repair") {
      content.push({ type: "text", text:
        `CURRENT EXTRACTION:\n${JSON.stringify(json)}\n\nFAILED CHECKS:\n` +
        (issues || []).map((i) => `- ${i}`).join("\n") });
    }

    const chosen = model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5";

    // Stream so the upstream connection stays active for the whole generation.
    let r;
    try {
      r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": keyToUse, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model: chosen,
          max_tokens: cfg.maxTokens,
          temperature: 0,
          stream: true,
          messages: [
            { role: "user", content },
            // Prefilling the assistant turn with "{" makes prose physically
            // impossible — the model can only continue the JSON object.
            { role: "assistant", content: "{" },
          ],
        }),
      });
    } catch (e) {
      return Response.json({ error: "اتصال به Anthropic API برقرار نشد: " + String(e.message || e) }, { status: 502 });
    }

    if (!r.ok || !r.body) {
      const t = await r.text().catch(() => "");
      let hint = "";
      if (r.status === 401) hint = " \u2014 کلید API نامعتبر است.";
      else if (r.status === 429) hint = " \u2014 محدودیت نرخ؛ کمی بعد دوباره تلاش کنید.";
      else if (/model/i.test(t)) hint = ` \u2014 نام مدل «${chosen}» پذیرفته نشد؛ در صفحه مدل دیگری وارد کنید.`;
      return Response.json({ error: `Anthropic API ${r.status}: ${t.slice(0, 250)}${hint}` }, { status: 502 });
    }

    // Collect the SSE stream into the full text.
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "", text = "", usage = null, stopReason = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let ev;
        try { ev = JSON.parse(payload); } catch { continue; }
        if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text += ev.delta.text;
        if (ev.type === "message_delta") {
          if (ev.usage?.output_tokens != null) usage = { ...(usage || {}), output_tokens: ev.usage.output_tokens };
          if (ev.delta?.stop_reason) stopReason = ev.delta.stop_reason;
        }
        if (ev.type === "message_start" && ev.message?.usage?.input_tokens != null) {
          usage = { ...(usage || {}), input_tokens: ev.message.usage.input_tokens };
        }
        if (ev.type === "error") {
          return Response.json({ error: "Anthropic stream error: " + JSON.stringify(ev.error).slice(0, 250) }, { status: 502 });
        }
      }
    }

    const label = pass || "meta";

    if (!text.trim()) {
      return Response.json({
        error: `پاس «${label}»: مدل هیچ متنی برنگرداند (stop_reason: ${stopReason || "نامشخص"}).`,
      }, { status: 502 });
    }

    // The assistant turn was prefilled with "{", so put it back.
    let cleaned = ("{" + text).replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = cleaned.indexOf("{");
    const e = cleaned.lastIndexOf("}");
    if (e > s) cleaned = cleaned.slice(s, e + 1);
    else cleaned = cleaned.slice(s);

    const parsed = parseLoose(cleaned);
    if (!parsed) {
      return Response.json({
        error: `پاس «${label}»: خروجی مدل JSON معتبری نبود` +
          (stopReason === "max_tokens" ? " و به سقف توکن خورد (بریده شد)." : `. stop_reason: ${stopReason || "نامشخص"}.`),
        raw: cleaned.slice(0, 800),
        stopReason,
      }, { status: 502 });
    }

    return Response.json({
      data: parsed, usage, model: chosen, ms: Date.now() - started,
      pass: label, stopReason,
      truncated: stopReason === "max_tokens",
    });
  } catch (err) {
    return Response.json({ error: "خطای سرور: " + String(err && err.message ? err.message : err) }, { status: 500 });
  }
}
