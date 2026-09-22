export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby caps this at 60 s; Pro honours up to 300 s.
export const maxDuration = 300;

import { ELL90, ELL45, TEE_C } from "../../../lib/standards";
import { createLlmClient } from "../../../lib/llm/index.mjs";
import { parseLoose, cleanJsonText } from "../../../lib/llm/parse.mjs";
import { authenticate, errorResponse } from "../../../lib/server/session.mjs";

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
    "drawingNo": string, "rev": string, "revDate": string|null, "sheet": string, "project": string,
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
  "cutLengths": [{ "piece": number|string, "lengthMm": number, "nps": number }],
  "notes": [string],
  "unreadable": [string]
}

"revDate" is the issue date of THIS revision, as printed in the revision block,
in ISO form (YYYY-MM-DD). Convert a Gregorian date as printed; if the block shows
only a Jamali date or nothing at all, use null rather than guessing.

"cutLengths" is the CUT PIPE LENGTH table, when the drawing carries one: one entry per
piece mark, with the cut length in millimetres and the nominal size. It is the sharpest
check available - the MTO quantity is rounded and usually carries extra for field
adjustment, so it hides errors that a cut length does not. Read it if it is there and
leave the array empty if it is not; never derive it from the geometry.

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
              "faceToFace": number|null,
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
8. IN-LINE COMPONENTS - a valve, a reducer, a weld-neck flange - have no centreline
   intersection, so their node goes at the CENTRE OF THE BODY, half its length from each
   of its two welds. (An elbow or a tee still goes on the centreline intersection.)
9. A WELD-NECK FLANGE is the exception: it has ONE weld, and its node goes on the FACE -
   the point the drawing dimensions to and the point a continuation callout gives
   coordinates for. Its "faceToFace" is the length through the hub, from that face to
   the weld.
10. "faceToFace" is the body length in mm of such an in-line component, read from the
   dimension printed across it on the drawing. Use null for every other node type, and
   null when the dimension is not shown - do NOT take it from a standards table and do
   NOT estimate it. The tables that would give it (B16.10 for valves, B16.9 for reducers,
   B16.5 for flange hubs) key on valve type, pressure class or reduction ratio, and this
   drawing may state none of them. A null here is handled downstream and reported.
11. NEVER refuse and NEVER explain. If you cannot work out the intermediate fitting
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

/**
 * The fallback for an equipment list that arrived as a scan.
 *
 * Deliberately NOT built on COMMON: that prompt is a piping isometric
 * briefing, and telling a model about B16.9 take-outs while it reads a table
 * is noise that invites it to be clever.
 *
 * It transcribes and nothing else. It does not decide whether something is
 * rotating or static — lib/equipment/parse.mjs does, deterministically, from
 * the same description this returns. Letting the model classify would put an
 * alignment hold point on a vessel on the strength of a guess, and no one
 * downstream would be able to tell which rows were read and which were
 * inferred.
 */
const EQUIPMENT_PROMPT = `You are transcribing an EQUIPMENT LIST from a scanned document.

Return ONLY a JSON object. No markdown fences, no preamble, no commentary.

{
  "headers": [string],
  "rows": [[string]],
  "unreadable": [string]
}

"headers" is the header row exactly as printed, left to right.
"rows" is every data row, each an array of cells in the SAME order as "headers",
padded with "" where a cell is blank.

RULES
1. TRANSCRIBE, DO NOT INTERPRET. Copy each cell as printed. Do not expand an
   abbreviation, do not tidy a description, do not convert units.
2. Do NOT classify anything. Do not add a column saying whether an item is
   rotating or static, and do not reorder or merge columns. That is decided
   downstream from the description you return.
3. Skip nothing. Section headings, continuation rows and totals rows are
   transcribed as they appear; they are filtered downstream by rule.
4. A cell you genuinely cannot read is "" and its tag number and column name
   go in "unreadable". Never invent a tag number - a tag that does not exist
   on the plant becomes a subsystem that waits on it forever.
5. NEVER refuse and NEVER explain. Your entire reply is the JSON object.`;

const PASSES = {
  meta: { prompt: META_PROMPT, maxTokens: 4000 },
  nodes: { prompt: NODES_PROMPT, maxTokens: 4000 },
  repair: { prompt: REPAIR_PROMPT, maxTokens: 5000 },
  // A list runs to hundreds of rows, so it gets a larger budget than a
  // drawing pass; `truncated` in the response tells the caller when even
  // that was not enough rather than handing back half a plant.
  equipment: { prompt: EQUIPMENT_PROMPT, maxTokens: 8000 },
};

