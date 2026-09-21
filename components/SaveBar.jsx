"use client";
import { useState } from "react";

/**
 * Persistence for a computed register.
 *
 * Everything this component does is a request the server re-checks: it posts
 * the extraction payload, and the API recomputes the register with the engine
 * rather than trusting what the browser worked out. So this is a convenience
 * surface, not a trust boundary — which is the only reason it is allowed to
 * be this simple.
 */

const MAX_INLINE_UPLOAD = 3_400_000; // same body ceiling the extraction passes respect

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function SaveBar({ session, data, model, sourceFile, strictBom, onSaved }) {
  const { projectId, identity, call } = session;
  const [state, setState] = useState({ phase: "idle" });
  const [saved, setSaved] = useState(null);
  const [diff, setDiff] = useState(null);

  async function save() {
    if (!projectId) return setState({ phase: "error", msg: "اول پروژه را انتخاب کنید." });
    const docNo = data?.meta?.drawingNo;
    const revision = data?.meta?.rev;
    if (!docNo || !revision) {
      return setState({ phase: "error", msg: "شماره نقشه و رویژن لازم است — در تب JSON پرشان کنید." });
    }

    setState({ phase: "busy", msg: "ثبت سند…" });
    try {
      let fileBase64 = null, fileSha256 = null, byteSize = null;
      if (sourceFile) {
        const buf = await sourceFile.arrayBuffer();
        fileSha256 = await sha256Hex(buf);
        byteSize = buf.byteLength;
        // Above the body ceiling the bytes need a presigned upload straight to
        // object storage; until MinIO is wired the document is registered by
        // hash alone and says so, rather than silently storing nothing.
        if (buf.byteLength <= MAX_INLINE_UPLOAD) {
          fileBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
        }
      }

      const doc = await call("/api/documents", {
        method: "POST",
        body: JSON.stringify({
          projectId, docNo, revision,
          revisionDate: data.meta.revDate || null,
          sheetNo: data.meta.sheet || "1/1",
          contentType: sourceFile?.type || "image/jpeg",
          fileBase64, fileSha256, byteSize,
        }),
      });

      setState({ phase: "busy", msg: "ثبت رجیستر…" });
      const run = await call("/api/runs", {
        method: "POST",
        body: JSON.stringify({
          projectId, documentId: doc.document.id,
          lineNo: data.meta.lineNo || docNo,
          payload: data, options: { strictBom },
        }),
      });

      setSaved({ doc, run });
      onSaved?.(run.run.id);

      // What this revision changed, and what of it is already welded. Only
      // meaningful when there is an earlier run to compare against.
      try {
        const d = await call(`/api/runs/${run.run.id}/diff?projectId=${projectId}`);
        setDiff(d.diff ? d : null);
      } catch { setDiff(null); }

      setState({
        phase: "done",
        msg: `${run.register.length} جوش ثبت شد` +
          (doc.deduplicated ? " · فایل تکراری بود، دوباره ذخیره نشد" : "") +
          (doc.superseded?.length ? ` · رویژن ${doc.superseded.map((d) => d.revision).join("، ")} منسوخ شد` : "") +
          (fileBase64 === null && sourceFile ? " · فایل بزرگ بود؛ فقط با hash ثبت شد" : ""),
      });
    } catch (e) {
      setState({ phase: "error", msg: e.message });
    }
  }

  async function approve() {
    setState({ phase: "busy", msg: "ثبت تأیید…" });
    try {
      const { run } = await call(`/api/runs/${saved.run.run.id}/approve`, {
        method: "POST", body: JSON.stringify({ projectId }),
      });
      setSaved((s) => ({ ...s, run: { ...s.run, run } }));
      setState({ phase: "done", msg: `تأیید شد · ${run.approved_sha256.slice(0, 12)}…` });
    } catch (e) {
      setState({ phase: "error", msg: e.message });
    }
  }

  const busy = state.phase === "busy";
  const approved = saved?.run?.run?.status === "approved";

  return (
    <div className="savebar">
      <div className="row">
        <button className="ghost" onClick={save} disabled={busy || !projectId || model?.error}>
          ذخیره در سامانه
        </button>
        {!projectId && <span className="muted sm">اول پروژه را انتخاب کنید.</span>}
      </div>

      {diff && (
        <div className={"revdiff" + (diff.impact.rework.length ? " alarm" : "")}>
          <b className="mono">
            {diff.from.revision} → {diff.to.revision}
          </b>
          <span className="mono sm">
            {diff.diff.summary.added} افزوده · {diff.diff.summary.removed} حذف ·
            {" "}{diff.diff.summary.changed} تغییر · {diff.diff.summary.unchanged} بدون تغییر
            {diff.diff.summary.renumbered ? ` · ${diff.diff.summary.renumbered} شماره‌گذاری مجدد` : ""}
          </span>
          {diff.diff.summary.rebased && (
            <span className="muted sm">مبنای مختصات جابه‌جا شده — با tie-in تراز شد، پس تغییر واقعی شمرده نشد.</span>
          )}
          {diff.impact.rework.length > 0 ? (
            <div className="rework">
              <b>⚠ دوباره‌کاری</b>
              {diff.impact.rework.map((s) => (
                <span key={s.spool} className="mono sm">
                  {s.spool} ({s.fabStatus}) — جوش‌های {s.welds.join("، ")}
                </span>
              ))}
              <span className="sm">این اسپول‌ها ساخته شده‌اند و این رویژن آن‌ها را تغییر می‌دهد.
                قبل از ادامه با کارگاه ساخت هماهنگ کنید.</span>
            </div>
          ) : (
            <span className="muted sm">هیچ اسپول ساخته‌شده‌ای تحت تأثیر نیست.</span>
          )}
        </div>
      )}

      {saved && !approved && (
        <div className="row">
          <button className="ghost" onClick={approve} disabled={busy}>تأیید رجیستر (مهندس)</button>
        </div>
      )}
      {approved && <p className="muted sm">✓ این رجیستر تأیید شده و قفل است. تغییر بعدی رویژن جدید می‌خواهد.</p>}

      {state.msg && <p className={state.phase === "error" ? "err" : "note mono"}>{state.msg}</p>}

      <p className="muted sm">
        رجیستر روی سرور از روی همین payload <b>دوباره محاسبه</b> می‌شود — مرورگر تعیین نمی‌کند
        جوش کجا بخورد. تأیید فقط از نقش <b>engineer</b> پذیرفته می‌شود و هش آنچه امضا شده ثبت می‌گردد.
      </p>
    </div>
  );
}
