/**
 * Pre-commissioning checklists and commissioning procedures, their
 * attempts, and the RFC and RFSU certificates.
 *
 * Every rule is lib/completions/precom.mjs; this reads and writes.
 * Call inside `withProject`.
 */
import {
  APPLIES, PHASES, templateProblems, expectedChecks, checkState, attemptProblems, acceptProblems, rfcReadiness, rfsuReadiness, RFSU_BLOCKER_FA,
} from "../../completions/precom.mjs";
import { qualityBlocks } from "./quality.mjs";

/** Declare a checklist, or change one. Its code is its identity. */
export async function upsertTemplate(db, { projectId, code, title, appliesTo, phase = "precom", criteria = null, active = true }) {
  const problems = templateProblems({ code, title, appliesTo, phase });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [prior] } = await db.query("SELECT id, applies_to, phase FROM precom_template WHERE project_id = $1 AND code = $2", [projectId, code]);
  if (prior && (prior.applies_to !== appliesTo || prior.phase !== phase)) {
    const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM precom_attempt WHERE template_id = $1", [prior.id]);
    // Records name items of the old kind, under the old certificate; moving the checklist would orphan them.
    if (n) throw bad(`چک‌لیست ${code} ${n} رکورد دارد؛ نوع آیتم و مرحله‌اش عوض نمی‌شود — چک‌لیست جدید تعریف کنید.`);
  }
  const { rows: [row] } = await db.query(
    `INSERT INTO precom_template (project_id, code, title, applies_to, phase, criteria, active) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (project_id, code) DO UPDATE SET title = EXCLUDED.title, applies_to = EXCLUDED.applies_to, phase = EXCLUDED.phase,
       criteria = EXCLUDED.criteria, active = EXCLUDED.active RETURNING *`,
    [projectId, code, String(title).trim(), appliesTo, phase, criteria || null, active !== false]);
  return row;
}

export async function listTemplates(db, { projectId }) {
  const { rows } = await db.query("SELECT * FROM precom_template WHERE project_id = $1 ORDER BY code", [projectId]);
  return rows.map(tpl);
}

/** What a subsystem holds, by the kinds a checklist can apply to. */
async function itemsOf(db, projectId, sub) {
  const q = async (sql) => (await db.query(sql, [projectId, sub.id])).rows;
  const tags = await q("SELECT id::text AS ref, tag_no AS label, kind FROM tag WHERE project_id = $1 AND subsystem_id = $2 ORDER BY tag_no");
  return {
    subsystem: [{ ref: sub.id, label: sub.code }],
    rotating: tags.filter((t) => t.kind === "rotating"),
    static: tags.filter((t) => t.kind === "static"),
    fired: tags.filter((t) => t.kind === "fired"),
    line: await q("SELECT id::text AS ref, line_no AS label FROM line WHERE project_id = $1 AND subsystem_id = $2 ORDER BY line_no"),
    cable: await q("SELECT id::text AS ref, cable_no AS label FROM cable WHERE project_id = $1 AND subsystem_id = $2 ORDER BY cable_no"),
    instrument: await q("SELECT id::text AS ref, tag_no AS label FROM instrument WHERE project_id = $1 AND subsystem_id = $2 ORDER BY tag_no"),
    loop: await q(`SELECT DISTINCT loop_no AS ref, loop_no AS label FROM instrument
                    WHERE project_id = $1 AND subsystem_id = $2 AND loop_no IS NOT NULL ORDER BY loop_no`),
  };
}

/**
 * One subsystem: its MC and RFSU certificates, every check it owes with
 * where it stands, and its RFSU readiness.
 */
