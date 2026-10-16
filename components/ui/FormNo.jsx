"use client";
import { useProjectData } from "../../lib/client/platform.mjs";

/**
 * A form's number field. Left empty, the platform issues the form's next
 * number (its code and sequence — project › کد فرم‌ها); the field shows
 * which number that will be. A number typed here is kept as typed, and
 * never issued a second time.
 *
 *   <FormNo id="pt-no" form="permit" label="شمارهٔ مجوز" value={f.permitNo} on={(v) => setF({ ...f, permitNo: v })} />
 */
export default function FormNo({ id, form, label, value, on, scope = null, readOnly = false }) {
  const { data, reload } = useProjectData(
    (pid) => `/api/numbering?projectId=${pid}&forms=${form}${scope ? `&scope=${encodeURIComponent(scope)}` : ""}`, [form, scope]);
  const next = data?.next?.[form];
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} dir="ltr" value={value || ""} readOnly={readOnly} onFocus={() => reload()}
             placeholder={next ? `خودکار: ${next}` : "خودکار"} onChange={(e) => on(e.target.value)} />
      {!readOnly && !value && next && <span className="muted sm" data-next-no={next}>خالی بماند تا {next} بگیرد</span>}
    </div>
  );
}
