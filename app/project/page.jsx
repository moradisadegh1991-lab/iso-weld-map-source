"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { ERECTION_STANDARDS } from "../../lib/structural/steel.mjs";
import TableKit from "../../components/ui/TableKit";
import Tabs from "../../components/ui/Tabs";

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
  ["site_location", "محل اجرا", "text"],
  ["start_date", "تاریخ شروع", "date"],
  ["planned_end_date", "پایان برنامه‌ای", "date"],
];

/** The frame shapes a weld number is printed in (migration 057). */
const WELD_SYMBOLS = { circle: "دایره", square: "مربع", diamond: "لوزی", hexagon: "شش‌ضلعی" };

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

/**
 * The concrete specification. Curing days is not defaulted: it decides when
 * every foundation's curing step completes, and it is the spec's number.
 */
const CONCRETE = [
  ["concrete_curing_days", "مدت عمل‌آوری بتن (روز)", "number", "1",
    "تا ثبت نشود، مرحلهٔ عمل‌آوری هیچ فونداسیونی حکم نمی‌گیرد"],
  ["concrete_sample_per_m3", "حجم بتن به ازای هر نمونهٔ آزمون (m³)", "number", "0.1",
    "خالی = معیار ACI 318 (۱۵۰ یارد مکعب ≈ ۱۱۵ m³)"],
];

/**
 * The electrical spec. The LV circuit voltage picks the IEC 60364-6 test
 * voltage and limit when a cable schedule does not say; MV acceptance is the
 * commissioning spec's number, and without it no MV cable gets an IR verdict.
 */
const ELECTRICAL = [
  ["lv_system_voltage_v", "ولتاژ نامی مدارهای فشار ضعیف (V)", "1",
    "مثلاً 400 — آزمون 500 V DC و حداقل 1 MΩ طبق IEC 60364-6"],
  ["mv_ir_test_voltage_v", "ولتاژ تست IR کابل فشار متوسط (V DC)", "1", "طبق مشخصات راه‌اندازی، مثلاً 5000"],
  ["mv_ir_min_mohm", "حداقل مقاومت عایقی کابل فشار متوسط (MΩ)", "0.1",
    "IEC 60364-6 فشار متوسط را پوشش نمی‌دهد — عدد پروژه"],
];

/** Painting application limits. The margin defaults to 3 °C only when empty. */
const COATING = [
  ["coating_dewpoint_margin_c", "فاصلهٔ دمای فولاد از نقطهٔ شبنم (°C)", "0.1", "خالی = 3 °C (ISO 8502-4)"],
  ["coating_max_rh_pct", "حداکثر رطوبت نسبی هنگام رنگ (%)", "0.1", "خالی = رطوبت سنجیده نمی‌شود؛ طبق دیتاشیت رنگ"],
];

/** HSE gas-test limits and permit duration. None has a default. */
const HSE = [
  ["hse_o2_min_pct", "حداقل O2 (%)", "0.1", "مثلاً 19.5 — طبق دستورالعمل PTW کارفرما"],
  ["hse_o2_max_pct", "حداکثر O2 (%)", "0.1", "مثلاً 23.5"],
  ["hse_lel_max_pct", "حداکثر LEL برای کار گرم (%)", "0.1", "بسیاری از دستورالعمل‌ها 0"],
  ["hse_h2s_max_ppm", "حداکثر H2S (ppm)", "0.1", ""],
  ["hse_co_max_ppm", "حداکثر CO (ppm)", "0.1", ""],
  ["hse_gas_test_validity_min", "اعتبار تست گاز (دقیقه)", "1", "تست قدیمی‌تر از این، صدور را متوقف می‌کند"],
  ["hse_permit_max_hours", "حداکثر مدت مجوز (ساعت)", "0.5", "مثلاً یک شیفت"],
  ["hse_scaffold_inspection_days", "فاصلهٔ بازرسی داربست (روز)", "1", "طبق دستورالعمل کارفرما؛ مثلاً ۷"],
  ["hse_crane_inspection_days", "فاصلهٔ بازرسی جرثقیل / بالابر (روز)", "1", "اعتبار گواهی بازرسی (Thorough examination)"],
  ["hse_risk_max_residual", "حداکثر ریسک باقیماندهٔ پذیرفتنی JSA (احتمال × شدت، ۱ تا ۲۵)", "1", "بالاتر از این، JSA تأیید نمی‌شود"],
];

