/**
 * Issuing form numbers (lib/numbering.mjs holds the forms).
 *
 * The counter moves with one UPSERT, so two saves at the same moment never
 * get the same number. A candidate that already exists — someone typed it
 * by hand — is skipped, not issued twice.
 */
import { FORMS, CODE_RE, formatNumber } from "../../numbering.mjs";
import { logEvent } from "./log.mjs";

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });

const keyOf = (form, scope) => (FORMS[form].scoped ? `${form}:${scope}` : form);

async function codeOf(db, projectId, form) {
  const { rows: [r] } = await db.query("SELECT code FROM form_code WHERE project_id = $1 AND form = $2", [projectId, form]);
  return r?.code || FORMS[form].code;
}

async function taken(db, projectId, form, no) {
  const f = FORMS[form];
  const { rows } = await db.query(`SELECT 1 FROM ${f.table} WHERE project_id = $1 AND ${f.column} = $2 LIMIT 1`, [projectId, no]);
  return rows.length > 0;
}

/** The next number of a form, issued: the counter moves. */
export async function nextNumber(db, { projectId, form, scope = null }) {
  const f = FORMS[form];
  if (!f) throw new Error(`unknown form ${form}`);
  if (f.scoped && !scope) throw new Error(`form ${form} is numbered per scope`);
  const code = await codeOf(db, projectId, form);
  for (;;) {
    const { rows: [c] } = await db.query(
      `INSERT INTO form_counter (project_id, form, last_no) VALUES ($1, $2, 1)
       ON CONFLICT (project_id, form) DO UPDATE SET last_no = form_counter.last_no + 1 RETURNING last_no`,
      [projectId, keyOf(form, scope)]);
    const no = formatNumber(form, code, c.last_no, scope);
    if (!(await taken(db, projectId, form, no))) return no;
  }
}

/** What the next number would be, without issuing it — for a form to show. */
export async function peekNumber(db, { projectId, form, scope = null }) {
  const f = FORMS[form];
  if (!f || (f.scoped && !scope)) return null;
  const code = await codeOf(db, projectId, form);
  const { rows: [c] } = await db.query("SELECT last_no FROM form_counter WHERE project_id = $1 AND form = $2",
    [projectId, keyOf(form, scope)]);
  for (let n = (c?.last_no || 0) + 1; ; n++) {
    const no = formatNumber(form, code, n, scope);
    if (!(await taken(db, projectId, form, no))) return no;
  }
}

/** The number to use: the one typed, or the form's next. */
export async function numberOr(db, { projectId, form, typed, scope = null }) {
  const t = String(typed ?? "").trim();
  return t || nextNumber(db, { projectId, form, scope });
}

/** Every form with its code (the project's or the default) and the last number issued. */
export async function formCodes(db, { projectId }) {
  const { rows: codes } = await db.query("SELECT form, code FROM form_code WHERE project_id = $1", [projectId]);
  const { rows: counters } = await db.query("SELECT form, last_no FROM form_counter WHERE project_id = $1", [projectId]);
  const own = new Map(codes.map((r) => [r.form, r.code]));
  const out = [];
  for (const [form, f] of Object.entries(FORMS)) {
    const last = counters.filter((c) => c.form === form || c.form.startsWith(`${form}:`)).reduce((s, c) => s + c.last_no, 0);
    out.push({ form, title: f.title, code: own.get(form) || f.code, defaultCode: f.code, own: own.has(form), issued: last,
      next: f.scoped ? null : await peekNumber(db, { projectId, form }), scoped: !!f.scoped });
  }
  return out;
}

/** A project's own code for a form; an empty code returns it to the default. */
export async function setFormCode(db, { projectId, form, code, userId = null }) {
  if (!FORMS[form]) throw bad(`فرم «${form}» شناخته نشد.`);
  const c = String(code ?? "").trim();
  if (!c) {
    await db.query("DELETE FROM form_code WHERE project_id = $1 AND form = $2", [projectId, form]);
  } else {
    if (!CODE_RE.test(c)) throw bad("کد فرم: حرف لاتین یا رقم، و حداکثر ۱۶ نویسه از حروف، ارقام و - _ . /");
    await db.query(
      `INSERT INTO form_code (project_id, form, code, set_by) VALUES ($1,$2,$3,$4)
       ON CONFLICT (project_id, form) DO UPDATE SET code = EXCLUDED.code, set_by = EXCLUDED.set_by, set_at = now()`,
      [projectId, form, c, userId]);
  }
  await logEvent(db, { projectId, section: "project", entityType: "form_code", label: `کد فرم ${FORMS[form].title}`,
    action: "updated", to: c || FORMS[form].code, userId });
  return formCodes(db, { projectId });
}
