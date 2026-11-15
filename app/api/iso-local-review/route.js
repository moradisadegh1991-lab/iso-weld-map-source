export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { reviewIsoLocally } from "../../../lib/llm/iso-local-review.mjs";

/** Review OCR candidates using only the explicitly configured, trusted same-host model. */
export async function POST(request) {
  try {
    const body = await request.json();
    if (!body.projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { membership } = await authenticate(request, { projectId: body.projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.RUN_EXTRACTION);
    try {
      const review = await reviewIsoLocally({ url: process.env.ISO_LOCAL_MODEL_URL, model: process.env.ISO_LOCAL_MODEL,
        image: body.image, marks: body.marks, bom: body.bom });
      return Response.json({ review }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      const config = e.message === "LOCAL_MODEL_UNCONFIGURED";
      const bad = e.message === "LOCAL_REVIEW_IMAGE" || e.message === "LOCAL_REVIEW_MARKS";
      return Response.json({ code: config ? "LOCAL_MODEL_UNCONFIGURED" : bad ? "LOCAL_REVIEW_INPUT" : "LOCAL_REVIEW_FAILED",
        error: config ? "مدل محلی روی همین سرور پیکربندی نشده است." : bad ? "ورودی بررسی مدل محلی نامعتبر است." : "بررسی مدل محلی ناموفق بود؛ نتیجهٔ OCR محفوظ است." },
      { status: config ? 503 : bad ? 400 : 502, headers: { "Cache-Control": "no-store" } });
    }
  } catch (e) { return errorResponse(e); }
}
