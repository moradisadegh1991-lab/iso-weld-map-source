"use client";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { qrSvg } from "../../../lib/field/qr.mjs";
import TableKit from "../../../components/ui/TableKit";
import Tabs from "../../../components/ui/Tabs";
import Fold from "../../../components/ui/Fold";
import { usePrefs } from "../../../lib/client/prefs.mjs";

/**
 * Piping reports, spool loads and drawing labels — what the Piping.Tools
 * exports gave the owner, built from the platform's own registers with no
 * model in the path (lib/piping/reports.mjs). Each report is an .xlsx the
 * server writes; a load is a truck from shop to site with its packing list;
 * a label is 4×2 in, one drawing sheet each, printed from the browser.
 */
const REPORTS = ["weld-log", "bom", "ndt", "progress"];
const STATUS_TONE = { pending: "warn", shipped: "", delivered: "ok" };
const ORIGIN = "epc.labelOrigin";

export default function PipingReportsPage() {
  const { projectId, role, call } = usePlatform();
  const { t, num, date } = usePrefs();
  const mayShip = can({ role }, ACTIONS.ASSIGN_WELD);
  const [drawing, setDrawing] = useState("");
  const [loadId, setLoadId] = useState("");
  const [labelSource, setLabelSource] = useState("");
  const [msg, setMsg] = useState(null);
  const { data: lab } = useProjectData((id) => `/api/piping/loads?projectId=${id}&labels=1`, []);
  const { data: ld, reload } = useProjectData((id) => `/api/piping/loads?projectId=${id}`, []);
  const { data: detail, reload: reloadDetail } = useProjectData((id) => (loadId ? `/api/piping/loads?projectId=${id}&loadId=${loadId}` : null), [loadId]);

  // a drawing label's QR opens this page on that drawing
  useEffect(() => {
    const d = new URLSearchParams(window.location.search).get("drawing");
    if (d) setDrawing(d);
  }, []);

  const drawings = useMemo(() => [...new Set((lab?.labels || []).map((l) => l.drawingNo))], [lab]);
  const loads = ld?.loads || [];
  const free = ld?.freeSpools || [];

  async function post(body, after) {
    setMsg(null);
    try {
      const r = await call("/api/piping/loads", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload(); if (loadId) reloadDetail();
      after?.(r);
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  const href = (kind) => `/api/piping/reports?projectId=${projectId}&kind=${kind}${drawing && kind !== "template" ? `&drawing=${encodeURIComponent(drawing)}` : ""}`;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("pi.rp.title")}</h1>
        <span className="sub">{t("pi.rp.sub", { drawings: num(drawings.length), loads: num(loads.length) })}</span>
      </div>
      {msg && <p className="err">{msg}</p>}
      <Tabs name="piping-reports">
        <div className="card" data-tab="reports">
          <h2>{t("pi.rp.reports")}</h2>
          <p className="muted sm">{t("pi.rp.noModel")}</p>
          <div className="field" style={{ maxWidth: 360 }}>
            <label htmlFor="rp-scope">{t("pi.rp.scope")}</label>
            <select id="rp-scope" value={drawing} onChange={(e) => setDrawing(e.target.value)}>
              <option value="">{t("pi.rp.allDrawings")}</option>
              {drawings.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          <div className="rp-list">
            {[...REPORTS, "template"].map((k) => (
              <a key={k} className="rp-item" href={href(k)} data-report={k}>
                <b>{t(`pi.rp.r.${k}`)}</b><span className="muted sm">{t(`pi.rp.r.${k}.d`)}</span><span className="btn ghost sm">{t("pi.rp.download")}</span>
              </a>))}
          </div>
          <p className="muted sm">{t("pi.rp.blanks")}</p>
        </div>

        <div className="card" data-tab="loads">
          <h2>{t("pi.rp.loads")}</h2>
          {mayShip && <Fold title={t("pi.rp.newLoad")}><NewLoad onSave={(b) => post({ kind: "create", ...b }, (r) => setLoadId(r.load.id))} /></Fold>}
          {!loads.length ? <p className="empty-note">{t("pi.rp.noLoads")}</p> : (
            <TableKit name="piping-loads">
              <table className="dtable">
                <thead><tr><th>{t("pi.rp.load")}</th><th>{t("c.status")}</th><th>{t("pi.rp.spools")}</th><th>{t("pi.rp.lengthM")}</th>
                  <th>{t("pi.rp.items")}</th><th>{t("pi.rp.destination")}</th><th>{t("pi.rp.leaveOn")}</th><th>{t("pi.rp.deliveredOn")}</th><th></th></tr></thead>
                <tbody>{loads.map((l) => (
                  <tr key={l.id} data-load={l.load_no}>
                    <td className="mono">{l.load_no}</td>
                    <td><span className={`pill ${STATUS_TONE[l.status]}`}>{t(`pi.rp.st.${l.status}`)}</span></td>
                    <td className="mono">{num(l.spools)}</td><td className="mono">{num(Math.round(l.length_mm / 10) / 100)}</td>
                    <td className="mono">{num(l.items)}</td><td>{l.destination || "—"}</td>
                    <td>{l.leave_on ? date(l.leave_on) : "—"}</td><td>{l.delivered_on ? date(l.delivered_on) : "—"}</td>
                    <td><button className="btn ghost sm" onClick={() => setLoadId(l.id)}>{t("pi.rp.open")}</button></td>
                  </tr>))}</tbody>
              </table>
            </TableKit>)}
          {detail?.load && <LoadDetail d={detail} free={free} mayShip={mayShip} post={post} projectId={projectId}
            onLabels={() => setLabelSource(`load:${detail.load.id}`)} />}
        </div>

        <div className="card" data-tab="labels">
          <h2>{t("pi.rp.labels")}</h2>
          <Labels projectId={projectId} loads={loads} source={labelSource} setSource={setLabelSource} call={call} />
        </div>
      </Tabs>
    </div>
  );
}

function NewLoad({ onSave }) {
  const { t } = usePrefs();
  const [f, setF] = useState({ loadNo: "", destination: "", notes: "" });
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await onSave(f)) setF({ loadNo: "", destination: "", notes: "" }); }}>
      <div className="field"><label htmlFor="ln">{t("pi.rp.load")}</label>
        <input id="ln" dir="ltr" required value={f.loadNo} onChange={(e) => setF({ ...f, loadNo: e.target.value })} /></div>
      <div className="field"><label htmlFor="ld">{t("pi.rp.destination")}</label>
        <input id="ld" value={f.destination} onChange={(e) => setF({ ...f, destination: e.target.value })} /></div>
      <div className="field"><label htmlFor="lnt">{t("pi.rp.notes")}</label>
        <input id="lnt" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
      <button className="btn" type="submit">{t("c.save")}</button>
    </form>
  );
}