export async function subsystemPrecom(db, { projectId, subsystemId, blocks = null, templates = null }) {
  const { rows: [sub] } = await db.query(
    `SELECT s.id, s.code, s.name, m.signed_at AS mc_signed_at, m.accepted_at AS mc_accepted_at,
            c.signed_at AS rfc_signed_at, c.accepted_at AS rfc_accepted_at, (c.snapshot ? 'carriedFrom') AS rfc_carried,
            cs.display_name AS rfc_signed_by_name, ca.display_name AS rfc_accepted_by_name,
            r.signed_at AS rfsu_signed_at, r.accepted_at AS rfsu_accepted_at, r.signed_by AS rfsu_signed_by,
            us.display_name AS rfsu_signed_by_name, ua.display_name AS rfsu_accepted_by_name
       FROM subsystem s LEFT JOIN mc_certificate m ON m.subsystem_id = s.id
       LEFT JOIN rfc_certificate c ON c.subsystem_id = s.id
       LEFT JOIN app_user cs ON cs.id = c.signed_by LEFT JOIN app_user ca ON ca.id = c.accepted_by
       LEFT JOIN rfsu_certificate r ON r.subsystem_id = s.id
       LEFT JOIN app_user us ON us.id = r.signed_by LEFT JOIN app_user ua ON ua.id = r.accepted_by
      WHERE s.id = $1 AND s.project_id = $2`, [subsystemId, projectId]);
  if (!sub) throw notFound("subsystem");
  const tpls = templates || await listTemplates(db, { projectId });
  const expected = expectedChecks(tpls, await itemsOf(db, projectId, sub));
  const { rows: attempts } = await db.query(
    `SELECT a.*, u.display_name AS performed_by_name, v.display_name AS accepted_by_name FROM precom_attempt a
       LEFT JOIN app_user u ON u.id = a.performed_by LEFT JOIN app_user v ON v.id = a.accepted_by
      WHERE a.project_id = $1 AND a.subsystem_id = $2 ORDER BY a.created_at`, [projectId, subsystemId]);
  const checks = expected.map((c) => {
    const mine = attempts.filter((a) => a.template_id === c.templateId && a.item_ref === c.itemRef).map(att);
    return { ...c, state: checkState(mine), latest: mine[mine.length - 1] || null, attempts: mine };
  });
  const q = (blocks || await qualityBlocks(db, { projectId }))[subsystemId] || { mc: 0, rfsu: 0, ncr: 0 };
  const pre = checks.filter((c) => c.phase === "precom"), com = checks.filter((c) => c.phase === "commissioning");
  const declared = (ph) => tpls.some((t) => t.active && t.phase === ph);
  const rfc = rfcReadiness({ mcAccepted: !!sub.mc_accepted_at, templatesDeclared: declared("precom"), checks: pre,
    punchA: q.mc, ncrOpen: q.ncr });
  const rfsu = rfsuReadiness({ rfcAccepted: !!sub.rfc_accepted_at, templatesDeclared: declared("commissioning"), checks: com,
    punchAB: q.rfsu, ncrOpen: q.ncr });
  const count = (list) => ({ total: list.length, accepted: list.filter((c) => c.state === "accepted").length,
    failed: list.filter((c) => c.state === "failed").length, passed: list.filter((c) => c.state === "passed").length });
  // An RFSU signed before RFC was separate (its RFC carried by 048) certified
  // pre-commissioning, not commissioning: it has reopened only if what it
  // certified has — never merely because procedures were declared later.
  const legacy = !!sub.rfc_carried;
  const rfsuReopened = !!sub.rfsu_signed_at && (legacy ? (!rfc.ready || q.rfsu > 0) : !rfsu.ready);
  return { subsystem: sub, checks, rfc, rfsu, legacyRfsu: legacy && !!sub.rfsu_signed_at, rfsuReopened,
    counts: { precom: count(pre), commissioning: count(com) } };
}

/** Every subsystem, its MC, its pre-commissioning count and RFSU. */
export async function precomBoard(db, { projectId }) {
  const { rows: subs } = await db.query("SELECT id FROM subsystem WHERE project_id = $1 ORDER BY handover_seq NULLS LAST, code", [projectId]);
  const blocks = await qualityBlocks(db, { projectId });
  const templates = await listTemplates(db, { projectId });
  const out = [];
  for (const s of subs) {
    const r = await subsystemPrecom(db, { projectId, subsystemId: s.id, blocks, templates });
    // A signed certificate stands; the board says when what it certified has since reopened.
    out.push({ ...r.subsystem, rfc: r.rfc, rfsu: r.rfsu, counts: r.counts,
      rfcReopened: !!r.subsystem.rfc_signed_at && !r.subsystem.rfc_carried && !r.rfc.ready,
      reopened: r.rfsuReopened, legacyRfsu: r.legacyRfsu });
  }
  return out;
}

