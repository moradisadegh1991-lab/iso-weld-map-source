/**
 * Electrical: the cable schedule, each cable's chain, and the insulation
 * tests that answer it.
 *
 * A cable is an item, like a weld: it hangs off the tag it feeds, and the
 * tag's own `electrical` step is answered by its cables. The IR verdict is
 * lib/electrical/cable.mjs.
 *
 * Call inside `withProject`.
 */
import {
  parseCableSchedule, matchTag, parseRating, parseCableSize, irRequirement, judgeIr,
} from "../../electrical/cable.mjs";
import {
  CHAINS, walk, nextActions, whyNotReady, progress, DONE, IN_PROGRESS,
} from "../../platform/precedence.mjs";

const CHAIN = CHAINS.cable;

/**
 * Import a cable schedule.
 *
 * Upserts by cable number. What a person corrected survives a re-import:
 * the tag a cable feeds is kept when the new schedule cannot name one, and
 * a field the schedule leaves unreadable does not blank a value someone
 * typed in.
 */
export async function importCableSchedule(db, { projectId, text }) {
  const parsed = parseCableSchedule(text);
  const { rows: tags } = await db.query(
    "SELECT id, tag_no, subsystem_id FROM tag WHERE project_id = $1", [projectId]);
  const tagNos = tags.map((t) => t.tag_no);
  const byNo = new Map(tags.map((t) => [t.tag_no, t]));

  const unmatched = [];
  let count = 0;
  for (const r of parsed.rows) {
    const no = matchTag(r.to, tagNos) || matchTag(r.from, tagNos);
    const tag = no ? byNo.get(no) : null;
    if (!tag) unmatched.push(r.cableNo);
    await db.query(
      `INSERT INTO cable (project_id, cable_no, from_ref, to_ref, to_tag_id, subsystem_id, cable_spec,
                          cores, size_mm2, rating, u_kv, voltage_class, system_voltage_v, length_m)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (project_id, cable_no) DO UPDATE
          SET from_ref = EXCLUDED.from_ref, to_ref = EXCLUDED.to_ref,
              to_tag_id = COALESCE(EXCLUDED.to_tag_id, cable.to_tag_id),
              subsystem_id = COALESCE(EXCLUDED.subsystem_id, cable.subsystem_id),
              cable_spec = EXCLUDED.cable_spec,
              cores = COALESCE(EXCLUDED.cores, cable.cores),
              size_mm2 = COALESCE(EXCLUDED.size_mm2, cable.size_mm2),
              rating = COALESCE(EXCLUDED.rating, cable.rating),
              u_kv = COALESCE(EXCLUDED.u_kv, cable.u_kv),
              voltage_class = COALESCE(EXCLUDED.voltage_class, cable.voltage_class),
              system_voltage_v = COALESCE(EXCLUDED.system_voltage_v, cable.system_voltage_v),
              length_m = COALESCE(EXCLUDED.length_m, cable.length_m)`,
      [projectId, r.cableNo, r.from, r.to, tag?.id || null, tag?.subsystem_id || null, r.spec,
       r.cores, r.sizeMm2, r.rating, r.uKv, r.voltageClass, r.systemVoltageV, r.lengthM]);
    count++;
  }
  return { imported: count, problems: parsed.problems, unmatched, columns: parsed.columns };
}

/**
 * A person's correction of what the schedule could not say: the tag fed, the
 * construction, the rating, the circuit voltage. Only the fields given change.
 */
export async function correctCable(db, {
  projectId, cableId, toTagId, spec, rating, systemVoltageV,
}) {
  const { rows: [c] } = await db.query(
    "SELECT * FROM cable WHERE id = $1 AND project_id = $2", [cableId, projectId]);
  if (!c) throw notFound("cable");
  const sets = [], vals = [];
  const put = (col, v) => { vals.push(v); sets.push(`${col} = $${vals.length}`); };

  if (toTagId !== undefined) {
    if (toTagId) {
      const { rows: [t] } = await db.query(
        "SELECT id, subsystem_id FROM tag WHERE id = $1 AND project_id = $2", [toTagId, projectId]);
      if (!t) throw notFound("tag");
      put("to_tag_id", t.id);
      if (t.subsystem_id) put("subsystem_id", t.subsystem_id);
    } else {
      // The subsystem came from the tag; left behind, it would file the
      // cable under a machine it no longer feeds.
      put("to_tag_id", null); put("subsystem_id", null);
    }
  }
  if (spec !== undefined) {
    const size = parseCableSize(spec);
    if (!size) throw bad(`تعداد رشته و سطح مقطع از «${spec}» خوانده نشد.`);
    put("cable_spec", spec); put("cores", size.cores); put("size_mm2", size.sizeMm2);
  }
  if (rating !== undefined) {
    const r = parseRating(rating);
    if (!r) throw bad(`ردهٔ ولتاژ «${rating}» خوانده نشد (مثلاً 0.6/1kV).`);
    put("rating", `${r.u0Kv}/${r.uKv} kV`); put("u_kv", r.uKv); put("voltage_class", r.voltageClass);
  }
  if (systemVoltageV !== undefined) {
    const v = systemVoltageV === "" || systemVoltageV === null ? null : Number(systemVoltageV);
    if (v !== null && !(v > 0)) throw bad("ولتاژ مدار باید عدد مثبت باشد.");
    put("system_voltage_v", v);
  }
  if (!sets.length) return c;
  vals.push(cableId, projectId);
  const { rows } = await db.query(
    `UPDATE cable SET ${sets.join(", ")} WHERE id = $${vals.length - 1} AND project_id = $${vals.length}
     RETURNING *`, vals);
  return rows[0];
}