function LoadDetail({ d, free, mayShip, post, projectId, onLabels }) {
  const { t, num, date } = usePrefs();
  const { load, spools, items } = d;
  const [pick, setPick] = useState([]);
  const [on, setOn] = useState(new Date().toISOString().slice(0, 10));
  const [it, setIt] = useState({ description: "", qty: "", uom: "EA", drawingRef: "", itemNo: "", notes: "" });
  const pending = load.status === "pending";
  return (
    <div className="rp-detail" data-load-detail={load.load_no}>
      <h3>{t("pi.rp.loadN", { no: load.load_no })} · <span className={`pill ${STATUS_TONE[load.status]}`}>{t(`pi.rp.st.${load.status}`)}</span></h3>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <a className="btn" href={`/api/piping/loads?projectId=${projectId}&loadId=${load.id}&export=packing`} data-packing>{t("pi.rp.packing")}</a>
        <button className="btn ghost" onClick={onLabels}>{t("pi.rp.labelsOf")}</button>
        {mayShip && load.status !== "delivered" && <>
          <div className="field"><label htmlFor="lon">{t("pi.rp.on")}</label>
            <input id="lon" type="date" value={on} onChange={(e) => setOn(e.target.value)} /></div>
          {pending && <button className="btn" data-ship onClick={() => post({ kind: "status", loadId: load.id, status: "shipped", on })}>{t("pi.rp.ship")}</button>}
          {load.status === "shipped" && <button className="btn" data-deliver onClick={() => post({ kind: "status", loadId: load.id, status: "delivered", on })}>{t("pi.rp.deliver")}</button>}
        </>}
      </div>

      <h3 className="sm">{t("pi.rp.spoolsOn", { n: num(spools.length) })}</h3>
      {!spools.length ? <p className="muted sm">{t("pi.rp.noSpools")}</p> : (
        <table className="dtable"><thead><tr><th>{t("pi.rp.drawing")}</th><th>{t("pi.rp.sheet")}</th><th>{t("pi.rp.spool")}</th>
          <th>{t("pi.rp.lengthM")}</th><th>{t("pi.rp.fitUp")}</th>{mayShip && pending && <th></th>}</tr></thead>
          <tbody>{spools.map((s) => (
            <tr key={s.id}><td className="mono">{s.doc_no}</td><td className="mono">{s.sheet_no}</td><td className="mono">{s.spool_no}</td>
              <td className="mono">{s.length_mm ? num(Math.round(s.length_mm / 10) / 100) : "—"}</td>
              <td>{s.fit_up_on ? `${date(s.fit_up_on)} · ${s.fit_up_by || ""}` : "—"}</td>
              {mayShip && pending && <td><button className="btn ghost sm" onClick={() => post({ kind: "remove_spool", loadId: load.id, spoolId: s.id })}>{t("pi.rp.remove")}</button></td>}
            </tr>))}</tbody></table>)}

      {mayShip && pending && (
        <Fold title={t("pi.rp.addSpools")}>
          {!free.length ? <p className="muted sm">{t("pi.rp.noFree")}</p> : <>
            <div className="rp-pick">{free.map((s) => (
              <label key={s.id} className="sm"><input type="checkbox" checked={pick.includes(s.id)}
                onChange={(e) => setPick(e.target.checked ? [...pick, s.id] : pick.filter((x) => x !== s.id))} />
                <span className="mono">{s.doc_no} {s.sheet_no} · {s.spool_no}</span></label>))}</div>
            <button className="btn" disabled={!pick.length} onClick={() => post({ kind: "add_spools", loadId: load.id, spoolIds: pick }, () => setPick([]))}>
              {t("pi.rp.addN", { n: num(pick.length) })}</button></>}
        </Fold>)}

      <h3 className="sm">{t("pi.rp.shiploose", { n: num(items.length) })}</h3>
      {!!items.length && (
        <table className="dtable"><thead><tr><th>{t("pi.rp.drawing")}</th><th>{t("pi.rp.itemNo")}</th><th>{t("c.description")}</th><th>{t("pi.rp.qty")}</th><th>{t("pi.rp.uom")}</th><th>{t("pi.rp.notes")}</th></tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id}><td className="mono">{i.drawing_ref || "—"}</td><td className="mono">{i.item_no || "—"}</td><td>{i.description}</td>
              <td className="mono">{num(Number(i.qty))}</td><td className="mono">{i.uom}</td><td>{i.notes || ""}</td></tr>))}</tbody></table>)}
      {mayShip && pending && (
        <Fold title={t("pi.rp.addItem")}>
          <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault();
            if (await post({ kind: "add_item", loadId: load.id, item: it })) setIt({ ...it, description: "", qty: "", itemNo: "", notes: "" }); }}>
            <div className="field"><label htmlFor="ii-d">{t("c.description")}</label><input id="ii-d" required value={it.description} onChange={(e) => setIt({ ...it, description: e.target.value })} /></div>
            <div className="field"><label htmlFor="ii-q">{t("pi.rp.qty")}</label><input id="ii-q" type="number" step="any" min="0" required value={it.qty} onChange={(e) => setIt({ ...it, qty: e.target.value })} /></div>
            <div className="field"><label htmlFor="ii-u">{t("pi.rp.uom")}</label><input id="ii-u" dir="ltr" required value={it.uom} onChange={(e) => setIt({ ...it, uom: e.target.value })} /></div>
            <div className="field"><label htmlFor="ii-r">{t("pi.rp.drawing")}</label><input id="ii-r" dir="ltr" value={it.drawingRef} onChange={(e) => setIt({ ...it, drawingRef: e.target.value })} /></div>
            <div className="field"><label htmlFor="ii-n">{t("pi.rp.itemNo")}</label><input id="ii-n" dir="ltr" value={it.itemNo} onChange={(e) => setIt({ ...it, itemNo: e.target.value })} /></div>
            <div className="field"><label htmlFor="ii-x">{t("pi.rp.notes")}</label><input id="ii-x" value={it.notes} onChange={(e) => setIt({ ...it, notes: e.target.value })} /></div>
            <button className="btn" type="submit">{t("c.save")}</button>
          </form>
        </Fold>)}
    </div>
  );
}

