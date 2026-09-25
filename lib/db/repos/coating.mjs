/**
 * Painting and insulation: systems, the items they are applied to, the
 * inspector's measurements, and the chain those answer.
 *
 * An item is one spool or one tag (a structure, a vessel). The spool's own
 * "painted" step and a structure's "painting" step are answered by their
 * item's sign-off. Verdicts are lib/coating/coating.mjs.
 *
 * Call inside `withProject`.
 */
import {
  judgePrep, judgeConditions, judgeDft, judgeInsulation, spoolAreaM2, normalizeGrade, INSULATION,
} from "../../coating/coating.mjs";
import { OD } from "../../standards.js";
import {
  CHAINS, walk, nextActions, whyNotReady, progress, DONE, IN_PROGRESS,
} from "../../platform/precedence.mjs";

const CHAIN = CHAINS.coating;
const DERIVED = new Set(["surface_prep", "coats", "insulation"]);

/** A painting system, as the project's painting specification writes it. */
export async function upsertSystem(db, {
  projectId, code, title = null, prepGrade, profileMinUm = null, profileMaxUm = null, coats, maxDftUm = null,
}) {
  if (!code) throw bad("کد سیستم رنگ لازم است.");
  const grade = normalizeGrade(prepGrade);
  if (!grade) throw bad(`درجهٔ آماده‌سازی «${prepGrade}» خوانده نشد (مثلاً Sa 2½).`);
  const list = (coats || []).map((c) => ({ name: String(c.name || "").trim(), ndft_um: Number(c.ndftUm ?? c.ndft_um) }));
  if (!list.length || list.length > 5 || list.some((c) => !c.name || !(c.ndft_um > 0))) {
    throw bad("هر لایه نام و DFT اسمی مثبت لازم دارد (۱ تا ۵ لایه).");
  }
  const { rows } = await db.query(
    `INSERT INTO coating_system (project_id, code, title, prep_grade, profile_min_um, profile_max_um, coats, max_dft_um)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)
     ON CONFLICT (project_id, code) DO UPDATE
        SET title = EXCLUDED.title, prep_grade = EXCLUDED.prep_grade,
            profile_min_um = EXCLUDED.profile_min_um, profile_max_um = EXCLUDED.profile_max_um,
            coats = EXCLUDED.coats, max_dft_um = EXCLUDED.max_dft_um
     RETURNING *`,
    [projectId, code.trim().toUpperCase(), title, grade, emptyNull(profileMinUm), emptyNull(profileMaxUm),
     JSON.stringify(list), emptyNull(maxDftUm)]);
  return rows[0];
}

/**
 * Assign a system (and insulation) to spools or tags.
 *
 * A spool's area is computed from its largest size and its length when the
 * caller gives none; a spool whose size is not in the B36.10M table keeps
 * no area, and its DFT gets no verdict until a person enters one.
 */