/** One IR test, readings as the instrument showed them. */
export async function recordIrTest(db, {
  projectId, cableId, testVoltageV, readings, testedOn, instrumentRef = null, tester = null, userId = null,
}) {
  const list = (Array.isArray(readings) ? readings : String(readings || "").split(/[\s,،]+/))
    .map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) throw bad("دست‌کم یک قرائت لازم است.");
  if (!(Number(testVoltageV) > 0)) throw bad("ولتاژ تست لازم است.");
  if (!testedOn) throw bad("تاریخ تست لازم است.");
  await cableRow(db, projectId, cableId);
  const { rows } = await db.query(
    `INSERT INTO ir_test (project_id, cable_id, test_voltage_v, readings, tested_on, instrument_ref,
                          tester, recorded_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8) RETURNING *`,
    [projectId, cableId, Number(testVoltageV), JSON.stringify(list), testedOn, instrumentRef, tester, userId]);
  return rows[0];
}

async function projectSpec(db, projectId) {
  const { rows: [p] } = await db.query(
    "SELECT lv_system_voltage_v, mv_ir_test_voltage_v, mv_ir_min_mohm FROM project WHERE id = $1",
    [projectId]);
  return { lvSystemVoltageV: p?.lv_system_voltage_v ?? null, mvTestVoltageV: p?.mv_ir_test_voltage_v ?? null,
    mvMinMohm: p?.mv_ir_min_mohm == null ? null : Number(p.mv_ir_min_mohm) };
}

async function cableRow(db, projectId, cableId) {
  const { rows: [c] } = await db.query(
    `SELECT c.*, t.tag_no AS to_tag_no, s.code AS subsystem
       FROM cable c LEFT JOIN tag t ON t.id = c.to_tag_id LEFT JOIN subsystem s ON s.id = c.subsystem_id
      WHERE c.id = $1 AND c.project_id = $2`, [cableId, projectId]);
  if (!c) throw notFound("cable");
  return c;
}

const asCable = (c) => ({ voltageClass: c.voltage_class, systemVoltageV: c.system_voltage_v, cores: c.cores });

/**
 * The derived steps of one cable.
 *
 * ir: DONE when the LATEST test passes; null otherwise, with the reason.
 * hv_test: not applicable to LV; a manual step for MV; undefined (manual,
 * shown with a warning) when the class is unknown.
 */
function derive(cable, tests, spec) {
  const notes = {};
  const req = irRequirement(asCable(cable), spec);
  let ir = null;
  const latest = tests[tests.length - 1];
  let verdict = null;
  if (latest) {
    verdict = judgeIr({ testVoltageV: latest.test_voltage_v, readings: latest.readings }, asCable(cable), req);
    if (!verdict.valid) notes.ir = { level: req.reason ? "warn" : "bad", text: verdict.reason };
    else if (!verdict.ok) notes.ir = { level: "bad", text: `${verdict.reason} — تعمیر و تست مجدد لازم است.` };
    else ir = DONE;
  } else if (req.reason) {
    notes.ir = { level: "warn", text: req.reason };
  }
  const hv = cable.voltage_class === "LV" ? "na" : undefined;
  if (!cable.voltage_class) notes.hv_test = { level: "warn", text: "کلاس ولتاژ معلوم نیست — کاربرد تست HV تعیین نشد." };
  return { steps: { ir, hv_test: hv }, notes, requirement: req, verdict, latest };
}

/** Everything known about one cable's progress. */
export async function cableStatus(db, { projectId, cableId }) {
  const cable = await cableRow(db, projectId, cableId);
  const spec = await projectSpec(db, projectId);
  const { rows: acts } = await db.query(
    "SELECT code, status, done_at, ref_no FROM cable_activity WHERE cable_id = $1 AND project_id = $2",
    [cableId, projectId]);
  const { rows: tests } = await db.query(
    `SELECT test_voltage_v, readings, tested_on, instrument_ref, tester FROM ir_test
      WHERE cable_id = $1 AND project_id = $2 ORDER BY tested_on, created_at`, [cableId, projectId]);

  const recorded = Object.fromEntries(acts.map((a) => [a.code, a.status]));
  const d = derive(cable, tests, spec);
  const na = new Set();
  // ir is always the test's to answer — a recorded tick cannot stand in for it.
  if (d.steps.ir) recorded.ir = d.steps.ir; else delete recorded.ir;
  if (d.steps.hv_test === "na") { recorded.hv_test = DONE; na.add("hv_test"); }

  const steps = walk(CHAIN, recorded, { na }).map((s) => {
    const a = acts.find((x) => x.code === s.code);
    return { ...s, na: na.has(s.code), derived: s.code === "ir" || na.has(s.code),
      note: d.notes[s.code] || null, doneAt: a?.done_at || null, refNo: a?.ref_no || null };
  });
  return {
    cable, steps,
    next: nextActions(CHAIN, recorded),
    why: whyNotReady(CHAIN, recorded),
    progress: progress(CHAIN, recorded, { na }),
    ir: { requirement: d.requirement, verdict: d.verdict,
      tests: tests.map((t) => ({ ...t, tested_on: iso(t.tested_on) })) },
  };
}

