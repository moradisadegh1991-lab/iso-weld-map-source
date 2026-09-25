"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";

/**
 * Procurement and expediting.
 *
 * The expediting list is ordered by float against the site's need date:
 * what construction will wait for first. A line with no need date has no
 * float and goes to the bottom, labelled — unknown is neither late nor on
 * time. A forecast that is only the vendor's original promise says so.
 */
const DOC_STATE = { pending: ["", "در انتظار"], overdue: ["bad", "معوق"], under_review: ["warn", "در بررسی"],
  resubmit: ["warn", "ارسال مجدد"], resubmit_overdue: ["bad", "ارسال مجدد — معوق"], accepted: ["ok", "پذیرفته"] };

export default function ProcurementPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/procurement?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [openPo, setOpenPo] = useState(null);
  const may = can({ role }, ACTIONS.MANAGE_PROCUREMENT);

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/procurement", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const ex = data.expediting;
  const late = ex.filter((l) => l.floatDays !== null && l.floatDays < 0).length;
  const unknown = ex.filter((l) => l.floatDays === null).length;
  const overdue = ex.filter((l) => l.overdue).length;
  const docs = data.orders.flatMap((o) => o.docs);
  const docsLate = docs.filter((d) => d.state === "overdue" || d.state === "resubmit_overdue").length;
  const fatWait = ex.filter((l) => l.fatRequired && (l.stage === "ordered" || l.stage === "fat_pending")).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>خرید و پیگیری</h1>
        <span className="sub">{data.orders.length} سفارش · {ex.length} ردیف باز · {docs.length} مدرک فروشنده</span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={late} l="دیرتر از نیاز سایت" b="شناوری منفی" tone={late ? "bad" : "ok"} />
        <Kpi v={overdue} l="موعد تحویل گذشته" b="و هنوز نرسیده" tone={overdue ? "warn" : ""} />
        <Kpi v={unknown} l="بدون تاریخ نیاز (ROS)" b="شناوری نامعلوم" tone={unknown ? "warn" : ""} />
        <Kpi v={fatWait} l="منتظر بازرسی کارخانه" />
        <Kpi v={docsLate} l="مدرک فروشندهٔ معوق" tone={docsLate ? "bad" : ""} />
      </div>

      <div className="card">
        <h2>فهرست پیگیری — به ترتیب شناوری</h2>
        {ex.length === 0 ? <p className="empty-note">ردیف بازی نیست.</p> : (
          <div className="wrap">
            <table className="dtable">
              <thead><tr><th>PO / ردیف</th><th>چه چیزی</th><th>مقدار</th><th>حمل / رسید</th><th>تعهد</th><th>پیش‌بینی</th><th>نیاز سایت</th><th>تأخیر</th><th>شناوری</th><th>مرحله</th></tr></thead>
              <tbody>
                {ex.map((l) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{l.poNo}/{l.lineNo}</td>
                    <td className="sm">{l.tagId ? <a href={`/asset?tag=${encodeURIComponent(l.what)}`}>{l.what}</a> : l.what}</td>
                    <td className="mono">{l.qty} {l.uom}</td>
                    <td className="mono">{l.shippedQty} / {l.receivedQty}</td>
                    <td className="mono sm">{fa(l.promisedOn)}</td>
                    <td className="mono sm">{l.forecastIsPromise ? <span className="muted" title="پیش‌بینی ثبت نشده — همان تعهد">{fa(l.forecast)}*</span> : fa(l.forecast)}</td>
                    <td className="mono sm">{fa(l.needOn)}</td>
                    <td className={`mono ${l.slipDays > 0 ? "warn" : ""}`}>{l.slipDays ?? "—"}</td>
                    <td className={`mono ${l.floatDays === null ? "" : l.floatDays < 0 ? "bad" : "ok"}`}>{l.floatDays ?? "نامعلوم"}</td>
                    <td className="sm">{data.stages[l.stage]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted sm">* پیش‌بینی ثبت نشده؛ تاریخ تعهد PO به‌جای آن آمده است.</p>
      </div>

      {data.orders.map((o) => (
        <div className="card" key={o.po.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 className="mono" style={{ margin: 0 }}>{o.po.po_no} <span className="muted sm">{o.po.title} · {data.vendors.find((v) => v.id === o.po.vendor_id)?.name}</span></h2>
            <button className="btn ghost" onClick={() => setOpenPo(openPo === o.po.id ? null : o.po.id)}>{openPo === o.po.id ? "بستن" : "جزئیات"}</button>
          </div>
          {openPo === o.po.id && <PoDetail o={o} data={data} post={post} may={may} role={role} />}
        </div>
      ))}

      {may && <NewPo data={data} post={post} />}
    </div>
  );
}

function Kpi({ v, l, b, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span>{b && <span className="b">{b}</span>}</div>;
}

function PoDetail({ o, data, post, may, role }) {
  const [act, setAct] = useState(null);   // { lineId, kind }
  const mayFat = can({ role }, ACTIONS.RECORD_NDT);
  const mayReceive = can({ role }, ACTIONS.ASSIGN_WELD);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <div className="wrap">
        <table className="dtable">
          <thead><tr><th>ردیف</th><th>چه چیزی</th><th>مقدار</th><th>FAT</th><th>حمل / رسید</th><th>مرحله</th><th /></tr></thead>
          <tbody>
            {o.lines.map((l) => [
              <tr key={l.id}>
                <td className="mono">{l.lineNo}</td>
                <td className="sm">{l.what}</td>
                <td className="mono">{l.qty} {l.uom}</td>
                <td className="sm">{!l.fatRequired ? "—" : l.fat ? <span className={`pill ${l.fat.result === "fail" ? "bad" : "ok"}`}>{data.fatResults[l.fat.result]}{l.fat.irnNo ? ` · ${l.fat.irnNo}` : ""}</span> : <span className="pill">لازم</span>}</td>
                <td className="mono">{l.shippedQty} / {l.receivedQty}</td>
                <td className="sm">{data.stages[l.stage]}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {may && <button className="btn ghost" onClick={() => setAct({ lineId: l.id, kind: "forecast" })}>پیش‌بینی</button>}
                  {mayFat && l.fatRequired && <button className="btn ghost" onClick={() => setAct({ lineId: l.id, kind: "fat" })}>FAT</button>}
                  {mayReceive && l.itemId && l.receivedQty < l.qty && <button className="btn ghost" onClick={() => setAct({ lineId: l.id, kind: "receive" })}>رسید</button>}
                </td>
              </tr>,
              act?.lineId === l.id && (
                <tr key={l.id + "-x"}><td colSpan={7}><LineAction l={l} kind={act.kind} data={data} post={post} done={() => setAct(null)} /></td></tr>
              ),
            ])}
          </tbody>
        </table>
      </div>

      {o.shipments.length > 0 && (
        <div className="wrap"><table className="dtable">
          <thead><tr><th>محموله</th><th>حمل</th><th>ETA</th><th>ورود</th><th>ردیف‌ها</th><th /></tr></thead>
          <tbody>{o.shipments.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.shipment_no}</td><td className="mono sm">{fa(s.shipped_on)}</td><td className="mono sm">{fa(s.eta_on)}</td>
              <td className="mono sm">{s.arrived_on ? fa(s.arrived_on) : <span className="muted">در راه</span>}</td>
              <td className="mono sm">{(s.lines || []).map((x) => `${x.lineNo}×${Number(x.qty)}`).join("، ")}</td>
              <td>{may && !s.arrived_on && <button className="btn ghost" onClick={() => post({ kind: "arrive", shipmentId: s.id, arrivedOn: today() })}>ورود به سایت (امروز)</button>}</td>
            </tr>))}</tbody>
        </table></div>
      )}

      <div>
        <b className="sm">مدارک فروشنده (VDRL)</b>
        {o.docs.length === 0 ? <p className="muted sm">ثبت نشده</p> : (
          <div className="wrap"><table className="dtable">
            <thead><tr><th>کد</th><th>عنوان</th><th>موعد</th><th>آخرین ارسال</th><th>کد بررسی</th><th>وضعیت</th><th /></tr></thead>
            <tbody>{o.docs.map((d) => {
              const [tone, label] = DOC_STATE[d.state];
              return (
                <tr key={d.id}>
                  <td className="mono">{d.doc_code}{d.before_fat && <div className="muted sm">پیش از FAT</div>}</td>
                  <td className="sm">{d.title}</td>
                  <td className="mono sm">{fa(d.due_on)}</td>
                  <td className="mono sm">{d.last_revision ? `Rev.${d.last_revision} · ${fa(d.last_submitted_on)}` : "—"}</td>
                  <td className="sm">{d.last_code ? data.reviewCodes[d.last_code] : "—"}</td>
                  <td><span className={`pill ${tone}`}>{label}{d.daysLate ? ` · ${d.daysLate} روز` : ""}</span></td>
                  <td>{may && <DocAction d={d} data={data} post={post} />}</td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </div>

      {may && <PoForms o={o} data={data} post={post} />}
    </div>
  );
}

function LineAction({ l, kind, data, post, done }) {
  const [f, setF] = useState({ forecastOn: l.forecast || "", source: "", inspectedOn: today(), result: "pass", irnNo: "", inspector: "", note: "",
    receiptNo: "", receivedOn: today(), qty: "", heatNo: "", mtcRef: "" });
  const [hist, setHist] = useState(null);
  const { projectId, call } = usePlatform();
  useEffect(() => {
    if (kind !== "forecast") return;
    call(`/api/procurement?projectId=${projectId}&lineId=${l.id}`).then((r) => setHist(r.history)).catch(() => setHist([]));
  }, [kind, l.id, projectId, call]);
  const go = async (body) => { if (await post(body)) done(); };
  if (kind === "forecast") return (
    <div className="grid2">
      <div className="sm">{hist && hist.length ? <ol style={{ margin: 0 }}>{hist.map((h) => <li key={h.id}>{fa(h.forecast_on)} — {h.source}{h.by_name && ` (${h.by_name})`}</li>)}</ol> : <span className="muted">پیش‌بینی قبلی ندارد</span>}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <Field id={`fo-${l.id}`} label="پیش‌بینی تحویل" type="date" value={f.forecastOn} on={(v) => setF({ ...f, forecastOn: v })} />
        <Field id={`fs-${l.id}`} label="منبع (گزارش فروشنده، تماس، بازدید)" value={f.source} on={(v) => setF({ ...f, source: v })} />
        <button className="btn" onClick={() => go({ kind: "forecast", poLineId: l.id, forecastOn: f.forecastOn, source: f.source })}>ثبت</button>
      </div>
    </div>
  );
  if (kind === "fat") return (
    <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <Field id={`fd-${l.id}`} label="تاریخ بازرسی" type="date" value={f.inspectedOn} on={(v) => setF({ ...f, inspectedOn: v })} />
      <Select id={`fr-${l.id}`} label="نتیجه" value={f.result} on={(v) => setF({ ...f, result: v })} opts={Object.entries(data.fatResults)} />
      <Field id={`fi-${l.id}`} label="شمارهٔ IRN" value={f.irnNo} on={(v) => setF({ ...f, irnNo: v })} />
      <Field id={`fn-${l.id}`} label="بازرس" value={f.inspector} on={(v) => setF({ ...f, inspector: v })} />
      <Field id={`ft-${l.id}`} label="یادداشت (برای رد یا معافیت الزامی)" value={f.note} on={(v) => setF({ ...f, note: v })} />
      <button className="btn" onClick={() => go({ kind: "fat", poLineId: l.id, ...f })}>ثبت FAT</button>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <Field id={`rn-${l.id}`} label="شمارهٔ رسید (MRR)" value={f.receiptNo} on={(v) => setF({ ...f, receiptNo: v })} />
      <Field id={`rd-${l.id}`} label="تاریخ" type="date" value={f.receivedOn} on={(v) => setF({ ...f, receivedOn: v })} />
      <Field id={`rq-${l.id}`} label={`مقدار (${l.uom}) — باقی ${l.qty - l.receivedQty}`} type="number" value={f.qty} on={(v) => setF({ ...f, qty: v })} />
      <Field id={`rh-${l.id}`} label="Heat No." value={f.heatNo} on={(v) => setF({ ...f, heatNo: v })} />
      <Field id={`rm-${l.id}`} label="MTC" value={f.mtcRef} on={(v) => setF({ ...f, mtcRef: v })} />
      <button className="btn" onClick={() => go({ kind: "receive", poLineId: l.id, ...f })}>رسید به انبار</button>
    </div>
  );
}

function DocAction({ d, data, post }) {
  const [f, setF] = useState({ revision: "", code: "2", comment: "" });
  if (d.state === "accepted") return null;
  if (d.state === "under_review") return (
    <div style={{ display: "flex", gap: 6, alignItems: "end" }}>
      <Select id={`dc-${d.id}`} label="کد" value={f.code} on={(v) => setF({ ...f, code: v })} opts={Object.entries(data.reviewCodes)} />
      <Field id={`dm-${d.id}`} label="کامنت" value={f.comment} on={(v) => setF({ ...f, comment: v })} />
      <button className="btn ghost" onClick={() => post({ kind: "review", docId: d.id, returnedOn: today(), code: f.code, comment: f.comment })}>برگشت</button>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "end" }}>
      <Field id={`dr-${d.id}`} label="رویژن" value={f.revision} on={(v) => setF({ ...f, revision: v })} />
      <button className="btn ghost" onClick={() => post({ kind: "submit", docId: d.id, revision: f.revision, submittedOn: today() })}>ارسال شد</button>
    </div>
  );
}

function PoForms({ o, data, post }) {
  const [l, setL] = useState({ what: "item", itemId: "", tagId: "", qty: "", unitPrice: "", promisedOn: "", needOn: "", fatRequired: false });
  const [s, setS] = useState({ shipmentNo: "", shippedOn: today(), etaOn: "", mode: "", qty: {} });
  const [d, setD] = useState({ docCode: "", title: "", dueOn: "", beforeFat: false });
  const open = o.lines.filter((x) => x.shippedQty < x.qty);
  return (
    <div className="grid2">
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "line", poId: o.po.id, ...l, itemId: l.what === "item" ? l.itemId : null, tagId: l.what === "tag" ? l.tagId : null })) setL({ ...l, qty: "" }); }}>
        <b>ردیف جدید</b>
        <Select id={`lw-${o.po.id}`} label="نوع" value={l.what} on={(v) => setL({ ...l, what: v })} opts={[["item", "کالای انبار"], ["tag", "تجهیز تگ‌دار"]]} />
        {l.what === "item"
          ? <Select id={`li-${o.po.id}`} label="کالا" value={l.itemId} on={(v) => setL({ ...l, itemId: v })} opts={data.items.map((i) => [i.id, `${i.code} (${i.uom})`])} blank="—" />
          : <Select id={`lt-${o.po.id}`} label="تگ" value={l.tagId} on={(v) => setL({ ...l, tagId: v })} opts={data.tags.map((t) => [t.id, t.tag_no])} blank="—" />}
        <Field id={`lq-${o.po.id}`} label="مقدار" type="number" value={l.qty} on={(v) => setL({ ...l, qty: v })} />
        <Field id={`lp-${o.po.id}`} label="تاریخ تعهد تحویل" type="date" value={l.promisedOn} on={(v) => setL({ ...l, promisedOn: v })} />
        <Field id={`ln-${o.po.id}`} label="نیاز در سایت (ROS)" type="date" value={l.needOn} on={(v) => setL({ ...l, needOn: v })} />
        <label className="sm"><input type="checkbox" checked={l.fatRequired} onChange={(e) => setL({ ...l, fatRequired: e.target.checked })} /> بازرسی کارخانه (FAT) لازم است</label>
        <div><button className="btn" type="submit">افزودن ردیف</button></div>
      </form>
      <form onSubmit={async (e) => { e.preventDefault();
        const lines = Object.entries(s.qty).filter(([, q]) => Number(q) > 0).map(([poLineId, qty]) => ({ poLineId, qty }));
        if (await post({ kind: "shipment", poId: o.po.id, shipmentNo: s.shipmentNo, shippedOn: s.shippedOn, etaOn: s.etaOn, mode: s.mode, lines })) setS({ ...s, shipmentNo: "", qty: {} }); }}>
        <b>محمولهٔ جدید</b>
        <Field id={`sn-${o.po.id}`} label="شمارهٔ محموله (PL / BL)" value={s.shipmentNo} on={(v) => setS({ ...s, shipmentNo: v })} />
        <Field id={`sd-${o.po.id}`} label="تاریخ حمل" type="date" value={s.shippedOn} on={(v) => setS({ ...s, shippedOn: v })} />
        <Field id={`se-${o.po.id}`} label="ETA" type="date" value={s.etaOn} on={(v) => setS({ ...s, etaOn: v })} />
        {open.map((x) => (
          <Field key={x.id} id={`sq-${x.id}`} label={`ردیف ${x.lineNo} — ${x.what} (باقی ${x.qty - x.shippedQty} ${x.uom})`} type="number"
                 value={s.qty[x.id] || ""} on={(v) => setS({ ...s, qty: { ...s.qty, [x.id]: v } })} />
        ))}
        <div><button className="btn" type="submit">ثبت محموله</button></div>
      </form>
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "doc", poId: o.po.id, ...d })) setD({ docCode: "", title: "", dueOn: "", beforeFat: false }); }}>
        <b>مدرک فروشنده (VDRL)</b>
        <Field id={`dk-${o.po.id}`} label="کد (GA، DS، ITP، IOM…)" value={d.docCode} on={(v) => setD({ ...d, docCode: v })} />
        <Field id={`dt-${o.po.id}`} label="عنوان" value={d.title} on={(v) => setD({ ...d, title: v })} />
        <Field id={`dd-${o.po.id}`} label="موعد" type="date" value={d.dueOn} on={(v) => setD({ ...d, dueOn: v })} />
        <label className="sm"><input type="checkbox" checked={d.beforeFat} onChange={(e) => setD({ ...d, beforeFat: e.target.checked })} /> پیش از FAT لازم است</label>
        <div><button className="btn" type="submit">افزودن مدرک</button></div>
      </form>
    </div>
  );
}