/** Quality: when an overdue NCR goes to the project manager. No default. */
const QUALITY = [
  ["ncr_escalation_days", "مهلت تشدید NCR معوق (روز)", "1", "بعد از این تعداد روز تأخیر، NCR به مدیر پروژه می‌رود"],
  ["vdrl_resubmit_days", "مهلت ارسال مجدد مدرک فروشندهٔ کد ۳ (روز)", "1", "طبق قرارداد خرید؛ بعد از آن مدرک معوق است"],
  ["doc_review_days", "مهلت بررسی مدارک طراح (روز)", "1", "طبق قرارداد مهندسی؛ مهلت پاسخ هر ترانسمیتال ورودی از روی آن حساب می‌شود"],
];

/** Handover to maintenance: the CMMS's own conventions. Text; no defaults. */
const CMMS = [
  ["cmms_plant_code", "کد کارخانه در CMMS", "مثلاً KPC-OLF"],
  ["floc_template", "الگوی Functional Location", "نشانه‌ها: {plant} {unit} {system} {subsystem} {tag} — مثلاً {plant}-{unit}-{tag}"],
  ["criticality_levels", "سطوح Criticality (سیاست شرکت)", "با ویرگول، مثلاً A, B, C"],
];

/** Instrument calibration tolerance, used where a datasheet gives none. */
const INSTRUMENTS = [
  ["calibration_tolerance_pct", "تلورانس کالیبراسیون (% اسپن)", "0.001",
    "وقتی دیتاشیت ابزار تلورانس ندارد؛ مثلاً 0.25"],
];

