/**
 * Work recorded on site, possibly with no network: the operations, their
 * shape, and the rules a phone can check before the server does.
 *
 * An operation is captured on the phone, queued, and sent when there is a
 * network. It is NOT a record until the server has applied it: the same
 * repositories and engines that judge an entry made at a desk judge it
 * then, and they may refuse it (a derived step, a step out of order that
 * the chain refuses, a punch item already closed by someone else). Until
 * then the screen calls it "queued", never "done".
 *
 * Every operation carries an id made on the phone. Sending it twice — a
 * lost reply, a retry, a second tab — applies it once: the server keeps the
 * id with the outcome and answers the repeat from that.
 *
 * `doneOn` is the site date the person states; `capturedAt` is the phone's
 * clock when it was entered. Both are kept: a step done on Monday and
 * synced on Wednesday is a Monday step.
 */
import { ACTIONS } from "../authz.mjs";
import { PHOTO_STAGES } from "../quality/photo.mjs";

export const OP_KINDS = {
  tag_step:    { title: "ثبت مرحلهٔ تگ", need: ACTIONS.ASSIGN_WELD, fields: ["tagId", "code", "doneOn"] },
  spool_step:  { title: "ثبت مرحلهٔ اسپول", need: ACTIONS.ASSIGN_WELD, fields: ["spoolId", "code", "doneOn"] },
  punch_raise: { title: "ثبت آیتم Punch", need: ACTIONS.RECORD_QUALITY, fields: ["tagId", "category", "description", "raisedOn"] },
  punch_clear: { title: "رفع آیتم Punch", need: ACTIONS.RECORD_QUALITY, fields: ["punchId", "note", "clearedOn"] },
  // Electrical and instrumentation: the same site work their pages record,
  // with the same permission those pages ask for.
  cable_step:  { title: "ثبت مرحلهٔ کابل", need: ACTIONS.ASSIGN_WELD, fields: ["cableId", "code", "doneOn"] },
  cable_ir:    { title: "ثبت تست IR", need: ACTIONS.ASSIGN_WELD, fields: ["cableId", "testVoltageV", "readings", "testedOn"] },
  instrument_step: { title: "ثبت مرحلهٔ ابزار", need: ACTIONS.ASSIGN_WELD, fields: ["instrumentId", "code", "doneOn"] },
  instrument_cal:  { title: "ثبت کالیبراسیون", need: ACTIONS.ASSIGN_WELD, fields: ["instrumentId", "points", "calibratedOn"] },
  loop_check:  { title: "امضای لوپ چک", need: ACTIONS.ASSIGN_WELD, fields: ["loopNo", "checkedOn"] },
  // A site photo on a punch item: of an item already on the server
  // (punchId), or of one raised on this phone and not sent yet (raiseOpId,
  // the id of that punch_raise operation). The bytes travel with the
  // operation as `data` (base64) only when it is sent; they are kept in the
  // content store, never in the operation's record.
  punch_photo: { title: "عکس Punch", need: ACTIONS.RECORD_QUALITY, fields: ["stage", "takenOn"] },
  // An inspector's signature on a request, taken where the work is. The
  // party signed for is the signer's membership's, checked on the server.
  ir_result:   { title: "امضای بازرسی", need: ACTIONS.RECORD_INSPECTION, fields: ["irId", "outcome"] },
};

/**
 * IR readings as typed on site, one per core: "2000 >2000 1500" or with
 * commas. Kept as text, exactly as the megger showed them — ">2000" is a
 * reading, not 2000 — and judged by lib/electrical/cable.mjs.
 */
export const splitReadings = (text) => String(text || "").split(/[\s,،]+/).map((r) => r.trim()).filter(Boolean);

/**
 * Calibration points as typed: "0:4.01 6.25:8.00 12.5:12.02 …" (applied,
 * then output). Null when any pair is not two numbers: a half-typed point
 * is refused on the phone, not saved to be refused later.
 */