function NewPo({ data, post }) {
  const [v, setV] = useState({ code: "", name: "", country: "" });
  const [p, setP] = useState({ poNo: "", vendorId: "", title: "", currency: "", placedOn: today() });
  return (
    <div className="card grid2">
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "po", ...p })) setP({ ...p, poNo: "", title: "" }); }}>
        <h2>سفارش خرید جدید</h2>
        <Field id="po-no" label="شمارهٔ PO" value={p.poNo} on={(x) => setP({ ...p, poNo: x })} />
        <Select id="po-v" label="فروشنده" value={p.vendorId} on={(x) => setP({ ...p, vendorId: x })} opts={data.vendors.map((x) => [x.id, `${x.code} — ${x.name}`])} blank="—" />
        <Field id="po-t" label="عنوان" value={p.title} on={(x) => setP({ ...p, title: x })} />
        <Field id="po-c" label="ارز PO" value={p.currency} on={(x) => setP({ ...p, currency: x })} />
        <Field id="po-d" label="تاریخ صدور" type="date" value={p.placedOn} on={(x) => setP({ ...p, placedOn: x })} />
        <div><button className="btn" type="submit">ثبت PO</button></div>
      </form>
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "vendor", ...v })) setV({ code: "", name: "", country: "" }); }}>
        <h2>فروشنده</h2>
        <Field id="vd-c" label="کد" value={v.code} on={(x) => setV({ ...v, code: x })} />
        <Field id="vd-n" label="نام" value={v.name} on={(x) => setV({ ...v, name: x })} />
        <Field id="vd-k" label="کشور" value={v.country} on={(x) => setV({ ...v, country: x })} />
        <div><button className="btn" type="submit">ثبت فروشنده</button></div>
      </form>
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
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"} value={value} onChange={(e) => on(e.target.value)} />
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
