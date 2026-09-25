/**
 * The field: the pack a phone carries offline, and the sync that applies
 * what was captured with it.
 *
 * The pack is a snapshot — every item's state as the server judged it when
 * the pack was made, with that time on it. The phone shows it as such and
 * never works a status out for itself: a step recorded offline is shown
 * queued beside the snapshot, not merged into it.
 *
 * The sync applies each operation through the same repository a desk entry
 * uses, in its own transaction, in the order it was captured. A refusal is
 * that operation's outcome, not the batch's: the rest still apply.
 */
import { can } from "../../authz.mjs";
import { OP_KINDS, opProblems, inCaptureOrder, splitReadings } from "../../field/ops.mjs";
import { withProject } from "../scope.mjs";
import { createLoader } from "../loader.mjs";
import { tagStatus, recordActivity } from "./activities.mjs";
import { spoolStatus, recordSpoolActivity } from "./piping-execution.mjs";
import { raisePunch, punchAction } from "./quality.mjs";
import { cableStatus, recordCableActivity, recordIrTest } from "./electrical.mjs";
import { instrumentStatus, recordInstrumentActivity, recordCalibration, recordLoopCheck } from "./instrumentation.mjs";
import { attachPhoto, listPhotos } from "./punch-photos.mjs";

const BEFORE_LOOP = ["calibrated", "installed", "hookup", "wired"];
const stepsOf = (steps) => steps.map((x) => ({ code: x.code, title: x.title, status: x.status, derived: !!x.derived, na: !!x.na }));