export function parseCalPoints(text) {
  const pairs = String(text || "").trim().split(/[\s,،]+/).filter(Boolean);
  if (!pairs.length) return null;
  if (pairs.some((p) => p.split(":").length !== 2)) return null;
  const out = pairs.map((p) => {
    const [a, o] = p.split(":");
    return { applied: a === "" ? NaN : Number(a), output: o === "" ? NaN : Number(o) };
  });
  return out.every((p) => Number.isFinite(p.applied) && Number.isFinite(p.output)) ? out : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Problems with an operation as captured, or []. The server runs the same check first. */
export function opProblems(op, { today = null } = {}) {
  const out = [];
  const k = OP_KINDS[op?.kind];
  if (!k) return [`نوع عملیات «${op?.kind}» شناخته نشد`];
  if (!UUID.test(String(op.opId || ""))) out.push("شناسهٔ عملیات معتبر نیست");
  if (!op.capturedAt || !Number.isFinite(Date.parse(op.capturedAt))) out.push("زمان ثبت روی گوشی معتبر نیست");
  const p = op.payload || {};
  for (const f of k.fields) if (!String(p[f] ?? "").trim()) out.push(`«${f}» خالی است`);
  for (const f of ["doneOn", "raisedOn", "clearedOn", "testedOn", "calibratedOn", "checkedOn", "takenOn"]) {
    if (p[f] && !DATE.test(p[f])) out.push(`تاریخ «${f}» معتبر نیست`);
    // A site date after the day it reaches the server is a phone with a
    // wrong clock or a typo; either way it is not accepted as a date.
    if (p[f] && today && p[f] > today) out.push("تاریخ کار در آینده است");
  }
  if (op.kind === "punch_raise" && p.category && !["A", "B", "C"].includes(p.category)) out.push("دستهٔ Punch باید A، B یا C باشد");
  if (op.kind === "cable_ir") {
    if (p.testVoltageV !== undefined && !(Number(p.testVoltageV) > 0)) out.push("ولتاژ تست باید عدد مثبت باشد");
    if (p.readings !== undefined && !splitReadings(p.readings).length) out.push("دست‌کم یک قرائت لازم است");
  }
  if (op.kind === "instrument_cal" && p.points !== undefined && String(p.points).trim() && !parseCalPoints(p.points))
    out.push("نقاط را به شکل «اعمالی:خروجی» بنویسید، مثلاً 0:4.01 6.25:8.00");
  if (op.kind === "ir_result") {
    if (p.outcome && !["accepted", "accepted_comments", "rejected", "not_attended"].includes(p.outcome)) out.push("نتیجهٔ بازرسی شناخته نشد");
    if (p.outcome === "rejected" && !String(p.comments || "").trim()) out.push("رد بدون دلیل ثبت نمی‌شود");
    if (p.outcome === "not_attended" && !["company", "tpi"].includes(p.aboutParty)) out.push("طرفی که حاضر نشد را مشخص کنید");
  }
  if (op.kind === "punch_photo") {
    if (p.stage && !PHOTO_STAGES[p.stage]) out.push("مرحلهٔ عکس شناخته نشد");
    const refs = [p.punchId, p.raiseOpId].filter((v) => String(v ?? "").trim());
    if (refs.length !== 1) out.push("عکس باید به یک آیتم Punch وصل باشد");
    else if (p.raiseOpId && !UUID.test(String(p.raiseOpId))) out.push("شناسهٔ ثبت Punch معتبر نیست");
  }
  return out;
}

/** A new operation, as the phone makes it. */
export function newOp(kind, payload, { projectId, now = new Date(), id = globalThis.crypto?.randomUUID?.() } = {}) {
  return { opId: id, kind, projectId, payload, capturedAt: now.toISOString() };
}

/** Order a batch as it happened on site: steps depend on the ones before them. */
export const inCaptureOrder = (ops) => [...ops].sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
