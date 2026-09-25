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

export const OP_KINDS = {
  tag_step:    { title: "ثبت مرحلهٔ تگ", need: ACTIONS.ASSIGN_WELD, fields: ["tagId", "code", "doneOn"] },
  spool_step:  { title: "ثبت مرحلهٔ اسپول", need: ACTIONS.ASSIGN_WELD, fields: ["spoolId", "code", "doneOn"] },
  punch_raise: { title: "ثبت آیتم Punch", need: ACTIONS.RECORD_QUALITY, fields: ["tagId", "category", "description", "raisedOn"] },
  punch_clear: { title: "رفع آیتم Punch", need: ACTIONS.RECORD_QUALITY, fields: ["punchId", "note", "clearedOn"] },
};

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
  for (const f of ["doneOn", "raisedOn", "clearedOn"]) {
    if (p[f] && !DATE.test(p[f])) out.push(`تاریخ «${f}» معتبر نیست`);
    // A site date after the day it reaches the server is a phone with a
    // wrong clock or a typo; either way it is not accepted as a date.
    if (p[f] && today && p[f] > today) out.push("تاریخ کار در آینده است");
  }
  if (op.kind === "punch_raise" && p.category && !["A", "B", "C"].includes(p.category)) out.push("دستهٔ Punch باید A، B یا C باشد");
  return out;
}

/** A new operation, as the phone makes it. */
export function newOp(kind, payload, { projectId, now = new Date(), id = globalThis.crypto?.randomUUID?.() } = {}) {
  return { opId: id, kind, projectId, payload, capturedAt: now.toISOString() };
}

/** Order a batch as it happened on site: steps depend on the ones before them. */
export const inCaptureOrder = (ops) => [...ops].sort((a, b) => String(a.capturedAt).localeCompare(String(b.capturedAt)));