/** Everything a phone needs to work a subsystem (or the project) offline. */
export async function fieldPack(db, { projectId, subsystemId = null }) {
  const { rows: [project] } = await db.query("SELECT id, code, name FROM project WHERE id = $1", [projectId]);
  const scope = [projectId, subsystemId];
  const { rows: tagRows } = await db.query(
    `SELECT t.id, t.tag_no, t.description, t.discipline, t.kind, s.code AS subsystem
       FROM tag t LEFT JOIN subsystem s ON s.id = t.subsystem_id
      WHERE t.project_id = $1 AND ($2::uuid IS NULL OR t.subsystem_id = $2) ORDER BY t.tag_no`, scope);
  const loader = createLoader(db, projectId);
  await loader.prime(tagRows.map((t) => t.id));
  const tags = [];
  for (const t of tagRows) {
    const s = await tagStatus(db, { projectId, tagId: t.id, loader });
    tags.push({
      id: t.id, no: t.tag_no, description: t.description, discipline: t.discipline, kind: t.kind, subsystem: t.subsystem,
      pct: s.progress?.pct ?? null, ready: s.why ? !!s.why.ready : null,
      steps: s.steps ? s.steps.map((x) => ({ code: x.code, title: x.title, status: x.status, derived: !!x.derived, na: !!x.na })) : null,
      next: s.next ? s.next.map((n) => n.code) : [],
    });
  }
  const { rows: spoolRows } = await db.query(
    `SELECT sp.id FROM spool sp JOIN reporting.current_run cr ON cr.run_id = sp.extraction_run_id
       LEFT JOIN line l ON l.id = sp.line_id
      WHERE sp.project_id = $1 AND ($2::uuid IS NULL OR l.subsystem_id = $2) ORDER BY sp.spool_no`, scope);
  const spools = [];
  for (const { id } of spoolRows) {
    const s = await spoolStatus(db, { projectId, spoolId: id });
    spools.push({ id, no: s.spool.spool_no, line: s.spool.line_no, pct: s.progress.pct, ready: !!s.why.ready, stage: s.headline,
      steps: s.steps.map((x) => ({ code: x.code, title: x.title, status: x.status, derived: !!x.derived, na: !!x.na })),
      next: s.next.map((n) => n.code) });
  }
  // Cables and instruments with their chains, and what their test must
  // meet: the phone shows a provisional verdict on an IR test or a
  // calibration it has not sent yet, computed by the same engine from the
  // same requirement — labelled provisional, because the server decides.
  const { rows: cableRows } = await db.query(
    `SELECT c.id FROM cable c WHERE c.project_id = $1 AND ($2::uuid IS NULL OR c.subsystem_id = $2) ORDER BY c.cable_no`, scope);
  const cables = [];
  for (const { id } of cableRows) {
    const s = await cableStatus(db, { projectId, cableId: id });
    cables.push({ id, no: s.cable.cable_no, description: [s.cable.from_ref, s.cable.to_ref].filter(Boolean).join(" → "),
      tag: s.cable.to_tag_no, cores: s.cable.cores, voltageClass: s.cable.voltage_class,
      pct: s.progress.pct, ready: !!s.why.ready, steps: stepsOf(s.steps), irRequirement: s.ir.requirement,
      lastIr: s.ir.verdict ? { ok: !!s.ir.verdict.ok, valid: !!s.ir.verdict.valid, reason: s.ir.verdict.reason || null } : null });
  }
  const { rows: instRows } = await db.query(
    `SELECT i.id FROM instrument i WHERE i.project_id = $1 AND ($2::uuid IS NULL OR i.subsystem_id = $2) ORDER BY i.tag_no`, scope);
  const instruments = [];
  for (const { id } of instRows) {
    const s = await instrumentStatus(db, { projectId, instrumentId: id });
    const i = s.instrument;
    instruments.push({ id, no: i.tag_no, description: i.service || null, tag: i.eq_tag_no, category: i.category, loopNo: i.loop_no,
      range: i.range_lo !== null && i.range_hi !== null ? `${Number(i.range_lo)}–${Number(i.range_hi)} ${i.range_unit || ""}`.trim() : null,
      pct: s.progress.pct, ready: !!s.why.ready, steps: stepsOf(s.steps), calRequirement: s.calibration.requirement });
  }
  // Loops: which instruments, and whether each has what the signature needs.
  const loops = {};
  for (const i of instruments) {
    if (!i.loopNo) continue;
    (loops[i.loopNo] ||= { loopNo: i.loopNo, signed: false, members: [] }).members.push({ no: i.no,
      open: i.steps.filter((x) => BEFORE_LOOP.includes(x.code) && x.status !== "done").map((x) => x.title) });
    if (i.steps.find((x) => x.code === "loop_check")?.status === "done") loops[i.loopNo].signed = true;
  }
  const { rows: punch } = await db.query(
    `SELECT p.id, p.punch_no, p.tag_id, p.category, p.status, p.description, p.due_on FROM punch_item p
      WHERE p.project_id = $1 AND p.status <> 'closed' AND ($2::uuid IS NULL OR p.subsystem_id = $2) ORDER BY p.punch_no`, scope);
  // The photos each open item already has: shown as the server's, next to
  // the ones still queued on the phone. The bytes are fetched when shown.
  const photos = await listPhotos(db, { projectId });
  for (const item of punch) item.photos = photos.filter((f) => f.punch_id === item.id)
    .map((f) => ({ id: f.id, stage: f.stage, takenOn: f.taken_on, by: f.by_name }));
  // Every subsystem, not just the packed one: the phone offers them for the next pack.
  const { rows: subsystems } = await db.query("SELECT id, code FROM subsystem WHERE project_id = $1 ORDER BY code", [projectId]);
  return {
    generatedAt: new Date().toISOString(), project, subsystemId, subsystems,
    tags, spools, cables, instruments, loops: Object.values(loops), punch,
  };
}

/**
 * Apply a batch captured on site. Each operation: checked, permission
 * checked, then applied in its own transaction together with its field_op
 * row — or refused, and the refusal recorded. A repeated id returns the
 * outcome already recorded.
 *
 * Runs OUTSIDE any withProject: each operation binds the project inside its
 * own transaction, so a pooled driver gets the binding on the connection
 * that runs the statements.
 */
