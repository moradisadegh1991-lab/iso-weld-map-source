/**
 * The organisation's process, steps 1–2 (migration 067): companies and
 * their logos, project and contract stakeholders, currencies, budgets,
 * contract amendments and the contract's category trees. The budget's
 * derived columns are lib/org/budget.mjs.
 *
 * Companies are the organisation's directory, shared by all projects;
 * everything else is the project's. Call inside `withProject`.
 */
import { contractorForCompany } from "./contractors.mjs";
import { sniffImage } from "../../quality/photo.mjs";
import { contractBudget, revisedEnd, amendmentProblems, treeOf, makesCycle } from "../../org/budget.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (w) => Object.assign(new Error(`${w} not found`), { status: 404 });
const blank = (v) => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim());
const num = (v, what) => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v); if (!Number.isFinite(n)) throw bad(`${what}: «${v}» عدد نیست.`); return n;
};
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
export const MAX_LOGO_BYTES = 1024 * 1024;

export const PROJECT_ROLES = { owner: "کارفرما / مالک", epc: "پیمانکار EPC", consultant: "مشاور", supervisor: "نظارت",
  contractor: "پیمانکار", subcontractor: "پیمانکار جزء", vendor: "سازنده / فروشنده", other: "سایر" };
export const CONTRACT_ROLES = { employer: "کارفرمای قرارداد", contractor: "پیمانکار قرارداد", consultant: "مشاور",
  supervisor: "نظارت", subcontractor: "پیمانکار جزء", other: "سایر" };
export const AMENDMENT_KINDS = { time: "زمانی (تمدید)", financial: "مالی", both: "زمانی و مالی" };
export const TREES = { resource: "دسته‌های منابع", narrative: "دسته‌های شرح کار (Narrative)", work_group: "گروه‌های اجرایی کار" };

// ── companies ────────────────────────────────────────────────────────────

