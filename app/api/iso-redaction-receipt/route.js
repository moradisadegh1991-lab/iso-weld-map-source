export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { readCookie } from "../../../lib/auth/cookie.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import { issueImageReceipt, verifyImageReceipt } from "../../../lib/server/iso-redaction-receipt.mjs";

const MAX_BODY = 3_600_000;
const headers = { "Cache-Control": "no-store" };
const bad = (code, message, status = 400) => Response.json({ code, error: message }, { status, headers });
async function readBoundedJson(request) {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw Object.assign(new Error("too large"), { code: "BODY_TOO_LARGE" });
  const reader = request.body?.getReader(); if (!reader) throw new Error("body missing");
  const chunks = []; let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      total += value.length;
      if (total > MAX_BODY) { reader.cancel().catch(() => {}); throw Object.assign(new Error("too large"), { code: "BODY_TOO_LARGE" }); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Integrity receipt only; does not certify masking or authorize an external send. */
export async function POST(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId") || "";
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) return bad("INVALID_PROJECT", "شناسهٔ پروژه نامعتبر است.");
    const { user, membership, authMode } = await authenticate(request, { projectId });
    if (!membership) return bad("NOT_FOUND", "not found", 404);
    assertCan(membership, ACTIONS.RUN_EXTRACTION);
    const credential = authMode === "session" ? readCookie(request) : request.headers.get("authorization");
    let body;
    try { body = await readBoundedJson(request); } catch (e) {
      return e.code === "BODY_TOO_LARGE" ? bad("BODY_TOO_LARGE", "حجم بسته بیش از حد مجاز است.", 413) : bad("INVALID_BODY", "درخواست معتبر نیست.");
    }
    if (body?.kind === "issue") {
      try {
        const result = issueImageReceipt({ images: body.images, claimedDigest: body.sha256, projectId, userId: user.id, credential });
        return Response.json({ ...result, notice: "این رسید فقط تطبیق محتوای تصاویر را نشان می‌دهد؛ تأیید محرمانگی یا مجوز ارسال نیست." }, { headers });
      } catch (e) {
        if (e.code === "RECEIPT_KEY_UNAVAILABLE") return bad(e.code, "کلید رسید در سرور پیکربندی نشده است.", 503);
        return bad(e.code || "INVALID_BUNDLE", "بسته یا شناسهٔ تصاویر نامعتبر است.");
      }
    }
    if (body?.kind === "verify") {
      const valid = verifyImageReceipt({ receipt: body.receipt, images: body.images, projectId, userId: user.id, credential });
      return Response.json({ valid, notice: "این بررسی مجوز ارسال یا تأیید کامل‌بودن پوشاندن نیست." }, { headers });
    }
    return bad("INVALID_KIND", "عملیات نامعتبر است.");
  } catch (e) { return errorResponse(e); }
}