export async function applyOps(db, { projectId, userId, membership, ops = [], today = null, store = null }) {
  const day = today || new Date().toISOString().slice(0, 10);
  const out = [];
  for (const op of inCaptureOrder(ops)) {
    const prior = await withProject(db, projectId, async () =>
      (await db.query("SELECT status, result, error FROM field_op WHERE op_id = $1", [op.opId])).rows[0]);
    if (prior) { out.push({ opId: op.opId, status: prior.status, duplicate: true, error: prior.error, result: prior.result }); continue; }

    let error = null;
    const problems = opProblems(op, { today: day });
    if (op.projectId && op.projectId !== projectId) problems.push("این عملیات برای پروژهٔ دیگری ثبت شده است");
    if (problems.length) error = problems.join(" · ");
    else if (!can(membership, OP_KINDS[op.kind].need)) error = "نقش شما اجازهٔ این ثبت را ندارد";

    if (!error) {
      try {
        const result = await db.transaction((tx) => withProject(tx, projectId, async () => {
          const r = await APPLY[op.kind](tx, { projectId, userId, p: op.payload, store });
          await tx.query(
            `INSERT INTO field_op (op_id, project_id, kind, payload, captured_at, user_id, status, result)
             VALUES ($1,$2,$3,$4,$5,$6,'applied',$7)`,
            [op.opId, projectId, op.kind, JSON.stringify(kept(op.payload)), op.capturedAt, userId, JSON.stringify(r)]);
          return r;
        }));
        out.push({ opId: op.opId, status: "applied", result });
        continue;
      } catch (e) {
        // A second copy of the same id arriving at once: the other one won.
        if (e?.code === "23505" && String(e.constraint || "").startsWith("field_op")) {
          const again = await withProject(db, projectId, async () =>
            (await db.query("SELECT status, result, error FROM field_op WHERE op_id = $1", [op.opId])).rows[0]);
          out.push({ opId: op.opId, status: again.status, duplicate: true, error: again.error, result: again.result });
          continue;
        }
        // The engine's refusal text is the reason; anything else is not
        // shown to the phone in detail (it may carry internals).
        // A rule the table holds (class 23: a CHECK, a duplicate, a missing
        // reference) or a malformed value (class 22) is the data's answer
        // too, named by the rule.
        const refused = (e?.status && e.status < 500) ? e.message
          : /^23/.test(String(e?.code || "")) ? `با قاعدهٔ ثبت داده نمی‌خواند (${e.constraint || e.code})`
          : /^22/.test(String(e?.code || "")) ? "قالب یکی از مقادیر درست نیست" : null;
        // Not yet answerable (a photo whose punch item has not arrived): sent
        // again with the next sync, nothing recorded.
        if (e?.retry) { out.push({ opId: op.opId, status: "retry", error: e.message }); continue; }
        error = refused || "خطای داخلی هنگام اعمال — دوباره همگام‌سازی کنید";
        if (!refused) {
          console.error("field op failed", op.opId, e);
          out.push({ opId: op.opId, status: "retry", error });
          continue;          // not recorded: a server fault is not the site's answer
        }
      }
    }
    await withProject(db, projectId, () => db.query(
      `INSERT INTO field_op (op_id, project_id, kind, payload, captured_at, user_id, status, error)
       VALUES ($1,$2,$3,$4,$5,$6,'rejected',$7) ON CONFLICT (op_id) DO NOTHING`,
      [op.opId, projectId, OP_KINDS[op.kind] ? op.kind : "unknown", JSON.stringify(kept(op.payload)),
       Number.isFinite(Date.parse(op.capturedAt)) ? op.capturedAt : new Date().toISOString(), userId, error]));
    out.push({ opId: op.opId, status: "rejected", error });
  }
  return out;
}

/** The payload as recorded: a photo's bytes are in the content store, not here. */
function kept(payload) {
  if (!payload || typeof payload !== "object") return {};
  const { data, ...rest } = payload;
  return data === undefined ? payload : { ...rest, bytes: typeof data === "string" ? Buffer.byteLength(data, "base64") : null };
}

