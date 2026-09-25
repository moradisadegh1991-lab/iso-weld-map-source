/**
 * The assumption register and the missing-information register.
 *
 * Assumptions are stored, revised and decided on (Master Plan §2.51–2.53).
 * Missing information is COMPUTED from the same facts the engines refuse on
 * — a project with no curing period has foundations whose curing step
 * cannot be judged, and this is where that shows up, with the discipline
 * that owns the answer and how many items wait on it.
 *
 * Call inside `withProject`.
 */

export const STATUSES = {
  proposed: "پیشنهادی", under_review: "در دست بررسی", approved: "تأییدشده",
  rejected: "ردشده", superseded: "جایگزین‌شده", unknown: "نامعلوم",
};
const DECISIONS = new Set(["approved", "rejected", "superseded", "under_review"]);
const IMPACTS = new Set(["low", "medium", "high"]);
/** Fields whose change is a change of substance: a decision on the old text does not carry over. */
const SUBSTANCE = ["category", "description", "value", "source", "owner", "impact", "risk"];

/**
 * The master plan's own baseline (§2.1–2.5). Stated as the plan states it:
 * project-scale assumptions, not engineering facts — so they enter as
 * "proposed" and the detail the plan forbids inferring is written out.
 */
export const BASELINE = [
  { code: "A-001", category: "نوع پروژه", description: "پروژهٔ Greenfield با قرارداد EPC یکپارچه؛ پس از تکمیل به سازمان بهره‌بردار تحویل می‌شود.",
    value: "Greenfield EPC", impact: "high", owner: "مدیریت پروژه",
    risk: "اگر Brownfield باشد، اتصال به سیستم‌ها و Tagهای موجود کارخانه باید طراحی شود." },
  { code: "A-002", category: "ظرفیت", description: "ظرفیت اسمی اتیلن ۵۰۰٬۰۰۰ تن در سال — فقط مقیاس پروژه؛ هیچ پارامتر طراحی (تعداد کوره، کمپرسور، فشار، دما، خلوص) از آن استنتاج نمی‌شود.",
    value: "500,000 t/y", impact: "medium", owner: "فرایند",
    risk: "استنتاج پارامتر طراحی از ظرفیت، عدد جعلی وارد داده‌های مهندسی می‌کند." },
  { code: "A-003", category: "خوراک", description: "اتان تنها خوراک است. ترکیب، فشار، دما، دبی و ناخالصی خوراک نامعلوم است تا مدرک پروژه آن را بدهد.",
    value: "Ethane", impact: "high", owner: "فرایند" },
  { code: "A-004", category: "Utilities", description: "Utilities (بخار، آب خنک‌کن، آب بدون املاح، هوای ابزار، نیتروژن، سوخت، برق، آب آتش‌نشانی، فلر، پساب) داخل مجتمع تأمین می‌شود. ظرفیت‌ها از مهندسی می‌آید.",
    value: "Internal", impact: "high", owner: "فرایند / Utilities" },
  { code: "A-005", category: "ذخیره و صادرات", description: "اتیلن پیش از صادرات در مخازن اختصاصی ذخیره می‌شود. تعداد، حجم، نوع و فشار مخازن و روش بارگیری نامعلوم است.",
    value: "Dedicated storage before export", impact: "medium", owner: "فرایند / Offsite" },
];

export async function listAssumptions(db, { projectId }) {
  const { rows } = await db.query(
    `SELECT a.*, u.display_name AS decided_by_name
       FROM project_assumption a LEFT JOIN app_user u ON u.id = a.decided_by
      WHERE a.project_id = $1 ORDER BY a.code`, [projectId]);
  return rows;
}

