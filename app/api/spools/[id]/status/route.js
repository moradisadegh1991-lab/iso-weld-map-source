export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Retired with migration 012.
 *
 * This endpoint set a spool's fabrication status freely, one value at a
 * time, beside the governed chain that now decides it. Two statuses for one
 * spool is how a report says "fabricated" while the chain says "released".
 *
 * 410 rather than a silent redirect: a script still calling this should
 * fail loudly and be pointed at the replacement, not appear to succeed
 * while recording nothing.
 */
const GONE = {
  error: "این مسیر بازنشسته شده است. وضعیت اسپول حالا از زنجیرهٔ اجرای پایپینگ "
    + "حساب می‌شود؛ مراحل را از POST /api/piping/execution (kind: \"activity\") ثبت کنید.",
  code: "ENDPOINT_RETIRED",
  replacement: "/api/piping/execution",
};

export async function POST() {
  return Response.json(GONE, { status: 410 });
}
