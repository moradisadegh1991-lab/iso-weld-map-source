/**
 * Human resources: the project's personnel and their timesheets.
 *
 * One person, one row: the register is the same one HSE names on permits
 * (hse_person, keyed by national / employee number), so a person HR
 * mobilises is the person a permit can name, with their competence cards —
 * and a person HSE registered appears here to be completed, not re-typed.
 *
 * A timesheet row is a person's hours on one day against a WBS element;
 * hours are summed by contractor for the HSE man-hours and by WBS element
 * for the controls, rather than typed a second time for either.
 *
 * Call inside `withProject`.
 */
import { latestToday } from "../../civil/concrete.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const blank = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);

export const EMPLOYER_FA = { epc: "پیمانکار EPC", contractor: "پیمانکار جزء", client: "کارفرما", consultant: "مشاور" };

export async function upsertPersonnel(db, { projectId, idNo, fullName, employer = "contractor", contractorId = null,
  position = null, department = null, trade = null, mobilizedOn = null, demobilizedOn = null, phone = null, email = null, userId = null }) {
  const id = blank(idNo), name = blank(fullName);
  if (!id || !name) throw bad("کد ملی / شمارهٔ پرسنلی و نام لازم است.");
  if (!EMPLOYER_FA[employer]) throw bad("کارفرمای فرد (EPC، پیمانکار جزء، کارفرما، مشاور) را انتخاب کنید.");
  if (employer === "contractor" && !contractorId) throw bad("پرسنل پیمانکار جزء، پیمانکارش را می‌خواهد.");
  if (blank(email) && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(blank(email))) throw bad(`ایمیل «${email}» درست نیست.`);
  const mob = iso(mobilizedOn), demob = iso(demobilizedOn);
  if (mob && mob > latestToday()) throw bad(`تاریخ ورود ${mob} هنوز نرسیده است.`);
  if (mob && demob && demob < mob) throw bad("تاریخ خروج پیش از تاریخ ورود است.");
  const { rows: [have] } = await db.query("SELECT id FROM hse_person WHERE project_id = $1 AND id_no = $2", [projectId, id]);
  const { rows: [p] } = await db.query(
    `INSERT INTO hse_person (project_id, id_no, full_name, contractor_id, trade, employer, position, department, mobilized_on, demobilized_on, phone, email)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (project_id, id_no) DO UPDATE SET full_name = EXCLUDED.full_name, contractor_id = EXCLUDED.contractor_id,
       trade = COALESCE(EXCLUDED.trade, hse_person.trade), employer = EXCLUDED.employer, position = EXCLUDED.position,
       department = EXCLUDED.department, mobilized_on = EXCLUDED.mobilized_on, demobilized_on = EXCLUDED.demobilized_on,
       phone = EXCLUDED.phone, email = EXCLUDED.email
     RETURNING *`,
    [projectId, id, name, employer === "contractor" ? contractorId : null, blank(trade), employer, blank(position), blank(department),
     mob, demob, blank(phone), blank(email) ? blank(email).toLowerCase() : null]);
  await logEvent(db, { projectId, section: "hr", entityType: "person", entityId: p.id, label: `${name} (${id})`,
    action: have ? "updated" : "created", comment: [blank(position), EMPLOYER_FA[employer], demob ? `خروج ${demob}` : null].filter(Boolean).join(" · "), userId });
  return p;
}

/** A person's hours on one day (against a WBS element, if any). Mobilised people only. */
export async function recordTimesheet(db, { projectId, personId, workDate, hours, overtime = 0, accountId = null, note = null, userId = null }) {
  const on = iso(workDate); if (!on) throw bad("تاریخ لازم است.");
  if (on > latestToday()) throw bad(`تاریخ ${on} هنوز نرسیده است.`);
  const h = Number(hours), o = Number(overtime || 0);
  if (!Number.isFinite(h) || h < 0 || !Number.isFinite(o) || o < 0 || h + o > 24) throw bad("ساعت کار و اضافه‌کار باید بین ۰ و ۲۴ ساعت در روز باشد.");
  const { rows: [p] } = await db.query("SELECT * FROM hse_person WHERE id = $1 AND project_id = $2", [personId, projectId]);
  if (!p) throw bad("فرد پیدا نشد.");
  if (p.mobilized_on && on < iso(p.mobilized_on)) throw bad(`${p.full_name} در ${on} هنوز به پروژه نیامده بود (ورود ${iso(p.mobilized_on)}).`);
  if (p.demobilized_on && on > iso(p.demobilized_on)) throw bad(`${p.full_name} در ${iso(p.demobilized_on)} از پروژه خارج شده است.`);
  const { rows: [day] } = await db.query(
    "SELECT COALESCE(sum(hours + overtime), 0) AS h FROM hr_timesheet WHERE person_id = $1 AND work_date = $2 AND account_id IS DISTINCT FROM $3",
    [personId, on, accountId || null]);
  if (Number(day.h) + h + o > 24) throw bad(`${p.full_name} در ${on} روی هم بیش از ۲۴ ساعت می‌شود.`);
  const { rows: [t] } = await db.query(
    `INSERT INTO hr_timesheet (project_id, person_id, work_date, hours, overtime, account_id, note, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (person_id, work_date, COALESCE(account_id, '00000000-0000-0000-0000-000000000000'::uuid))
     DO UPDATE SET hours = EXCLUDED.hours, overtime = EXCLUDED.overtime, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by
     RETURNING *`, [projectId, personId, on, h, o, accountId || null, blank(note), userId]);
  await logEvent(db, { projectId, section: "hr", entityType: "timesheet", entityId: t.id, label: `کارکرد ${p.full_name} — ${on}`,
    action: "recorded", comment: `${h} ساعت${o ? ` + ${o} اضافه‌کار` : ""}`, userId });
  return t;
}

