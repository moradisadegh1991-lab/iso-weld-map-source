"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import Fold from "../../components/ui/Fold";

/**
 * The workflow of each report type: stages in order, the review groups of
 * each stage in priority order, and who sits in each group with which
 * rights. What the rights allow is decided by lib/reports/workflow.mjs; this
 * page only says who holds them.
 */
const PERM_HELP = {
  view: "خواندن گزارش", create: "ساخت گزارش تازه (فقط در مرحلهٔ اول معنا دارد)",
  edit: "تغییر محتوا تا وقتی کسی در این مرحله امضا نکرده", edit_after_sign: "تغییر محتوا حتی پس از امضا در همین مرحله — امضاها باید دوباره داده شوند",
  delete: "لغو گزارش در مرحلهٔ اول، پیش از هر تأیید", sign: "امضای گزارش برای این گروه",
  return: "برگرداندن به مرحلهٔ قبل با ذکر دلیل", approve: "تأیید نهایی مرحله — پس از امضای خود",
};

export default function ReportSetupPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/report-setup?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [typeId, setTypeId] = useState(null);
  const [nt, setNt] = useState({ code: "", name: "", description: "" });
  const [ns, setNs] = useState({ seq: "", name: "" });
  const [ng, setNg] = useState({});        // per stage: { seq, name, title, description }
  const [nm, setNm] = useState({});        // per group: { userId, permissions[] }

  async function post(body) {
    setMsg(null);
    try { const r = await call("/api/report-setup", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const type = data.types.find((t) => t.id === typeId) || data.types[0] || null;
  const name = (uid) => data.users.find((u) => u.id === uid)?.name || "—";
  const gform = (sid) => ng[sid] || { seq: "", name: "", title: "", description: "" };
  const mform = (gid) => nm[gid] || { userId: "", permissions: ["view"] };

  return (
    <div className="page">
      <div className="pagehead"><h1>تنظیم گردش‌کار گزارش</h1>
        <span className="sub">{data.types.length} نوع گزارش</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}

      <div className="card">
        <h2>انواع گزارش</h2>
        {data.types.length === 0 ? (
          <p className="empty-note">هنوز نوع گزارشی تعریف نشده است. الگوی گزارش روزانه مراحل پیمانکار ← نظارت ← کارفرما را می‌سازد؛ اعضا را خودتان تعیین می‌کنید.</p>
        ) : (
          <div className="seg" role="radiogroup" aria-label="نوع گزارش">
            {data.types.map((t) => (
              <label key={t.id}><input type="radio" name="rtype" checked={type?.id === t.id} onChange={() => setTypeId(t.id)} />
                <span className="mono">{t.code}</span> — {t.name} <span className="muted sm">({t.stages.length} مرحله · {t.reports} گزارش)</span></label>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {!data.types.some((t) => t.code === "DR") && (
            <button className="btn" type="button" onClick={() => post({ kind: "template" })}>ساخت الگوی گزارش روزانه</button>
          )}
        </div>
        <Fold title="تعریف نوع گزارش">
          <form onSubmit={async (e) => { e.preventDefault(); const r = await post({ kind: "type", ...nt }); if (r) { setNt({ code: "", name: "", description: "" }); setTypeId(r.row.id); } }}>
            <div className="grid2">
              <div className="field"><label htmlFor="rt-code">کد (لاتین، مثل DR)</label><input id="rt-code" dir="ltr" required value={nt.code} onChange={(e) => setNt({ ...nt, code: e.target.value })} /></div>
              <div className="field"><label htmlFor="rt-name">نام</label><input id="rt-name" required value={nt.name} onChange={(e) => setNt({ ...nt, name: e.target.value })} /></div>
              <div className="field"><label htmlFor="rt-desc">شرح</label><input id="rt-desc" value={nt.description} onChange={(e) => setNt({ ...nt, description: e.target.value })} /></div>
            </div>
            <button className="btn" type="submit">ذخیرهٔ نوع گزارش</button>
          </form>
        </Fold>
      </div>

      {type && (
        <div className="card">
          <h2>مراحل «{type.name}»</h2>
          {type.reports > 0 && <p className="muted sm">با این نوع {type.reports} گزارش ثبت شده است: مرحله‌ها حذف نمی‌شوند (نامشان تغییر می‌کند) و گروهی که برایش امضا شده حذف نمی‌شود.</p>}
          {type.stages.length === 0 && <p className="empty-note">مرحله‌ای تعریف نشده است.</p>}
          {type.stages.map((st) => (
            <div className="stagebox" key={st.id}>
              <h3>مرحلهٔ {st.seq}: {st.name}
                {type.reports === 0 && <button className="btn ghost sm" type="button" style={{ marginInlineStart: 8 }}
                  onClick={() => post({ kind: "stage-remove", stageId: st.id })}>حذف مرحله</button>}</h3>
              {st.groups.length === 0 && <p className="muted sm">گروهی ندارد — بدون گروه، کسی در این مرحله کاری نمی‌تواند بکند.</p>}
              {st.groups.map((g) => (
                <div className="groupbox" key={g.id}>
                  <b>{g.seq}. {g.name}</b>{g.title && <span className="muted sm"> — {g.title}</span>}
                  {g.description && <div className="muted sm">{g.description}</div>}
                  <table className="dtable" style={{ marginTop: 6 }}>
                    <thead><tr><th>عضو</th><th>دسترسی‌ها</th><th /></tr></thead>
                    <tbody>
                      {g.members.length === 0 && <tr><td colSpan={3} className="muted sm">عضوی ندارد.</td></tr>}
                      {g.members.map((m) => (
                        <tr key={m.userId}>
                          <td>{m.name || name(m.userId)}</td>
                          <td className="sm">{m.permissions.map((p) => data.permissions[p]).join("، ")}</td>
                          <td><button className="btn ghost sm" type="button" onClick={() => post({ kind: "member-remove", groupId: g.id, userId: m.userId })}>برداشتن</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <details className="inlinefold"><summary>افزودن یا تغییر دسترسی عضو</summary>
                    <form onSubmit={async (e) => {
                      e.preventDefault(); const f = mform(g.id);
                      if (await post({ kind: "member", groupId: g.id, userId: f.userId, permissions: f.permissions })) setNm({ ...nm, [g.id]: undefined });
                    }}>
                      <div className="field"><label htmlFor={`gm-u-${g.id}`}>کاربر</label>
                        <select id={`gm-u-${g.id}`} required value={mform(g.id).userId} onChange={(e) => {
                          const have = g.members.find((m) => m.userId === e.target.value);
                          setNm({ ...nm, [g.id]: { userId: e.target.value, permissions: have ? have.permissions : mform(g.id).permissions } });
                        }}>
                          <option value="">—</option>
                          {data.users.filter((u) => u.active).map((u) => <option key={u.id} value={u.id}>{u.name}{u.email && u.email !== u.name ? ` (${u.email})` : ""}</option>)}
                        </select></div>
                      <div className="permgrid" role="group" aria-label="دسترسی‌ها">
                        {Object.entries(data.permissions).map(([k, v]) => (
                          <label key={k} title={PERM_HELP[k]}><input type="checkbox" checked={mform(g.id).permissions.includes(k)} onChange={(e) => {
                            const f = mform(g.id);
                            setNm({ ...nm, [g.id]: { ...f, permissions: e.target.checked ? [...f.permissions, k] : f.permissions.filter((x) => x !== k) } });
                          }} /> {v}</label>
                        ))}
                      </div>
                      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                        <button className="btn" type="submit">ذخیرهٔ عضو</button>
                        <button className="btn ghost" type="button" onClick={() => post({ kind: "group-remove", groupId: g.id })}>حذف گروه</button>
                      </div>
                    </form>
                  </details>
                </div>
              ))}
              <details className="inlinefold"><summary>افزودن گروه به این مرحله</summary>
                <form onSubmit={async (e) => {
                  e.preventDefault(); const f = gform(st.id);
                  if (await post({ kind: "group", stageId: st.id, ...f })) setNg({ ...ng, [st.id]: undefined });
                }}>
                  <div className="grid2">
                    <div className="field"><label htmlFor={`g-seq-${st.id}`}>اولویت (۱ = اول)</label><input id={`g-seq-${st.id}`} type="number" min={1} dir="ltr" required
                      value={gform(st.id).seq} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), seq: e.target.value } })} /></div>
                    <div className="field"><label htmlFor={`g-name-${st.id}`}>نام گروه</label><input id={`g-name-${st.id}`} required
                      value={gform(st.id).name} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), name: e.target.value } })} /></div>
                    <div className="field"><label htmlFor={`g-title-${st.id}`}>عنوان (در کادر امضا)</label><input id={`g-title-${st.id}`}
                      value={gform(st.id).title} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), title: e.target.value } })} /></div>
                    <div className="field"><label htmlFor={`g-desc-${st.id}`}>شرح</label><input id={`g-desc-${st.id}`}
                      value={gform(st.id).description} onChange={(e) => setNg({ ...ng, [st.id]: { ...gform(st.id), description: e.target.value } })} /></div>
                  </div>
                  <button className="btn" type="submit">ذخیرهٔ گروه</button>
                </form>
              </details>
            </div>
          ))}
          <Fold title="افزودن مرحله یا تغییر نام آن">
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "stage", reportTypeId: type.id, ...ns })) setNs({ seq: "", name: "" }); }}>
              <div className="grid2">
                <div className="field"><label htmlFor="st-seq">ترتیب مرحله</label><input id="st-seq" type="number" min={1} dir="ltr" required value={ns.seq} onChange={(e) => setNs({ ...ns, seq: e.target.value })} /></div>
                <div className="field"><label htmlFor="st-name">نام مرحله</label><input id="st-name" required value={ns.name} onChange={(e) => setNs({ ...ns, name: e.target.value })} /></div>
              </div>
              <button className="btn" type="submit">ذخیرهٔ مرحله</button>
            </form>
          </Fold>
          <p className="muted sm">اولویت گروه‌ها ترتیب نمایش و چاپ کادرهای امضاست. هر تغییر در این صفحه در «لاگ و گردش» این بخش ثبت می‌شود.</p>
        </div>
      )}
    </div>
  );
}
