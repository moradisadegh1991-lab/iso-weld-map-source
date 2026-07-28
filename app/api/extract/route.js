export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Hobby caps this at 60 s; Pro honours up to 300 s.
export const maxDuration = 300;

const COMMON = `You are a senior piping engineer reading a piping isometric drawing.

You are given the FULL SHEET plus overlapping high-resolution QUADRANT crops of the same
drawing. Use the quadrants to read small text and the full sheet for overall routing.
The quadrants overlap, so the same item may appear twice - do not double count it.

Return ONLY a JSON object. No markdown fences, no preamble, no commentary, no explanation.
Be terse: no trailing prose, no repeated fields.
ALL COORDINATES AND LENGTHS IN MILLIMETRES.
If a value is genuinely unreadable use null and list it in "unreadable". Never invent a number.`;

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
    "pupLength": number|null, "pupNote": string
  },
  "bom": [{ "pt": number, "group": string, "description": string,
            "diam": number, "stockCode": string, "qty": number }],
  "notes": [string],
  "unreadable": [string]
}

"pupLength" is set only when a DETAIL note adds short pipe pieces at every fitting
(e.g. "pipe length 150 mm typ."). Otherwise null.
Keep each BOM "description" under 90 characters.`;

const NODES_PROMPT = `${COMMON}

Extract ONLY the route geometry. Do NOT output the BOM or the title block.

{
  "nps": number,
  "nodes": [{ "id": string,
              "type": "tie-in"|"elbow90"|"elbow45"|"tee"|"reducer"|"flange-wn"|"valve-bw"|"valve-flanged",
              "ref": string,
              "E": number, "N": number, "EL": number }],
  "unreadable": [string]
}

CRITICAL RULES
1. "nodes" must be ordered along the pipe route, from the first tie-in to the last tie-in.
2. Tie-in coordinates are printed on the drawing. Derive INTERMEDIATE node coordinates
   (fitting vertices) from the running dimensions. A fitting node coordinate is the
   intersection of the two centrelines, NOT a weld point.
3. Cross-check: the dimension from a fitting vertex to the adjacent weld equals the ASME B16.9
   centre-to-face for that fitting PLUS any pup piece length given in a DETAIL. For DN900 (36
   inch) LR elbows: 90 deg = 1372 mm, 45 deg = 565 mm.
4. "ref" holds the continuation drawing number for tie-in nodes, "" otherwise.
5. Do NOT number welds and do NOT define spools. That is computed downstream.`;

const PASSES = {
  meta: { prompt: META_PROMPT, maxTokens: 3000 },
  nodes: { prompt: NODES_PROMPT, maxTokens: 2000 },
};

export async function POST(req) {
  const started = Date.now();
  try {
    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "بدنه درخواست خوانده نشد؛ احتمالاً از سقف ۴.۵ مگابایت Vercel رد شده." }, { status: 413 });
    }

    const { images, imageBase64, mediaType, apiKey, model, pass } = body || {};
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
          stream: true,
          messages: [{ role: "user", content }],
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
    let buf = "", text = "", usage = null;
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
        if (ev.type === "message_delta" && ev.usage) usage = { ...(usage || {}), ...ev.usage };
        if (ev.type === "message_start" && ev.message?.usage) usage = { ...(usage || {}), ...ev.message.usage };
        if (ev.type === "error") return Response.json({ error: "Anthropic stream error: " + JSON.stringify(ev.error).slice(0, 250) }, { status: 502 });
      }
    }

    const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
    const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
    if (s < 0 || e < 0) {
      return Response.json({ error: `پاسخ مدل در پاس «${pass || "meta"}» JSON نبود.`, raw: cleaned.slice(0, 400) }, { status: 502 });
    }
    let parsed;
    try {
      parsed = JSON.parse(cleaned.slice(s, e + 1));
    } catch (err) {
      return Response.json({ error: `JSON پاس «${pass || "meta"}» قابل تجزیه نبود: ${err.message}`, raw: cleaned.slice(0, 400) }, { status: 502 });
    }

    return Response.json({ data: parsed, usage, model: chosen, ms: Date.now() - started, pass: pass || "meta" });
  } catch (err) {
    return Response.json({ error: "خطای سرور: " + String(err && err.message ? err.message : err) }, { status: 500 });
  }
}
