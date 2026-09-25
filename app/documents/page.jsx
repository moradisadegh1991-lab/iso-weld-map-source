"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * The master document register.
 *
 * The date picker is the point of the page: "which revision was in force,
 * and which one was construction to build to, on that day" has one answer,
 * read off the issue dates. Uploaded sheets are checked against it — a
 * weld register extracted from a superseded drawing is flagged here.
 */
const ITEM_STATE = { awaiting: ["", "در انتظار پاسخ"], overdue: ["bad", "معوق"], returned: ["ok", "پاسخ داده شد"], rejected: ["bad", "رد (کد ۳)"] };

export default function DocumentsPage() {
  const { projectId, role, call } = usePlatform();
  const [onDate, setOnDate] = useState("");
  const { data, error, reload } = useProjectData((id) => `/api/doc-control?projectId=${id}${onDate ? `&onDate=${onDate}` : ""}`, [onDate]);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const may = can({ role }, ACTIONS.CONTROL_DOCUMENTS);

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/doc-control", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const docs = data.documents;
  const ifc = docs.filter((d) => d.construction).length;
  const late = docs.filter((d) => d.lateness.daysLate > 0).length;
  const wrongSheets = data.sheets.filter((s) => s.ok === false);
  const overdue = data.transmittals.flatMap((t) => t.items).filter((i) => i.state === "overdue").length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>کنترل مدارک</h1>
        <span className="sub">{docs.length} مدرک در رجیستر · {data.transmittals.length} ترانسمیتال</span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="card">
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div className="field"><label htmlFor="ondate">وضعیت رجیستر در تاریخ</label>
            <input id="ondate" type="date" dir="ltr" value={onDate || data.today} onChange={(e) => setOnDate(e.target.value === data.today ? "" : e.target.value)} /></div>
          {onDate && <button className="btn ghost" onClick={() => setOnDate("")}>امروز</button>}
          <span className="muted sm">«رویژن ساخت» = آخرین رویژن IFC یا چون‌ساخت که تا آن روز صادر شده بود.</span>
        </div>
      </div>

      <div className="kpis">
        <Kpi v={`${ifc}/${docs.length}`} l="دارای رویژن ساخت (IFC)" />
        <Kpi v={late} l="IFC دیرتر از برنامه" tone={late ? "warn" : ""} />
        <Kpi v={wrongSheets.length} l="نقشهٔ بارگذاری‌شده از رویژن غیرمعتبر" b="رجیستر جوش را مرور کنید" tone={wrongSheets.length ? "bad" : "ok"} />
        <Kpi v={overdue} l="پاسخ معوق ترانسمیتال" tone={overdue ? "bad" : ""} />
      </div>

      {(wrongSheets.length > 0 || data.unregistered.length > 0) && (
        <div className="card" style={{ borderColor: "rgba(226,87,76,.5)" }}>
          <h2 style={{ color: "var(--bad)" }}>نقشه‌های بارگذاری‌شده در برابر رجیستر</h2>
          {wrongSheets.map((s) => (
            <p key={s.id} className="sm"><span className="mono">{s.docNo}</span> برگ {s.sheetNo}، بارگذاری {fa(s.uploadedOn)}: {s.reason}</p>
          ))}
          {data.unregistered.length > 0 && <p className="muted sm">در رجیستر نیستند (بررسی نشدند): {data.unregistered.join("، ")}</p>}
        </div>
      )}

      <div className="card">
        <h2>رجیستر مدارک (MDR)</h2>
        {docs.length === 0 ? <p className="empty-note">مدرکی ثبت نشده است.</p> : (
          <TableKit name="documents">
            <table className="dtable">
              <thead><tr><th>شماره</th><th>عنوان</th><th>رشته</th><th>رویژن جاری</th><th>رویژن ساخت</th><th>IFC برنامه</th><th /></tr></thead>
              <tbody>
                {docs.map((d) => [
                  <tr key={d.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{d.doc_no}{d.approval_required && <div className="muted sm">نیازمند تأیید کارفرما</div>}</td>
                    <td className="sm">{d.title}{d.tag_no && <div className="muted"><a href={`/asset?tag=${encodeURIComponent(d.tag_no)}`}>{d.tag_no}</a></div>}</td>
                    <td className="sm">{d.discipline || "—"}</td>
                    <td className="mono">{d.current ? `Rev.${d.current.revision} · ${d.current.purpose}` : "—"}</td>
                    <td className="mono">{d.construction ? <span className="pill ok">Rev.{d.construction.revision}</span> : <span className="pill">ندارد</span>}</td>
                    <td className="mono sm">{fa(d.planned_ifc_on)}{d.lateness.daysLate > 0 && <div><span className="pill warn">{d.lateness.daysLate} روز تأخیر</span></div>}</td>
                    <td><button className="btn ghost" onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? "بستن" : "رویژن‌ها"}</button></td>
                  </tr>,
                  open === d.id && (
                    <tr key={d.id + "-x"}><td colSpan={7}><Revisions d={d} data={data} post={post} may={may} /></td></tr>
                  ),
                ])}
              </tbody>
            </table>
          </TableKit>
        )}
        {may && <Fold title="مدرک جدید در رجیستر"><MdrForm data={data} post={post} /></Fold>}
      </div>

      <div className="card">
        <h2>ترانسمیتال‌ها</h2>
        {data.transmittals.length === 0 ? <p className="empty-note">ترانسمیتالی ارسال نشده است.</p> : data.transmittals.map((t) => (
          <div key={t.id} style={{ marginBottom: 10 }}>
            <p className="sm"><b className="mono">{t.transmittalNo}</b> به {t.toParty} · {t.purpose} · {fa(t.sentOn)}{t.responseDue && ` · مهلت پاسخ ${fa(t.responseDue)}`}</p>
            <TableKit name="documents"><table className="dtable">
              <thead><tr><th>مدرک</th><th>رویژن</th><th>وضعیت</th><th>پاسخ</th><th /></tr></thead>
              <tbody>{t.items.map((i) => {
                const [tone, label] = ITEM_STATE[i.state];
                return (
                  <tr key={i.id}>
                    <td className="mono">{i.docNo}</td><td className="mono">Rev.{i.revision} · {i.revPurpose}</td>
                    <td><span className={`pill ${tone}`}>{label}</span></td>
                    <td className="sm">{i.returnCode ? `${data.returnCodes[i.returnCode]} · ${fa(i.returnedOn)}${i.comment ? ` — ${i.comment}` : ""}` : "—"}</td>
                    <td>{may && !i.returnCode && <ReturnForm i={i} data={data} post={post} />}</td>
                  </tr>
                );
              })}</tbody>
            </table></TableKit>
          </div>
        ))}
        {may && <Fold title="ترانسمیتال جدید"><TransmittalForm data={data} post={post} /></Fold>}
      </div>
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function Revisions({ d, data, post, may }) {
  const [f, setF] = useState({ revision: "", purpose: "IFR", issuedOn: today(), note: "" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {d.revisions.length === 0 ? <p className="muted sm">رویژنی صادر نشده.</p> : (
        <ol className="sm" style={{ margin: 0 }}>
          {d.revisions.map((r) => (
            <li key={r.id}><span className="mono">Rev.{r.revision}</span> — {data.purposes[r.purpose]} — {fa(r.issuedOn)}
              {r.approvedCode && <span className="pill ok"> کد {r.approvedCode}</span>}{r.note && ` — ${r.note}`}</li>
          ))}
        </ol>
      )}
      {may && (
        <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}
              onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "revision", mdrId: d.id, ...f })) setF({ ...f, revision: "", note: "" }); }}>
          <Field id={`rv-${d.id}`} label="رویژن" value={f.revision} on={(v) => setF({ ...f, revision: v })} />
          <Select id={`rp-${d.id}`} label="هدف صدور" value={f.purpose} on={(v) => setF({ ...f, purpose: v })} opts={Object.entries(data.purposes)} />
          <Field id={`rd-${d.id}`} label="تاریخ صدور" type="date" value={f.issuedOn} on={(v) => setF({ ...f, issuedOn: v })} />
          <Field id={`rn-${d.id}`} label="یادداشت" value={f.note} on={(v) => setF({ ...f, note: v })} />
          <button className="btn" type="submit">صدور رویژن</button>
        </form>
      )}
    </div>
  );
}

