"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

/**
 * The project's particulars.
 *
 * Every field is optional and the form saves whatever is filled in, because
 * a project exists before its contract is signed and a form that refuses to
 * save until everything is known is a form people keep in Excel instead.
 *
 * A viewer sees the same screen with the inputs disabled rather than a
 * different read-only one: two layouts for one set of facts drift apart.
 */
const FIELDS = [
  ["name", "نام پروژه", "text"],
  ["client_name", "کارفرما", "text"],
  ["consultant_name", "مشاور / مهندس کارفرما", "text"],
  ["contractor_name", "پیمانکار اصلی (EPC)", "text"],
  ["contract_no", "شمارهٔ قرارداد", "text"],
  ["contract_date", "تاریخ قرارداد", "date"],
  ["contract_value", "مبلغ قرارداد", "number"],
  ["contract_currency", "واحد پول", "text"],
  ["site_location", "محل اجرا", "text"],
  ["start_date", "تاریخ شروع", "date"],
  ["planned_end_date", "پایان برنامه‌ای", "date"],
];

export default function ProjectPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/project?projectId=${id}`, []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const editable = can({ role }, ACTIONS.MANAGE_MEMBERS);

  useEffect(() => {
    if (!data?.project) return;
    const p = data.project;
    setForm(Object.fromEntries(FIELDS.map(([k]) => [k, p[k] ?? ""])
      .concat([["description", p.description ?? ""]])));
  }, [data]);

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })); setSaved(false); }

  async function save(e) {
    e.preventDefault();
    setSaving(true); setSaveErr(null);
    try {
      await call("/api/project", {
        method: "PATCH",
        body: JSON.stringify({ projectId, patch: form }),
      });
      setSaved(true);
      await reload();
    } catch (e2) {
      setSaveErr(e2.message);
    } finally { setSaving(false); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!form) return <p className="muted">در حال بارگذاری…</p>;

  const p = data.project;
  return (
    <div className="page">
      <div className="pagehead">
        <h1>مشخصات پروژه</h1>
        <span className="sub">
          {p.updated_at
            ? `آخرین ویرایش ${new Date(p.updated_at).toLocaleDateString("fa-IR")}`
            : "هنوز ویرایش نشده"}
        </span>
      </div>

      {!editable && (
        <p className="muted sm">
          شما دسترسی ویرایش ندارید. مبلغ قرارداد و نام کارفرما را فقط مدیر پروژه تغییر می‌دهد.
        </p>
      )}

      <form className="card" onSubmit={save}>
        <h2>قرارداد و طرفین</h2>
        <div className="grid2">
          {FIELDS.map(([k, label, type]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type={type} disabled={!editable}
                     dir={type === "text" ? "auto" : "ltr"}
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              {k === "contract_value" && (
                <span className="hint">مبلغ بدون واحد پول ثبت نمی‌شود.</span>
              )}
            </div>
          ))}
        </div>

        <div className="field">
          <label htmlFor="description">شرح پروژه</label>
          <textarea id="description" disabled={!editable}
                    value={form.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </div>

        {saveErr && <p className="err">{saveErr}</p>}
        {saved && <p className="pill ok">ذخیره شد</p>}

        {editable && (
          <div>
            <button className="btn" type="submit" disabled={saving}>
              {saving ? "در حال ذخیره…" : "ذخیره"}
            </button>
          </div>
        )}
      </form>

      <div className="card">
        <h2>کد پروژه</h2>
        <p className="muted sm">
          کد <b className="mono">{p.code}</b> پس از ساخت پروژه تغییر نمی‌کند — هر
          مدرک، رجیستر و گزارشی که تا امروز صادر شده به آن ارجاع می‌دهد.
        </p>
      </div>
    </div>
  );
}