/** The register, headcount on a day, and hours by month — by contractor and by WBS element. */
export async function hrBoard(db, { projectId, onDate = null }) {
  const day = iso(onDate) || latestToday();
  const { rows: people } = await db.query(
    `SELECT p.*, c.code AS contractor_code, c.name AS contractor_name,
            (SELECT COALESCE(sum(t.hours + t.overtime), 0) FROM hr_timesheet t WHERE t.person_id = p.id) AS hours
       FROM hse_person p LEFT JOIN contractor c ON c.id = p.contractor_id WHERE p.project_id = $1 ORDER BY p.full_name`, [projectId]);
  const onSite = people.filter((p) => (!p.mobilized_on || iso(p.mobilized_on) <= day) && (!p.demobilized_on || iso(p.demobilized_on) >= day) && p.mobilized_on);
  const group = (arr, key) => Object.entries(arr.reduce((m, p) => { const k = key(p); m[k] = (m[k] || 0) + 1; return m; }, {}))
    .map(([k, n]) => ({ key: k, n })).sort((a, b) => b.n - a.n);
  const { rows: byMonth } = await db.query(
    `SELECT to_char(t.work_date, 'YYYY-MM') AS month, COALESCE(c.code, CASE p.employer WHEN 'epc' THEN 'EPC' ELSE p.employer END) AS party,
            sum(t.hours) AS hours, sum(t.overtime) AS overtime, count(DISTINCT t.person_id)::int AS people
       FROM hr_timesheet t JOIN hse_person p ON p.id = t.person_id LEFT JOIN contractor c ON c.id = p.contractor_id
      WHERE t.project_id = $1 GROUP BY 1, 2 ORDER BY 1, 2`, [projectId]);
  const { rows: byWbs } = await db.query(
    `SELECT COALESCE(a.code, '—') AS wbs, a.title, sum(t.hours + t.overtime) AS hours
       FROM hr_timesheet t LEFT JOIN control_account a ON a.id = t.account_id WHERE t.project_id = $1 GROUP BY 1, 2 ORDER BY 1`, [projectId]);
  // The HSE man-hours of the same contractors and months, to reconcile.
  const { rows: hse } = await db.query(
    `SELECT to_char(m.work_date, 'YYYY-MM') AS month, COALESCE(c.code, 'EPC') AS party, sum(m.hours) AS hours
       FROM hse_manhours m LEFT JOIN contractor c ON c.id = m.contractor_id WHERE m.project_id = $1 GROUP BY 1, 2`, [projectId]);
  const { rows: recent } = await db.query(
    `SELECT t.*, p.full_name, p.id_no, a.code AS wbs FROM hr_timesheet t JOIN hse_person p ON p.id = t.person_id
       LEFT JOIN control_account a ON a.id = t.account_id WHERE t.project_id = $1 ORDER BY t.work_date DESC, p.full_name LIMIT 200`, [projectId]);
  return {
    onDate: day, employers: EMPLOYER_FA,
    people: people.map((p) => ({ id: p.id, idNo: p.id_no, fullName: p.full_name, employer: p.employer, employerFa: EMPLOYER_FA[p.employer],
      contractorId: p.contractor_id, contractor: p.contractor_code ? `${p.contractor_code} — ${p.contractor_name}` : null,
      position: p.position, department: p.department, trade: p.trade, mobilizedOn: iso(p.mobilized_on), demobilizedOn: iso(p.demobilized_on),
      phone: p.phone, email: p.email, hours: Number(p.hours),
      status: !p.mobilized_on ? "not_mobilized" : p.demobilized_on && iso(p.demobilized_on) < day ? "demobilized" : "on_site" })),
    headcount: { total: onSite.length, byEmployer: group(onSite, (p) => EMPLOYER_FA[p.employer]),
      byParty: group(onSite, (p) => p.contractor_code || EMPLOYER_FA[p.employer]), byDepartment: group(onSite, (p) => p.department || "—") },
    byMonth: byMonth.map((r) => {
      const h = hse.find((x) => x.month === r.month && x.party === r.party);
      return { month: r.month, party: r.party, hours: Number(r.hours), overtime: Number(r.overtime), people: r.people,
        hseHours: h ? Number(h.hours) : null };
    }),
    byWbs: byWbs.map((r) => ({ wbs: r.wbs, title: r.title, hours: Number(r.hours) })),
    recent: recent.map((t) => ({ id: t.id, person: t.full_name, idNo: t.id_no, workDate: iso(t.work_date), hours: Number(t.hours),
      overtime: Number(t.overtime), wbs: t.wbs, note: t.note })),
  };
}
