/**
 * Civil: foundations, pours and specimens, and the three foundation steps
 * they answer.
 *
 * A foundation is a tag (discipline 'civil', kind 'foundation'), so its
 * chain, its subsystem and its contractor package come from the spine. What
 * lives here is the concrete: what was specified, what was poured, what the
 * lab broke — and the derivation of `pour`, `curing` and `strength` from
 * them. Acceptance itself is lib/civil/concrete.mjs.
 *
 * Call inside `withProject`.
 */
import { upsertTag } from "./spine.mjs";
import { createLoader } from "../loader.mjs";
import {
  strengthTest, evaluateClass, samplesRequired, curingComplete, SPECIMENS,
} from "../../civil/concrete.mjs";
import { DONE, IN_PROGRESS } from "../../platform/precedence.mjs";

/**
 * Register a foundation, or update it.
 *
 * With no subsystem given, a foundation that carries equipment files under
 * that equipment's subsystem. That is not a guess: the foundation is built
 * for that machine and handed over with it.
 */
export async function upsertFoundation(db, {
  projectId, tagNo, carriesTagId = null, subsystemId = null, description = null,
  concreteClass, fcMpa, fcAgeDays = 28, volumeM3 = null, drawingRef = null, anchorBoltRef = null,
}) {
  if (!tagNo) throw bad("شمارهٔ فونداسیون لازم است.");
  if (!concreteClass || !(Number(fcMpa) > 0)) {
    throw bad("کلاس بتن و f′c مشخصات لازم است — پذیرش مقاومت بدون آن ممکن نیست.");
  }

  let carried = null;
  if (carriesTagId) {
    ({ rows: [carried] } = await db.query(
      "SELECT id, subsystem_id, discipline FROM tag WHERE id = $1 AND project_id = $2",
      [carriesTagId, projectId]));
    if (!carried) throw notFound("carried tag");
    if (carried.discipline === "civil") throw bad("فونداسیون نمی‌تواند فونداسیون دیگری را حمل کند.");
  }

  const tag = await upsertTag(db, {
    projectId, tagNo, discipline: "civil", kind: "foundation",
    subsystemId: subsystemId || carried?.subsystem_id || null, description,
  });
  await db.query("UPDATE tag SET carries_tag_id = $1 WHERE id = $2 AND project_id = $3",
    [carriesTagId, tag.id, projectId]);
  await db.query(
    `INSERT INTO foundation_spec (tag_id, project_id, concrete_class, fc_mpa, fc_age_days,
                                  volume_m3, drawing_ref, anchor_bolt_ref)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (tag_id) DO UPDATE
        SET concrete_class = EXCLUDED.concrete_class, fc_mpa = EXCLUDED.fc_mpa,
            fc_age_days = EXCLUDED.fc_age_days, volume_m3 = EXCLUDED.volume_m3,
            drawing_ref = COALESCE(EXCLUDED.drawing_ref, foundation_spec.drawing_ref),
            anchor_bolt_ref = COALESCE(EXCLUDED.anchor_bolt_ref, foundation_spec.anchor_bolt_ref)`,
    [tag.id, projectId, concreteClass, fcMpa, fcAgeDays, volumeM3, drawingRef, anchorBoltRef]);
  return { ...tag, carries_tag_id: carriesTagId };
}

/**
 * Record a pour from its pour card and batch ticket.
 *
 * The class is what was DELIVERED and is required, not copied from the
 * specification: defaulting it from the spec would hide exactly the C25
 * truck on a C30 foundation that the comparison exists to catch.
 *
 * A pour recorded before the pre-pour hold point is signed is still
 * recorded — the concrete is in the ground either way — and the chain shows
 * it as out of order. Refusing to record it would lose the evidence without
 * undoing the pour.
 */