async function row(db, projectId, id) {
  const { rows: [a] } = await db.query(
    "SELECT * FROM project_assumption WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!a) throw notFound("assumption");
  return a;
}

async function nextCode(db, projectId) {
  const { rows } = await db.query(
    "SELECT code FROM project_assumption WHERE project_id = $1 AND code ~ '^A-[0-9]+$'", [projectId]);
  const n = rows.reduce((m, r) => Math.max(m, Number(r.code.slice(2))), 0) + 1;
  return `A-${String(n).padStart(3, "0")}`;
}

/** A new assumption. It starts as proposed; nobody approves their own proposal by creating it. */
export async function proposeAssumption(db, {
  projectId, code = null, category, description, value = null, source = null, owner = null,
  impact = "medium", risk = null, userId = null,
}) {
  if (!category || !description) throw bad("دسته و شرح فرض لازم است.");
  if (!IMPACTS.has(impact)) throw bad(`اثر «${impact}» شناخته نشد.`);
  const c = code ? String(code).trim().toUpperCase() : await nextCode(db, projectId);
  const { rows } = await db.query(
    `INSERT INTO project_assumption (project_id, code, category, description, value, source, owner,
                                     impact, risk, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [projectId, c, category, description, value, source, owner, impact, risk, userId]);
  return rows[0];
}

async function snapshot(db, a, reason, userId) {
  const { id, project_id, ...rest } = a;
  await db.query(
    `INSERT INTO project_assumption_revision (project_id, assumption_id, revision, snapshot, reason, changed_by)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
    [project_id, id, a.revision, JSON.stringify(rest), reason, userId]);
}

/**
 * Change an assumption's content. The old revision is kept as it stood, and
 * a decision on it does not carry over: an approved assumption whose value
 * changes goes back under review (Master Plan §2.53 — never silently).
 */
export async function reviseAssumption(db, { projectId, assumptionId, patch = {}, reason, userId = null }) {
  if (!reason) throw bad("دلیل تغییر لازم است — تغییر فرض بدون دلیل ثبت نمی‌شود.");
  const a = await row(db, projectId, assumptionId);
  const fields = SUBSTANCE.filter((f) => f in patch && String(patch[f] ?? "") !== String(a[f] ?? ""));
  if (!fields.length) return a;
  if ("impact" in patch && !IMPACTS.has(patch.impact)) throw bad(`اثر «${patch.impact}» شناخته نشد.`);
  if ("description" in patch && !patch.description) throw bad("شرح فرض خالی نمی‌شود.");
  await snapshot(db, a, reason, userId);
  const decided = ["approved", "rejected", "superseded"].includes(a.status);
  const vals = fields.map((f) => patch[f] === "" ? null : patch[f]);
  const sets = fields.map((f, i) => `${f} = $${i + 1}`);
  const { rows } = await db.query(
    `UPDATE project_assumption SET ${sets.join(", ")}, revision = revision + 1, updated_at = now()
            ${decided ? ", status = 'under_review', decided_by = NULL, decided_at = NULL" : ""}
      WHERE id = $${fields.length + 1} AND project_id = $${fields.length + 2} RETURNING *`,
    [...vals, assumptionId, projectId]);
  return rows[0];
}

/** Approve, reject, supersede or send back for review — signed by whoever decides. */
export async function decideAssumption(db, { projectId, assumptionId, status, reason = null, userId }) {
  if (!DECISIONS.has(status)) throw bad(`تصمیم «${status}» شناخته نشد.`);
  if (!userId) throw bad("تصمیم بدون تصمیم‌گیرنده ثبت نمی‌شود.");
  if (status !== "approved" && !reason) throw bad("رد، جایگزینی یا بازگرداندن برای بررسی دلیل لازم دارد.");
  const a = await row(db, projectId, assumptionId);
  if (a.status === status) return a;
  await snapshot(db, a, reason || "تأیید", userId);
  const signs = status !== "under_review";
  const { rows } = await db.query(
    `UPDATE project_assumption
        SET status = $1, revision = revision + 1, updated_at = now(),
            decided_by = $2, decided_at = CASE WHEN $3::boolean THEN now() ELSE NULL END
      WHERE id = $4 AND project_id = $5 RETURNING *`,
    [status, signs ? userId : null, signs, assumptionId, projectId]);
  return rows[0];
}

export async function assumptionHistory(db, { projectId, assumptionId }) {
  const { rows } = await db.query(
    `SELECT r.revision, r.snapshot, r.reason, r.changed_at, u.display_name AS changed_by_name
       FROM project_assumption_revision r LEFT JOIN app_user u ON u.id = r.changed_by
      WHERE r.assumption_id = $1 AND r.project_id = $2 ORDER BY r.revision`, [assumptionId, projectId]);
  return rows;
}

/** Add the master plan's baseline assumptions that are not there yet. */
export async function addBaseline(db, { projectId, userId = null }) {
  let added = 0;
  for (const b of BASELINE) {
    const { rows } = await db.query(
      "SELECT 1 FROM project_assumption WHERE project_id = $1 AND code = $2", [projectId, b.code]);
    if (rows.length) continue;
    await proposeAssumption(db, { projectId, ...b, source: "Digitalization Master Plan §2", userId });
    added++;
  }
  return { added };
}

/**
 * Everything the platform cannot judge for lack of a fact, and how much
 * waits on each. Computed on every call from the same data the engines read.
 *
 * `impact` is "high" when a verdict is withheld (the engine refuses to
 * judge), "medium" when items are unfiled or cannot be traced, "low" for
 * checks that are simply not made.
 */
export async function missingInformation(db, { projectId }) {
  const q = async (sql) => (await db.query(sql, [projectId])).rows[0];
  const { rows: [p] } = await db.query("SELECT * FROM project WHERE id = $1", [projectId]);
  const out = [];
  const add = (key, count, item) => { if (count > 0) out.push({ key, count, ...item }); };

  // ── project specification facts the engines key on ──
  // A unit may state its own grade (012); only welds that end up with none
  // anywhere — line unit, drawing unit, project — are unjudged.
  const welds = (await q(`SELECT count(*)::int AS n FROM reporting.fact_weld
                            WHERE project_key = $1 AND grade_applied_mm IS NULL`)).n;
  {
    add("grade", welds, { title: "تراز گرید تمام‌شده", discipline: "سیویل / پایپینگ", impact: "high",
      why: "بدون آن هیچ جوشی زیرزمینی یا روزمینی تشخیص داده نمی‌شود", unit: "جوش", fixAt: "/project" });
  }
  const pours = (await q(
    "SELECT count(DISTINCT tag_id)::int AS n FROM concrete_pour WHERE project_id = $1")).n;
  if (p.concrete_curing_days == null) {
    add("curing", pours, { title: "مدت عمل‌آوری بتن", discipline: "سیویل", impact: "high",
      why: "مرحلهٔ عمل‌آوری فونداسیون‌های بتن‌ریزی‌شده حکم نمی‌گیرد", unit: "فونداسیون", fixAt: "/project" });
  }
  const structures = (await q("SELECT count(*)::int AS n FROM structure_spec WHERE project_id = $1")).n;
  if (!p.steel_erection_standard) {
    add("erection", structures, { title: "استاندارد رواداری نصب اسکلت", discipline: "استراکچر", impact: "high",
      why: "شاقولی هیچ ستونی حکم نمی‌گیرد", unit: "سازه", fixAt: "/project" });
  }
  if (p.lv_system_voltage_v == null) {
    const n = (await q(`SELECT count(*)::int AS n FROM cable WHERE project_id = $1
                          AND voltage_class = 'LV' AND system_voltage_v IS NULL`)).n;
    add("lv", n, { title: "ولتاژ نامی مدارهای فشار ضعیف", discipline: "برق", impact: "high",
      why: "تست IR این کابل‌ها با IEC 60364-6 سنجیده نمی‌شود", unit: "کابل", fixAt: "/project" });
  }
  if (p.mv_ir_test_voltage_v == null || p.mv_ir_min_mohm == null) {
    const n = (await q("SELECT count(*)::int AS n FROM cable WHERE project_id = $1 AND voltage_class = 'MV'")).n;
    add("mv", n, { title: "معیار IR کابل فشار متوسط", discipline: "برق / راه‌اندازی", impact: "high",
      why: "IEC 60364-6 فشار متوسط را پوشش نمی‌دهد؛ این کابل‌ها حکم IR نمی‌گیرند", unit: "کابل", fixAt: "/project" });
  }
  if (p.calibration_tolerance_pct == null) {
    const n = (await q(`SELECT count(*)::int AS n FROM instrument WHERE project_id = $1
                          AND category IN ('transmitter', 'gauge') AND tolerance_pct IS NULL`)).n;
    add("tolerance", n, { title: "تلورانس کالیبراسیون", discipline: "ابزار دقیق", impact: "high",
      why: "کالیبراسیون این ابزارها حکم نمی‌گیرد", unit: "ابزار", fixAt: "/project" });
  }
  if (p.coating_max_rh_pct == null) {
    const n = (await q("SELECT count(*)::int AS n FROM coating_item WHERE project_id = $1")).n;
    add("rh", n, { title: "حد رطوبت نسبی هنگام رنگ", discipline: "رنگ و عایق", impact: "low",
      why: "رطوبت در شرایط اعمال سنجیده نمی‌شود (فقط نقطهٔ شبنم)", unit: "آیتم رنگ", fixAt: "/project" });
  }

  // ── item-level facts a person has to supply ──
  add("eq-kind", (await q(`SELECT count(*)::int AS n FROM tag WHERE project_id = $1
                             AND discipline = 'equipment' AND kind IS NULL`)).n,
    { title: "نوع تجهیز (دوّار / ثابت / کوره)", discipline: "مکانیک", impact: "high",
      why: "بدون نوع، زنجیرهٔ پیش‌نیاز تجهیز معلوم نیست", unit: "تجهیز", fixAt: "/equipment" });
  add("cable-tag", (await q("SELECT count(*)::int AS n FROM cable WHERE project_id = $1 AND to_tag_id IS NULL")).n,
    { title: "تجهیزی که کابل تغذیه می‌کند", discipline: "برق", impact: "medium",
      why: "کابل به هیچ تگ و ساب‌سیستمی وصل نیست", unit: "کابل", fixAt: "/electrical" });
  add("cable-class", (await q(`SELECT count(*)::int AS n FROM cable WHERE project_id = $1
                                 AND (voltage_class IS NULL OR cores IS NULL)`)).n,
    { title: "ساختار یا ردهٔ ولتاژ کابل", discipline: "برق", impact: "high",
      why: "لیست کابل خوانده نشد؛ IR حکم نمی‌گیرد", unit: "کابل", fixAt: "/electrical" });
  add("inst-tag", (await q("SELECT count(*)::int AS n FROM instrument WHERE project_id = $1 AND category IS NULL")).n,
    { title: "تگ ابزار ناخوانا (ISA 5.1)", discipline: "ابزار دقیق", impact: "high",
      why: "نوع ابزار و لوپ تعیین نشد", unit: "ابزار", fixAt: "/instrumentation" });
  add("inst-range", (await q(`SELECT count(*)::int AS n FROM instrument WHERE project_id = $1
                                AND category IN ('transmitter', 'gauge') AND range_lo IS NULL`)).n,
    { title: "رنج ابزار", discipline: "ابزار دقیق", impact: "high",
      why: "دقت کالیبراسیون بدون رنج سنجیده نمی‌شود", unit: "ابزار", fixAt: "/instrumentation" });
  add("inst-eq", (await q(`SELECT count(*)::int AS n FROM instrument WHERE project_id = $1
                             AND eq_tag_id IS NULL AND category IS NOT NULL`)).n,
    { title: "تجهیزی که ابزار به آن خدمت می‌کند", discipline: "ابزار دقیق", impact: "medium",
      why: "ابزار به هیچ تگ و ساب‌سیستمی وصل نیست", unit: "ابزار", fixAt: "/instrumentation" });
  add("coat-area", (await q("SELECT count(*)::int AS n FROM coating_item WHERE project_id = $1 AND area_m2 IS NULL")).n,
    { title: "مساحت سطح رنگ", discipline: "رنگ و عایق", impact: "high",
      why: "کفایت تعداد قرائت DFT (ISO 19840) سنجیده نمی‌شود", unit: "آیتم رنگ", fixAt: "/coating" });
  add("steel-counts", (await q(`SELECT count(*)::int AS n FROM structure_spec WHERE project_id = $1
                                  AND (columns IS NULL OR bolted_joints IS NULL)`)).n,
    { title: "تعداد ستون یا اتصال پیچی سازه", discipline: "استراکچر", impact: "medium",
      why: "«همهٔ ستون‌ها / همهٔ اتصال‌ها» گفته نمی‌شود؛ مرحله در جریان می‌ماند", unit: "سازه", fixAt: "/structural" });

  const rank = { high: 0, medium: 1, low: 2 };
  return out.sort((a, b) => rank[a.impact] - rank[b.impact] || b.count - a.count);
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
