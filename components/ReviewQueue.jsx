"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * What is waiting for a piping engineer.
 *
 * Ordered worst first — engine error, then warning count — because a queue
 * ordered by arrival asks the engineer to find the bad ones themselves, which
 * is the job the validation engine already did. The scarcest resource on the
 * project is the reviewer's attention, so the list spends it on the drawings
 * most likely to be wrong.
 */
export default function ReviewQueue({ session, onOpen, currentRunId }) {
  const { projectId, call } = session;
  const [queue, setQueue] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const { queue } = await call(`/api/review-queue?projectId=${projectId}`);
      setQueue(queue);
    } catch (e) {
      setError(e.message);
      setQueue(null);
    } finally {
      setBusy(false);
    }
  }, [projectId, call]);

  useEffect(() => { load(); }, [load]);

  if (!projectId) return <p className="muted sm">برای دیدن صف، پروژه را انتخاب کنید.</p>;

  return (
    <div className="pane">
      <div className="row">
        <button className="ghost" onClick={load} disabled={busy}>
          {busy ? "…" : "تازه‌سازی صف"}
        </button>
        {queue && <span className="muted sm">{queue.length} در انتظار بازبینی</span>}
      </div>

      {error && <div className="err">{error}</div>}

      {queue && !queue.length && (
        <p className="muted sm">چیزی در انتظار بازبینی نیست.</p>
      )}

      {queue && queue.length > 0 && (
        <table>
          <thead>
            <tr><th>نقشه</th><th>REV</th><th>هشدار</th><th>جوش</th><th>اصلاح</th><th /></tr>
          </thead>
          <tbody>
            {queue.map((r) => (
              <tr key={r.runId} className={r.runId === currentRunId ? "sel" : ""}>
                <td className="mono sm">{r.docNo}</td>
                <td className="mono sm">{r.revision}</td>
                <td className={"mono " + (r.engineError ? "fld" : r.warnings ? "warnish" : "")}>
                  {r.engineError ? "خطا" : r.warnings || "—"}
                </td>
                <td className="mono sm">{r.welds}</td>
                <td className="mono sm">{r.edits || "—"}</td>
                <td>
                  <button className="ghost sm" onClick={() => onOpen(r.runId)}>باز کردن</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="muted sm">
        مرتب بر اساس «چقدر احتمال دارد غلط باشد»: اول خطای موتور، بعد تعداد هشدار.
      </p>
    </div>
  );
}
