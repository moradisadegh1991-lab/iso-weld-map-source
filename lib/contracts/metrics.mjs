/**
 * What the platform can measure for a payment item, as of a date.
 *
 * Each metric counts work the platform already holds, dated by the day the
 * work was done (not the day it was typed), so a statement for a period end
 * counts exactly the work done by then — the same record the site entered,
 * the engineer signed and the progress curve counted. A metric can be
 * narrowed to one subsystem (the package's scope).
 *
 * The SQL takes $1 project, $2 date, $3 subsystem (or NULL) and returns
 * { qty, items, missing } — `missing` counts items that are done but whose
 * quantity is unknown (a cable with no length): they are not guessed, and
 * the statement says so.
 */
export const METRICS = {
  piping_inchdia_shop: {
    title: "اینچ‌قطر جوش کارگاهی", unit: "inch-dia", discipline: "piping",
    sql: `SELECT COALESCE(sum(fw.nps), 0) AS qty, count(*)::int AS items, count(*) FILTER (WHERE fw.nps IS NULL)::int AS missing
            FROM reporting.fact_weld fw JOIN document d ON d.id = fw.document_key AND d.superseded_by IS NULL
            LEFT JOIN line l ON l.id = fw.line_key
           WHERE fw.project_key = $1 AND fw.is_welded AND fw.welded_at <= $2 AND fw.shop_field = 'Shop'
             AND ($3::uuid IS NULL OR COALESCE(l.subsystem_id, d.subsystem_id) = $3)`,
  },
  piping_inchdia_field: {
    title: "اینچ‌قطر جوش سایت", unit: "inch-dia", discipline: "piping",
    sql: `SELECT COALESCE(sum(fw.nps), 0) AS qty, count(*)::int AS items, count(*) FILTER (WHERE fw.nps IS NULL)::int AS missing
            FROM reporting.fact_weld fw JOIN document d ON d.id = fw.document_key AND d.superseded_by IS NULL
            LEFT JOIN line l ON l.id = fw.line_key
           WHERE fw.project_key = $1 AND fw.is_welded AND fw.welded_at <= $2 AND fw.shop_field = 'Field'
             AND ($3::uuid IS NULL OR COALESCE(l.subsystem_id, d.subsystem_id) = $3)`,
  },
  piping_spools_erected: {
    title: "اسپول نصب‌شده", unit: "عدد", discipline: "piping",
    sql: `SELECT count(*)::numeric AS qty, count(*)::int AS items, 0 AS missing
            FROM spool_activity a JOIN spool s ON s.id = a.spool_id
            JOIN reporting.current_run cr ON cr.run_id = s.extraction_run_id
            JOIN document d ON d.id = cr.document_id AND d.superseded_by IS NULL
            LEFT JOIN line l ON l.id = s.line_id
           WHERE a.project_id = $1 AND a.code = 'erected' AND a.status = 'done' AND a.done_at <= $2
             AND ($3::uuid IS NULL OR l.subsystem_id = $3)`,
  },
  civil_concrete_m3: {
    title: "بتن ریخته‌شده", unit: "m³", discipline: "civil",
    sql: `SELECT COALESCE(sum(p.volume_m3), 0) AS qty, count(*)::int AS items, count(*) FILTER (WHERE p.volume_m3 IS NULL)::int AS missing
            FROM concrete_pour p JOIN tag t ON t.id = p.tag_id
           WHERE p.project_id = $1 AND p.poured_on <= $2 AND ($3::uuid IS NULL OR t.subsystem_id = $3)`,
  },
  equipment_set: {
    title: "تجهیز مستقر و ترازشده", unit: "عدد", discipline: "equipment",
    sql: `SELECT count(*)::numeric AS qty, count(*)::int AS items, 0 AS missing
            FROM tag_activity a JOIN tag t ON t.id = a.tag_id
           WHERE a.project_id = $1 AND a.code = 'set' AND a.status = 'done' AND a.done_at <= $2
             AND ($3::uuid IS NULL OR t.subsystem_id = $3)`,
  },
  cable_pulled_m: {
    title: "کابل کشیده‌شده", unit: "m", discipline: "electrical",
    sql: `SELECT COALESCE(sum(c.length_m), 0) AS qty, count(*)::int AS items, count(*) FILTER (WHERE c.length_m IS NULL)::int AS missing
            FROM cable_activity a JOIN cable c ON c.id = a.cable_id
           WHERE a.project_id = $1 AND a.code = 'pulled' AND a.status = 'done' AND a.done_at <= $2
             AND ($3::uuid IS NULL OR c.subsystem_id = $3)`,
  },
  cable_terminated: {
    title: "کابل ترمینیت‌شده (دو سر)", unit: "رشته", discipline: "electrical",
    sql: `SELECT count(*)::numeric AS qty, count(*)::int AS items, 0 AS missing
            FROM cable_activity a JOIN cable c ON c.id = a.cable_id
           WHERE a.project_id = $1 AND a.code = 'terminated' AND a.status = 'done' AND a.done_at <= $2
             AND ($3::uuid IS NULL OR c.subsystem_id = $3)`,
  },
  instrument_installed: {
    title: "ابزار نصب‌شده", unit: "عدد", discipline: "instrumentation",
    sql: `SELECT count(*)::numeric AS qty, count(*)::int AS items, 0 AS missing
            FROM instrument_activity a JOIN instrument i ON i.id = a.instrument_id
           WHERE a.project_id = $1 AND a.code = 'installed' AND a.status = 'done' AND a.done_at <= $2
             AND ($3::uuid IS NULL OR i.subsystem_id = $3)`,
  },
};

export const METRIC_FA = Object.fromEntries(Object.entries(METRICS).map(([k, m]) => [k, `${m.title} (${m.unit})`]));
