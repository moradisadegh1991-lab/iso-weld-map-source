"use client";
import { useEffect, useState } from "react";
import { getIdentity, setIdentity as persistIdentity, authHeaders } from "../lib/client/identity.mjs";

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

export default function SaveBar({ data, model, sourceFile, strictBom }) {
  const [identity, setIdentity] = useState("");
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [state, setState] = useState({ phase: "idle" });
  const [saved, setSaved] = useState(null);

  useEffect(() => { setIdentity(getIdentity()); }, []);

  async function call(url, init = {}) {
    const res = await fetch(url, { ...init, headers: authHeaders(identity) });
    const body = await res.json().catch(() => ({ error: `پاسخ ${res.status}` }));
    if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
    return body;
  }

  async function loadProjects() {
    setState({ phase: "busy", msg: "خواندن پروژه‌ها…" });
    try {
      persistIdentity(identity);
      const { projects } = await call("/api/projects");
      setProjects(projects);
      if (projects.length === 1) setProjectId(projects[0].id);
      setState({ phase: "idle" });
    } catch (e) {
      setState({ phase: "error", msg: e.message });
    }
  }

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
        <input className="mono" placeholder="شناسه کاربر (حالت dev)" value={identity}
          onChange={(e) => setIdentity(e.target.value)} disabled={busy} />
        <button className="ghost" onClick={loadProjects} disabled={!identity || busy}>پروژه‌ها</button>
      </div>

      {projects && (
        projects.length ? (
          <div className="row">
            <select className="mono" value={projectId} onChange={(e) => setProjectId(e.target.value)} disabled={busy}>
              <option value="">— پروژه —</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.role}</option>)}
            </select>
            <button className="ghost" onClick={save} disabled={busy || model?.error}>ذخیره در سامانه</button>
          </div>
        ) : <p className="muted sm">این کاربر عضو هیچ پروژه‌ای نیست.</p>
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
