"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import Tabs from "../../../components/ui/Tabs";
import TreeEditor, { flatten } from "../../../components/ui/TreeEditor";

import TableKit from "../../../components/ui/TableKit";
/**
 * Step 2 of the organisation's process: one contract's currencies (at the
 * contract's own rate) and budget, its stakeholders, its addenda and
 * extensions, and its category trees for resources and the narrative.
 * Everything a budget row shows beyond its forecast is derived.
 */
const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("fa-IR", { maximumFractionDigits: 2 }));

export default function ContractSetupPage() {
  const { projectId, contractId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/org?projectId=${id}${contractId ? `&contractId=${contractId}` : ""}`, [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/org", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const may = data.may.contract;
  const C = data.contract;
  return (
    <div className="page">
      <div className="pagehead"><h1>تعریف قرارداد</h1>
        <span className="sub">ارز و بودجه، ذی‌نفعان، الحاقیه و تمدید، و دسته‌های منابع و شرح کار — مرحلهٔ ۲ فرایند سازمان</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {data.contracts.length === 0 ? <p className="empty-note">هنوز قراردادی نیست؛ از «قراردادها و پیمان‌ها» قرارداد ایجاد کنید.</p>
        : !C && <p className="empty-note">قرارداد را از فهرست بالای صفحه انتخاب کنید.</p>}
      {C && <p className="sm"><b>قرارداد {C.contract.contract_no}</b> — {C.contract.title}</p>}
      {C && (
        <Tabs name="contract-setup" key={contractId}>
          <Budget data={data} C={C} may={may} post={post} />
          <Parties data={data} C={C} may={may} post={post} />
          <Amendments data={data} C={C} may={may} post={post} />
          <Trees data={data} C={C} may={may} post={post} />
        </Tabs>
      )}
    </div>
  );
}

function Budget({ data, C, may, post }) {
  const [f, setF] = useState({ currency: "", rate: "", budget: "", doneTyped: "" });
  const main = C.contract.currency;
  return (
    <div className="card">
      <h2>ارز و بودجهٔ قرارداد</h2>
      <p className="sm muted">نرخ هر ارز همان است که قرارداد تعیین می‌کند (خالی: نرخ پروژه). وزن = بودجه × نرخ ÷ جمع؛ کاهش، افزایش و آیتم‌های جدید از الحاقیه‌ها؛
        انجام‌شده در ارز اصلی قرارداد ({main}) از صورت‌وضعیت‌های تأییدشده و در ارزهای دیگر دستی (با برچسب «دستی»).</p>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "contract-currency", ...f }, () => `${f.currency} ثبت شد.`)) setF({ currency: "", rate: "", budget: "", doneTyped: "" }); }}>
          <div className="field"><label htmlFor="cc-cur">ارز</label><select id="cc-cur" required value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
            <option value="">—</option>{data.currencies.map((x) => <option key={x.code} value={x.code}>{x.code} ({Number(x.rate)})</option>)}</select></div>
          <div className="field"><label htmlFor="cc-rate">نرخ قراردادی</label><input id="cc-rate" dir="ltr" inputMode="decimal" value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} placeholder="نرخ پروژه" /></div>
          <div className="field"><label htmlFor="cc-b">بودجهٔ پیش‌بینی</label><input id="cc-b" dir="ltr" required inputMode="decimal" value={f.budget} onChange={(e) => setF({ ...f, budget: e.target.value })} /></div>
          {f.currency && f.currency !== main && <div className="field"><label htmlFor="cc-d">انجام‌شده (دستی)</label><input id="cc-d" dir="ltr" inputMode="decimal" value={f.doneTyped} onChange={(e) => setF({ ...f, doneTyped: e.target.value })} /></div>}
          <button className="btn" type="submit">ثبت</button>
        </form>)}
      {data.currencies.length === 0 && <p className="empty-note">ارزها را اول در «تعریف پروژه» ثبت کنید.</p>}
      <div className="tablewrap"><TableKit name="contracts-setup-1"><table className="dtable">
        <thead><tr><th>ارز</th><th>نرخ</th><th>بودجهٔ پیش‌بینی</th><th>وزن</th><th>انجام‌شده</th><th>باقی‌مانده</th><th>کاهش</th><th>افزایش</th><th>آیتم‌های جدید</th><th>کل بودجهٔ مورد نیاز</th><th>به واحد پایه</th>{may && <th />}</tr></thead>
        <tbody>{C.budget.rows.map((r) => (
          <tr key={r.currency}><td className="mono">{r.currency}</td><td className="mono" dir="ltr">{r.rate}</td><td className="mono">{fmt(r.forecast)}</td>
            <td className="mono">{r.weightPct == null ? "—" : `${r.weightPct}٪`}</td>
            <td className="mono">{fmt(r.done)}{r.doneSource && <div className="sm muted">{r.doneSource === "statements" ? "از صورت‌وضعیت‌ها" : "دستی"}</div>}</td>
            <td className="mono">{fmt(r.remaining)}</td><td className="mono">{fmt(r.decrease)}</td><td className="mono">{fmt(r.increase)}</td><td className="mono">{fmt(r.newItems)}</td>
            <td className="mono"><b>{fmt(r.needed)}</b></td><td className="mono">{fmt(r.base.needed)}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ currency: r.currency, rate: String(r.rate), budget: String(r.forecast),
              doneTyped: r.doneSource === "typed" ? String(r.done) : "" })}>ویرایش</button></td>}</tr>))}
          {C.budget.rows.length > 0 && <tr><td colSpan={2}><b>جمع (واحد پایه)</b></td><td className="mono">{fmt(C.budget.total.forecast)}</td><td /><td className="mono">{fmt(C.budget.total.done)}</td>
            <td colSpan={4} /><td /><td className="mono"><b>{fmt(C.budget.total.needed)}</b></td></tr>}
        </tbody></table></TableKit></div>
      <p className="sm">مدت قرارداد: {C.contract.start_on ? String(C.contract.start_on).slice(0, 10) : "—"} تا {C.contract.end_on ? String(C.contract.end_on).slice(0, 10) : "—"}
        {C.revised && C.revised.days !== 0 && <> · پس از تمدیدها: <b>{C.revised.endOn}</b> ({C.revised.days > 0 ? "+" : ""}{C.revised.days} روز)</>}</p>
    </div>
  );
}

function Parties({ data, C, may, post }) {
  const BLANK = { id: null, companyId: "", role: "employer", note: "" };
  const [f, setF] = useState(BLANK);
  const [p, setP] = useState({ employerId: C.contract.employer_company_id || "", contractorId: C.contract.contractor_company_id || "" });
  const R = data.labels.contractRoles;
  const pick = (id, v, on) => (
    <select id={id} value={v} disabled={!may} onChange={(e) => on(e.target.value)}>
      <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select>);
  return (
    <div className="card">
      <h2>کارفرما و پیمانکار</h2>
      <p className="sm muted">از فهرست شرکت‌های «تعریف پروژه». هر دو در ذی‌نفعان قرارداد با همین نقش ثبت می‌شوند و فقط کاربرانِ شرکت‌های ذی‌نفع به قرارداد تخصیص داده می‌شوند.</p>
      {data.companies.length === 0 ? <p className="empty-note">اول در «تعریف پروژه ◄ شرکت‌ها» شرکت تعریف کنید.</p> : (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={(e) => { e.preventDefault(); post({ kind: "contract-parties", ...p }, () => "کارفرما و پیمانکار ثبت شد."); }}>
          <div className="field"><label htmlFor="cp-e">کارفرما</label>{pick("cp-e", p.employerId, (v) => setP({ ...p, employerId: v }))}</div>
          <div className="field"><label htmlFor="cp-c">پیمانکار</label>{pick("cp-c", p.contractorId, (v) => setP({ ...p, contractorId: v }))}</div>
          {may && <button className="btn" type="submit">ثبت کارفرما و پیمانکار</button>}
        </form>)}
      <h2 style={{ marginTop: 16 }}>ذی‌نفعان قرارداد</h2>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "contract-stakeholder", ...f }, () => (f.id ? "ویرایش شد." : "اضافه شد."))) setF(BLANK); }}>
          <div className="field"><label htmlFor="cs-co">شرکت</label><select id="cs-co" required value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
            <option value="">—</option>{data.companies.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}</select></div>
          <div className="field"><label htmlFor="cs-role">نقش</label><select id="cs-role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {Object.entries(R).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
          <div className="field"><label htmlFor="cs-note">توضیح</label><input id="cs-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? "ذخیرهٔ تغییرات" : "افزودن"}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>انصراف</button>}
        </form>)}
      {C.stakeholders.length === 0 ? <p className="empty-note">ثبت نشده.</p> : (
        <TableKit name="contracts-setup-2"><table className="dtable"><thead><tr><th>نقش</th><th>شرکت</th><th>توضیح</th>{may && <th />}</tr></thead>
          <tbody>{C.stakeholders.map((s) => <tr key={s.id}><td>{R[s.role]}</td><td><span className="mono">{s.code}</span> — {s.name}</td><td className="sm">{s.note || "—"}</td>
            {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: s.id, companyId: s.company_id, role: s.role, note: s.note || "" })}>ویرایش</button>
              <button className="btn ghost sm" type="button" onClick={() => post({ kind: "contract-stakeholder-remove", id: s.id })}>حذف</button></td>}</tr>)}</tbody></table></TableKit>)}
    </div>
  );
}

function Amendments({ data, C, may, post }) {
  const BLANK = { id: null, amendmentNo: "", amendmentKind: "time", title: "", signedOn: "", days: "", note: "", lines: [] };
  const [f, setF] = useState(BLANK);
  const K = data.labels.amendmentKinds;
  const curs = C.budget.rows.map((r) => r.currency);
  const money = f.amendmentKind !== "time", time = f.amendmentKind !== "financial";
  return (
    <div className="card">
      <h2>الحاقیه‌ها و تمدید</h2>
      {may && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "amendment", ...f, days: time ? f.days : 0, lines: money ? f.lines : [] }, () => (f.id ? "الحاقیه اصلاح شد." : "الحاقیه ثبت شد."))) setF(BLANK); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="am-no">شمارهٔ الحاقیه</label><input id="am-no" required value={f.amendmentNo} onChange={(e) => setF({ ...f, amendmentNo: e.target.value })} /></div>
            <div className="field"><label htmlFor="am-k">نوع</label><select id="am-k" value={f.amendmentKind} onChange={(e) => setF({ ...f, amendmentKind: e.target.value })}>
              {Object.entries(K).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
            <div className="field"><label htmlFor="am-t">عنوان</label><input id="am-t" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></div>
            <div className="field"><label htmlFor="am-s">تاریخ امضا</label><input id="am-s" type="date" value={f.signedOn} onChange={(e) => setF({ ...f, signedOn: e.target.value })} /></div>
            {time && <div className="field"><label htmlFor="am-d">افزایش (+) یا کاهش (−) مدت، روز</label><input id="am-d" dir="ltr" required inputMode="numeric" value={f.days} onChange={(e) => setF({ ...f, days: e.target.value })} /></div>}
          </div>
          {money && (
            <div>
              {f.lines.map((l, i) => (
                <div key={i} className="row" style={{ gap: 8, alignItems: "end" }}>
                  <div className="field"><label htmlFor={`al-c${i}`}>ارز</label><select id={`al-c${i}`} value={l.currency} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, currency: e.target.value } : x)) })}>
                    <option value="">—</option>{curs.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div className="field"><label htmlFor={`al-k${i}`}>نوع</label><select id={`al-k${i}`} value={l.kind} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, kind: e.target.value } : x)) })}>
                    <option value="change">افزایش / کاهش بودجه</option><option value="new_items">بودجهٔ آیتم‌های جدید</option></select></div>
                  <div className="field"><label htmlFor={`al-a${i}`}>مبلغ (+ / −)</label><input id={`al-a${i}`} dir="ltr" inputMode="decimal" value={l.amount} onChange={(e) => setF({ ...f, lines: f.lines.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)) })} /></div>
                  <button className="btn ghost sm" type="button" onClick={() => setF({ ...f, lines: f.lines.filter((_, j) => j !== i) })}>×</button>
                </div>))}
              <button className="btn ghost sm" type="button" onClick={() => setF({ ...f, lines: [...f.lines, { currency: curs[0] || "", kind: "change", amount: "" }] })}>+ ردیف مبلغ</button>
            </div>)}
          <div className="field"><label htmlFor="am-n">توضیح</label><input id="am-n" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
          <button className="btn" type="submit">{f.id ? "ذخیرهٔ اصلاح الحاقیه" : "ثبت الحاقیه"}</button>
          {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>انصراف</button>}
        </form>)}
      {C.amendments.length === 0 ? <p className="empty-note">الحاقیه‌ای ثبت نشده.</p> : (
        <TableKit name="contracts-setup-3"><table className="dtable"><thead><tr><th>شماره</th><th>نوع</th><th>عنوان</th><th>تاریخ</th><th>مدت</th><th>مبالغ</th>{may && <th />}</tr></thead>
          <tbody>{C.amendments.map((a) => (
            <tr key={a.id}><td className="mono">{a.amendment_no}</td><td>{K[a.kind]}</td><td>{a.title}</td><td className="mono">{a.signed_on ? String(a.signed_on).slice(0, 10) : "—"}</td>
              <td className="mono">{a.days ? `${a.days > 0 ? "+" : ""}${a.days} روز` : "—"}</td>
              <td className="sm">{a.lines.length ? a.lines.map((l) => <div key={l.id}>{l.kind === "new_items" ? "آیتم جدید" : Number(l.amount) > 0 ? "افزایش" : "کاهش"} {fmt(Math.abs(Number(l.amount)))} {l.currency}</div>) : "—"}</td>
              {may && <td><button className="btn ghost sm" type="button" onClick={() => setF({ id: a.id, amendmentNo: a.amendment_no, amendmentKind: a.kind, title: a.title,
                signedOn: a.signed_on ? String(a.signed_on).slice(0, 10) : "", days: a.days ? String(a.days) : "", note: a.note || "",
                lines: a.lines.map((l) => ({ currency: l.currency, kind: l.kind, amount: String(Number(l.amount)) })) })}>ویرایش</button></td>}</tr>))}</tbody></table></TableKit>)}
    </div>
  );
}

function Trees({ data, C, may, post }) {
  const [tree, setTree] = useState("resource");
  const [f, setF] = useState({ name: "", discipline: "", parentId: "" });
  const nodes = C.trees[tree];
  return (
    <div className="card">
      <h2>دسته‌های منابع، شرح کار و گروه‌های اجرایی</h2>
      <div className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <div className="field"><label htmlFor="tr-t">درخت</label><select id="tr-t" value={tree} onChange={(e) => { setTree(e.target.value); setF({ ...f, parentId: "" }); /* a branch of one tree is no parent in another */ }}>
          {Object.entries(data.labels.trees).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      </div>
      {may && (
        <form className="row" style={{ gap: 8, alignItems: "end", flexWrap: "wrap" }}
          onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "category", tree, ...f }, (r) => `«${r.row.name}» اضافه شد.`)) setF({ ...f, name: "" }); }}>
          <div className="field"><label htmlFor="tr-n">نام دسته (رشته یا گروه کاری)</label><input id="tr-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="field"><label htmlFor="tr-d">دیسیپلین</label><input id="tr-d" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value })} /></div>
          <div className="field"><label htmlFor="tr-p">زیر</label><select id="tr-p" value={f.parentId} onChange={(e) => setF({ ...f, parentId: e.target.value })}>
            <option value="">— بالاترین سطح —</option>{flatten(nodes).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></div>
          <button className="btn" type="submit">افزودن</button>
        </form>)}
      <TreeEditor nodes={nodes} editable={may} label="دسته" onMove={(id, parentId) => post({ kind: "category-move", id, parentId }, () => "جابه‌جا شد.")}
        render={(n) => <><span className="mono sm muted">{n.seq}.</span> {n.name}{n.discipline && <span className="sm muted"> · {n.discipline}</span>}</>}
        actions={may ? (n) => <>
          <button className="btn ghost sm" type="button" onClick={() => {
            const name = prompt("نام دسته", n.name); if (name === null) return;
            const discipline = prompt("دیسیپلین", n.discipline || ""); if (discipline === null) return;
            const seq = prompt("ترتیب نمایش در همین شاخه", String(n.seq ?? "")); if (seq === null) return;
            post({ kind: "category-rename", id: n.id, name, discipline, seq }, () => "ویرایش شد.");
          }}>ویرایش</button>
          <button className="btn ghost sm" type="button" onClick={() => post({ kind: "category-remove", id: n.id }, () => "حذف شد.")}>حذف</button></> : null} />
    </div>
  );
}