export async function recordPour(db, {
  projectId, tagId, pourNo, pouredOn, volumeM3 = null, concreteClass, fcMpa,
  fcAgeDays = 28, supplier = null, ticketRef = null, contractorId = null, userId = null,
}) {
  if (!pourNo || !pouredOn) throw bad("شمارهٔ پور کارت و تاریخ بتن‌ریزی لازم است.");
  if (!concreteClass || !(Number(fcMpa) > 0)) {
    throw bad("کلاس بتن تحویلی و f′c آن را از بارنامه وارد کنید.");
  }
  const { rows: [t] } = await db.query(
    "SELECT id FROM tag WHERE id = $1 AND project_id = $2 AND kind = 'foundation'", [tagId, projectId]);
  if (!t) throw notFound("foundation");

  const { rows } = await db.query(
    `INSERT INTO concrete_pour (project_id, tag_id, pour_no, poured_on, volume_m3, concrete_class,
                                fc_mpa, fc_age_days, supplier, ticket_ref, contractor_id, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (project_id, pour_no) DO UPDATE
        SET poured_on = EXCLUDED.poured_on, volume_m3 = EXCLUDED.volume_m3,
            concrete_class = EXCLUDED.concrete_class, fc_mpa = EXCLUDED.fc_mpa,
            fc_age_days = EXCLUDED.fc_age_days, supplier = EXCLUDED.supplier,
            ticket_ref = EXCLUDED.ticket_ref
     RETURNING *`,
    [projectId, tagId, pourNo, pouredOn, volumeM3, concreteClass, fcMpa, fcAgeDays,
     supplier, ticketRef, contractorId, userId]);
  return rows[0];
}

/**
 * Record the breaks of one sample at one age: one row per specimen.
 *
 * Specimens, not an average — so the engine can refuse a "test" of one
 * cylinder instead of trusting a number somebody averaged by hand.
 */
