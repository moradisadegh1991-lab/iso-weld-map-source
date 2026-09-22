/**
 * Contractors and the scopes of work they hold.
 *
 * In EPC the work is executed by subcontractors, so almost every question a
 * project manager asks is scoped by one. This is what makes those questions
 * answerable: a contractor is a row, a scope is a row, and progress joins to
 * both.
 *
 * Call inside `withProject`.
 */

const DISCIPLINES = ["piping", "structural", "electrical", "instrumentation", "civil", "equipment"];
const STATUSES = ["prospective", "active", "suspended", "demobilised"];

/**
 * A Postgres array column, as a JavaScript array.
 *
 * `discipline[]` is a custom enum array, so the driver has no parser
 * registered for its type OID and hands back the raw literal —
 * "{civil,structural}". Left alone that reaches the UI as a string and
 * renders with its braces, which looks like a formatting slip rather than a
 * type bug and is exactly the kind of thing that ships. Both shapes are
 * accepted here so this keeps working if the driver ever learns the type.
 */
function toArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v !== "string") return [];
  const inner = v.replace(/^\{|\}$/g, "").trim();
  return inner ? inner.split(",").map((x) => x.replace(/^"|"$/g, "")) : [];
}

export async function upsertContractor(db, {
  projectId, code, name, status = "active", disciplines = [],
  contactName = null, contactPhone = null, contactEmail = null, nationalId = null,
  prequalifiedOn = null, prequalifiedUntil = null, note = null,
}) {
  if (!code) throw bad("کد پیمانکار لازم است.");
  if (!name) throw bad("نام پیمانکار لازم است.");
  if (!STATUSES.includes(status)) throw bad(`وضعیت «${status}» شناخته نشد.`);
  const bad_ = disciplines.find((d) => !DISCIPLINES.includes(d));
  if (bad_) throw bad(`رشتهٔ «${bad_}» شناخته نشد.`);

  const { rows } = await db.query(
    `INSERT INTO contractor (project_id, code, name, status, disciplines,
                             contact_name, contact_phone, contact_email, national_id,
                             prequalified_on, prequalified_until, note)
     VALUES ($1,$2,$3,$4::contractor_status,
             -- The driver does not turn a JS array into a Postgres array
             -- literal, so the list travels as text and is split here. Every
             -- element was checked against DISCIPLINES above, and it is still
             -- a bound parameter, so nothing is interpolated either way.
             COALESCE(string_to_array(NULLIF($5, ''), ','), '{}')::discipline[],
             $6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (project_id, code) DO UPDATE
        SET name = EXCLUDED.name, status = EXCLUDED.status,
            disciplines = EXCLUDED.disciplines,
            contact_name  = COALESCE(EXCLUDED.contact_name,  contractor.contact_name),
            contact_phone = COALESCE(EXCLUDED.contact_phone, contractor.contact_phone),
            contact_email = COALESCE(EXCLUDED.contact_email, contractor.contact_email),
            national_id   = COALESCE(EXCLUDED.national_id,   contractor.national_id),
            prequalified_on    = COALESCE(EXCLUDED.prequalified_on,    contractor.prequalified_on),
            prequalified_until = COALESCE(EXCLUDED.prequalified_until, contractor.prequalified_until),
            note = COALESCE(EXCLUDED.note, contractor.note)
     RETURNING *`,
    [projectId, code, name, status, disciplines.join(","), contactName, contactPhone,
     contactEmail, nationalId, prequalifiedOn, prequalifiedUntil, note]);
  return { ...rows[0], disciplines: toArray(rows[0].disciplines) };
}

/**
 * Every contractor, with what they hold and whether they may still work.
 *
 * Expiry is computed here and not stored, for the same reason `blocked` is
 * computed in the precedence engine: a stored flag is wrong the morning
 * after it becomes true and nobody is watching.
 */
export async function listContractors(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT * FROM reporting.dim_contractor
      WHERE project_key = $1 ORDER BY contractor_code`, [projectId]);
  return rows.map((r) => ({
    id: r.contractor_key,
    code: r.contractor_code,
    name: r.contractor_name,
    status: r.status,
    disciplines: toArray(r.disciplines),
    prequalifiedUntil: r.prequalified_until,
    expired: r.prequalification_expired,
    packages: Number(r.packages),
    awardedValue: r.awarded_value == null ? null : Number(r.awarded_value),
  }));
}

export async function upsertPackage(db, {
  projectId, contractorId, code, title = null, discipline,
  subsystemId = null, value = null, currency = null,
  startDate = null, endDate = null,
}) {
  if (!code) throw bad("کد پکیج لازم است.");
  if (!DISCIPLINES.includes(discipline)) throw bad(`رشتهٔ «${discipline}» شناخته نشد.`);
  // The database enforces this too; saying it here gives a Persian message
  // instead of a constraint name.
  if (value != null && !currency) throw bad("مبلغ بدون واحد پول ثبت نمی‌شود.");

  const { rows } = await db.query(
    `INSERT INTO contract_package (project_id, contractor_id, code, title, discipline,
                                   subsystem_id, value, currency, start_date, end_date)
     VALUES ($1,$2,$3,$4,$5::discipline,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id, code) DO UPDATE
        SET contractor_id = EXCLUDED.contractor_id, title = EXCLUDED.title,
            discipline = EXCLUDED.discipline, subsystem_id = EXCLUDED.subsystem_id,
            value = EXCLUDED.value, currency = EXCLUDED.currency,
            start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date
     RETURNING *`,
    [projectId, contractorId, code, title, discipline, subsystemId,
     value, currency, startDate, endDate]);
  return rows[0];
}

/** Progress per package: whose work is holding what. */
export async function packageProgress(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT * FROM reporting.kpi_package_progress
      WHERE project_key = $1
      ORDER BY pct_ready NULLS FIRST, package_code`, [projectId]);
  return rows.map((r) => ({
    packageId: r.package_key,
    code: r.package_code,
    discipline: r.discipline,
    contractorId: r.contractor_key,
    contractor: r.contractor_name,
    subsystem: r.subsystem_code,
    scope: r.subsystem_code || "کل پروژه",
    items: Number(r.items),
    installed: Number(r.installed),
    tested: Number(r.tested),
    pctReady: r.pct_ready == null ? null : Number(r.pct_ready),
  }));
}

export async function packagesOf(db, { projectId, contractorId }) {
  const { rows } = await db.query(
    `SELECT p.*, s.code AS subsystem_code FROM contract_package p
       LEFT JOIN subsystem s ON s.id = p.subsystem_id
      WHERE p.project_id = $1 AND p.contractor_id = $2 ORDER BY p.code`,
    [projectId, contractorId]);
  return rows;
}

/**
 * Contractors whose prequalification has lapsed but who still hold work.
 *
 * This is the list that matters: an expired certificate on a company with no
 * open package is paperwork, and the same certificate on one currently
 * welding is an audit finding.
 */
export async function lapsedWithWork(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT c.contractor_code, c.contractor_name, c.prequalified_until, c.packages
       FROM reporting.dim_contractor c
      WHERE c.project_key = $1
        AND c.prequalification_expired
        AND c.status IN ('active', 'suspended')
        AND c.packages > 0
      ORDER BY c.prequalified_until`, [projectId]);
  return rows;
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