export async function assignCoating(db, {
  projectId, systemId, spoolIds = [], tagIds = [], insulation = "none", insulationThkMm = null, areaM2 = null,
}) {
  if (!INSULATION[insulation]) throw bad(`نوع عایق «${insulation}» شناخته نشد.`);
  if (insulation !== "none" && !(Number(insulationThkMm) > 0)) throw bad("ضخامت عایق لازم است.");
  const { rows: [sys] } = await db.query(
    "SELECT id FROM coating_system WHERE id = $1 AND project_id = $2", [systemId, projectId]);
  if (!sys) throw notFound("coating system");
  const thk = insulation === "none" ? null : Number(insulationThkMm);
  const noArea = [];
  let assigned = 0;
  for (const spoolId of spoolIds) {
    const { rows: [sp] } = await db.query(
      "SELECT id, spool_no, nps_max, length_mm FROM spool WHERE id = $1 AND project_id = $2", [spoolId, projectId]);
    if (!sp) throw notFound("spool");
    const area = emptyNull(areaM2) ?? spoolAreaM2(OD[Number(sp.nps_max)], sp.length_mm);
    if (area === null) noArea.push(sp.spool_no);
    await db.query(
      `INSERT INTO coating_item (project_id, spool_id, system_id, insulation, insulation_thk_mm, area_m2)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, spool_id) WHERE spool_id IS NOT NULL DO UPDATE
          SET system_id = EXCLUDED.system_id, insulation = EXCLUDED.insulation,
              insulation_thk_mm = EXCLUDED.insulation_thk_mm,
              area_m2 = COALESCE(EXCLUDED.area_m2, coating_item.area_m2)`,
      [projectId, spoolId, systemId, insulation, thk, area]);
    assigned++;
  }
  for (const tagId of tagIds) {
    const { rows: [t] } = await db.query("SELECT id, tag_no FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
    if (!t) throw notFound("tag");
    const area = emptyNull(areaM2);
    if (area === null) noArea.push(t.tag_no);
    await db.query(
      `INSERT INTO coating_item (project_id, tag_id, system_id, insulation, insulation_thk_mm, area_m2)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, tag_id) WHERE tag_id IS NOT NULL DO UPDATE
          SET system_id = EXCLUDED.system_id, insulation = EXCLUDED.insulation,
              insulation_thk_mm = EXCLUDED.insulation_thk_mm,
              area_m2 = COALESCE(EXCLUDED.area_m2, coating_item.area_m2)`,
      [projectId, tagId, systemId, insulation, thk, area]);
    assigned++;
  }
  return { assigned, noArea };
}

/** Correct an item's area (m²) — for tags, and spools the table cannot size. */
export async function setItemArea(db, { projectId, itemId, areaM2 }) {
  const v = emptyNull(areaM2);
  if (v !== null && !(Number(v) > 0)) throw bad("مساحت باید مثبت باشد.");
  const { rows } = await db.query(
    "UPDATE coating_item SET area_m2 = $1 WHERE id = $2 AND project_id = $3 RETURNING *", [v, itemId, projectId]);
  if (!rows[0]) throw notFound("coating item");
  return rows[0];
}

/**
 * What the inspector measured. kind: prep {grade, profile[]}, coat {coatNo,
 * airC, rh, steelC, readings[]}, insulation {thicknessMm[]}. Lists may be
 * given as space-separated text.
 */
export async function recordCoating(db, { projectId, itemId, kind, coatNo = null, recordedOn, inspector = null, userId = null, ...d }) {
  const item = await itemRow(db, projectId, itemId);
  if (!recordedOn) throw bad("تاریخ بازرسی لازم است.");
  let data;
  if (kind === "prep") {
    data = { grade: d.grade, profile: list(d.profile) };
    if (!normalizeGrade(d.grade)) throw bad(`درجهٔ آماده‌سازی «${d.grade}» خوانده نشد (مثلاً Sa 2½).`);
  } else if (kind === "coat") {
    const n = Number(coatNo);
    if (!(n >= 1 && n <= item.coats.length)) throw bad(`سیستم ${item.system_code} ${item.coats.length} لایه دارد.`);
    data = { airC: numOrNull(d.airC), rh: numOrNull(d.rh), steelC: numOrNull(d.steelC), readings: list(d.readings) };
    if (!data.readings.length) throw bad("قرائت‌های DFT لازم است.");
    coatNo = n;
  } else if (kind === "insulation") {
    if (item.insulation === "none") throw bad("این آیتم عایق ندارد.");
    data = { thicknessMm: list(d.thicknessMm) };
    if (!data.thicknessMm.length) throw bad("ضخامت‌های اندازه‌گیری‌شده لازم است.");
  } else {
    throw bad(`نوع رکورد «${kind}» شناخته نشد.`);
  }
  const { rows } = await db.query(
    `INSERT INTO coating_record (project_id, item_id, kind, coat_no, data, recorded_on, inspector, recorded_by)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING *`,
    [projectId, itemId, kind, kind === "coat" ? coatNo : null, JSON.stringify(data), recordedOn, inspector, userId]);
  return rows[0];
}

async function itemRow(db, projectId, itemId) {
  const { rows: [i] } = await db.query(
    `SELECT ci.*, cs.code AS system_code, cs.title AS system_title, cs.prep_grade, cs.profile_min_um,
            cs.profile_max_um, cs.coats, cs.max_dft_um, sp.spool_no, t.tag_no, l.line_no
       FROM coating_item ci
       JOIN coating_system cs ON cs.id = ci.system_id
       LEFT JOIN spool sp ON sp.id = ci.spool_id
       LEFT JOIN line l ON l.id = sp.line_id
       LEFT JOIN tag t ON t.id = ci.tag_id
      WHERE ci.id = $1 AND ci.project_id = $2`, [itemId, projectId]);
  if (!i) throw notFound("coating item");
  return i;
}

async function projectSpec(db, projectId) {
  const { rows: [p] } = await db.query(
    "SELECT coating_dewpoint_margin_c, coating_max_rh_pct FROM project WHERE id = $1", [projectId]);
  return { marginC: p?.coating_dewpoint_margin_c == null ? 3 : Number(p.coating_dewpoint_margin_c),
    maxRh: p?.coating_max_rh_pct == null ? null : Number(p.coating_max_rh_pct) };
}

/** Everything known about one item's coating and insulation. */
export async function coatingStatus(db, { projectId, itemId }) {
  const item = await itemRow(db, projectId, itemId);
  const spec = await projectSpec(db, projectId);
  const { rows: records } = await db.query(
    `SELECT kind, coat_no, data, recorded_on, inspector FROM coating_record
      WHERE item_id = $1 AND project_id = $2 ORDER BY recorded_on, created_at`, [itemId, projectId]);
  const { rows: acts } = await db.query(
    "SELECT code, status, done_at, ref_no FROM coating_activity WHERE item_id = $1 AND project_id = $2",
    [itemId, projectId]);
  const latest = (kind, coatNo = null) =>
    records.filter((r) => r.kind === kind && (coatNo === null || r.coat_no === coatNo)).pop();

  const system = { prepGrade: item.prep_grade, profileMin: item.profile_min_um, profileMax: item.profile_max_um };
  const recorded = Object.fromEntries(acts.map((a) => [a.code, a.status]));
  for (const c of DERIVED) delete recorded[c];
  const notes = {};
  const na = new Set();

  // ── surface preparation ──
  const prepRec = latest("prep");
  const prep = prepRec ? judgePrep(prepRec.data, system) : null;
  if (prep && !prep.valid) notes.surface_prep = { level: "bad", text: prep.reason };
  else if (prep && !prep.ok) notes.surface_prep = { level: "bad", text: `${prep.reason} — آماده‌سازی مجدد لازم است.` };
  else if (prep) recorded.surface_prep = DONE;

  // ── coats, each on its own readings, cumulative nominal ──
  let nominal = 0;
  const coats = item.coats.map((c, k) => {
    nominal += Number(c.ndft_um);
    const rec = latest("coat", k + 1);
    if (!rec) return { no: k + 1, name: c.name, nominal, record: null };
    const cond = judgeConditions(rec.data, spec);
    const dft = judgeDft(rec.data.readings, { ndft: nominal,
      maxDft: k === item.coats.length - 1 ? item.max_dft_um : null, areaM2: item.area_m2 });
    const ok = cond.valid && cond.ok && dft.valid && dft.ok;
    return { no: k + 1, name: c.name, nominal, record: { ...rec, recorded_on: iso(rec.recorded_on) }, cond, dft, ok };
  });
  const passed = coats.filter((c) => c.ok).length;
  const failed = coats.filter((c) => c.record && !c.ok);
  if (failed.length) {
    // Only a missing area is a gap in the record, not a failed coat.
    const noAreaOnly = failed.every((c) => c.cond?.valid && c.cond.ok && c.dft && !c.dft.valid
      && /مساحت/.test(c.dft.reason));
    notes.coats = { level: noAreaOnly ? "warn" : "bad",
      text: failed.map((c) => `لایهٔ ${c.no} (${c.name}): ${[
        c.cond && (!c.cond.valid || !c.cond.ok) ? c.cond.reason : null,
        c.dft && (!c.dft.valid || !c.dft.ok) ? c.dft.reason : null].filter(Boolean).join(" · ")}`).join(" | ") };
  } else if (passed && passed < coats.length) {
    notes.coats = { level: "info", text: `${passed} از ${coats.length} لایه پذیرفته.` };
  }
  if (passed === coats.length) recorded.coats = DONE;
  else if (passed > 0) recorded.coats = IN_PROGRESS;

  // ── insulation ──
  let spoolTested = null;
  if (item.spool_id) {
    const { rows: [t] } = await db.query(
      "SELECT 1 FROM spool_activity WHERE spool_id = $1 AND code = 'test' AND status = 'done'", [item.spool_id]);
    spoolTested = Boolean(t);
  }
  let insulation = null;
  if (item.insulation === "none") {
    for (const c of ["insulation", "cladding"]) { recorded[c] = DONE; na.add(c); }
  } else {
    const rec = latest("insulation");
    insulation = rec ? judgeInsulation(rec.data.thicknessMm, item.insulation_thk_mm) : null;
    if (insulation && !insulation.valid) notes.insulation = { level: "bad", text: insulation.reason };
    else if (insulation && !insulation.ok) notes.insulation = { level: "bad", text: `${insulation.reason} — تکمیل لازم است.` };
    else if (insulation && spoolTested === false) {
      // B31.3 §345.3.1: joints exposed during the leak test. The insulation
      // is measured and fine, but it is on a line nobody has tested.
      // "hold", not "bad": nothing about the insulation needs fixing; it is
      // waiting on another discipline's step.
      notes.insulation = { level: "hold",
        text: "عایق پیش از تست فشار اسپول — ASME B31.3 §345.3.1 اتصالات را در تست نشتی باز می‌خواهد. پس از تست تأیید می‌شود." };
    } else if (insulation) {
      recorded.insulation = DONE;
    } else if (spoolTested === false) {
      notes.insulation = { level: "info", text: "پس از تست فشار اسپول (ASME B31.3 §345.3.1)." };
    }
  }

  const steps = walk(CHAIN, recorded, { na }).map((s) => {
    const a = acts.find((x) => x.code === s.code);
    return { ...s, na: na.has(s.code), derived: DERIVED.has(s.code) && !na.has(s.code),
      note: notes[s.code] || null, doneAt: a?.done_at || null, refNo: a?.ref_no || null };
  });
  return {
    item: { ...item, label: item.spool_no ? `${item.line_no || ""} / ${item.spool_no}` : item.tag_no },
    steps, next: nextActions(CHAIN, recorded), why: whyNotReady(CHAIN, recorded),
    progress: progress(CHAIN, recorded, { na }),
    prep: prep ? { ...prep, record: { ...prepRec, recorded_on: iso(prepRec.recorded_on) } } : null,
    coats, insulation, spoolTested, spec,
  };
}

/**
 * Record a manual step. Refused: a measured step, a step that does not
 * apply, and `ready` while anything before it is open — the spool's
 * "painted" step and reporting read `ready`.
 */
export async function recordCoatingActivity(db, {
  projectId, itemId, code, doneAt, refNo = null, note = null, contractorId = null, userId = null,
}) {
  const step = CHAIN.find((s) => s.code === code);
  if (!step) throw bad(`مرحلهٔ «${code}» در زنجیرهٔ رنگ و عایق نیست.`);
  if (!doneAt) throw bad("تاریخ انجام لازم است.");
  if (DERIVED.has(code)) throw bad(`«${step.title}» از اندازه‌گیری بازرس خوانده می‌شود و دستی ثبت نمی‌شود.`);
  const s = await coatingStatus(db, { projectId, itemId });
  const st = s.steps.find((x) => x.code === code);
  if (st.na) throw bad(`«${step.title}» برای این آیتم کاربرد ندارد.`);
  if (code === "ready" && st.blocked) {
    throw bad(`تحویل رنگ و عایق ثبت نمی‌شود — باز: ${st.waitingOn.map((w) => w.title).join("، ")}`);
  }
  const { rows } = await db.query(
    `INSERT INTO coating_activity (project_id, item_id, code, status, done_at, ref_no, note, contractor_id, recorded_by)
     VALUES ($1,$2,$3,'done',$4,$5,$6,$7,$8)
     ON CONFLICT (project_id, item_id, code) DO UPDATE
        SET status = 'done', done_at = EXCLUDED.done_at,
            ref_no = COALESCE(EXCLUDED.ref_no, coating_activity.ref_no),
            recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING *`,
    [projectId, itemId, code, doneAt, refNo, note, contractorId, userId]);
  return rows[0];
}

/** Every item with its stage, the systems, and what has no system yet. */
export async function coatingBoard(db, { projectId }) {
  const { rows: ids } = await db.query(
    "SELECT id FROM coating_item WHERE project_id = $1 ORDER BY created_at", [projectId]);
  const items = [];
  for (const { id } of ids) {
    const s = await coatingStatus(db, { projectId, itemId: id });
    const st = (c) => { const x = s.steps.find((y) => y.code === c); return { status: x.status, note: x.note, na: x.na }; };
    items.push({
      id, label: s.item.label, spoolId: s.item.spool_id, tagId: s.item.tag_id, system: s.item.system_code,
      insulation: s.item.insulation, insulationThkMm: s.item.insulation_thk_mm == null ? null : Number(s.item.insulation_thk_mm),
      areaM2: s.item.area_m2 == null ? null : Number(s.item.area_m2),
      pct: s.progress.pct, ready: s.why.ready, spoolTested: s.spoolTested,
      next: s.next.map(({ code, title }) => ({ code, title })),
      prep: st("surface_prep"), coats: st("coats"), insul: st("insulation"),
      outOfOrder: s.steps.filter((x) => x.outOfOrder).map((x) => x.title),
    });
  }
  items.sort((a, b) => a.label.localeCompare(b.label));
  const { rows: systems } = await db.query(
    "SELECT * FROM coating_system WHERE project_id = $1 ORDER BY code", [projectId]);
  const { rows: spools } = await db.query(
    `SELECT sp.id, sp.spool_no, l.line_no FROM spool sp
       JOIN reporting.current_run cr ON cr.run_id = sp.extraction_run_id
       LEFT JOIN line l ON l.id = sp.line_id
      WHERE sp.project_id = $1 AND NOT EXISTS (SELECT 1 FROM coating_item ci WHERE ci.spool_id = sp.id)
      ORDER BY l.line_no, sp.spool_no`, [projectId]);
  const { rows: tags } = await db.query(
    `SELECT t.id, t.tag_no, t.discipline FROM tag t
      WHERE t.project_id = $1 AND t.discipline IN ('structural', 'equipment')
        AND NOT EXISTS (SELECT 1 FROM coating_item ci WHERE ci.tag_id = t.id)
      ORDER BY t.tag_no`, [projectId]);
  return { items, systems, unassigned: { spools, tags } };
}

/**
 * The owner's paint step, answered by its item's sign-off.
 *
 * `undefined` when the owner has no coating item (manual, as before); DONE
 * when the item's `ready` is recorded; IN_PROGRESS once anything is measured
 * or recorded on it. Reads the stored sign-off, as reporting.spool_stage
 * does, so the engine and the view cannot disagree.
 */
export async function deriveCoatingFor(db, { projectId, spoolId = null, tagId = null }) {
  const { rows: [item] } = await db.query(
    `SELECT id, insulation FROM coating_item
      WHERE project_id = $1 AND (spool_id = $2::uuid OR tag_id = $3::uuid)`, [projectId, spoolId, tagId]);
  if (!item) return undefined;
  const { rows: [r] } = await db.query(
    `SELECT EXISTS (SELECT 1 FROM coating_activity WHERE item_id = $1 AND code = 'ready' AND status = 'done') AS ready,
            EXISTS (SELECT 1 FROM coating_record WHERE item_id = $1)
              OR EXISTS (SELECT 1 FROM coating_activity WHERE item_id = $1) AS started`, [item.id]);
  return { value: r.ready ? DONE : r.started ? IN_PROGRESS : null, insulated: item.insulation !== "none" };
}

const list = (v) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,،]+/)).map((x) => String(x).trim())
  .filter(Boolean).map(Number).filter((x) => Number.isFinite(x));
const numOrNull = (v) => (v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const emptyNull = (v) => (v === "" || v === undefined || v === null ? null : Number(v));
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d == null ? null : String(d).slice(0, 10));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