export async function upsertCompany(db, { id = null, code, name, nameEn = null, nationalId = null, taxCode = null, address = null, phone = null, email = null, userId = null }) {
  const c = blank(code), n = blank(name);
  if (!c || !n) throw bad("کد و نام شرکت لازم است.");
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,15}$/.test(c)) throw bad("کد شرکت: حروف و رقم لاتین، حداکثر ۱۶ نویسه.");
  const vals = [c.toUpperCase(), n, blank(nameEn), blank(nationalId), blank(address), blank(phone), blank(email), blank(taxCode)];
  const { rows: [have] } = await db.query("SELECT id FROM company WHERE code = $1 AND id IS DISTINCT FROM $2", [vals[0], id]);
  if (have) throw bad(`کد ${vals[0]} برای شرکت دیگری ثبت شده است.`);
  if (id) {
    const { rows: [r] } = await db.query(
      `UPDATE company SET code = $2, name = $3, name_en = $4, national_id = $5, address = $6, phone = $7, email = $8, tax_code = $9 WHERE id = $1 RETURNING *`, [id, ...vals]);
    if (!r) throw notFound("company");
    return r;
  }
  const { rows: [r] } = await db.query(
    `INSERT INTO company (code, name, name_en, national_id, address, phone, email, tax_code, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [...vals, userId]);
  return r;
}

export async function listCompanies(db) {
  const { rows } = await db.query("SELECT * FROM company ORDER BY code");
  const { rows: logos } = await db.query(
    "SELECT id, company_id, name, content_type, byte_size, active, uploaded_at FROM company_logo ORDER BY uploaded_at");
  return rows.map((c) => ({ ...c, logos: logos.filter((l) => l.company_id === c.id) }));
}

/** A logo for a company — any number of them; the same image again is the one already kept. */
export async function addCompanyLogo(db, { companyId, name, bytes, store, userId = null }) {
  const buf = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!blank(name)) throw bad("نام لوگو لازم است.");
  if (!buf.length) throw bad("فایل لوگو خالی است.");
  if (buf.length > MAX_LOGO_BYTES) throw bad("حجم لوگو بیش از ۱ مگابایت است.");
  const type = sniffImage(buf);
  if (!type) throw bad("فایل لوگو تصویر PNG، JPEG یا WebP نیست.");
  const { rows: [c] } = await db.query("SELECT id FROM company WHERE id = $1", [companyId]);
  if (!c) throw notFound("company");
  const blob = await store.put(buf, { ext: EXT[type], contentType: type });
  const { rows: [have] } = await db.query("SELECT id, name FROM company_logo WHERE company_id = $1 AND sha256 = $2", [companyId, blob.digest]);
  if (have) return { ...have, duplicate: true };
  const { rows: [row] } = await db.query(
    `INSERT INTO company_logo (company_id, name, sha256, storage_uri, content_type, byte_size, uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, company_id, name, content_type, byte_size, active, uploaded_at`,
    [companyId, blank(name), blob.digest, blob.uri, type, buf.length, userId]);
  return row;
}

export async function setCompanyLogoActive(db, { logoId, active }) {
  const { rows: [r] } = await db.query("UPDATE company_logo SET active = $2 WHERE id = $1 RETURNING id, active", [logoId, !!active]);
  if (!r) throw notFound("logo");
  return r;
}

export async function renameCompanyLogo(db, { logoId, name }) {
  if (!blank(name)) throw bad("نام لوگو لازم است.");
  const { rows: [r] } = await db.query("UPDATE company_logo SET name = $2 WHERE id = $1 RETURNING id, name", [logoId, blank(name)]);
  if (!r) throw notFound("logo");
  return r;
}

export async function readCompanyLogo(db, { logoId, store }) {
  const { rows: [l] } = await db.query("SELECT * FROM company_logo WHERE id = $1", [logoId]);
  if (!l) throw notFound("logo");
  return { bytes: await store.get(l.storage_uri), contentType: l.content_type, sha256: l.sha256 };
}

// ── project: stakeholders, currencies, budgets ───────────────────────────

export async function addProjectStakeholder(db, { projectId, id = null, companyId, role, note = null }) {
  if (!PROJECT_ROLES[role]) throw bad("نقش ذی‌نفع را انتخاب کنید.");
  const { rows: [c] } = await db.query("SELECT id FROM company WHERE id = $1", [companyId]);
  if (!c) throw bad("شرکت را از فهرست شرکت‌ها انتخاب کنید.");
  if (id) {
    const { rows: [dup] } = await db.query("SELECT 1 FROM project_stakeholder WHERE project_id = $1 AND company_id = $2 AND role = $3 AND id <> $4", [projectId, companyId, role, id]);
    if (dup) throw bad("این شرکت با همین نقش از قبل ذی‌نفع است.");
    const { rows: [r] } = await db.query(
      "UPDATE project_stakeholder SET company_id = $3, role = $4, note = $5 WHERE id = $1 AND project_id = $2 RETURNING *", [id, projectId, companyId, role, blank(note)]);
    if (!r) throw notFound("stakeholder");
    return r;
  }
  const { rows: [r] } = await db.query(
    `INSERT INTO project_stakeholder (project_id, company_id, role, note) VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, company_id, role) DO UPDATE SET note = EXCLUDED.note RETURNING *`, [projectId, companyId, role, blank(note)]);
  // a company that does the work is the project's contractor too: one record, never typed twice
  if (CONTRACTOR_ROLES.includes(role)) await contractorForCompany(db, { projectId, companyId });
  return r;
}
const CONTRACTOR_ROLES = ["epc", "contractor", "subcontractor"];

export async function removeProjectStakeholder(db, { projectId, id }) {
  await db.query("DELETE FROM project_stakeholder WHERE id = $1 AND project_id = $2", [id, projectId]);
}

/** A currency and its value in the base unit (USD = 1 → IRR = 0.00732 …). */
export async function upsertCurrency(db, { projectId, code, name, rate }) {
  const c = String(code || "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw bad("کد ارز سه حرف لاتین است (USD، EUR، IRR …).");
  const r = num(rate, "واحد پایه");
  if (!(r > 0)) throw bad("ارزش ارز در واحد پایه باید عدد مثبت باشد.");
  const { rows: [row] } = await db.query(
    `INSERT INTO project_currency (project_id, code, name, rate) VALUES ($1,$2,$3,$4)
     ON CONFLICT (project_id, code) DO UPDATE SET name = EXCLUDED.name, rate = EXCLUDED.rate RETURNING *`, [projectId, c, blank(name) || c, r]);
  return row;
}

export async function addProjectBudget(db, { projectId, id = null, title, currency, amount, note = null, userId = null }) {
  const a = num(amount, "مبلغ");
  if (!blank(title)) throw bad("عنوان بودجه لازم است.");
  if (a == null || a < 0) throw bad("مبلغ بودجه باید عدد نامنفی باشد.");
  const { rows: [cur] } = await db.query("SELECT code FROM project_currency WHERE project_id = $1 AND code = $2", [projectId, currency]);
  if (!cur) throw bad("ارز بودجه را اول در ارزهای پروژه تعریف کنید.");
  if (id) {
    const { rows: [r] } = await db.query(
      "UPDATE project_budget SET title = $3, currency = $4, amount = $5, note = $6 WHERE id = $1 AND project_id = $2 RETURNING *",
      [id, projectId, blank(title), currency, a, blank(note)]);
    if (!r) throw notFound("budget");
    return r;
  }
  const { rows: [r] } = await db.query(
    "INSERT INTO project_budget (project_id, title, currency, amount, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [projectId, blank(title), currency, a, blank(note), userId]);
  return r;
}

export async function removeProjectBudget(db, { projectId, id }) {
  await db.query("DELETE FROM project_budget WHERE id = $1 AND project_id = $2", [id, projectId]);
}

export async function projectSetup(db, { projectId }) {
  const { rows: stakeholders } = await db.query(
    `SELECT s.*, c.code, c.name FROM project_stakeholder s JOIN company c ON c.id = s.company_id WHERE s.project_id = $1 ORDER BY s.role, c.code`, [projectId]);
  const { rows: currencies } = await db.query("SELECT * FROM project_currency WHERE project_id = $1 ORDER BY code", [projectId]);
  const { rows: budgets } = await db.query("SELECT * FROM project_budget WHERE project_id = $1 ORDER BY created_at", [projectId]);
  const rate = new Map(currencies.map((c) => [c.code, Number(c.rate)]));
  const inBase = budgets.reduce((s, b) => s + Number(b.amount) * (rate.get(b.currency) || 0), 0);
  return { stakeholders, currencies, budgets, budgetInBase: Math.round(inBase * 100) / 100,
    companies: await listCompanies(db), roles: PROJECT_ROLES };
}

// ── contract: currencies and budget, stakeholders, amendments ────────────

async function contractOf(db, projectId, contractId) {
  const { rows: [c] } = await db.query("SELECT * FROM contract WHERE id = $1 AND project_id = $2", [contractId, projectId]);
  if (!c) throw notFound("contract");
  return c;
}
const LOG = (db, projectId, c, action, extra) => logEvent(db, { projectId, section: "contracts", entityType: "contract",
  entityId: c.id, label: `قرارداد ${c.contract_no}`, action, ...extra });

/** A currency of the contract: the rate the contract fixes (default: the project's) and the forecast budget in it. */
export async function upsertContractCurrency(db, { projectId, contractId, currency, rate = null, budget, doneTyped = null, userId = null }) {
  const c = await contractOf(db, projectId, contractId);
  const { rows: [pc] } = await db.query("SELECT * FROM project_currency WHERE project_id = $1 AND code = $2", [projectId, currency]);
  if (!pc) throw bad("ارز را اول در ارزهای پروژه تعریف کنید.");
  const r = num(rate, "نرخ") ?? Number(pc.rate);
  const b = num(budget, "بودجهٔ پیش‌بینی");
  const d = num(doneTyped, "مبلغ انجام‌شده");
  if (!(r > 0)) throw bad("نرخ باید مثبت باشد.");
  if (b == null || b < 0) throw bad("بودجهٔ پیش‌بینی باید عدد نامنفی باشد.");
  if (d != null && d < 0) throw bad("مبلغ انجام‌شده منفی نمی‌شود.");
  if (d != null && currency === c.currency) throw bad(`انجام‌شده در ${currency} (ارز اصلی قرارداد) از صورت‌وضعیت‌های تأییدشده می‌آید و دستی وارد نمی‌شود.`);
  const { rows: [row] } = await db.query(
    `INSERT INTO contract_currency (project_id, contract_id, currency, rate, budget, done_typed) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (contract_id, currency) DO UPDATE SET rate = EXCLUDED.rate, budget = EXCLUDED.budget, done_typed = EXCLUDED.done_typed RETURNING *`,
    [projectId, contractId, currency, r, b, d]);
  await LOG(db, projectId, c, "updated", { comment: `بودجهٔ ${currency}: ${b}`, userId });
  return row;
}

export async function addContractStakeholder(db, { projectId, contractId, id = null, companyId, role, note = null }) {
  await contractOf(db, projectId, contractId);
  if (!CONTRACT_ROLES[role]) throw bad("نقش ذی‌نفع قرارداد را انتخاب کنید.");
  const { rows: [c] } = await db.query("SELECT id FROM company WHERE id = $1", [companyId]);
  if (!c) throw bad("شرکت را از فهرست شرکت‌ها انتخاب کنید.");
  if (id) {
    const { rows: [dup] } = await db.query("SELECT 1 FROM contract_stakeholder WHERE contract_id = $1 AND company_id = $2 AND role = $3 AND id <> $4", [contractId, companyId, role, id]);
    if (dup) throw bad("این شرکت با همین نقش از قبل ذی‌نفع قرارداد است.");
    const { rows: [r] } = await db.query(
      "UPDATE contract_stakeholder SET company_id = $4, role = $5, note = $6 WHERE id = $1 AND project_id = $2 AND contract_id = $3 RETURNING *",
      [id, projectId, contractId, companyId, role, blank(note)]);
    if (!r) throw notFound("stakeholder");
    await syncParties(db, contractId);
    return r;
  }
  const { rows: [r] } = await db.query(
    `INSERT INTO contract_stakeholder (project_id, contract_id, company_id, role, note) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (contract_id, company_id, role) DO UPDATE SET note = EXCLUDED.note RETURNING *`, [projectId, contractId, companyId, role, blank(note)]);
  await syncParties(db, contractId);
  return r;
}

export async function removeContractStakeholder(db, { projectId, id }) {
  const { rows: [s] } = await db.query("DELETE FROM contract_stakeholder WHERE id = $1 AND project_id = $2 RETURNING contract_id", [id, projectId]);
  if (s) await syncParties(db, s.contract_id);
}

/**
 * The contract's employer and contractor, picked from the companies. They
 * are the contract's stakeholders in those roles, and the stakeholders are
 * the one record: setting a party adds (or moves) its stakeholder row, and
 * the contract's two columns follow the stakeholders.
 */
export async function setContractParties(db, { projectId, contractId, employerId = null, contractorId = null, userId = null }) {
  const c = await contractOf(db, projectId, contractId);
  for (const [role, companyId] of [["employer", employerId], ["contractor", contractorId]]) {
    if (companyId) {
      const { rows: [co] } = await db.query("SELECT id FROM company WHERE id = $1", [companyId]);
      if (!co) throw bad("شرکت را از فهرست شرکت‌ها انتخاب کنید.");
    }
    await db.query("DELETE FROM contract_stakeholder WHERE contract_id = $1 AND role = $2 AND company_id IS DISTINCT FROM $3", [contractId, role, companyId || null]);
    if (companyId) {
      await db.query(
        `INSERT INTO contract_stakeholder (project_id, contract_id, company_id, role) VALUES ($1,$2,$3,$4)
         ON CONFLICT (contract_id, company_id, role) DO NOTHING`, [projectId, contractId, companyId, role]);
    }
  }
  await syncParties(db, contractId);
  await LOG(db, projectId, c, "updated", { comment: "کارفرما و پیمانکار قرارداد", userId });
  return contractOf(db, projectId, contractId);
}

async function syncParties(db, contractId) {
  await db.query(
    `UPDATE contract c SET
        employer_company_id = (SELECT company_id FROM contract_stakeholder s WHERE s.contract_id = c.id AND s.role = 'employer' ORDER BY s.id LIMIT 1),
        contractor_company_id = (SELECT company_id FROM contract_stakeholder s WHERE s.contract_id = c.id AND s.role = 'contractor' ORDER BY s.id LIMIT 1)
      WHERE c.id = $1`, [contractId]);
}

/** An addendum or extension. Its money lines must be in the contract's currencies. */
export async function addAmendment(db, { projectId, contractId, id = null, amendmentNo, kind, title, signedOn = null, days = 0, lines = [], note = null, userId = null }) {
  const c = await contractOf(db, projectId, contractId);
  if (!blank(amendmentNo) || !blank(title)) throw bad("شماره و عنوان الحاقیه لازم است.");
  const clean = (lines || []).filter((l) => blank(l.amount) != null).map((l) => ({ currency: l.currency, kind: l.kind === "new_items" ? "new_items" : "change", amount: Number(l.amount) }));
  const problems = amendmentProblems({ kind, days, lines: clean });
  const { rows: curs } = await db.query("SELECT currency FROM contract_currency WHERE contract_id = $1", [contractId]);
  for (const l of clean) if (!curs.some((x) => x.currency === l.currency)) problems.push(`${l.currency} از ارزهای این قرارداد نیست.`);
  if (problems.length) throw bad(problems.join(" "));
  const { rows: [dup] } = await db.query("SELECT 1 FROM contract_amendment WHERE contract_id = $1 AND amendment_no = $2 AND id IS DISTINCT FROM $3",
    [contractId, blank(amendmentNo), id]);
  if (dup) throw bad(`الحاقیهٔ ${blank(amendmentNo)} از قبل ثبت شده است.`);
  if (id) {
    // An amendment corrected: the row and its money lines are replaced, and the log keeps that it was.
    const { rows: [a] } = await db.query(
      `UPDATE contract_amendment SET amendment_no = $3, kind = $4, title = $5, signed_on = $6, days = $7, note = $8
        WHERE id = $1 AND contract_id = $2 RETURNING *`,
      [id, contractId, blank(amendmentNo), kind, blank(title), signedOn || null, Number(days) || 0, blank(note)]);
    if (!a) throw notFound("amendment");
    await db.query("DELETE FROM contract_amendment_line WHERE amendment_id = $1", [id]);
    for (const l of clean) {
      await db.query("INSERT INTO contract_amendment_line (project_id, amendment_id, currency, kind, amount) VALUES ($1,$2,$3,$4,$5)",
        [projectId, a.id, l.currency, l.kind, l.amount]);
    }
    await LOG(db, projectId, c, "updated", { comment: `اصلاح الحاقیهٔ ${a.amendment_no} (${AMENDMENT_KINDS[kind]})`, userId });
    return a;
  }
  const { rows: [a] } = await db.query(
    `INSERT INTO contract_amendment (project_id, contract_id, amendment_no, kind, title, signed_on, days, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [projectId, contractId, blank(amendmentNo), kind, blank(title), signedOn || null, Number(days) || 0, blank(note), userId]);
  for (const l of clean) {
    await db.query("INSERT INTO contract_amendment_line (project_id, amendment_id, currency, kind, amount) VALUES ($1,$2,$3,$4,$5)",
      [projectId, a.id, l.currency, l.kind, l.amount]);
  }
  await LOG(db, projectId, c, "updated", { comment: `الحاقیهٔ ${a.amendment_no} (${AMENDMENT_KINDS[kind]})`, userId });
  return a;
}

