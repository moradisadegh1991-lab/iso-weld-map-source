"use client";
import { useMemo, useState } from "react";
import { diffPayload } from "../lib/review/payload-diff.mjs";

/**
 * Correcting a persisted run.
 *
 * The preview is the point. Before anything is written, the engineer sees
 * exactly which fields they are about to change and what each one was — a
 * JSON textarea makes it far too easy to fix one digit and silently mangle
 * three others, and the log would then record all four as deliberate.
 *
 * Every field that does change is recorded with both values. That log is what
 * tells the programme which field extraction gets wrong, which no amount of
 * aggregate accuracy ever could.
 */
export default function EditPanel({ session, run, edited, onApplied }) {
  const { projectId, call } = session;
  const [reason, setReason] = useState("");
  const [state, setState] = useState({ phase: "idle" });

  const parsed = useMemo(() => {
    try { return { value: JSON.parse(edited), error: null }; }
    catch (e) { return { value: null, error: e.message }; }
  }, [edited]);

  const pending = useMemo(() => {
    if (!run?.payload || !parsed.value) return [];
    return diffPayload(run.payload, parsed.value);
  }, [run, parsed.value]);

  const locked = !!run?.run?.lockedAt;

  async function apply() {
    setState({ phase: "busy" });
    try {
      const body = await call(`/api/runs/${run.run.id}/edits`, {
        method: "POST",
        body: JSON.stringify({ projectId, payload: parsed.value, reason: reason || null }),
      });
      setReason("");
      setState({ phase: "done",
        msg: `${body.edits.length} فیلد ثبت شد · رجیستر با ${body.register.length} جوش بازسازی شد` +
          (body.engineError ? ` · خطای موتور: ${body.engineError}` : "") });
      onApplied?.(body);
    } catch (e) {
      setState({ phase: "error",
        msg: e.body?.code === "RUN_LOCKED"
          ? "این اجرا تأیید و قفل شده است. برای تغییر، رویژن جدید نقشه را ثبت کنید."
          : e.message });
    }
  }

  return (
    <div className="editpanel">
      {locked && (
        <div className="locked">
          <b>🔒 تأییدشده و قفل</b>
          <span className="mono sm">
            {run.run.approvedBy || "—"} · {String(run.run.approvedAt).slice(0, 10)}
            {run.run.approvedSha256 ? ` · ${run.run.approvedSha256.slice(0, 12)}` : ""}
          </span>
          <span className="sm">تغییر بعدی نیاز به رویژن جدید نقشه دارد — امضا در برابر همین بایت‌ها زده شده.</span>
        </div>
      )}

      {parsed.error && <div className="err">JSON نامعتبر: {parsed.error}</div>}

      {!locked && !parsed.error && (
        <>
          <div className="pendinghead">
            {pending.length
              ? <b>{pending.length} فیلد تغییر می‌کند</b>
              : <span className="muted sm">هنوز چیزی تغییر نکرده است.</span>}
          </div>

          {pending.length > 0 && (
            <>
              <table className="difftable">
                <thead><tr><th>فیلد</th><th>از</th><th>به</th></tr></thead>
                <tbody>
                  {pending.slice(0, 12).map((e) => (
                    <tr key={e.path}>
                      <td className="mono sm">{e.path}</td>
                      <td className="mono sm was">{fmt(e.before)}</td>
                      <td className="mono sm now">{fmt(e.after)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pending.length > 12 && (
                <p className="muted sm">و {pending.length - 12} فیلد دیگر.</p>
              )}
              <input className="mono" placeholder="دلیل اصلاح (اختیاری، ولی بعداً کمک می‌کند)"
                value={reason} onChange={(e) => setReason(e.target.value)} />
              <button className="ghost" onClick={apply} disabled={state.phase === "busy"}>
                {state.phase === "busy" ? "…" : "اعمال و ثبت اصلاح"}
              </button>
            </>
          )}
        </>
      )}

      {state.msg && <p className={state.phase === "error" ? "err" : "note mono"}>{state.msg}</p>}

      {run?.edits?.length > 0 && (
        <details className="editlog">
          <summary>{run.edits.length} اصلاح ثبت‌شده</summary>
          <table className="difftable">
            <tbody>
              {run.edits.map((e) => (
                <tr key={e.id}>
                  <td className="mono sm">{e.path}</td>
                  <td className="mono sm was">{fmt(e.before_value)}</td>
                  <td className="mono sm now">{fmt(e.after_value)}</td>
                  <td className="muted sm">{e.display_name || e.subject || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <p className="muted sm">
        رجیستر روی سرور از payload اصلاح‌شده <b>بازسازی</b> می‌شود، نه وصله — یک مختصات
        اصلاح‌شده می‌تواند مرز اسپول را دو مفصل آن‌طرف‌تر جابه‌جا کند. شناسهٔ جوش منتقل
        می‌شود، پس رکورد NDT جوش دست‌نخورده یتیم نمی‌ماند.
      </p>
    </div>
  );
}

const fmt = (v) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));
