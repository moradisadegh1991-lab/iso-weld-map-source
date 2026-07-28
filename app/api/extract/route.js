export const runtime = "nodejs";
export const maxDuration = 60;

const SCHEMA_PROMPT = `You are a senior piping engineer reading a piping isometric drawing.

Return ONLY a JSON object. No markdown fences, no preamble, no commentary.

{
  "meta": {
    "drawingNo": string, "rev": string, "sheet": string, "project": string,
    "unit": string, "area": string, "pipingClass": string,
    "nps": number,              // nominal pipe size in INCHES, e.g. 36
    "schedule": string,         // e.g. "SCH 10"
    "clLengthM": number|null,   // CL LENGTH from the drawing, in metres
    "testFluid": string, "testPressureBarg": number|null,
    "insulation": string, "heatTrace": string,
    "pipeSpec": string, "fittingSpec": string,
    "pupLength": number|null,   // mm, if a DETAIL note adds pup pieces at fittings; else null
    "pupNote": string
  },
  "bom": [{ "pt": number, "group": string, "description": string,
            "diam": number, "stockCode": string, "qty": number }],
  "nodes": [{ "id": string,
              "type": "tie-in"|"elbow90"|"elbow45"|"tee"|"reducer"|"flange-wn"|"valve-bw"|"valve-flanged",
              "ref": string,
              "E": number, "N": number, "EL": number }],
  "notes": [string],
  "unreadable": [string],
  "confidence": number
}

ALL COORDINATES AND LENGTHS IN MILLIMETRES.

CRITICAL RULES
1. "nodes" must be ordered along the pipe route, from the first tie-in to the last tie-in.
2. Tie-in coordinates are printed on the drawing. Derive INTERMEDIATE node coordinates
   (fitting vertices) from the running dimensions. A fitting node coordinate is the
   intersection of the two centrelines, NOT a weld point.
3. Cross-check your reading: the dimension from a fitting vertex to the adjacent weld equals
   the ASME B16.9 centre-to-face for that fitting PLUS any pup piece length given in a DETAIL.
   For DN900 (36") LR elbows: 90 deg = 1372 mm, 45 deg = 565 mm. Use this to confirm both
   pupLength and the node positions.
4. Cross-check again: the sum of straight pipe lengths should match the PIPE quantity in the
   BOM, and (pipe + pups + all take-outs) should match CL LENGTH.
5. If a value is genuinely unreadable use null and list it in "unreadable". Never invent a number.
6. Do NOT number welds and do NOT define spools. That is computed downstream.`;

export async function POST(req) {
  try {
    const { imageBase64, mediaType, apiKey, model } = await req.json();
    const keyToUse = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!keyToUse) {
      return Response.json({
        error: "کلید API تنظیم نشده. یا ANTHROPIC_API_KEY را در Vercel \u203a Settings \u203a Environment Variables بگذارید، یا کلید را در همین صفحه وارد کنید.",
      }, { status: 400 });
    }
    if (!imageBase64) return Response.json({ error: "تصویری دریافت نشد." }, { status: 400 });

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": keyToUse,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: model || process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
        max_tokens: 8000,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType || "image/jpeg", data: imageBase64 } },
            { type: "text", text: SCHEMA_PROMPT },
          ],
        }],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      return Response.json({ error: `Anthropic API ${r.status}: ${t.slice(0, 400)}` }, { status: 502 });
    }

    const data = await r.json();
    const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
    if (s < 0 || e < 0) {
      return Response.json({ error: "پاسخ مدل JSON معتبر نبود.", raw: text.slice(0, 600) }, { status: 502 });
    }
    let parsed;
    try {
      parsed = JSON.parse(cleaned.slice(s, e + 1));
    } catch (err) {
      return Response.json({ error: "JSON قابل تجزیه نبود: " + err.message, raw: cleaned.slice(0, 600) }, { status: 502 });
    }
    return Response.json({ data: parsed });
  } catch (err) {
    return Response.json({ error: String(err && err.message ? err.message : err) }, { status: 500 });
  }
}