const APPLY = {
  async tag_step(db, { projectId, userId, p }) {
    const a = await recordActivity(db, { projectId, tagId: p.tagId, code: p.code, doneAt: p.doneOn,
      note: p.note || "ثبت در سایت (آفلاین)", refNo: p.refNo || null, userId });
    return { activityId: a.id };
  },
  async spool_step(db, { projectId, userId, p }) {
    const a = await recordSpoolActivity(db, { projectId, spoolId: p.spoolId, code: p.code, doneAt: p.doneOn,
      note: p.note || "ثبت در سایت (آفلاین)", refNo: p.refNo || null, userId });
    return { activityId: a.id };
  },
  async punch_raise(db, { projectId, userId, p }) {
    const r = await raisePunch(db, { projectId, tagId: p.tagId, category: p.category, description: p.description,
      location: p.location || null, raisedOn: p.raisedOn, userId });
    return { punchId: r.id, punchNo: r.punch_no };
  },
  async cable_step(db, { projectId, userId, p }) {
    const a = await recordCableActivity(db, { projectId, cableId: p.cableId, code: p.code, doneAt: p.doneOn,
      refNo: p.refNo || null, note: p.note || "ثبت در سایت (آفلاین)", userId });
    return { activityId: a.id };
  },
  async cable_ir(db, { projectId, userId, p }) {
    const t = await recordIrTest(db, { projectId, cableId: p.cableId, testVoltageV: p.testVoltageV, readings: splitReadings(p.readings),
      testedOn: p.testedOn, instrumentRef: p.instrumentRef || null, tester: p.tester || null, userId });
    // The server's verdict on it, as the cable page will show it.
    const s = await cableStatus(db, { projectId, cableId: p.cableId });
    return { testId: t.id, ok: s.ir.verdict?.ok ?? null, reason: s.ir.verdict?.reason ?? null };
  },
  async instrument_step(db, { projectId, userId, p }) {
    const a = await recordInstrumentActivity(db, { projectId, instrumentId: p.instrumentId, code: p.code, doneAt: p.doneOn,
      refNo: p.refNo || null, note: p.note || "ثبت در سایت (آفلاین)", userId });
    return { activityId: a.id };
  },
  async instrument_cal(db, { projectId, userId, p }) {
    const c = await recordCalibration(db, { projectId, instrumentId: p.instrumentId, points: p.points, calibratedOn: p.calibratedOn,
      calibratorRef: p.calibratorRef || null, certificateRef: p.certificateRef || null, userId });
    const s = await instrumentStatus(db, { projectId, instrumentId: p.instrumentId });
    return { calibrationId: c.id, ok: s.calibration.verdict?.ok ?? null, reason: s.calibration.verdict?.reason ?? null };
  },
  async loop_check(db, { projectId, userId, p }) {
    const l = await recordLoopCheck(db, { projectId, loopNo: p.loopNo, checkedOn: p.checkedOn, refNo: p.refNo || null,
      witnessedBy: p.witnessedBy || null, userId });
    return { loopNo: l.loop_no };
  },
  async punch_photo(db, { projectId, userId, p, store }) {
    if (!store) throw new Error("no content store configured");
    let punchId = p.punchId;
    if (!punchId) {
      // An item raised on the same phone: its operation says which item it became.
      const { rows: [raise] } = await db.query("SELECT kind, status, result FROM field_op WHERE op_id = $1", [p.raiseOpId]);
      if (!raise) throw Object.assign(new Error("آیتم Punch این عکس هنوز به سرور نرسیده است"), { retry: true });
      if (raise.kind !== "punch_raise") throw Object.assign(new Error("عکس به عملیاتی غیر از ثبت Punch اشاره می‌کند"), { status: 400 });
      if (raise.status !== "applied") throw Object.assign(new Error("آیتم Punch این عکس ثبت نشد؛ عکس هم ثبت نمی‌شود"), { status: 409 });
      punchId = raise.result.punchId;
    }
    if (typeof p.data !== "string" || !p.data) throw Object.assign(new Error("فایل عکس همراه عملیات نیست"), { status: 400 });
    const f = await attachPhoto(db, { projectId, punchId, bytes: Buffer.from(p.data, "base64"), stage: p.stage,
      takenOn: p.takenOn, userId, store });
    return { photoId: f.id, punchId, sha256: f.sha256, duplicate: !!f.duplicate };
  },
  async punch_clear(db, { projectId, userId, p }) {
    const r = await punchAction(db, { projectId, punchId: p.punchId, action: "clear", note: p.note, onDate: p.clearedOn, userId });
    return { punchId: r.id, status: r.status };
  },
};

/** The latest operations received from site, for the page and for follow-up of refusals. */
export async function recentOps(db, { projectId, limit = 50 }) {
  const { rows } = await db.query(
    `SELECT f.op_id, f.kind, f.payload, f.captured_at, f.received_at, f.status, f.error, u.display_name AS by_name
       FROM field_op f LEFT JOIN app_user u ON u.id = f.user_id
      WHERE f.project_id = $1 ORDER BY f.received_at DESC LIMIT $2`, [projectId, limit]);
  return rows;
}