function MdrForm({ data, post }) {
  const blank = { docNo: "", title: "", discipline: "", docType: "", originator: "EPC", subsystemId: "", approvalRequired: false, plannedIfcOn: "" };
  const [f, setF] = useState(blank);
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "document", ...f })) setF(blank); }}>
      <h2>مدرک جدید در رجیستر</h2>
      <div className="grid2">
        <Field id="md-no" label="شمارهٔ مدرک" value={f.docNo} on={(v) => setF({ ...f, docNo: v })} />
        <Field id="md-t" label="عنوان" value={f.title} on={(v) => setF({ ...f, title: v })} />
        <Field id="md-d" label="رشته" value={f.discipline} on={(v) => setF({ ...f, discipline: v })} />
        <Field id="md-y" label="نوع (P&ID، ISO، DS…)" value={f.docType} on={(v) => setF({ ...f, docType: v })} />
        <Select id="md-o" label="تهیه‌کننده" value={f.originator} on={(v) => setF({ ...f, originator: v })}
                opts={[["EPC", "EPC"], ["vendor", "فروشنده"], ["contractor", "پیمانکار"], ["client", "کارفرما"]]} />
        <Select id="md-s" label="ساب‌سیستم" value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v })} opts={data.subsystems.map((s) => [s.id, s.code])} blank="—" />
        <Field id="md-p" label="تاریخ برنامه‌ای IFC" type="date" value={f.plannedIfcOn} on={(v) => setF({ ...f, plannedIfcOn: v })} />
        <label className="sm" style={{ alignSelf: "end" }}><input type="checkbox" checked={f.approvalRequired} onChange={(e) => setF({ ...f, approvalRequired: e.target.checked })} /> تأیید کارفرما پیش از IFC لازم است</label>
      </div>
      <div><button className="btn" type="submit">ثبت در رجیستر</button></div>
    </form>
  );
}