/** The contract's setup: budget per currency with its derived columns, stakeholders, amendments, revised end, trees. */
export async function contractSetup(db, { projectId, contractId }) {
  const c = await contractOf(db, projectId, contractId);
  const { rows: currencies } = await db.query("SELECT * FROM contract_currency WHERE contract_id = $1 ORDER BY currency", [contractId]);
  const { rows: amendments } = await db.query("SELECT * FROM contract_amendment WHERE contract_id = $1 ORDER BY signed_on NULLS LAST, created_at", [contractId]);
  const { rows: lines } = await db.query(
    "SELECT l.* FROM contract_amendment_line l JOIN contract_amendment a ON a.id = l.amendment_id WHERE a.contract_id = $1", [contractId]);
  const { rows: [st] } = await db.query(
    "SELECT sum(gross_this)::float AS done, count(*)::int AS n FROM pay_statement WHERE contract_id = $1 AND status IN ('approved', 'paid')", [contractId]);
  const { rows: stakeholders } = await db.query(
    `SELECT s.*, co.code, co.name FROM contract_stakeholder s JOIN company co ON co.id = s.company_id WHERE s.contract_id = $1 ORDER BY s.role`, [contractId]);
  const { rows: cats } = await db.query("SELECT * FROM contract_category WHERE contract_id = $1", [contractId]);
  return {
    contract: c,
    budget: contractBudget({ currencies, amendments: lines, statementDone: st.n ? st.done : null, mainCurrency: c.currency }),
    statements: st.n,
    amendments: amendments.map((a) => ({ ...a, lines: lines.filter((l) => l.amendment_id === a.id) })),
    revised: revisedEnd(c.end_on, amendments),
    stakeholders,
    trees: Object.fromEntries(Object.keys(TREES).map((t) => [t, treeOf(cats.filter((x) => x.tree === t))])),
  };
}

