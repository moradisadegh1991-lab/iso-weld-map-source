/**
 * One asset, every discipline: the digital thread of a single tag
 * (Master Plan §3, §55, §79).
 *
 * Nothing here is stored or recomputed differently: each section is the
 * answer the discipline's own module gives, joined on the tag's id. What
 * the platform does not yet hold for an asset (vendor data, purchase order,
 * CMMS, DCS/historian mapping) is listed as not held — never shown as
 * complete or as missing.
 *
 * Call inside `withProject`.
 */
import { tagStatus } from "./activities.mjs";
import { cableBoard } from "./electrical.mjs";
import { instrumentStatus } from "./instrumentation.mjs";
import { coatingStatus } from "./coating.mjs";

/** Domains the master plan names that no module of this platform holds yet. */
export const NOT_HELD = [
  { key: "vendor", title: "مدارک و دادهٔ وندور (Vendor Data)" },
  { key: "procurement", title: "خرید (MR / PO / FAT / حمل)" },
  { key: "cmms", title: "CMMS / EAM (Functional Location، PM، BOM)" },
  { key: "dcs", title: "نگاشت DCS / Historian" },
];

export async function assetThread(db, { projectId, tagId = null, tagNo = null }) {
  const { rows: [tag] } = await db.query(
    `SELECT t.id, t.tag_no, t.discipline, t.kind, t.description, t.carries_tag_id,
            s.id AS subsystem_id, s.code AS subsystem, s.name AS subsystem_name, s.system_code,
            u.code AS unit, c.tag_no AS carries_tag_no
       FROM tag t
       LEFT JOIN subsystem s ON s.id = t.subsystem_id
       LEFT JOIN unit u ON u.id = s.unit_id
       LEFT JOIN tag c ON c.id = t.carries_tag_id
      WHERE t.project_id = $1 AND ($2::uuid IS NOT NULL AND t.id = $2::uuid
                                   OR $2::uuid IS NULL AND upper(t.tag_no) = upper($3))`,
    [projectId, tagId, tagNo]);
  if (!tag) throw Object.assign(new Error("tag not found"), { status: 404 });

  const status = await tagStatus(db, { projectId, tagId: tag.id });

  // ── civil: what it stands on ──
  const { rows: foundations } = await db.query(
    `SELECT f.id, f.tag_no, fs.concrete_class, fs.fc_mpa FROM tag f
       LEFT JOIN foundation_spec fs ON fs.tag_id = f.id
      WHERE f.project_id = $1 AND f.carries_tag_id = $2 ORDER BY f.tag_no`, [projectId, tag.id]);
  for (const f of foundations) {
    const s = await tagStatus(db, { projectId, tagId: f.id });
    const strength = s.steps?.find((x) => x.code === "strength");
    Object.assign(f, { pct: s.progress?.pct ?? 0, ready: !!s.why?.ready,
      strength: strength ? { status: strength.status, note: strength.note } : null });
  }

  // ── piping: lines tagged to it, and their welds ──
  const { rows: lines } = await db.query(
    `SELECT l.id, l.line_no, l.service,
            count(f.weld_uid)::int AS welds,
            count(f.weld_uid) FILTER (WHERE f.is_welded)::int AS welded,
            count(f.weld_uid) FILTER (WHERE f.is_examined)::int AS examined
       FROM line l LEFT JOIN reporting.fact_weld f ON f.line_key = l.id
      WHERE l.project_id = $1 AND l.tag_id = $2
      GROUP BY l.id, l.line_no, l.service ORDER BY l.line_no`, [projectId, tag.id]);

  // ── electrical, instrumentation, coating ──
  const cables = await cableBoard(db, { projectId, tagId: tag.id });
  const { rows: instIds } = await db.query(
    "SELECT id FROM instrument WHERE project_id = $1 AND eq_tag_id = $2 ORDER BY loop_no, tag_no", [projectId, tag.id]);
  const instruments = [];
  for (const { id } of instIds) {
    const s = await instrumentStatus(db, { projectId, instrumentId: id });
    const cal = s.steps.find((x) => x.code === "calibrated");
    instruments.push({ id, tagNo: s.instrument.tag_no, category: s.instrument.category, loopNo: s.instrument.loop_no,
      pct: s.progress.pct, ready: s.why.ready, calibration: { status: cal.status, note: cal.note } });
  }
  const { rows: [coatItem] } = await db.query(
    "SELECT id FROM coating_item WHERE project_id = $1 AND tag_id = $2", [projectId, tag.id]);
  let coating = null;
  if (coatItem) {
    const s = await coatingStatus(db, { projectId, itemId: coatItem.id });
    coating = { id: coatItem.id, system: s.item.system_code, insulation: s.item.insulation,
      pct: s.progress.pct, ready: s.why.ready,
      next: s.next.map((n) => n.title) };
  }

  // ── contracts covering it ──
  const { rows: packages } = await db.query(
    `SELECT p.code, p.title, p.discipline, c.name AS contractor
       FROM contract_package p JOIN contractor c ON c.id = p.contractor_id
      WHERE p.project_id = $1 AND (p.subsystem_id = $2 OR p.subsystem_id IS NULL)
      ORDER BY p.discipline, p.code`, [projectId, tag.subsystem_id]);

  return {
    tag, status, foundations, lines, cables, instruments, coating, packages,
    readiness: digitalReadiness({ tag, status, foundations, lines, cables, instruments, coating }),
    notHeld: NOT_HELD,
  };
}

/**
 * Digital readiness over what the platform holds (Master Plan §60).
 *
 * Two kinds of check, reported apart:
 *   IDENTITY — the asset itself is filed, classified, described: every
 *              asset needs these, so each is pass or fail.
 *   LINKS    — civil, piping, electrical, instrumentation, coating data
 *              attached to it. An absent link may be a gap OR may not apply
 *              (a vessel may have no motor cable); the platform does not
 *              guess which, so a link is "linked" or "none recorded", and
 *              only identity makes up the score.
 */
export function digitalReadiness({ tag, status, foundations, lines, cables, instruments, coating }) {
  const identity = [
    { key: "subsystem", title: "در ساب‌سیستم ثبت شده", ok: !!tag.subsystem },
    { key: "kind", title: "نوع و زنجیرهٔ پیش‌نیاز معلوم", ok: !!status.steps },
    { key: "description", title: "شرح سرویس", ok: !!(tag.description && String(tag.description).trim()) },
  ];
  const links = [
    { key: "civil", title: "فونداسیون (سیویل)", count: foundations.length },
    { key: "piping", title: "خط لوله", count: lines.length },
    { key: "electrical", title: "کابل", count: cables.length },
    { key: "instrumentation", title: "ابزار دقیق", count: instruments.length },
    { key: "coating", title: "رنگ و عایق", count: coating ? 1 : 0 },
  ];
  const passed = identity.filter((c) => c.ok).length;
  return { identity, links, identityPct: Math.round((passed / identity.length) * 100),
    linked: links.filter((l) => l.count > 0).length };
}
