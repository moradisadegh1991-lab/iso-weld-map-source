"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tender from "./Tender";
import Vendors from "./Vendors";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Procurement and expediting.
 *
 * The expediting list is ordered by float against the site's need date:
 * what construction will wait for first. A line with no need date has no
 * float and goes to the bottom, labelled — unknown is neither late nor on
 * time. A forecast that is only the vendor's original promise says so.
 */
// a vendor document's state: its tone; its words are pu.doc.<state>
const DOC_STATE = { pending: "", overdue: "bad", under_review: "warn", resubmit: "warn", resubmit_overdue: "bad", accepted: "ok" };

const TABS = ["orders", "tender", "vendors", "vdt"];

export default function ProcurementPage() {
  const [tab, setTab] = useState("orders");
  const { t } = usePrefs();
  const bar = (
    <div className="ptabs no-print" role="tablist">
      {TABS.map((k) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{t(`pu.tab.${k}`)}</button>)}
    </div>
  );
  const goVendors = () => setTab("vendors");
  return tab === "orders" ? <Orders bar={bar} goVendors={goVendors} />
    : tab === "vendors" ? <Vendors bar={bar} />
    : <Tender key={tab} tab={tab} bar={bar} goVendors={goVendors} />;
}

function Orders({ bar, goVendors }) {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/procurement?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [openPo, setOpenPo] = useState(null);
  const may = can({ role }, ACTIONS.MANAGE_PROCUREMENT);
  const { t, L, date } = usePrefs();

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/procurement", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
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
        <h1>{t("pu.title")}</h1>
        <span className="sub">{t("pu.sub", { po: data.orders.length, open: ex.length, docs: docs.length })}</span>
      </div>
      {bar}
      {msg && <p className="err">{msg}</p>}

      <div className="kpis">
        <Kpi v={late} l={t("pu.k.late")} b={t("pu.k.lateB")} tone={late ? "bad" : "ok"} />
        <Kpi v={overdue} l={t("pu.k.overdue")} b={t("pu.k.overdueB")} tone={overdue ? "warn" : ""} />
        <Kpi v={unknown} l={t("pu.k.noRos")} b={t("pu.k.noRosB")} tone={unknown ? "warn" : ""} />
        <Kpi v={fatWait} l={t("pu.k.fat")} />
        <Kpi v={docsLate} l={t("pu.k.docsLate")} tone={docsLate ? "bad" : ""} />
      </div>

      <div className="card">
        <h2>{t("pu.ex.title")}</h2>
        {ex.length === 0 ? <p className="empty-note">{t("pu.ex.empty")}</p> : (
          <TableKit name="procurement-1">
            <table className="dtable">
              <thead><tr><th>{t("pu.h.poLine")}</th><th>{t("pu.h.what")}</th><th>{t("pu.h.qty")}</th><th>{t("pu.h.shipRecv")}</th><th>{t("pu.h.promised")}</th><th>{t("pu.h.forecast")}</th><th>{t("pu.h.need")}</th><th>{t("pu.h.slip")}</th><th>{t("pu.h.float")}</th><th>{t("pu.h.stage")}</th></tr></thead>
              <tbody>
                {ex.map((l) => (
                  <tr key={l.id}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{l.poNo}/{l.lineNo}</td>
                    <td className="sm">{l.tagId ? <a href={`/asset?tag=${encodeURIComponent(l.what)}`}>{l.what}</a> : l.what}</td>
                    <td className="mono">{l.qty} {l.uom}</td>
                    <td className="mono">{l.shippedQty} / {l.receivedQty}</td>
                    <td className="mono sm">{date(l.promisedOn)}</td>
                    <td className="mono sm">{l.forecastIsPromise ? <span className="muted" title={t("pu.ex.isPromise")}>{date(l.forecast)}*</span> : date(l.forecast)}</td>
                    <td className="mono sm">{date(l.needOn)}</td>
                    <td className={`mono ${l.slipDays > 0 ? "warn" : ""}`}>{l.slipDays ?? "—"}</td>
                    <td className={`mono ${l.floatDays === null ? "" : l.floatDays < 0 ? "bad" : "ok"}`}>{l.floatDays ?? t("pu.unknown")}</td>
                    <td className="sm">{L(`proc.stage.${l.stage}`, data.stages[l.stage])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        <p className="muted sm">{t("pu.ex.note")}</p>
      </div>

      {data.orders.map((o) => (
        <div className="card" key={o.po.id}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h2 className="mono" style={{ margin: 0 }}>{o.po.po_no} <span className="muted sm">{o.po.title} · {data.vendors.find((v) => v.id === o.po.vendor_id)?.name}</span></h2>
            <button className="btn ghost" onClick={() => setOpenPo(openPo === o.po.id ? null : o.po.id)}>{openPo === o.po.id ? t("common.close") : t("pu.details")}</button>
          </div>
          {openPo === o.po.id && <PoDetail o={o} data={data} post={post} may={may} role={role} />}
        </div>
      ))}

      {may && <Fold title={t("pu.newPoFold")}><NewPo data={data} post={post} goVendors={goVendors} /></Fold>}
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
  const { t, L, date } = usePrefs();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
      <TableKit name="procurement-2">
        <table className="dtable">
          <thead><tr><th>{t("c.row")}</th><th>{t("pu.h.what")}</th><th>{t("pu.h.qty")}</th><th>FAT</th><th>{t("pu.h.shipRecv")}</th><th>{t("pu.h.stage")}</th><th /></tr></thead>
          <tbody>
            {o.lines.map((l) => [
              <tr key={l.id}>
                <td className="mono">{l.lineNo}</td>
                <td className="sm">{l.what}</td>
                <td className="mono">{l.qty} {l.uom}</td>
                <td className="sm">{!l.fatRequired ? "—" : l.fat ? <span className={`pill ${l.fat.result === "fail" ? "bad" : "ok"}`}>{L(`proc.fat.${l.fat.result}`, data.fatResults[l.fat.result])}{l.fat.irnNo ? ` · ${l.fat.irnNo}` : ""}</span> : <span className="pill">{t("pu.required")}</span>}</td>
                <td className="mono">{l.shippedQty} / {l.receivedQty}</td>
                <td className="sm">{L(`proc.stage.${l.stage}`, data.stages[l.stage])}</td>
                <td style={{ whiteSpace: "nowrap" }}>
                  {may && <button className="btn ghost" onClick={() => setAct({ lineId: l.id, kind: "forecast" })}>{t("pu.forecast")}</button>}
                  {mayFat && l.fatRequired && <button className="btn ghost" onClick={() => setAct({ lineId: l.id, kind: "fat" })}>FAT</button>}
                  {mayReceive && l.itemId && l.receivedQty < l.qty && <button className="btn ghost" onClick={() => setAct({ lineId: l.id, kind: "receive" })}>{t("pu.receipt")}</button>}
                </td>
              </tr>,
              act?.lineId === l.id && (
                <tr key={l.id + "-x"}><td colSpan={7}><LineAction l={l} kind={act.kind} data={data} post={post} done={() => setAct(null)} /></td></tr>
              ),
            ])}
          </tbody>
        </table>
      </TableKit>

      {o.shipments.length > 0 && (
        <TableKit name="procurement-3"><table className="dtable">
          <thead><tr><th>{t("pu.h.shipment")}</th><th>{t("pu.h.shipped")}</th><th>ETA</th><th>{t("pu.h.arrived")}</th><th>{t("pu.h.lines")}</th><th /></tr></thead>
          <tbody>{o.shipments.map((s) => (
            <tr key={s.id}>
              <td className="mono">{s.shipment_no}</td><td className="mono sm">{date(s.shipped_on)}</td><td className="mono sm">{date(s.eta_on)}</td>
              <td className="mono sm">{s.arrived_on ? date(s.arrived_on) : <span className="muted">{t("pu.inTransit")}</span>}</td>
              <td className="mono sm">{(s.lines || []).map((x) => `${x.lineNo}×${Number(x.qty)}`).join(t("c.sep"))}</td>
              <td>{may && !s.arrived_on && <Arrive s={s} post={post} />}</td>
            </tr>))}</tbody>
        </table></TableKit>
      )}

      <div>
        <b className="sm">{t("pu.vdrl")}</b>
        {o.docs.length === 0 ? <p className="muted sm">{t("pu.notRecorded")}</p> : (
          <TableKit name="procurement-4"><table className="dtable">
            <thead><tr><th>{t("pu.h.code")}</th><th>{t("c.title")}</th><th>{t("c.due")}</th><th>{t("pu.h.lastSub")}</th><th>{t("pu.h.reviewCode")}</th><th>{t("c.status")}</th><th /></tr></thead>
            <tbody>{o.docs.map((d) => {
              const tone = DOC_STATE[d.state];
              return (
                <tr key={d.id}>
                  <td className="mono">{d.doc_code}{d.before_fat && <div className="muted sm">{t("pu.beforeFat")}</div>}</td>
                  <td className="sm">{d.title}</td>
                  <td className="mono sm">{date(d.due_on)}</td>
                  <td className="mono sm">{d.last_revision ? `Rev.${d.last_revision} · ${date(d.last_submitted_on)}` : "—"}</td>
                  <td className="sm">{d.last_code ? L(`proc.review.${d.last_code}`, data.reviewCodes[d.last_code]) : "—"}</td>
                  <td><span className={`pill ${tone}`}>{t(`pu.doc.${d.state}`)}{d.daysLate ? ` · ${t("pu.days", { n: d.daysLate })}` : ""}</span></td>
                  <td>{may && <DocAction d={d} data={data} post={post} />}</td>
                </tr>
              );
            })}</tbody>
          </table></TableKit>
        )}
      </div>

      {may && <PoForms o={o} data={data} post={post} />}
    </div>
  );
}

function Arrive({ s, post }) {
  const [on, setOn] = useState(today());
  const { t } = usePrefs();
  return (
    <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
      <input type="date" dir="ltr" aria-label={t("pu.arrivedOn", { no: s.shipment_no })} value={on} onChange={(e) => setOn(e.target.value)} />
      <button className="btn ghost" onClick={() => post({ kind: "arrive", shipmentId: s.id, arrivedOn: on })}>{t("pu.arrive")}</button>
    </span>
  );
}

function LineAction({ l, kind, data, post, done }) {
  const [f, setF] = useState({ forecastOn: l.forecast || "", source: "", inspectedOn: today(), result: "pass", irnNo: "", inspector: "", note: "",
    receiptNo: "", receivedOn: today(), qty: "", heatNo: "", mtcRef: "", location: "" });
  const [hist, setHist] = useState(null);
  const { projectId, call } = usePlatform();
  const { t, L, date } = usePrefs();
  useEffect(() => {
    if (kind !== "forecast") return;
    call(`/api/procurement?projectId=${projectId}&lineId=${l.id}`).then((r) => setHist(r.history)).catch(() => setHist([]));
  }, [kind, l.id, projectId, call]);
  const go = async (body) => { if (await post(body)) done(); };
  if (kind === "forecast") return (
    <div className="grid2">
      <div className="sm">{hist && hist.length ? <ol style={{ margin: 0 }}>{hist.map((h) => <li key={h.id}>{date(h.forecast_on)} — {h.source}{h.by_name && ` (${h.by_name})`}</li>)}</ol> : <span className="muted">{t("pu.noForecast")}</span>}</div>
      <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
        <Field id={`fo-${l.id}`} label={t("pu.f.forecastOn")} type="date" value={f.forecastOn} on={(v) => setF({ ...f, forecastOn: v })} />
        <Field id={`fs-${l.id}`} label={t("pu.f.source")} value={f.source} on={(v) => setF({ ...f, source: v })} />
        <button className="btn" onClick={() => go({ kind: "forecast", poLineId: l.id, forecastOn: f.forecastOn, source: f.source })}>{t("c.submit")}</button>
      </div>
    </div>
  );
  if (kind === "fat") return (
    <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <Field id={`fd-${l.id}`} label={t("pu.f.inspectedOn")} type="date" value={f.inspectedOn} on={(v) => setF({ ...f, inspectedOn: v })} />
      <Select id={`fr-${l.id}`} label={t("c.result")} value={f.result} on={(v) => setF({ ...f, result: v })} opts={Object.entries(data.fatResults).map(([k, v]) => [k, L(`proc.fat.${k}`, v)])} />
      <Field id={`fi-${l.id}`} label={t("pu.f.irn")} value={f.irnNo} on={(v) => setF({ ...f, irnNo: v })} />
      <Field id={`fn-${l.id}`} label={t("c.inspector")} value={f.inspector} on={(v) => setF({ ...f, inspector: v })} />
      <Field id={`ft-${l.id}`} label={t("pu.f.fatNote")} value={f.note} on={(v) => setF({ ...f, note: v })} />
      <button className="btn" onClick={() => go({ kind: "fat", poLineId: l.id, ...f })}>{t("pu.f.saveFat")}</button>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }}>
      <FormNo id={`rn-${l.id}`} form="receipt" label={t("pu.f.receiptNo")} value={f.receiptNo} on={(v) => setF({ ...f, receiptNo: v })} />
      <Field id={`rd-${l.id}`} label={t("c.date")} type="date" value={f.receivedOn} on={(v) => setF({ ...f, receivedOn: v })} />
      <Field id={`rq-${l.id}`} label={t("pu.f.qtyLeft", { uom: l.uom, n: l.qty - l.receivedQty })} type="number" value={f.qty} on={(v) => setF({ ...f, qty: v })} />
      <Field id={`rh-${l.id}`} label="Heat No." value={f.heatNo} on={(v) => setF({ ...f, heatNo: v })} />
      <Field id={`rm-${l.id}`} label="MTC" value={f.mtcRef} on={(v) => setF({ ...f, mtcRef: v })} />
      <Field id={`rl-${l.id}`} label={t("pu.f.storeLoc")} value={f.location} on={(v) => setF({ ...f, location: v })} />
      <button className="btn" onClick={() => go({ kind: "receive", poLineId: l.id, receiptNo: f.receiptNo, receivedOn: f.receivedOn, qty: f.qty, heatNo: f.heatNo, mtcRef: f.mtcRef, location: f.location })}>{t("pu.f.toStore")}</button>
    </div>
  );
}

/**
 * The vendor's submission and our return, each on the day it happened — a
 * record entered late must not carry the day it was typed.
 */
function DocAction({ d, data, post }) {
  const [f, setF] = useState({ revision: "", code: "2", comment: "", on: today() });
  const { t, L } = usePrefs();
  if (d.state === "accepted") return null;
  if (d.state === "under_review") return (
    <div style={{ display: "flex", gap: 6, alignItems: "end" }}>
      <Select id={`dc-${d.id}`} label={t("pu.h.code")} value={f.code} on={(v) => setF({ ...f, code: v })} opts={Object.entries(data.reviewCodes).map(([k, v]) => [k, L(`proc.review.${k}`, v)])} />
      <Field id={`dm-${d.id}`} label={t("pu.f.comment")} value={f.comment} on={(v) => setF({ ...f, comment: v })} />
      <Field id={`do-${d.id}`} label={t("pu.f.returnedOn")} type="date" value={f.on} on={(v) => setF({ ...f, on: v })} />
      <button className="btn ghost" onClick={() => post({ kind: "review", docId: d.id, returnedOn: f.on, code: f.code, comment: f.comment })}>{t("pu.f.return")}</button>
    </div>
  );
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "end" }}>
      <Field id={`dr-${d.id}`} label={t("c.revision")} value={f.revision} on={(v) => setF({ ...f, revision: v })} />
      <Field id={`ds-${d.id}`} label={t("pu.f.submittedOn")} type="date" value={f.on} on={(v) => setF({ ...f, on: v })} />
      <button className="btn ghost" onClick={() => post({ kind: "submit", docId: d.id, revision: f.revision, submittedOn: f.on })}>{t("pu.f.submitted")}</button>
    </div>
  );
}