function TransmittalForm({ data, post }) {
  const [f, setF] = useState({ transmittalNo: "", toParty: "", purpose: "approval", sentOn: today(), responseDue: "", picked: [] });
  const revs = data.documents.flatMap((d) => d.revisions.map((r) => ({ id: r.id, label: `${d.doc_no} Rev.${r.revision} (${r.purpose})` })));
  return (
    <form style={{ marginTop: 10 }} onSubmit={async (e) => { e.preventDefault();
      if (await post({ kind: "transmittal", ...f, revisionIds: f.picked })) setF({ ...f, transmittalNo: "", picked: [] }); }}>
      <h2>ترانسمیتال جدید</h2>
      <div className="grid2">
        <Field id="tr-no" label="شمارهٔ ترانسمیتال" value={f.transmittalNo} on={(v) => setF({ ...f, transmittalNo: v })} />
        <Field id="tr-to" label="گیرنده" value={f.toParty} on={(v) => setF({ ...f, toParty: v })} />
        <Select id="tr-p" label="هدف" value={f.purpose} on={(v) => setF({ ...f, purpose: v })}
                opts={[["review", "بررسی"], ["approval", "تأیید"], ["construction", "ساخت"], ["information", "اطلاع"]]} />
        <Field id="tr-d" label="تاریخ ارسال" type="date" value={f.sentOn} on={(v) => setF({ ...f, sentOn: v })} />
        <Field id="tr-r" label="مهلت پاسخ" type="date" value={f.responseDue} on={(v) => setF({ ...f, responseDue: v })} />
        <div className="field"><label htmlFor="tr-revs">رویژن‌ها</label>
          <select id="tr-revs" multiple size={Math.min(6, Math.max(2, revs.length))} value={f.picked}
                  onChange={(e) => setF({ ...f, picked: [...e.target.selectedOptions].map((o) => o.value) })}>
            {revs.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select></div>
      </div>
      <div><button className="btn" type="submit">ارسال</button></div>
    </form>
  );
}

function ReturnForm({ i, data, post }) {
  const [f, setF] = useState({ code: "1", comment: "" });
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "end" }}>
      <Select id={`rc-${i.id}`} label="کد" value={f.code} on={(v) => setF({ ...f, code: v })} opts={Object.entries(data.returnCodes)} />
      <Field id={`rm-${i.id}`} label="کامنت" value={f.comment} on={(v) => setF({ ...f, comment: v })} />
      <button className="btn ghost" onClick={() => post({ kind: "return", itemId: i.id, code: f.code, returnedOn: today(), comment: f.comment })}>ثبت پاسخ</button>
    </div>
  );
}

function Select({ id, label, value, on, opts, blank }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {blank !== undefined && <option value="">{blank}</option>}
        {opts.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select></div>
  );
}

function Field({ id, label, value, on, type = "text" }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} dir={type === "text" ? "auto" : "ltr"} value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