// ── the contract's category trees ────────────────────────────────────────

export async function addCategory(db, { projectId, contractId, tree, parentId = null, name, discipline = null, seq = null }) {
  await contractOf(db, projectId, contractId);
  if (!TREES[tree]) throw bad("درخت را انتخاب کنید (منابع، شرح کار یا گروه‌های اجرایی).");
  if (!blank(name)) throw bad("نام دسته لازم است.");
  if (parentId) {
    const { rows: [p] } = await db.query("SELECT * FROM contract_category WHERE id = $1 AND contract_id = $2", [parentId, contractId]);
    if (!p || p.tree !== tree) throw bad("شاخهٔ والد در همین درخت نیست.");
  }
  const { rows: [{ n }] } = await db.query(
    "SELECT count(*)::int AS n FROM contract_category WHERE contract_id = $1 AND tree = $2 AND parent_id IS NOT DISTINCT FROM $3", [contractId, tree, parentId]);
  const { rows: [dup] } = await db.query(
    "SELECT 1 FROM contract_category WHERE contract_id = $1 AND tree = $2 AND parent_id IS NOT DISTINCT FROM $3 AND name = $4", [contractId, tree, parentId, blank(name)]);
  if (dup) throw bad(`«${blank(name)}» در همین شاخه هست.`);
  const { rows: [r] } = await db.query(
    `INSERT INTO contract_category (project_id, contract_id, tree, parent_id, name, discipline, seq) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [projectId, contractId, tree, parentId, blank(name), blank(discipline), seq ?? n + 1]);
  return r;
}

/** Move a branch under another (or to the top); a branch never moves under itself. */
export async function moveCategory(db, { projectId, id, parentId = null }) {
  const { rows: [c] } = await db.query("SELECT * FROM contract_category WHERE id = $1 AND project_id = $2", [id, projectId]);
  if (!c) throw notFound("category");
  const { rows: all } = await db.query("SELECT id, parent_id, tree FROM contract_category WHERE contract_id = $1", [c.contract_id]);
  if (parentId) {
    const p = all.find((x) => x.id === parentId);
    if (!p || p.tree !== c.tree) throw bad("مقصد در همین درخت نیست.");
    if (makesCycle(all, id, parentId)) throw bad("شاخه را نمی‌توان زیر خودش یا زیرشاخه‌هایش برد.");
  }
  const { rows: [r] } = await db.query("UPDATE contract_category SET parent_id = $2 WHERE id = $1 RETURNING *", [id, parentId]);
  return r;
}

export async function renameCategory(db, { projectId, id, name, discipline, seq = null }) {
  if (!blank(name)) throw bad("نام دسته لازم است.");
  const order = blank(seq) == null ? null : Number(seq);
  if (order !== null && (!Number.isInteger(order) || order < 0)) throw bad("ترتیب نمایش عدد صحیح نامنفی است.");
  const { rows: [r] } = await db.query(
    "UPDATE contract_category SET name = $3, discipline = $4, seq = COALESCE($5, seq) WHERE id = $1 AND project_id = $2 RETURNING *",
    [id, projectId, blank(name), blank(discipline), order]);
  if (!r) throw notFound("category");
  return r;
}

/** Remove a leaf nothing uses. */
export async function removeCategory(db, { projectId, id }) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM contract_category WHERE parent_id = $1", [id]);
  if (n) throw bad("این دسته زیرشاخه دارد؛ اول آن‌ها را جابه‌جا یا حذف کنید.");
  const { rows: [{ m }] } = await db.query("SELECT count(*)::int AS m FROM contract_resource WHERE category_id = $1", [id]);
  if (m) throw bad(`${m} منبع در این دسته است؛ اول آن‌ها را جابه‌جا کنید.`);
  await db.query("DELETE FROM contract_category WHERE id = $1 AND project_id = $2", [id, projectId]);
}