export default function ProjectPage() {
  const { projectId, role, call, reload: reloadPlatform } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/project?projectId=${id}`, []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState(null);
  const [saved, setSaved] = useState(false);

  const editable = can({ role }, ACTIONS.MANAGE_MEMBERS);

  useEffect(() => {
    if (!data?.project) return;
    const p = data.project;
    setForm(Object.fromEntries([...FIELDS, ...SITING, ...CONCRETE].map(([k]) => [k, p[k] ?? ""])
      .concat([["description", p.description ?? ""],
               ["steel_erection_standard", p.steel_erection_standard ?? ""],
               ["weld_symbol_shop", p.weld_symbol_shop ?? ""], ["weld_symbol_field", p.weld_symbol_field ?? ""],
               ["weld_thd_labelled", Boolean(p.weld_thd_labelled)],
               ...[...ELECTRICAL, ...INSTRUMENTS, ...COATING, ...HSE, ...QUALITY, ...CMMS].map(([k]) => [k, p[k] ?? ""])])));
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
      await reload(); reloadPlatform(); // the start date is project day 0 on every work date
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
          شما دسترسی ویرایش ندارید. مشخصات پروژه را فقط مدیر پروژه تغییر می‌دهد.
        </p>
      )}

      <Tabs name="project">
      <form className="card" data-tab="spec" data-tab-title="مشخصات و قواعد پروژه" onSubmit={save}>
        <h2>پروژه</h2>
        <div className="grid2">
          {FIELDS.map(([k, label, type]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type={type} disabled={!editable}
                     dir={type === "text" ? "auto" : "ltr"}
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
            </div>
          ))}
          <div className="field">
            <label htmlFor="contract_currency">ارز پایهٔ پروژه (کنترل پروژه و گزارش‌ها)</label>
            {data.parties?.currencies?.length ? (
              <select id="contract_currency" disabled={!editable} value={form.contract_currency ?? ""}
                      onChange={(e) => set("contract_currency", e.target.value)}>
                <option value="">—</option>
                {data.parties.currencies.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
              </select>
            ) : <input id="contract_currency" readOnly value={form.contract_currency ?? ""} placeholder="—" />}
            <span className="hint">از ارزهای تعریف‌شده در «شرکت‌ها، ذی‌نفعان و بودجه» انتخاب می‌شود.</span>
          </div>
        </div>
        <Parties parties={data.parties} />

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

        <h2 style={{ marginTop: 8 }}>مشخصات بتن</h2>
        <div className="grid2">
          {CONCRETE.map(([k, label, type, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type={type} step={step || undefined} disabled={!editable} dir="ltr"
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              {hint && <span className="hint">{hint}</span>}
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>نماد جوش روی ایزومتریک</h2>
        <div className="grid2">
          {[["weld_symbol_shop", "جوش کارگاهی (Shop) با"], ["weld_symbol_field", "جوش سایت (Field) با"]].map(([k, label]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <select id={k} disabled={!editable} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)}>
                <option value="">— ثبت نشده —</option>
                {Object.entries(WELD_SYMBOLS).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
              </select>
            </div>
          ))}
        </div>
        <label className="sm" style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input type="checkbox" disabled={!editable} checked={Boolean(form.weld_thd_labelled)}
                 onChange={(e) => set("weld_thd_labelled", e.target.checked)} />
          نقشه‌ها کنار <b>همهٔ</b> جوش‌های رزوه‌ای «THD» چاپ می‌کنند
        </label>
        <p className="hint" style={{ marginTop: -4 }}>
          شکل قابی که شمارهٔ هر جوش در آن چاپ شده (مثلاً دایره = کارگاه، مربع = سایت). مدل فقط شکل را می‌خواند؛
          Shop یا Field از همین قرارداد پروژه تعیین می‌شود — تا ثبت نشود، رجیستر خوانده‌شده از نقشه محل جوش ندارد.
        </p>

        <h2 style={{ marginTop: 8 }}>اسکلت فلزی</h2>
        <div className="grid2">
          <div className="field">
            <label htmlFor="steel_erection_standard">استاندارد رواداری نصب اسکلت</label>
            <select id="steel_erection_standard" disabled={!editable}
                    value={form.steel_erection_standard ?? ""}
                    onChange={(e) => set("steel_erection_standard", e.target.value)}>
              <option value="">— ثبت نشده —</option>
              {Object.entries(ERECTION_STANDARDS).map(([k, v]) => (
                <option key={k} value={k}>{v.title}</option>
              ))}
            </select>
            <span className="hint">
              تا ثبت نشود، شاقولی هیچ ستونی حکم نمی‌گیرد — ۱:۵۰۰ و h/300 هر دو درست‌اند، برای قراردادهای متفاوت
            </span>
          </div>
        </div>

        <h2 style={{ marginTop: 8 }}>برق</h2>
        <div className="grid2">
          {ELECTRICAL.map(([k, label, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type="number" step={step} disabled={!editable} dir="ltr"
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              <span className="hint">{hint}</span>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>رنگ و عایق</h2>
        <div className="grid2">
          {COATING.map(([k, label, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type="number" step={step} disabled={!editable} dir="ltr"
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              <span className="hint">{hint}</span>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>HSE — حدود تست گاز و مجوز کار</h2>
        <div className="grid2">
          {HSE.map(([k, label, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type="number" step={step} disabled={!editable} dir="ltr"
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              {hint && <span className="hint">{hint}</span>}
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>کیفیت و خرید — مهلت‌ها</h2>
        <div className="grid2">
          {QUALITY.map(([k, label, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type="number" step={step} disabled={!editable} dir="ltr"
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              <span className="hint">{hint}</span>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>تحویل به نگهداری (CMMS)</h2>
        <div className="grid2">
          {CMMS.map(([k, label, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type="text" dir="ltr" disabled={!editable} value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              <span className="hint">{hint}</span>
            </div>
          ))}
        </div>

        <h2 style={{ marginTop: 8 }}>ابزار دقیق</h2>
        <div className="grid2">
          {INSTRUMENTS.map(([k, label, step, hint]) => (
            <div className="field" key={k}>
              <label htmlFor={k}>{label}</label>
              <input id={k} type="number" step={step} disabled={!editable} dir="ltr"
                     value={form[k] ?? ""} onChange={(e) => set(k, e.target.value)} />
              <span className="hint">{hint}</span>
            </div>
          ))}
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

      <UnitsCard projectId={projectId} call={call} editable={editable}
                 projectGrade={p.grade_elevation_mm} />

      <FormCodesCard projectId={projectId} call={call} editable={editable} />

      <div className="card" data-keep>
        <h2>کد پروژه</h2>
        <p className="muted sm">
          کد <b className="mono">{p.code}</b> پس از ساخت پروژه تغییر نمی‌کند — هر
          مدرک، رجیستر و گزارشی که تا امروز صادر شده به آن ارجاع می‌دهد.
        </p>
      </div>
      </Tabs>
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

/**
 * The plant's units, and the ones that sit on their own ground.
 *
 * One grade for the whole project is right for a flat site and wrong for a
 * terraced one. A unit may override the project grade; leaving the field
 * empty means the unit uses the project's. A drawing is attached to its unit
 * by the unit code printed in its title block, matched exactly — so a code
 * here must be written the way the drawings write it.
 */
function UnitsCard({ projectId, call, editable, projectGrade }) {
  const { data, error, reload } = useProjectData((id) => `/api/units?projectId=${id}`, []);
  const [draft, setDraft] = useState({});
  const [f, setF] = useState({ code: "", name: "", grade: "" });
  const [err, setErr] = useState(null);

  async function save(code, name, grade) {
    setErr(null);
    try {
      await call("/api/units", { method: "POST",
        body: JSON.stringify({ projectId, code, name: name || null, gradeElevationMm: grade }) });
      setDraft({});
      reload();
    } catch (e) { setErr(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  const units = data?.units || [];

  return (
    <div className="card">
      <h2>واحدها و گرید هر واحد</h2>
      <p className="muted sm">
        اگر همهٔ واحدها روی یک تراز باشند، گرید پروژه کافی است. واحدی که روی
        سکوی دیگری است — مخازن، فلر، یوتیلیتی — گرید خودش را می‌گیرد. کد واحد را
        دقیقاً همان‌طور بنویسید که در title block نقشه‌ها چاپ می‌شود؛ نقشه با همین
        کد به واحد وصل می‌شود.
      </p>
      {units.length === 0 ? (
        <p className="empty-note">هنوز واحدی تعریف نشده است؛ همهٔ جوش‌ها با گرید پروژه سنجیده می‌شوند.</p>
      ) : (
        <TableKit name="project">
          <table className="dtable">
            <thead><tr><th>کد</th><th>نام</th><th>گرید واحد (mm)</th><th>گرید اعمال‌شده</th><th /></tr></thead>
            <tbody>
              {units.map((u) => {
                const own = u.grade_elevation_mm;
                const applied = own ?? projectGrade;
                const editing = draft.code === u.code;
                return (
                  <tr key={u.id}>
                    <td className="mono">{u.code}</td>
                    <td>{u.name || "—"}</td>
                    <td className="mono">
                      {editing ? (
                        <input type="number" step="0.1" dir="ltr" style={{ width: 130 }}
                               value={draft.grade} onChange={(e) => setDraft({ ...draft, grade: e.target.value })} />
                      ) : own == null ? <span className="muted">— (گرید پروژه)</span>
                        : Number(own).toLocaleString("en-US")}
                    </td>
                    <td className="mono">
                      {applied == null ? <span className="muted">ثبت نشده</span>
                        : Number(applied).toLocaleString("en-US")}
                    </td>
                    <td>
                      {editable && (editing ? (
                        <button className="btn" style={{ padding: "3px 10px" }}
                                onClick={() => save(u.code, u.name, draft.grade)}>ذخیره</button>
                      ) : (
                        <button className="btn ghost" style={{ padding: "3px 10px" }}
                                onClick={() => setDraft({ code: u.code, grade: own ?? "" })}>ویرایش گرید</button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableKit>
      )}

      {err && <p className="err">{err}</p>}

      {editable && (
        <form className="grid2" style={{ alignItems: "end" }}
              onSubmit={(e) => { e.preventDefault(); save(f.code, f.name, f.grade); setF({ code: "", name: "", grade: "" }); }}>
          <div className="field"><label htmlFor="u-code">کد واحد</label>
            <input id="u-code" dir="ltr" required value={f.code}
                   onChange={(e) => setF({ ...f, code: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-name">نام</label>
            <input id="u-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="u-grade">گرید واحد (اختیاری)</label>
            <input id="u-grade" type="number" step="0.1" dir="ltr" value={f.grade}
                   onChange={(e) => setF({ ...f, grade: e.target.value })} />
            <span className="hint">خالی = همان گرید پروژه</span></div>
          <div><button className="btn" type="submit" disabled={!f.code}>افزودن واحد</button></div>
        </form>
      )}
    </div>
  );
}

/**
 * The code of every form whose numbers the platform issues, and the number
 * each will take next. A project may name a form its own way (DMW-PTW);
 * an empty code goes back to the platform's default.
 */
function FormCodesCard({ projectId, call, editable }) {
  const { data, error, reload } = useProjectData((id) => `/api/numbering?projectId=${id}`, []);
  const [draft, setDraft] = useState({});
  const [msg, setMsg] = useState(null);
  async function save(form) {
    setMsg(null);
    try {
      await call("/api/numbering", { method: "POST", body: JSON.stringify({ projectId, form, code: draft[form] ?? "" }) });
      setDraft((d) => { const n = { ...d }; delete n[form]; return n; }); reload();
    } catch (e) { setMsg(e.message); }
  }
  return (
    <div className="card">
      <h2>کد فرم‌ها و شماره‌گذاری خودکار</h2>
      <p className="muted sm">
        هر رکوردی که پلتفرم صادر می‌کند شماره‌اش را از کد فرم و شمارهٔ بعدی همان فرم می‌گیرد (مثلاً PTW-0001)؛
        فیلد شماره را در فرم خالی بگذارید. شمارهٔ دستی نگه داشته می‌شود و هرگز دوباره صادر نمی‌شود.
        شماره‌هایی که از بیرون می‌آیند (ترانسمیتال طراح، شمارهٔ ذوب، تگ و خط نقشه) خودکار نیستند.
      </p>
      {error && <p className="err">{error}</p>}
      {msg && <p className="err">{msg}</p>}
      {data && (
        <table className="dtable">
          <thead><tr><th>فرم</th><th>کد</th><th>صادرشده</th><th>شمارهٔ بعدی</th>{editable && <th />}</tr></thead>
          <tbody>{data.forms.map((f) => (
            <tr key={f.form} data-form={f.form}>
              <td>{f.title}</td>
              <td>{editable
                ? <input aria-label={`کد فرم ${f.title}`} dir="ltr" style={{ width: 110 }} value={draft[f.form] ?? f.code}
                         onChange={(e) => setDraft({ ...draft, [f.form]: e.target.value })} />
                : <span className="mono">{f.code}</span>}
                {f.own && <span className="muted sm"> (پیش‌فرض {f.defaultCode})</span>}</td>
              <td className="mono">{f.issued}</td>
              <td className="mono">{f.scoped ? <span className="muted sm">به ازای هر ساب‌سیستم: 70-01-{f.code}001</span> : f.next}</td>
              {editable && <td><button className="btn ghost" type="button" disabled={draft[f.form] === undefined} onClick={() => save(f.form)}>ذخیره</button></td>}
            </tr>
          ))}</tbody>
        </table>
      )}
    </div>
  );
}

/**
 * The parties and the contract, as they are recorded where they belong: the
 * companies and their roles in «شرکت‌ها، ذی‌نفعان و بودجه», the contracts in
 * «قراردادها». Shown here, never typed here a second time.
 */
function Parties({ parties }) {
  if (!parties) return null;
  const row = (label, list, legacy) => (
    <tr><th>{label}</th><td>{list.length ? list.join("، ") : legacy
      ? <span>{legacy} <span className="pill warn sm">متن قدیمی — در شرکت‌ها و ذی‌نفعان ثبت کنید</span></span>
      : <span className="muted">ثبت نشده</span>}</td></tr>);
  const L = parties.legacy || {};
  return (
    <div data-parties style={{ marginTop: 8 }}>
      <h2>طرفین و قرارداد اصلی</h2>
      <p className="muted sm">طرفین از «پروژه ◄ شرکت‌ها، ذی‌نفعان و بودجه» و قرارداد از «قراردادها و پیمان‌ها» خوانده می‌شوند و اینجا دوباره وارد نمی‌شوند.</p>
      <table className="dtable"><tbody>
        {row("کارفرما", parties.employer, L.client_name)}
        {row("مشاور / نظارت", parties.consultant, L.consultant_name)}
        {row("پیمانکار EPC", parties.epc, L.contractor_name)}
        {row("پیمانکاران", parties.contractors)}
        <tr><th>قرارداد اصلی</th><td>{parties.contracts.length ? parties.contracts.map((c) => (
          <div key={c.id}><span className="mono">{c.contract_no}</span> — {c.title}
            {c.value != null && <span className="mono"> · {c.value.toLocaleString("en-US")} {c.currency}</span>}</div>))
          : L.contract_no || L.contract_value
            ? <span>{[L.contract_no, L.contract_value].filter(Boolean).join(" · ")} <span className="pill warn sm">متن قدیمی — قرارداد را در «قراردادها» ثبت کنید</span></span>
            : <span className="muted">قرارداد اصلی (نوع «اصلی») در «قراردادها» ثبت نشده</span>}</td></tr>
      </tbody></table>
    </div>
  );
}