/** Record an attempt of one checklist on one item. */
export async function recordAttempt(db, { projectId, subsystemId, templateId, itemRef, result, performedOn, witnessedBy = null,
  note = null, userId, today = new Date().toISOString().slice(0, 10) }) {
  const s = await subsystemPrecom(db, { projectId, subsystemId });
  const check = s.checks.find((c) => c.templateId === templateId && c.itemRef === String(itemRef));
  const { rows: [t] } = await db.query("SELECT phase FROM precom_template WHERE id = $1 AND project_id = $2", [templateId, projectId]);
  const problems = attemptProblems({ phase: t?.phase || "precom", mcAccepted: !!s.subsystem.mc_accepted_at,
    rfcSigned: !!s.subsystem.rfc_signed_at, rfcAccepted: !!s.subsystem.rfc_accepted_at, rfsuSigned: !!s.subsystem.rfsu_signed_at,
    result, note, performedOn, today, applies: !!check });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [row] } = await db.query(
    `INSERT INTO precom_attempt (project_id, subsystem_id, template_id, item_ref, result, performed_on, performed_by, witnessed_by, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, subsystemId, templateId, String(itemRef), result, performedOn, userId, witnessedBy || null, note || null]);
  return att(row);
}

/** Accept a passed attempt: someone other than its performer, and only the latest for its item. */
export async function acceptAttempt(db, { projectId, attemptId, userId }) {
  if (!UUID.test(String(attemptId || ""))) throw notFound("attempt");
  const { rows: [a] } = await db.query("SELECT * FROM precom_attempt WHERE id = $1 AND project_id = $2", [attemptId, projectId]);
  if (!a) throw notFound("attempt");
  const { rows: [latest] } = await db.query(
    `SELECT * FROM precom_attempt WHERE project_id = $1 AND subsystem_id = $2 AND template_id = $3 AND item_ref = $4
      ORDER BY created_at DESC LIMIT 1`, [projectId, a.subsystem_id, a.template_id, a.item_ref]);
  const problems = acceptProblems({ attempt: att(a), latest: att(latest), userId });
  if (problems.length) throw bad(problems.join(" · "));
  const { rows: [row] } = await db.query(
    "UPDATE precom_attempt SET accepted_by = $2, accepted_at = clock_timestamp() WHERE id = $1 RETURNING *", [attemptId, userId]);
  return att(row);
}

const snap = (checks) => JSON.stringify({ checks: checks.map((c) => ({ code: c.code, item: c.label, attemptId: c.latest?.id })) });
// In words: a person reading «باز: punch (1)» learns the schema, not what to close.
const openText = (r) => r.blockers.map((b) => (RFSU_BLOCKER_FA[b.kind] || b.kind) + (b.count ? ` (${b.count})` : "")).join("، ");

/** Sign RFC: refused while anything pre-commissioning certifies is open. */
export async function signRfc(db, { projectId, subsystemId, userId }) {
  const s = await subsystemPrecom(db, { projectId, subsystemId });
  if (s.subsystem.rfc_signed_at) throw bad("RFC این ساب‌سیستم پیش‌تر امضا شده است.");
  if (!s.rfc.ready) throw bad(`RFC امضا نمی‌شود — باز: ${openText(s.rfc)}`);
  const { rows: [r] } = await db.query(
    "INSERT INTO rfc_certificate (project_id, subsystem_id, snapshot, signed_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [projectId, subsystemId, snap(s.checks.filter((c) => c.phase === "precom")), userId]);
  return r;
}

/** The client's acceptance of RFC: someone other than the signer. Commissioning starts from it. */
export async function acceptRfc(db, { projectId, subsystemId, userId }) {
  const { rows: [r] } = await db.query("SELECT * FROM rfc_certificate WHERE project_id = $1 AND subsystem_id = $2", [projectId, subsystemId]);
  if (!r) throw bad("RFC هنوز امضا نشده است.");
  if (r.accepted_by) throw bad("RFC پیش‌تر پذیرفته شده است.");
  if (r.signed_by === userId) throw bad("امضاکنندهٔ RFC، آن را از طرف کارفرما نمی‌پذیرد.");
  const { rows: [out] } = await db.query(
    "UPDATE rfc_certificate SET accepted_by = $2, accepted_at = clock_timestamp() WHERE id = $1 RETURNING *", [r.id, userId]);
  return out;
}

/** Sign RFSU: refused while anything commissioning certifies is open. The readiness is kept with the signature. */
export async function signRfsu(db, { projectId, subsystemId, userId }) {
  const s = await subsystemPrecom(db, { projectId, subsystemId });
  if (s.subsystem.rfsu_signed_at) throw bad("RFSU این ساب‌سیستم پیش‌تر امضا شده است.");
  if (!s.rfsu.ready) throw bad(`RFSU امضا نمی‌شود — باز: ${openText(s.rfsu)}`);
  const { rows: [r] } = await db.query(
    "INSERT INTO rfsu_certificate (project_id, subsystem_id, snapshot, signed_by) VALUES ($1,$2,$3,$4) RETURNING *",
    [projectId, subsystemId, snap(s.checks.filter((c) => c.phase === "commissioning")), userId]);
  return r;
}

/** The client's acceptance of RFSU: someone other than the signer. */
export async function acceptRfsu(db, { projectId, subsystemId, userId }) {
  const { rows: [r] } = await db.query("SELECT * FROM rfsu_certificate WHERE project_id = $1 AND subsystem_id = $2", [projectId, subsystemId]);
  if (!r) throw bad("RFSU هنوز امضا نشده است.");
  if (r.accepted_by) throw bad("RFSU پیش‌تر پذیرفته شده است.");
  if (r.signed_by === userId) throw bad("امضاکنندهٔ RFSU، آن را از طرف کارفرما نمی‌پذیرد.");
  const { rows: [out] } = await db.query(
    "UPDATE rfsu_certificate SET accepted_by = $2, accepted_at = clock_timestamp() WHERE id = $1 RETURNING *", [r.id, userId]);
  return out;
}

const tpl = (t) => ({ id: t.id, code: t.code, title: t.title, appliesTo: t.applies_to, appliesTitle: APPLIES[t.applies_to],
  phase: t.phase, phaseTitle: PHASES[t.phase], criteria: t.criteria, active: t.active });
const att = (a) => a && ({ id: a.id, templateId: a.template_id, itemRef: a.item_ref, result: a.result, performedOn: a.performed_on,
  performedBy: a.performed_by, performedByName: a.performed_by_name, witnessedBy: a.witnessed_by, note: a.note,
  acceptedBy: a.accepted_by, acceptedByName: a.accepted_by_name, acceptedAt: a.accepted_at, createdAt: a.created_at });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