/** 4×2 in labels, one drawing sheet each: the load or transmittal on top, a QR that opens this page on the drawing. */
function Labels({ projectId, loads, source, setSource, call }) {
  const { t, num } = usePrefs();
  const [origin, setOrigin] = useState("");
  const [labels, setLabels] = useState([]);
  useEffect(() => {
    let o = window.location.origin;
    try { o = localStorage.getItem(ORIGIN) || o; } catch { /* ignore */ }
    setOrigin(o);
  }, []);
  useEffect(() => {
    if (!projectId) return;
    const q = source.startsWith("load:") ? `&loadId=${source.slice(5)}` : source.startsWith("tr:") ? `&transmittal=${encodeURIComponent(source.slice(3))}` : "";
    call(`/api/piping/loads?projectId=${projectId}&labels=1${q}`).then((r) => setLabels(r.labels), () => setLabels([]));
  }, [projectId, source, call]);
  const transmittals = [...new Set(labels.map((l) => l.header).filter(Boolean))];
  const local = /localhost|127\.0\.0\.1|\[::1\]/.test(origin);
  const saveOrigin = (v) => { setOrigin(v); try { localStorage.setItem(ORIGIN, v); } catch { /* ignore */ } };
  const sheet = (
    <div className="dlabels">
      {labels.map((l) => {
        const url = `${String(origin).replace(/\/+$/, "")}/piping/reports?drawing=${encodeURIComponent(l.drawingNo)}`;
        return (
          <div key={`${l.drawingNo}|${l.sheet}`} className="dlabel" dir="ltr" data-label={l.drawingNo}>
            <div className="dl-qr" dangerouslySetInnerHTML={{ __html: qrSvg(url, { size: 120 }) }} />
            <div className="dl-text">
              <div className="dl-head">{l.header}</div>
              <div className="dl-k">Drawing:</div>
              <div className="dl-no">{l.drawingNo}</div>
              <div className="dl-meta">Sheet #: {l.sheet}</div>
              <div className="dl-meta">Rev: {l.rev}</div>
            </div>
          </div>);
      })}
    </div>);
  // printing labels prints the labels alone, one 4×2 in page each (app/globals.css, @page dlabel)
  const print = () => {
    document.body.classList.add("print-labels");
    const done = () => { document.body.classList.remove("print-labels"); window.removeEventListener("afterprint", done); };
    window.addEventListener("afterprint", done);
    window.print();
  };
  return (<>
    <div className="no-print">
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label htmlFor="lb-s">{t("pi.rp.labelSource")}</label>
          <select id="lb-s" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">{t("pi.rp.allDrawings")}</option>
            {loads.map((l) => <option key={l.id} value={`load:${l.id}`}>{t("pi.rp.loadN", { no: l.load_no })}</option>)}
            {!source.startsWith("load:") && transmittals.map((x) => <option key={x} value={`tr:${x}`}>{x}</option>)}
          </select></div>
        <div className="field" style={{ flex: "1 1 260px" }}><label htmlFor="lb-o">{t("pi.rp.origin")}</label>
          <input id="lb-o" dir="ltr" value={origin} onChange={(e) => saveOrigin(e.target.value)} /></div>
        <button className="btn" data-print-labels disabled={!labels.length || local} onClick={print}>{t("pi.rp.print", { n: num(labels.length) })}</button>
      </div>
      {local && <p className="err sm">{t("pi.rp.localOrigin")}</p>}
      <p className="muted sm">{t("pi.rp.labelHint")}</p>
      {sheet}
    </div>
    {typeof document !== "undefined" && createPortal(<div className="dlabels-print">{sheet}</div>, document.body)}
  </>);
}