/**
 * Record a step on a cable.
 *
 * Physical steps may be recorded out of order — the cable is in the tray
 * whether or not the route was signed, and the chain shows it. Two things
 * are refused: a step the data answers (IR, or HV on an LV cable), and
 * `ready` while anything before it is open, because `ready` is a sign-off
 * and reporting reads it as "tested and accepted".
 */
export async function recordCableActivity(db, {
  projectId, cableId, code, doneAt, refNo = null, note = null, contractorId = null, userId = null,
}) {
  const step = CHAIN.find((s) => s.code === code);
  if (!step) throw bad(`مرحلهٔ «${code}» در زنجیرهٔ کابل نیست.`);
  if (!doneAt) throw bad("تاریخ انجام لازم است.");
  const s = await cableStatus(db, { projectId, cableId });
  const st = s.steps.find((x) => x.code === code);
  if (code === "ir") throw bad("تست IR از نتیجهٔ ثبت‌شدهٔ تست خوانده می‌شود و دستی ثبت نمی‌شود.");
  if (st.na) throw bad(`«${step.title}» برای این کابل کاربرد ندارد.`);
  if (code === "ready" && st.blocked) {
    throw bad(`آماده برای برق‌دار شدن ثبت نمی‌شود — باز: ${st.waitingOn.map((w) => w.title).join("، ")}`);
  }
  const { rows } = await db.query(
    `INSERT INTO cable_activity (project_id, cable_id, code, status, done_at, ref_no, note, contractor_id, recorded_by)
     VALUES ($1,$2,$3,'done',$4,$5,$6,$7,$8)
     ON CONFLICT (project_id, cable_id, code) DO UPDATE
        SET status = 'done', done_at = EXCLUDED.done_at,
            ref_no = COALESCE(EXCLUDED.ref_no, cable_activity.ref_no),
            note = COALESCE(EXCLUDED.note, cable_activity.note),
            recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING *`,
    [projectId, cableId, code, doneAt, refNo, note, contractorId, userId]);
  return rows[0];
}

/**
 * Every cable, with its stage and IR verdict.
 *
 * One status per cable is acceptable at the sizes this is read at (a unit's
 * schedule, a machine's cables). A plant-wide board of thousands becomes a
 * set-based query first.
 */
export async function cableBoard(db, { projectId, tagId = null }) {
  const { rows } = await db.query(
    `SELECT id FROM cable WHERE project_id = $1 AND ($2::uuid IS NULL OR to_tag_id = $2::uuid)
      ORDER BY cable_no`, [projectId, tagId]);
  const out = [];
  for (const { id } of rows) {
    const s = await cableStatus(db, { projectId, cableId: id });
    const ir = s.steps.find((x) => x.code === "ir");
    out.push({
      id, cableNo: s.cable.cable_no, from: s.cable.from_ref, to: s.cable.to_ref,
      toTagId: s.cable.to_tag_id, toTagNo: s.cable.to_tag_no, subsystem: s.cable.subsystem,
      spec: s.cable.cable_spec, cores: s.cable.cores, sizeMm2: s.cable.size_mm2 == null ? null : Number(s.cable.size_mm2),
      rating: s.cable.rating, voltageClass: s.cable.voltage_class, systemVoltageV: s.cable.system_voltage_v,
      lengthM: s.cable.length_m == null ? null : Number(s.cable.length_m),
      pct: s.progress.pct, ready: s.why.ready,
      next: s.next.map(({ code, title }) => ({ code, title })),
      ir: { status: ir.status, note: ir.note },
      outOfOrder: s.steps.filter((x) => x.outOfOrder).map((x) => x.title),
    });
  }
  return out;
}

/**
 * A tag's `electrical` step, answered by the cables that feed it.
 *
 * `undefined` when no cable feeds it (the step stays a manual record);
 * DONE when every one is ready to energise; IN_PROGRESS once any is pulled.
 */
export async function deriveTagElectrical(db, { projectId, tagId }) {
  const { rows } = await db.query(
    "SELECT id FROM cable WHERE to_tag_id = $1 AND project_id = $2", [tagId, projectId]);
  if (!rows.length) return undefined;
  const states = [];
  for (const { id } of rows) states.push(await cableStatus(db, { projectId, cableId: id }));
  if (states.every((s) => s.why.ready)) return DONE;
  if (states.some((s) => s.progress.done > 0)) return IN_PROGRESS;
  return null;
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
