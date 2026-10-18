"use client";
import { useEffect, useMemo, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import Tabs from "../../../components/ui/Tabs";

import TableKit from "../../../components/ui/TableKit";
/**
 * Reading received documents into the registers. An approved revision
 * (code 1 or 2) is read when the reply is sent, or here on demand; what it
 * shows is proposed against the registers and a person applies it.
 */
const ACTION = { new: ["ok", "تازه"], update: ["", "تکمیل"], conflict: ["bad", "تناقض"], same: ["muted", "بی‌تغییر"] };
const STATUS = { read: "خوانده شد", "needs-ocr": "اسکن — نیاز به OCR", queued: "در صف OCR…", unsupported: "نوع فایل پشتیبانی نمی‌شود", failed: "خطا در خواندن" };
const statusOf = (run) => (run.status === "queued" && run.stale ? "OCR متوقف شد (سرور دوباره راه افتاد) — دوباره بخوانید" : STATUS[run.status]);
const ATTR = { service: "سرویس", class: "کلاس", subsystem: "ساب‌سیستم", system: "سیستم", fluid: "کد سیال", insulation: "کد عایق",
  from: "از", to: "به", spec: "نوع کابل", length: "طول (m)", type: "نوع سازه", tonnage: "وزن (t)", drawing: "نقشه",
  pressure: "فشار طراحی (barg)", tmin: "کمینهٔ دمای طراحی (°C)", tmax: "بیشینهٔ دمای طراحی (°C)" };
const pct = (c) => (c == null ? "" : `${Math.round(Number(c) * 100)}٪`);
const DECISION = { pending: "منتظر تصمیم", applied: "اعمال شد", rejected: "رد شد" };

export default function IntakePage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/doc-intake?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [open, setOpen] = useState(null);
  // While a document waits for OCR, look again every few seconds.
  const waiting = !!data?.docs.some((d) => d.run?.status === "queued" && !d.run.stale);
  useEffect(() => {
    if (!waiting) return undefined;
    const t = setInterval(reload, 4000);
    return () => clearInterval(t);
  }, [waiting, reload]);

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
        <div><span>نیاز به OCR / در صف</span><b>{data.docs.filter((d) => d.run?.status === "needs-ocr" || d.run?.status === "queued").length}</b></div>
        <div><span>ردیف منتظر تصمیم</span><b>{pending}</b></div>
      </div>

      <Tabs name="intake">
        <div className="card" data-badge={pending || undefined}>
          <h2>مدارک</h2>
          <p className="sm muted">{data.ocr.engine ? `OCR روی سرور: ${data.ocr.version || data.ocr.engine} — اسکن‌ها در پس‌زمینه، یکی‌یکی خوانده می‌شوند.` : `OCR روی سرور در دسترس نیست: ${data.ocr.why}`}</p>
          {data.docs.length === 0 ? <p className="empty-note">هنوز مدرکی با فایل از طراح دریافت نشده است.</p> : (
            <div className="tablewrap"><TableKit name="documents-intake-1"><table className="dtable">
              <thead><tr><th>مدرک</th><th>رویژن</th><th>کد</th><th>خواندن</th><th>تازه</th><th>تکمیل</th><th>تناقض</th><th>منتظر</th><th /></tr></thead>
              <tbody>{data.docs.map((d) => {
                const n = (a) => d.items.filter((i) => i.action === a).length;
                return (
                  <tr key={d.revision_id} style={open === d.revision_id ? { background: "var(--hl, #eef6f8)" } : undefined}>
                    <td><b className="mono"><bdi>{d.doc_no}</bdi></b><div className="sm muted"><bdi>{d.title}</bdi></div></td>
                    <td className="mono">{d.revision}</td>
                    <td>{d.approved ? `کد ${d.approved}` : <span className="muted">تأیید نشده</span>}</td>
                    <td className="sm">{d.run ? <>{statusOf(d.run)}{d.run.method === "ocr" && d.run.status === "read" && <div className="muted">OCR{d.run.ocr_conf != null ? ` · اطمینان میانگین ${pct(d.run.ocr_conf)}` : ""}</div>}{d.run.doc_no_seen === false && <div className="err sm">شمارهٔ مدرک در فایل دیده نشد</div>}</> : <span className="muted">خوانده نشده</span>}</td>
                    <td>{n("new") || ""}</td><td>{n("update") || ""}</td><td style={n("conflict") ? { color: "var(--bad)", fontWeight: 700 } : undefined}>{n("conflict") || ""}</td>
                    <td>{d.items.filter((i) => i.decision === "pending" && i.action !== "same").length || ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {d.run && <button className="btn ghost sm" type="button" onClick={() => setOpen(open === d.revision_id ? null : d.revision_id)}>{open === d.revision_id ? "بستن" : "بررسی"}</button>}
                      {may && d.approved && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "read", revisionId: d.revision_id },
                        (r) => `${d.doc_no}: ${STATUS[r.status]} — ${r.items} ردیف`)}>{d.run ? "خواندن دوباره" : "خواندن"}</button>}
                      {may && d.approved && data.ocr.engine && d.run && (d.run.scanned_pages?.length > 0 || d.run.method === "ocr") && !(d.run.status === "queued" && !d.run.stale)
                        && <button className="btn ghost sm" type="button" onClick={() => post({ kind: "ocr", revisionId: d.revision_id },
                          () => `${d.doc_no} در صف OCR قرار گرفت؛ نتیجه همین‌جا نشان داده می‌شود.`)}>خواندن با OCR</button>}
                    </td>
                  </tr>
                );
              })}</tbody>
            </table></TableKit></div>
          )}
          {doc && <Proposal doc={doc} kinds={data.kinds} may={may} post={post} />}
        </div>

        <PatternsCard data={data} may={may} post={post} />
        <LegendCard data={data} may={may} post={post} />
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
      <h3><bdi>{doc.doc_no}</bdi> Rev.{doc.revision} — {statusOf(r)}</h3>
      <p className="sm muted">روش: {r.method === "pdf-text" ? "لایهٔ متن PDF" : r.method === "xlsx" ? "اکسل" : r.method === "ocr" ? `OCR (${r.engine || "—"})${r.ocr_pages?.length ? ` روی صفحهٔ ${r.ocr_pages.join("، ")}` : ""}${r.ocr_conf != null ? ` · اطمینان میانگین ${pct(r.ocr_conf)}` : ""}` : "—"}{r.pages ? ` · ${r.pages} صفحه` : ""}
        {r.scanned_pages?.length ? ` · صفحه‌های اسکن (بدون متن): ${r.scanned_pages.join("، ")}` : ""} · {String(r.created_at).slice(0, 16).replace("T", " ")} {r.by_name ? `· ${r.by_name}` : ""}</p>
      {r.status === "needs-ocr" && <p className="sm">این فایل تصویر اسکن است و لایهٔ متن ندارد؛ چیزی از آن حدس زده نشده است. با «خواندن با OCR» خوانده می‌شود.</p>}
      {r.method === "ocr" && r.status === "read" && <p className="sm">هر شماره‌ای که OCR اضافه یا عوض می‌کند «بررسی شود» است: با نقشه مقایسه کنید و با دلیل اعمال کنید. اطمینان OCR کنار هر ردیف آمده ولی به‌تنهایی درستی را نشان نمی‌دهد.</p>}
      {r.error && <p className="err sm">{r.error}</p>}
      {r.notes?.length > 0 && <div className="sm err">{r.notes.map((n) => <div key={n}>{n}</div>)}</div>}
      {r.ambiguous?.length > 0 && <p className="sm">شکل این شماره‌ها با دو نوع از قالب‌های پروژه یکی است و تصمیمی گرفته نشد: {r.ambiguous.map((a) => <span key={a.token} className="mono"> {a.token} ({a.kinds.map((k) => kinds[k]).join("/")})</span>)}</p>}
      {r.unknown_format?.length > 0 && <p className="sm">با هیچ قالب پروژه نمی‌خواند (اعمال نمی‌شود — اگر درست است، قالبش را اضافه کنید): {r.unknown_format.map((u) => <span key={u.value + u.where} className="mono"> {u.value}</span>)}</p>}
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="ik">نوع</label><select id="ik" value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="">همه</option>{Object.entries(kinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="is">نمایش</label><select id="is" value={show} onChange={(e) => setShow(e.target.value)}>
          <option value="todo">منتظر تصمیم</option><option value="same">بی‌تغییر (فقط ارجاع)</option><option value="all">همه</option></select></div>
        {may && <button className="btn ghost sm" type="button" onClick={() => setSel(new Set(pendingIds))}>انتخاب همه ({pendingIds.length})</button>}
      </div>
      <div className="tablewrap"><TableKit name="documents-intake-2"><table className="dtable">
        <thead><tr>{may && <th />}<th>نوع</th><th>شماره</th><th>وضعیت</th><th>تغییر</th><th>OCR</th><th>محل در فایل</th><th>تصمیم</th></tr></thead>
        <tbody>{items.map((i) => (
          <tr key={i.id}>
            {may && <td>{i.decision === "pending" && <input type="checkbox" aria-label={`انتخاب ${i.key}`} checked={sel.has(i.id)} onChange={() => toggle(i.id)} />}</td>}
            <td className="sm">{kinds[i.kind]}</td>
            <td className="mono"><bdi>{i.key}</bdi></td>
            <td><span className={`pill ${ACTION[i.action][0]}`}>{ACTION[i.action][1]}</span>
              {i.checks?.length > 0 && i.action !== "same" && <div><span className="pill warn">بررسی شود</span></div>}</td>
            <td className="sm">{i.changes.length === 0 ? "—" : i.changes.map((c) => (
              <div key={c.attr}>{ATTR[c.attr] || c.attr}:
                {c.from != null && <> <s className="muted"><bdi>{c.from}</bdi></s> ←</>} <b><bdi>{c.to}</bdi></b></div>))}
              {Object.keys(i.disagree || {}).length > 0 && <div className="err sm">فایل دو مقدار نوشته: {Object.entries(i.disagree).map(([a, v]) => `${ATTR[a] || a}: ${v.join(" / ")}`).join(" · ")}</div>}
              {Object.keys(i.unknown_codes || {}).length > 0 && <div className="err sm">در لجند پروژه نیست (پر نشد): {Object.entries(i.unknown_codes).map(([a, v]) => `${ATTR[a] || a} ${v.join("/")}`).join(" · ")}</div>}
              {i.attrs?.size && <div className="muted">سایز چاپ‌شده: {i.attrs.size}″</div>}
              {i.notes?.length > 0 && <div className="err sm">{i.notes.map((n) => <div key={n}>{n}</div>)}</div>}</td>
            <td className="sm">{i.confidence != null ? <>{pct(i.confidence)}
              {i.ocr_read && <div>چاپ‌شده: <bdi className="mono">{i.ocr_read}</bdi></div>}
              {i.suspect && <div className="err">شاید <bdi className="mono">{i.suspect}</bdi> در رجیستر</div>}</> : <span className="muted">—</span>}</td>
            <td className="sm mono">{i.seen_at.slice(0, 4).join("، ")}{i.seen_at.length > 4 ? "…" : ""}</td>
            <td className="sm">{DECISION[i.decision]}{i.reason && <div className="muted">{i.reason}</div>}</td>
          </tr>
        ))}</tbody>
      </table></TableKit></div>
      {may && sel.size > 0 && (
        <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap", marginTop: 8 }}>
          <div className="field" style={{ flex: 1 }}><label htmlFor="ir">دلیل (برای رد، تناقض و ردیف‌های «بررسی شود» لازم است)</label>
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
  const byKind = useMemo(() => Object.keys(data.patternKinds).map((k) => [k, data.patterns.filter((p) => p.kind === k)]), [data]);
  return (
    <div className="card">
      <h2>قالب شماره‌ها</h2>
      <p className="sm">پلتفرم شماره‌ها را فقط با «شکل»هایی می‌شناسد که پروژه دارد: رقم ← 9، حرف ← A، جداکننده‌ها همان‌طور (مثلاً <span className="mono" dir="ltr">30-E-1101A → 99-A-9999A</span>).
        شکل‌ها از رجیسترهای موجود یاد گرفته می‌شوند (هر شکلی که دست‌کم دو بار تکرار شده) یا با یک نمونه اضافه می‌شوند.</p>
      {data.shared.length > 0 && <p className="err sm">این شکل‌ها بین دو نوع مشترک است و شماره‌هایشان تصمیم‌گیری نمی‌شود: {data.shared.map((s) => `${s.shape} (${s.kinds.map((k) => data.kinds[k]).join("/")})`).join(" · ")}</p>}
      {may && <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <button className="btn ghost" type="button" onClick={() => post({ kind: "learn" }, (r) => `${r.added} شکل تازه از رجیسترها یاد گرفته شد.`)}>یادگیری از رجیسترها</button>
        <div className="field"><label htmlFor="pk">نوع</label><select id="pk" value={f.patternKind} onChange={(e) => setF({ ...f, patternKind: e.target.value })}>
          {Object.entries(data.patternKinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="pe">نمونهٔ شماره</label><input id="pe" dir="ltr" value={f.example} onChange={(e) => setF({ ...f, example: e.target.value })} placeholder="30-E-1101A" /></div>
        <button className="btn" type="button" onClick={async () => { if (await post({ kind: "pattern", ...f }, (r) => `شکل ${r.pattern.shape} اضافه شد.`)) setF({ ...f, example: "" }); }}>افزودن</button>
      </div>}
      <div className="tablewrap"><TableKit name="documents-intake-3"><table className="dtable">
        <thead><tr><th>نوع</th><th>شکل</th><th>نمونه</th><th>منبع</th><th>وضعیت</th></tr></thead>
        <tbody>{byKind.flatMap(([k, ps]) => ps.map((p) => (
          <tr key={p.id} style={p.active ? undefined : { opacity: 0.5 }}>
            <td className="sm">{data.kinds[k]}</td><td className="mono" dir="ltr">{p.shape}</td><td className="mono" dir="ltr">{p.example}</td>
            <td className="sm">{p.source === "learned" ? "از رجیستر" : "نمونهٔ شخص"}</td>
            <td>{may ? <button className="btn ghost sm" type="button" onClick={() => post({ kind: "pattern-active", id: p.id, active: !p.active })}>{p.active ? "فعال — خاموش کن" : "خاموش — فعال کن"}</button> : (p.active ? "فعال" : "خاموش")}</td>
          </tr>)))}</tbody>
      </table></TableKit></div>
      {data.patterns.length === 0 && <p className="empty-note">هنوز قالبی نیست — «یادگیری از رجیسترها» را بزنید یا یک نمونه اضافه کنید.</p>}
    </div>
  );
}

function LegendCard({ data, may, post }) {
  const L = data.legend;
  const [f, setF] = useState({ format: L.format?.format || "", example: L.format?.example || "", source: L.format?.source || "" });
  const [c, setC] = useState({ codeKind: "fluid", text: "", source: "" });
  return (
    <div className="card">
      <h2>لجند P&amp;ID</h2>
      <p className="sm">ساختار شمارهٔ لاین و کدهای سیال و عایق را از شیت لجند پروژه وارد کنید. با آن، از هر شمارهٔ لاین در نقشه، کلاس، کد سیال و کد عایق خوانده می‌شود.
        کدی که در لجند نباشد گزارش می‌شود و پر نمی‌شود.</p>
      <h3>ساختار شمارهٔ لاین</h3>
      <p className="sm">بخش‌ها: <span className="mono" dir="ltr">{"{size} {fluid} {number} {class} {insulation}"}</span>. بخشی که در رجیستر لاین «شمارهٔ لاین» است داخل <span className="mono">[ ]</span>؛
        بخشی که بعضی لاین‌ها ندارند داخل <span className="mono">( )</span>. مثال: <span className="mono" dir="ltr">{'{size}"-[{fluid}-{number}]-{class}(-{insulation})'}</span></p>
      {L.formatError && <p className="err sm">قالب ثبت‌شده دیگر معتبر نیست؛ دوباره ثبت کنید.</p>}
      {may ? (
        <form onSubmit={(e) => { e.preventDefault(); post({ kind: "line-format", ...f }, () => "ساختار شمارهٔ لاین ثبت شد."); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="lf">ساختار</label><input id="lf" dir="ltr" required value={f.format} onChange={(e) => setF({ ...f, format: e.target.value })} /></div>
            <div className="field"><label htmlFor="le">نمونه از نقشه</label><input id="le" dir="ltr" value={f.example} onChange={(e) => setF({ ...f, example: e.target.value })} placeholder={'8"-MP-140001-A1A-H'} /></div>
            <div className="field"><label htmlFor="ls">منبع (شمارهٔ شیت لجند)</label><input id="ls" dir="ltr" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} /></div>
          </div>
          <button className="btn" type="submit">ثبت ساختار</button>
        </form>
      ) : <p className="mono" dir="ltr">{L.format?.format || "—"}</p>}
      <h3 style={{ marginTop: 16 }}>کدهای لجند</h3>
      {may && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "codes", ...c }, (r) => `${r.added} کد ثبت شد.`)) setC({ ...c, text: "" }); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="ck">نوع</label><select id="ck" value={c.codeKind} onChange={(e) => setC({ ...c, codeKind: e.target.value })}>
              {Object.entries(L.codeKinds).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="cs">منبع</label><input id="cs" dir="ltr" value={c.source} onChange={(e) => setC({ ...c, source: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor="ct">هر سطر یک کد: کد = شرح (یا با Tab از اکسل)</label>
            <textarea id="ct" dir="ltr" rows={4} required value={c.text} onChange={(e) => setC({ ...c, text: e.target.value })} placeholder={"MP = MEDIUM PRESSURE STEAM\nCW = COOLING WATER"} /></div>
          <button className="btn" type="submit">افزودن کدها</button>
        </form>
      )}
      {L.codes.length === 0 ? <p className="empty-note">هنوز کدی ثبت نشده — تا ثبت نشود، کد سیال و عایق از نقشه پر نمی‌شود.</p> : (
        <div className="tablewrap"><TableKit name="documents-intake-4"><table className="dtable">
          <thead><tr><th>نوع</th><th>کد</th><th>شرح</th><th>منبع</th>{may && <th />}</tr></thead>
          <tbody>{L.codes.map((x) => (
            <tr key={x.id}><td className="sm">{L.codeKinds[x.kind]}</td><td className="mono">{x.code}</td><td className="sm" dir="ltr">{x.meaning}</td><td className="sm">{x.source || "—"}</td>
              {may && <td><button className="btn ghost sm" type="button" onClick={() => post({ kind: "code-remove", id: x.id })}>حذف</button></td>}</tr>
          ))}</tbody></table></TableKit></div>
      )}
    </div>
  );
}