function PoForms({ o, data, post }) {
  const [l, setL] = useState({ what: "item", itemId: "", tagId: "", qty: "", unitPrice: "", promisedOn: "", needOn: "", fatRequired: false });
  const [s, setS] = useState({ shipmentNo: "", shippedOn: today(), etaOn: "", mode: "", qty: {} });
  const [d, setD] = useState({ docCode: "", title: "", dueOn: "", beforeFat: false });
  const open = o.lines.filter((x) => x.shippedQty < x.qty);
  const { t } = usePrefs();
  return (
    <div className="grid2">
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "line", poId: o.po.id, ...l, itemId: l.what === "item" ? l.itemId : null, tagId: l.what === "tag" ? l.tagId : null })) setL({ ...l, qty: "" }); }}>
        <b>{t("pu.f.newLine")}</b>
        <Select id={`lw-${o.po.id}`} label={t("pu.f.kind")} value={l.what} on={(v) => setL({ ...l, what: v })} opts={[["item", t("pu.f.stockItem")], ["tag", t("pu.f.taggedEq")]]} />
        {l.what === "item"
          ? <Select id={`li-${o.po.id}`} label={t("pu.f.item")} value={l.itemId} on={(v) => setL({ ...l, itemId: v })} opts={data.items.map((i) => [i.id, `${i.code} (${i.uom})`])} blank="—" />
          : <Select id={`lt-${o.po.id}`} label={t("c.tag")} value={l.tagId} on={(v) => setL({ ...l, tagId: v })} opts={data.tags.map((x) => [x.id, x.tag_no])} blank="—" />}
        <Field id={`lq-${o.po.id}`} label={t("pu.h.qty")} type="number" value={l.qty} on={(v) => setL({ ...l, qty: v })} />
        <Field id={`lp-${o.po.id}`} label={t("pu.f.promisedOn")} type="date" value={l.promisedOn} on={(v) => setL({ ...l, promisedOn: v })} />
        <Field id={`ln-${o.po.id}`} label={t("pu.f.ros")} type="date" value={l.needOn} on={(v) => setL({ ...l, needOn: v })} />
        <label className="sm"><input type="checkbox" checked={l.fatRequired} onChange={(e) => setL({ ...l, fatRequired: e.target.checked })} /> {t("pu.f.fatReq")}</label>
        <div><button className="btn" type="submit">{t("pu.f.addLine")}</button></div>
      </form>
      <form onSubmit={async (e) => { e.preventDefault();
        const lines = Object.entries(s.qty).filter(([, q]) => Number(q) > 0).map(([poLineId, qty]) => ({ poLineId, qty }));
        if (await post({ kind: "shipment", poId: o.po.id, shipmentNo: s.shipmentNo, shippedOn: s.shippedOn, etaOn: s.etaOn, mode: s.mode, lines })) setS({ ...s, shipmentNo: "", qty: {} }); }}>
        <b>{t("pu.f.newShipment")}</b>
        <FormNo id={`sn-${o.po.id}`} form="shipment" label={t("pu.f.shipmentNo")} value={s.shipmentNo} on={(v) => setS({ ...s, shipmentNo: v })} />
        <Field id={`sd-${o.po.id}`} label={t("pu.f.shippedOn")} type="date" value={s.shippedOn} on={(v) => setS({ ...s, shippedOn: v })} />
        <Field id={`se-${o.po.id}`} label="ETA" type="date" value={s.etaOn} on={(v) => setS({ ...s, etaOn: v })} />
        {open.map((x) => (
          <Field key={x.id} id={`sq-${x.id}`} label={t("pu.f.lineLeft", { no: x.lineNo, what: x.what, n: x.qty - x.shippedQty, uom: x.uom })} type="number"
                 value={s.qty[x.id] || ""} on={(v) => setS({ ...s, qty: { ...s.qty, [x.id]: v } })} />
        ))}
        <div><button className="btn" type="submit">{t("pu.f.saveShipment")}</button></div>
      </form>
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "doc", poId: o.po.id, ...d })) setD({ docCode: "", title: "", dueOn: "", beforeFat: false }); }}>
        <b>{t("pu.f.vdrlDoc")}</b>
        <Field id={`dk-${o.po.id}`} label={t("pu.f.docCode")} value={d.docCode} on={(v) => setD({ ...d, docCode: v })} />
        <Field id={`dt-${o.po.id}`} label={t("c.title")} value={d.title} on={(v) => setD({ ...d, title: v })} />
        <Field id={`dd-${o.po.id}`} label={t("c.due")} type="date" value={d.dueOn} on={(v) => setD({ ...d, dueOn: v })} />
        <label className="sm"><input type="checkbox" checked={d.beforeFat} onChange={(e) => setD({ ...d, beforeFat: e.target.checked })} /> {t("pu.f.beforeFatReq")}</label>
        <div><button className="btn" type="submit">{t("pu.f.addDoc")}</button></div>
      </form>
    </div>
  );
}