const MAX_IMAGE_BYTES = 4_000_000;

/**
 * One extraction pass.
 *
 * This handler now knows nothing about which model answers it: it builds the
 * prompt and the images, hands them to whatever provider is configured, and
 * parses what comes back. Swapping a hosted API for a vLLM cluster inside the
 * plant is LLM_PROVIDER plus LLM_BASE_URL, with no change here.
 *
 * The API key is read from the server environment and never from the request.
 * A key travelling in a request body is a key in the browser, in every proxy
 * log along the way, and in anyone's devtools.
 */
export async function POST(req) {
  const started = Date.now();
  try {
    // Now that the key lives on the server, an open endpoint would let anyone
    // who can reach it spend it. Moving the key server-side without this
    // check would have been a downgrade, not a fix.
    try {
      await authenticate(req);
    } catch (e) {
      return errorResponse(e);
    }

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json(
        { error: "بدنه درخواست خوانده نشد؛ احتمالاً از سقف ۴.۵ مگابایت Vercel رد شده." },
        { status: 413 });
    }

    const { images, imageBase64, mediaType, model, pass, json, issues } = body || {};
    const cfg = PASSES[pass] || PASSES.meta;
    const label = pass || "meta";

    const list = Array.isArray(images) && images.length
      ? images
      : imageBase64
        ? [{ label: "FULL SHEET", data: imageBase64, mediaType: mediaType || "image/jpeg" }]
        : [];
    if (!list.length) return Response.json({ error: "تصویری دریافت نشد." }, { status: 400 });

    const bytes = list.reduce((a, i) => a + (i.data ? i.data.length : 0), 0);
    if (bytes > MAX_IMAGE_BYTES) {
      return Response.json(
        { error: `حجم ارسالی ${(bytes / 1e6).toFixed(1)} MB و بیش از سقف Vercel است.` },
        { status: 413 });
    }

    const client = createLlmClient();
    if (!client.configured) {
      return Response.json({
        error: client.id === "anthropic"
          ? "ANTHROPIC_API_KEY روی سرور تنظیم نشده. آن را در Environment Variables بگذارید."
          : "LLM_BASE_URL تنظیم نشده. آدرس سرویس vLLM را در Environment Variables بگذارید.",
        code: "LLM_NOT_CONFIGURED",
      }, { status: 400 });
    }

    const extraText = pass === "repair"
      ? `CURRENT EXTRACTION:\n${JSON.stringify(json)}\n\nFAILED CHECKS:\n` +
        (issues || []).map((i) => `- ${i}`).join("\n")
      : null;

    let out;
    try {
      out = await client.complete({
        model, maxTokens: cfg.maxTokens, temperature: 0,
        images: list, prompt: cfg.prompt, extraText,
      });
    } catch (e) {
      return Response.json({ error: hint(e), code: e.code || "LLM_ERROR" }, { status: e.status || 502 });
    }

    if (!out.text.trim()) {
      return Response.json({
        error: `پاس «${label}»: مدل هیچ متنی برنگرداند (stop_reason: ${out.stopReason || "نامشخص"}).`,
      }, { status: 502 });
    }

    const cleaned = cleanJsonText(out.text);
    const parsed = parseLoose(cleaned);
    if (!parsed) {
      return Response.json({
        error: `پاس «${label}»: خروجی مدل JSON معتبری نبود` +
          (out.stopReason === "max_tokens"
            ? " و به سقف توکن خورد (بریده شد)."
            : `. stop_reason: ${out.stopReason || "نامشخص"}.`),
        raw: cleaned.slice(0, 800),
        stopReason: out.stopReason,
      }, { status: 502 });
    }

    return Response.json({
      data: parsed,
      usage: Object.keys(out.usage || {}).length ? out.usage : null,
      model: out.model,
      provider: client.id,
      ms: Date.now() - started,
      pass: label,
      stopReason: out.stopReason,
      truncated: out.stopReason === "max_tokens",
    });
  } catch (err) {
    return Response.json(
      { error: "خطای داخلی: " + String(err?.message || err) },
      { status: 500 });
  }
}

/** Turn an upstream failure into something a site engineer can act on. */
function hint(e) {
  if (e.code === "LLM_NOT_CONFIGURED") return e.message;
  const s = e.upstreamStatus;
  if (s === 401 || s === 403) return e.message + " — کلید API نامعتبر است.";
  if (s === 429) return e.message + " — محدودیت نرخ؛ کمی بعد دوباره تلاش کنید.";
  if (/model/i.test(e.raw || "")) return e.message + ` — نام مدل «${e.model}» پذیرفته نشد.`;
  return e.message;
}
