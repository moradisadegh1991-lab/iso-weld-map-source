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

/**
 * Where the plant is on the earth, and where its ground is.
 *
 * Isometrics print coordinates in the plant grid (E, N, EL in mm), not in
 * latitude and longitude. These fields tie that grid to a real place — and
 * grade elevation is the one that changes engineering output: every weld
 * below it is buried. None of them is defaulted; a grade assumed wrongly
 * would bury every pipe rack or unbury every trench.
 */
const SITING = [
  ["origin_latitude", "عرض جغرافیایی نقطهٔ صفر (WGS84)", "number", "0.000001", "مثلاً 27.4912"],
  ["origin_longitude", "طول جغرافیایی نقطهٔ صفر (WGS84)", "number", "0.000001", "مثلاً 52.6078"],
  ["grid_origin_e_mm", "مختصات شرقی (E) نقطهٔ صفر در گرید پلنت — mm", "number", "0.1",
    "معمولاً 0؛ اگر گرید از عدد دیگری شروع شود همان را وارد کنید"],
  ["grid_origin_n_mm", "مختصات شمالی (N) نقطهٔ صفر در گرید پلنت — mm", "number", "0.1", ""],
  ["plant_north_deg", "زاویهٔ شمال پلنت از شمال حقیقی (درجه، ساعتگرد)", "number", "0.01",
    "روی plot plan با دو فلش PN و TN نشان داده می‌شود"],
  ["elevation_datum", "مبنای ارتفاع", "text", null, "مثلاً MSL یا «گرید ±0.00 = EL 100000»"],
  ["grade_elevation_mm", "تراز گرید تمام‌شده — EL در واحد نقشه (mm)", "number", "0.1",
    "هر جوش پایین‌تر از این تراز، زیرزمینی حساب می‌شود"],
  ["min_cover_mm", "حداقل عمق پوشش لولهٔ مدفون — mm", "number", "1", "طبق spec پروژه"],
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
    setForm(Object.fromEntries([...FIELDS, ...SITING].map(([k]) => [k, p[k] ?? ""])
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

        <h2 style={{ marginTop: 8 }}>مبدأ و ترازهای پلنت</h2>
        <div className="grid2">
          {SITING.map(([k, label, type, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type={type} step={step || undefined} disabled={!editable}
                     dir={type === "text" ? "auto" : "ltr"}
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              {hint && <span className="hint">{hint}</span>}
            </div>
          ))}
        </div>
        <GradeNote grade={form.grade_elevation_mm} cover={form.min_cover_mm} />

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

/**
 * What the grade elevation will do, said before it is saved.
 *
 * The field changes the classification of every weld in the project, so the
 * page states the consequence rather than leaving it to be discovered on the
 * execution screen.
 */
function GradeNote({ grade, cover }) {
  if (grade === "" || grade === null || grade === undefined) {
    return (
      <p className="muted sm">
        تا تراز گرید وارد نشود، سامانه برای هیچ جوشی حکم «زیرزمینی» یا «روزمینی»
        نمی‌دهد — ندانستن را صفر نشان نمی‌دهد.
      </p>
    );
  }
  const g = Number(grade);
  return (
    <p className="sm">
      جوش با EL کمتر از <b className="mono">{g.toLocaleString("en-US")}</b> mm زیرزمینی
      حساب می‌شود
      {cover !== "" && cover != null && (
        <> و بالای لوله باید دست‌کم <b className="mono">{Number(cover).toLocaleString("en-US")}</b> mm
          خاک باشد، یعنی تاج لوله زیر <b className="mono">{(g - Number(cover)).toLocaleString("en-US")}</b></>
      )}.
    </p>
  );
}
