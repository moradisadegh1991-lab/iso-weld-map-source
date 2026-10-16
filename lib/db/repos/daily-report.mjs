/**
 * The daily report's link to the rest of the platform: what the project
 * already holds for a date, offered to the person writing the report.
 *
 * It is an offer, never a fill-in behind anyone's back: the form shows it,
 * the writer keeps, changes or drops each row, and every row carries where
 * it came from. A number the platform does not hold (machines, materials,
 * stoppages) is not invented — those lists start empty.
 *
 * Call inside `withProject`.
 */
import { CLAIM_TABLES, labels } from "./claims.mjs";

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const SECTION_FA = { equipment: "تجهیزات", piping: "پایپینگ", electrical: "برق", instrumentation: "ابزار دقیق", coating: "رنگ و عایق" };

export async function dailyPrefill(db, { projectId, date }) {
  const day = iso(date);
  if (!day) throw Object.assign(new Error("تاریخ لازم است."), { status: 400 });

  // people: the timesheets of that day, by employer and position
  const { rows: people } = await db.query(
    `SELECT COALESCE(c.code, CASE p.employer WHEN 'contractor' THEN 'پیمانکار' WHEN 'client' THEN 'کارفرما' ELSE p.employer END) AS employer,
            COALESCE(p.position, p.trade, '—') AS role, p.department AS discipline,
            count(DISTINCT p.id)::int AS present, sum(t.hours)::float AS hours
       FROM hr_timesheet t JOIN hse_person p ON p.id = t.person_id LEFT JOIN contractor c ON c.id = p.contractor_id
      WHERE t.project_id = $1 AND t.work_date = $2 AND t.hours > 0
      GROUP BY 1, 2, 3 ORDER BY 1, 2`, [projectId, day]);

  // work: steps finished on that day, and steps a contractor claimed as finished on it
  const work = [];
  for (const table of Object.keys(CLAIM_TABLES)) {
    const { rows } = await db.query(
      `SELECT a.*, c.code AS contractor FROM ${table} a LEFT JOIN contractor c ON c.id = a.contractor_id
        WHERE a.project_id = $1 AND ((a.status = 'done' AND a.done_at = $2) OR a.claimed_on = $2) ORDER BY a.recorded_at`, [projectId, day]);
    const ls = rows.length ? await labels(db, table, rows) : [];
    rows.forEach((r, k) => work.push({
      description: `${ls[k].step} — ${ls[k].item}`, discipline: SECTION_FA[CLAIM_TABLES[table].section] || CLAIM_TABLES[table].section,
      location: null, qty: null, unit: null, state: r.claimed_on ? "claimed" : "done", ref: r.ref_no || null, source: "platform",
      contractor: r.contractor || null,
    }));
  }

  // HSE: incidents of the day, permits valid during it, observations made on it
  const { rows: [h] } = await db.query(
    `SELECT (SELECT count(*)::int FROM hse_incident WHERE project_id = $1 AND occurred_at::date = $2) AS incidents,
            (SELECT count(*)::int FROM hse_permit WHERE project_id = $1 AND status IN ('active', 'closed')
                AND valid_from::date <= $2 AND valid_to::date >= $2) AS permits,
            (SELECT count(*)::int FROM hse_observation WHERE project_id = $1 AND observed_on = $2) AS observations`, [projectId, day]);

  return {
    date: day,
    manpower: people.map((r) => ({ role: r.role, discipline: r.discipline, employer: r.employer, present: r.present, leave: 0, night: 0,
      hours: r.hours, source: "hr" })),
    work,
    hse: { incidents: h.incidents, permits: h.permits, observations: h.observations, note: null, source: "platform" },
    found: { people: people.reduce((s, r) => s + r.present, 0), work: work.length, incidents: h.incidents },
  };
}
