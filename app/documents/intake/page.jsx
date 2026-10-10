"use client";
import { useMemo, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import Tabs from "../../../components/ui/Tabs";

/**
 * Reading received documents into the registers. An approved revision
 * (code 1 or 2) is read when the reply is sent, or here on demand; what it
 * shows is proposed against the registers and a person applies it.
 */
const ACTION = { new: ["ok", "تازه"], update: ["", "تکمیل"], conflict: ["bad", "تناقض"], same: ["muted", "بی‌تغییر"] };
const STATUS = { read: "خوانده شد", "needs-ocr": "اسکن — نیاز به OCR", unsupported: "نوع فایل پشتیبانی نمی‌شود", failed: "خطا در خواندن" };
const DECISION = { pending: "منتظر تصمیم", applied: "اعمال شد", rejected: "رد شد" };

export default function IntakePage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/doc-intake?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [open, setOpen] = useState(null);

  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/doc-intake", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.edit;
  const pending = data.docs.reduce((n, d) => n + d.items.filter((i) => i.decision === "pending" && i.action !== "same").length, 0);
  const doc = data.docs.find((d) => d.revision_id === open) || null;

  return (
    <div className="page">
      <div className="pagehead"><h1>خواندن مدارک</h1>
        <span className="sub">مدرکی که کد ۱ یا ۲ گرفته خوانده می‌شود؛ تغییرهای پیشنهادی رجیسترها تا تأیید شما اعمال نمی‌شوند</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      <div className="moneyrow">
        <div><span>مدارک تأییدشده با فایل</span><b>{data.docs.filter((d) => d.approved).length}</b></div>
        <div><span>خوانده‌شده</span><b>{data.docs.filter((d) => d.run?.status === "read").length}</b></div>
        <div><span>نیاز به OCR</span><b>{data.docs.filter((d) => d.run?.status === "needs-ocr").length}</b></div>
        <div><span>ردیف منتظر تصمیم</span><b>{pending}</b></div>
      </div>

      <Tabs name="intake">
        <div className="card" data-badge={pending || undefined}>
          <h2>مدارک</h2>
          {data.docs.length === 0 ? <p className="empty-note">هنوز مدرکی با فایل از طراح دریافت نشده است.</p> : (
            <div className="tablewrap"><table className="dtable">
              <thead><tr><th>مدرک</th><th>رویژن</th><th>کد</th><th>خواندن</th><th>تازه</th><th>تکمیل</th><th>تناقض</th><th>منتظر</th><th /></tr></thead>
              <tbody>{data.docs.map((d) => {
                const n = (a) => d.items.filter((i) => i.action === a).length;
                return (
                  <tr key={d.revision_id} style={open === d.revision_id ? { background: "var(--hl, #eef6f8)" } : undefined}>
                    <td><b className="mono"><bdi>{d.doc_no}</bdi></b><div className="sm muted"><bdi>{d.title}</bdi></div></td>
                    <td className="mono">{d.revision}</td>
                    <td>{d.approved ? `کد ${d.approved}` : <span className="muted">تأیید نشده</span>}</td>
                    <td className="sm">{d.run ? <>{STATUS[d.run.status]}{d.run.doc_no_seen === false && <div className="err sm">شمارهٔ مدرک در فایل دیده نشد</div>}</> : <span className="muted">خوانده نشده</span>}</td>
                    <td>{n("new") || ""}</td><td>{n("update") || ""}</td><td style={n("conflict") ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{n("conflict") || ""}</td>
                    <td>{d.items.filter((i) => i.decision === "pending" && i.action !== "same").length || ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {d.run && <button className="btn ghost sm" type="button" onClick={() => setOpen(open === d.revision_id ? null : d.revision_id)}>{open === d.revision_id ? "بستن" : "بررسی"}</button>}
                      {may && d.approved && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "read", revisionId: d.revision_id },
                        (r) => `${d.doc_no}: ${STATUS[r.status]} — ${r.items} ردیف`)}>{d.run ? "خواندن دوباره" : "خواندن"}</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></div>
          )}
          {doc && <Proposal doc={doc} kinds={data.kinds} may={may} post={post} />}
        </div>

        <PatternsCard data={data} may={may} post={post} />
      </Tabs>
    </div>
  );
}

function Proposal({ doc, kinds, may, post }) {
  const [kind, setKind] = useState("");
  const [show, setShow] = useState("todo");
  const [sel, setSel] = useState(() => new Set());
  const [reason, setReason] = useState("");
  const items = doc.items.filter((i) => (!kind || i.kind === kind) && (show === "all" || (show === "todo" ? i.decision === "pending" && i.action !== "same" : i.action === "same")));
  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const pendingIds = items.filter((i) => i.decision === "pending").map((i) => i.id);
  const act = async (decision) => {
    const ids = [...sel];
    if (await post({ kind: "decide", itemIds: ids, decision, reason }, (r) => `${r.done} ردیف ${decision === "applied" ? "اعمال" : "رد"} شد${r.errors?.length ? ` — خطا: ${r.errors.join(" | ")}` : ""}`)) { setSel(new Set()); setReason(""); }
  };
  const r = doc.run;
  return (
    <div style={{ marginTop: 16 }}>
      <h3><bdi>{doc.doc_no}</bdi> Rev.{doc.revision} — {STATUS[r.status]}</h3>
      <p className="sm muted">روش: {r.method === "pdf-text" ? "لایهٔ متن PDF" : r.method === "xlsx" ? "اکسل" : "—"}{r.pages ? ` · ${r.pages} صفحه` : ""}
        {r.scanned_pages?.length ? ` · صفحه‌های اسکن (بدون متن): ${r.scanned_pages.join("، ")}` : ""} · {String(r.created_at).slice(0, 16).replace("T", " ")} {r.by_name ? `· ${r.by_name}` : ""}</p>
      {r.status === "needs-ocr" && <p className="sm">این فایل تصویر اسکن است و لایهٔ متن ندارد. خواندن آن به OCR نیاز دارد (فاز ۲)؛ چیزی از آن حدس زده نشده است.</p>}
      {r.error && <p className="err sm">{r.error}</p>}
      {r.ambiguous?.length > 0 && <p className="sm">شکل این شماره‌ها با دو نوع از قالب‌های پروژه یکی است و تصمیمی گرفته نشد: {r.ambiguous.map((a) => <span key={a.token} className="mono"> {a.token} ({a.kinds.map((k) => kinds[k]).join("/")})</span>)}</p>}
      {r.unknown_format?.length > 0 && <p className="sm">با هیچ قالب پروژه نمی‌خواند (اعمال نمی‌شود — اگر درست است، قالبش را اضافه کنید): {r.unknown_format.map((u) => <span key={u.value + u.where} className="mono"> {u.value}</span>)}</p>}
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="ik">نوع</label><select id="ik" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">همه</option>{Object.entries(kinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="is">نمایش</label><select id="is" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="todo">منتظر تصمیم</option><option value="same">بی‌تغییر (فقط ارجاع)</option><option value="all">همه</option></select></div>
        {may && <button className="btn ghost sm" type="button" onClick={() => setSel(new Set(pendingIds))}>انتخاب همه ({pendingIds.length})</button>}
      </div>
      <div className="tablewrap"><table className="dtable">
        <thead><tr>{may && <th />}<th>نوع</th><th>شماره</th><th>وضعیت</th><th>تغییر</th><th>محل در فایل</th><th>تصمیم</th></tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id}>
            {may && <td>{i.decision === "pending" && <input type="checkbox" aria-label={`انتخاب ${i.key}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} />}</td>}
            <td className="sm">{kinds[i.kind]}</td>
            <td className="mono"><bdi>{i.key}</bdi></td>
            <td><span className={`pill ${ACTION[i.action][0]}`}>{ACTION[i.action][1]}</span></td>
            <td className="sm">{i.changes.length === 0 ? "—" : i.changes.map((c) => (
              <div key={c.attr}>{c.attr === "service" ? "سرویس" : c.attr === "class" ? "کلاس" : c.attr === "subsystem" ? "ساب‌سیستم" : "سیستم"}:
                {c.from != null && <> <s className="muted"><bdi>{c.from}</bdi></s> ←</>} <b><bdi>{c.to}</bdi></b></div>))}
              {Object.keys(i.disagree || {}).length > 0 && <div className="err sm">فایل دو مقدار نوشته: {Object.entries(i.disagree).map(([a, v]) => `${a}: ${v.join(" / ")}`).join(" · ")}</div>}</td>
            <td className="sm mono">{i.seen_at.slice(0, 4).join("، ")}{i.seen_at.length > 4 ? "…" : ""}</td>
            <td className="sm">{DECISION[i.decision]}{i.reason && <div className="muted">{i.reason}</div>}</td>
          </tr>
        ))}</tbody>
      </table></div>
      {may && sel.size > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ir">دلیل (برای رد، و برای اعمال تناقض لازم است)</label>
            <input id="ir" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          <button className="btn" type="button" onClick={() => act("applied")}>اعمال {sel.size} ردیف در رجیسترها</button>
          <button className="btn ghost" type="button" onClick={() => act("rejected")}>رد</button>
        </div>
      )}
    </div>
  );
}

function PatternsCard({ data, may, post }) {
  const [f, setF] = useState({ patternKind: "equipment", example: "" });
  const byKind = useMemo(() => Object.keys(data.kinds).map((k) => [k, data.patterns.filter((p) => p.kind === k)]), [data]);
  return (
    <div className="card">
      <h2>قالب شماره‌ها</h2>
      <p className="sm">پلتفرم شماره‌ها را فقط با «شکل»هایی می‌شناسد که پروژه دارد: رقم ← 9، حرف ← A، جداکننده‌ها همان‌طور (مثلاً <span className="mono" dir="ltr">30-E-1101A → 99-A-9999A</span>).
        شکل‌ها از رجیسترهای موجود یاد گرفته می‌شوند (هر شکلی که دست‌کم دو بار تکرار شده) یا با یک نمونه اضافه می‌شوند.</p>
      {data.shared.length > 0 && <p className="err sm">این شکل‌ها بین دو نوع مشترک است و شماره‌هایشان تصمیم‌گیری نمی‌شود: {data.shared.map((s) => `${s.shape} (${s.kinds.map((k) => data.kinds[k]).join("/")})`).join(" · ")}</p>}
      {may && <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <button className="btn ghost" type="button" onClick={() => post({ kind: "learn" }, (r) => `${r.added} شکل تازه از رجیسترها یاد گرفته شد.`)}>یادگیری از رجیسترها</button>
        <div className="field"><label htmlFor="pk">نوع</label><select id="pk" value={f.patternKind} onChange={(e) => setF({ ...f, patternKind: e.target.value })}>
          {Object.entries(data.kinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="pe">نمونهٔ شماره</label><input id="pe" dir="ltr" value={f.example} onChange={(e) => setF({ ...f, example: e.target.value })} placeholder="30-E-1101A" /></div>
        <button className="btn" type="button" onClick={async () => { if (await post({ kind: "pattern", ...f }, (r) => `شکل ${r.pattern.shape} اضافه شد.`)) setF({ ...f, example: "" }); }}>افزودن</button>
      </div>}
      <div className="tablewrap"><table className="dtable">
        <thead><tr><th>نوع</th><th>شکل</th><th>نمونه</th><th>منبع</th><th>وضعیت</th></tr></thead>
        <tbody>{byKind.flatMap(([k, ps]) => ps.map((p) => (
          <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
            <td className="sm">{data.kinds[k]}</td><td className="mono" dir="ltr">{p.shape}</td><td className="mono" dir="ltr">{p.example}</td>
            <td className="sm">{p.source === "learned" ? "از رجیستر" : "نمونهٔ شخص"}</td>
            <td>{may ? <button className="btn ghost sm" type="button" onClick={() => post({ kind: "pattern-active", id: p.id, active: !p.active })}>{p.active ? "فعال — خاموش کن" : "خاموش — فعال کن"}</button> : (p.active ? "فعال" : "خاموش")}</td>
          </tr>)))}</tbody>
      </table></div>
      {data.patterns.length === 0 && <p className="empty-note">هنوز قالبی نیست — «یادگیری از رجیسترها» را بزنید یا یک نمونه اضافه کنید.</p>}
    </div>
  );
}