function NewPo({ data, post, goVendors }) {
  const [p, setP] = useState({ poNo: "", vendorId: "", title: "", currency: "", placedOn: today() });
  const { t } = usePrefs();
  return (
    <div className="card">
      <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "po", ...p })) setP({ ...p, poNo: "", title: "" }); }}>
        <h2>{t("pu.f.newPo")}</h2>
        <div className="grid2">
          <FormNo id="po-no" form="po" label={t("pu.f.poNo")} value={p.poNo} on={(x) => setP({ ...p, poNo: x })} />
          <Select id="po-v" label={t("pu.f.vendor")} value={p.vendorId} on={(x) => setP({ ...p, vendorId: x })} opts={data.vendors.map((x) => [x.id, `${x.code} — ${x.name}`])} blank="—" />
          <Field id="po-t" label={t("c.title")} value={p.title} on={(x) => setP({ ...p, title: x })} />
          <Field id="po-c" label={t("pu.f.poCurrency")} value={p.currency} on={(x) => setP({ ...p, currency: x })} />
          <Field id="po-d" label={t("pu.f.placedOn")} type="date" value={p.placedOn} on={(x) => setP({ ...p, placedOn: x })} />
        </div>
        <p className="muted sm">{t("pu.f.noVendor")} <button type="button" className="linkish" onClick={goVendors}>{t("pu.f.goVendors")}</button>.</p>
        <div><button className="btn" type="submit">{t("pu.f.savePo")}</button></div>
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
