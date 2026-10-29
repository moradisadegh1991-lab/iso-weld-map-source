"use client";
import { useEffect, useState } from "react";
import { ENDPOINT_PROVIDERS, SECRET_KIND_FA } from "../lib/llm/endpoints.mjs";

/**
 * «ثبت کلید و آدرس سرور» under the isometric reader's model picker (owner's
 * request 2026-10-29): the address and key of an OpenAI-compatible service
 * (Liara …) or of the relay holding the Claude / Gemini key, registered in
 * the app instead of the server's environment. Every member sees what is
 * registered; a project admin registers, changes or removes. The key goes to
 * the server once, sealed there, and is never sent back — the field is never
 * filled in, and left empty it keeps the stored key.
 *
 *   session   useSession(): { projectId, call }
 *   onChange  called after a save or a removal, so the model list is read again
 */
export default function LlmEndpoints({ session, onChange }) {
  const { projectId, call } = session;
  const [data, setData] = useState(null);
  const [f, setF] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    try { setData(await call(`/api/llm-endpoints?projectId=${projectId}`)); } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { if (projectId) load(); }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!projectId) return null;

  const blank = (provider = "openai-compatible") => ({ provider, baseUrl: "", secretKind: ENDPOINT_PROVIDERS[provider].kinds[0], secret: "", models: "" });
  const edit = (e) => setF({ provider: e.provider, baseUrl: e.baseUrl, secretKind: e.secretKind, secret: "", models: (e.models || []).join("\n"), had: e.hasSecret });
  const send = async (body, done) => {
    setMsg(null); setOk(null); setBusy(true);
    try { await call("/api/llm-endpoints", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); setOk(done); setF(null); await load(); onChange?.(); }
    catch (e) { setMsg(e.message); } finally { setBusy(false); }
  };
  const save = (e) => {
    e.preventDefault();
    if (!window.confirm("این آدرس و کلید ذخیره شود؟ کلید رمزنگاری می‌شود و دیگر نمایش داده نمی‌شود.")) return;
    send({ kind: "save", ...f, had: undefined }, "ذخیره شد.");
  };
  const remove = (p) => { if (window.confirm(`نقطهٔ ${ENDPOINT_PROVIDERS[p].label} حذف شود؟ دوباره از تنظیمات سرور (Environment) خوانده می‌شود.`)) send({ kind: "remove", provider: p }, "حذف شد."); };
  const may = !!data?.may?.write;
  const P = f ? ENDPOINT_PROVIDERS[f.provider] : null;

  return (
    <details className="intake-more" data-llm-endpoints>
      <summary>ثبت کلید و آدرس سرور (لیارا، رلهٔ Claude / Gemini، vLLM)</summary>
      <p className="muted sm">
        اگر سرویس هوش مصنوعی شما (مثلاً لیارا) با قالب OpenAI کار می‌کند، آدرس و کلیدش را اینجا ثبت کنید؛ برای Claude یا Gemini هم می‌توانید آدرس رله و توکن آن را بگذارید.
        کلید یک‌بار به سرور فرستاده و رمزنگاری می‌شود و هرگز به مرورگر برنمی‌گردد؛ ثبت و تغییر فقط با ادمین پروژه است.
        هر ارائه‌دهنده‌ای که اینجا ثبت شود در همین پروژه جای تنظیم Environment سرور را می‌گیرد.
      </p>
      {data && data.endpoints.length === 0 && <p className="muted sm" data-llm-none>هنوز چیزی ثبت نشده؛ سرور از تنظیمات Environment خودش می‌خواند.</p>}
      {data && data.endpoints.length > 0 && (
        <ul className="sm" data-llm-list style={{ paddingInlineStart: 16 }}>
          {data.endpoints.map((e) => (
            <li key={e.provider} data-llm-endpoint={e.provider}>
              <b>{ENDPOINT_PROVIDERS[e.provider]?.label || e.provider}</b>{" "}
              <span className="mono" dir="ltr">{e.baseUrl}</span>{" "}
              <span className="muted">· {SECRET_KIND_FA[e.secretKind]} {e.hasSecret ? <span className="mono" dir="ltr">{e.hint}</span> : "(بدون کلید)"}</span>
              {e.models.length > 0 && <span className="muted"> · مدل‌ها: <span className="mono" dir="ltr">{e.models.join("، ")}</span></span>}
              {!e.readable && <span className="err"> · کلید خوانده نمی‌شود (کلید رمزنگاری سرور عوض شده)؛ دوباره ثبتش کنید</span>}
              {may && <> <button type="button" className="ghost" onClick={() => edit(e)}>ویرایش</button>
                <button type="button" className="ghost" onClick={() => remove(e.provider)}>حذف</button></>}
            </li>))}
        </ul>)}
      {may && !f && <button type="button" className="ghost" data-llm-new onClick={() => setF(blank())}>+ ثبت آدرس و کلید</button>}
      {data && !may && <p className="muted sm">فقط ادمین پروژه می‌تواند آدرس و کلید ثبت کند.</p>}
      {f && (
        <form onSubmit={save} data-llm-form autoComplete="off">
          <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
            <label className="sm">ارائه‌دهنده
              <select aria-label="provider" value={f.provider} disabled={!!f.had} onChange={(e) => setF(blank(e.target.value))}>
                {Object.entries(ENDPOINT_PROVIDERS).map(([id, p]) => <option key={id} value={id}>{p.label}</option>)}</select></label>
            <label className="sm" style={{ flex: 1, minWidth: 260 }}>آدرس سرور
              <input aria-label="baseUrl" dir="ltr" required placeholder={P.hint} value={f.baseUrl} onChange={(e) => setF({ ...f, baseUrl: e.target.value })} /></label>
            {P.kinds.length > 1 && <label className="sm">نوع
              <select aria-label="secretKind" value={f.secretKind} onChange={(e) => setF({ ...f, secretKind: e.target.value })}>
                {P.kinds.map((k) => <option key={k} value={k}>{SECRET_KIND_FA[k]}</option>)}</select></label>}
            <label className="sm" style={{ flex: 1, minWidth: 220 }}>{SECRET_KIND_FA[f.secretKind]}
              <input aria-label="secret" type="password" dir="ltr" autoComplete="new-password" spellCheck={false} value={f.secret}
                placeholder={f.had ? "خالی = همان کلید ذخیره‌شده" : f.provider === "openai-compatible" ? "اگر سرور کلید نمی‌خواهد خالی بگذارید" : ""}
                onChange={(e) => setF({ ...f, secret: e.target.value })} /></label>
          </div>
          {f.provider === "openai-compatible" && (
            <label className="sm">نام مدل‌ها (هر خط یکی: اول مدل استخراج، دوم مدل پاس اصلاح — باید تصویر بخواند)
              <textarea aria-label="models" dir="ltr" rows={2} value={f.models} onChange={(e) => setF({ ...f, models: e.target.value })} /></label>)}
          <p className="row" style={{ gap: 6 }}>
            <button type="submit" disabled={busy} data-llm-save>ذخیره</button>
            <button type="button" className="ghost" onClick={() => setF(null)}>انصراف</button></p>
        </form>)}
      {msg && <div className="err" role="alert">{msg}</div>}
      {ok && <div className="note" role="status">{ok}</div>}
    </details>);
}