export async function recordSpecimens(db, {
  projectId, pourId, sampleNo, specimenType, ageDays, results = [],
  testedOn = null, labRef = null, userId = null,
}) {
  if (!sampleNo) throw bad("شمارهٔ نمونه لازم است.");
  if (!SPECIMENS[specimenType]) throw bad(`نوع نمونهٔ «${specimenType}» شناخته نشد.`);
  const values = results.map(Number).filter((v) => Number.isFinite(v));
  if (!values.length) throw bad("دست‌کم یک نتیجهٔ شکست وارد کنید.");

  const { rows: [p] } = await db.query(
    "SELECT id FROM concrete_pour WHERE id = $1 AND project_id = $2", [pourId, projectId]);
  if (!p) throw notFound("pour");

  const out = [];
  for (const mpa of values) {
    const { rows } = await db.query(
      `INSERT INTO concrete_specimen (project_id, pour_id, sample_no, specimen_type, age_days,
                                      mpa, tested_on, lab_ref, recorded_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [projectId, pourId, sampleNo, specimenType, ageDays, mpa, testedOn, labRef, userId]);
    out.push(rows[0]);
  }
  return out;
}

/**
 * The strength tests of one class of concrete across the project, judged.
 *
 * A class is (class code, f′c, age): two pours called "C30" with different
 * f′c are two classes, and averaging them together would judge one against
 * the other's strength.
 */
export async function classEvaluation(db, { projectId, concreteClass, fcMpa, fcAgeDays = 28 }) {
  const { rows } = await db.query(
    `SELECT p.id AS pour_id, p.pour_no, p.poured_on, p.tag_id, p.volume_m3,
            s.sample_no, s.specimen_type, s.age_days, s.mpa
       FROM concrete_pour p
       JOIN concrete_specimen s ON s.pour_id = p.id
      WHERE p.project_id = $1 AND p.concrete_class = $2 AND p.fc_mpa = $3 AND p.fc_age_days = $4
      ORDER BY p.poured_on, p.pour_no, s.sample_no`,
    [projectId, concreteClass, fcMpa, fcAgeDays]);

  const groups = new Map();
  for (const r of rows) {
    const k = `${r.pour_id}|${r.sample_no}|${r.age_days}`;
    if (!groups.has(k)) groups.set(k, { ...r, specimens: [] });
    groups.get(k).specimens.push({ type: r.specimen_type, ageDays: r.age_days, mpa: Number(r.mpa) });
  }

  // Only breaks AT the designated age are judged. Earlier ones say how the
  // concrete is developing and later ones are extra information; neither is
  // an acceptance test, and neither may fail one — an extra 56-day cylinder
  // on a 28-day class is diligence, not a defect.
  const tests = [];
  const rejected = [];
  const early = [];
  const later = [];
  for (const g of groups.values()) {
    const base = { pourId: g.pour_id, pourNo: g.pour_no, tagId: g.tag_id, sampleNo: g.sample_no,
      ageDays: g.age_days, at: iso(g.poured_on) };
    if (g.age_days !== fcAgeDays) {
      (g.age_days < fcAgeDays ? early : later).push({ ...base, mpa: avg(g.specimens.map((x) => x.mpa)) });
      continue;
    }
    const t = strengthTest(g.specimens, { ageDays: fcAgeDays });
    if (t.valid) tests.push({ ...base, id: `${g.pour_no}/${g.sample_no}`, mpa: t.mpa, n: t.n });
    else rejected.push({ ...base, reason: t.reason });
  }
  const verdict = evaluateClass(tests, fcMpa);
  const byId = new Map(verdict.tests.map((t) => [t.id, t]));
  return {
    ...verdict,
    tests: tests.map((t) => ({ ...t, ...byId.get(t.id) })),
    rejected, early, later,
  };
}

/**
 * The three derived steps of one foundation.
 *
 * @returns {{ steps: {pour, curing, strength}, notes: Record<string,{level,text}>, pours }}
 *   A step value is DONE, IN_PROGRESS or null (not started / not accepted).
 *   `notes` says why a step is where it is — a derived step that simply
 *   sits "not done" with no reason sends someone to the lab to find out.
 */
export async function deriveFoundationSteps(db, { projectId, tagId, today = new Date(), loader = null }) {
  const notes = {};
  const L = loader || createLoader(db, projectId);
  const spec = await L.foundationSpec(tagId);
  const pours = await L.pours(tagId);
  const proj = await L.project();

  if (!pours.length) return { steps: { pour: null, curing: null, strength: null }, notes, pours };

  // ── curing, against the stated period ──
  const last = pours[pours.length - 1];
  const cured = curingComplete(last.poured_on, proj?.concrete_curing_days, today);
  let curing = cured === true ? DONE : cured === false ? IN_PROGRESS : null;
  if (cured === null) {
    notes.curing = { level: "warn",
      text: "مدت عمل‌آوری در مشخصات پروژه ثبت نشده — تا ثبت نشود، این مرحله حکم نمی‌گیرد." };
  }

  // ── strength ──
  let strength = DONE;
  const why = [];
  const flag = (level, text) => { why.push(text); if (level === "bad") strength = null; };

  for (const p of pours) {
    if (spec && (p.concrete_class !== spec.concrete_class || Number(p.fc_mpa) !== Number(spec.fc_mpa))) {
      // Judged against the delivered class, a C25 truck might "pass" — which
      // is why the mismatch alone stops acceptance.
      flag("bad", `پور ${p.pour_no}: کلاس تحویلی ${p.concrete_class} (f′c ${Number(p.fc_mpa)}) با مشخصات `
        + `${spec.concrete_class} (f′c ${Number(spec.fc_mpa)}) نمی‌خواند.`);
      continue;
    }
    // A class is judged over every pour of it in the project; once per loader.
    const cls = await L.memo(`class:${p.concrete_class}:${Number(p.fc_mpa)}:${p.fc_age_days}`,
      () => classEvaluation(db, { projectId, concreteClass: p.concrete_class,
        fcMpa: Number(p.fc_mpa), fcAgeDays: p.fc_age_days }));
    const own = cls.tests.filter((t) => t.pourId === p.id);
    const rejected = cls.rejected.filter((t) => t.pourId === p.id);
    const early = cls.early.filter((t) => t.pourId === p.id);
    for (const r of rejected) flag("bad", `پور ${p.pour_no} نمونهٔ ${r.sampleNo}: ${r.reason}`);

    if (!own.length) {
      if (strength === DONE) strength = IN_PROGRESS;
      why.push(early.length
        ? `پور ${p.pour_no}: در انتظار نتیجهٔ ${p.fc_age_days} روزه (زودهنگام: `
          + `${early.map((e) => `${e.ageDays} روزه ${e.mpa} MPa`).join("، ")})`
        : `پور ${p.pour_no}: در انتظار نتیجهٔ ${p.fc_age_days} روزه`);
      continue;
    }

    const need = samplesRequired(p.volume_m3, proj?.concrete_sample_per_m3
      ? { perM3: Number(proj.concrete_sample_per_m3) } : undefined);
    if (need && own.length < need) {
      flag("bad", `پور ${p.pour_no}: ${Number(p.volume_m3)} m³ دست‌کم ${need} آزمون لازم دارد؛ ${own.length} ثبت شده.`);
    }
    for (const t of own) {
      if (t.verdict === "low") {
        flag("bad", `پور ${p.pour_no}: آزمون ${t.mpa} MPa زیر حد فردی ${cls.limit} MPa است.`);
      } else if (t.verdict === "investigate") {
        flag("bad", `پور ${p.pour_no}: میانگین سه آزمون متوالی کلاس ${p.concrete_class} `
          + `(${t.failedWindow} MPa) زیر f′c است — بررسی مقاومت پایین لازم است.`);
      } else if (t.verdict === "provisional") {
        why.push(`پور ${p.pour_no}: ${t.mpa} MPa، موقت — کلاس ${p.concrete_class} هنوز سه آزمون ندارد.`);
      }
    }
  }
  if (why.length) {
    notes.strength = { level: strength === null ? "bad" : "info",
      text: why.join(" ") };
  }
  return { steps: { pour: DONE, curing, strength }, notes, pours };
}

/** Everything the civil page shows for the foundations of a project. */
export async function listFoundations(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT t.id, t.tag_no, t.description, t.carries_tag_id, c.tag_no AS carries_tag_no,
            s.code AS subsystem, fs.concrete_class, fs.fc_mpa, fs.volume_m3, fs.drawing_ref,
            fs.anchor_bolt_ref,
            (SELECT count(*)::int FROM concrete_pour p WHERE p.tag_id = t.id) AS pours
       FROM tag t
       LEFT JOIN tag c ON c.id = t.carries_tag_id
       LEFT JOIN subsystem s ON s.id = t.subsystem_id
       LEFT JOIN foundation_spec fs ON fs.tag_id = t.id
      WHERE t.project_id = $1 AND t.kind = 'foundation'
      ORDER BY t.tag_no`, [projectId]);
  return rows;
}

/** Every class of concrete poured on the project, each judged as a whole. */
export async function concreteClasses(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT DISTINCT concrete_class, fc_mpa, fc_age_days FROM concrete_pour
      WHERE project_id = $1 ORDER BY concrete_class, fc_mpa`, [projectId]);
  const out = [];
  for (const c of rows) {
    const ev = await classEvaluation(db, { projectId, concreteClass: c.concrete_class,
      fcMpa: Number(c.fc_mpa), fcAgeDays: c.fc_age_days });
    out.push({ concreteClass: c.concrete_class, fcMpa: Number(c.fc_mpa),
      fcAgeDays: c.fc_age_days, ...ev });
  }
  return out;
}

export async function poursOf(db, { projectId, tagId }) {
  const { rows } = await db.query(
    `SELECT p.*, (SELECT json_agg(json_build_object('sample_no', s.sample_no,
                     'specimen_type', s.specimen_type, 'age_days', s.age_days, 'mpa', s.mpa)
                     ORDER BY s.sample_no, s.age_days)
                    FROM concrete_specimen s WHERE s.pour_id = p.id) AS specimens
       FROM concrete_pour p WHERE p.tag_id = $1 AND p.project_id = $2
      ORDER BY p.poured_on, p.pour_no`, [tagId, projectId]);
  return rows;
}

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
const avg = (xs) => Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10;
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
