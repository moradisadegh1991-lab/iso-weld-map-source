"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { CATEGORIES } from "../../lib/warehouse/stock.mjs";
import { spoolStageTitle } from "../../lib/platform/precedence.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Mesc from "./Mesc";
import Stores from "./Stores";
import Tabs from "../../components/ui/Tabs";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * Warehouse: what arrived, what inspection and the certificates allow out,
 * where it went, and what the MTO still lacks.
 *
 * Stock is never typed: it is accepted less issued plus returned. A lot of
 * pipe, fittings, flanges, valves, plate, structural steel or bolting leaves
 * only with a heat number and an accepted MTC; every issue says where it
 * went, so a certificate rejected late turns into a recall list at once.
 */
// tones; the words are wa.ins.<state> and wa.mtc.<state>
const INSPECTION = { pending: "", accepted: "ok", partial: "", rejected: "bad" };
const MTC = { pending: "", accepted: "ok", rejected: "bad" };
const IR_STATES = ["awaiting", "rejected"];

/** What the project's material ITP still holds on a step of a lot, in words. */
function holdText(h, t) {
  if (!h) return null;
  const ir = h.irNo ? `${h.irNo} ${IR_STATES.includes(h.state) ? t(`wa.ir.${h.state}`) : h.state}` : t("wa.ir.none");
  return t("wa.hold", { itp: h.itpNo, seq: h.seq, ir });
}
/** A spool's stage in the reader's language (the chain's step, or not started / unknown). */
const spoolStage = (code, t, L) => (code === "planned" ? t("wa.spool.planned") : !code || code === "unknown" ? t("wa.spool.unknown")
  : L(`chain.piping_spool.${code}`, spoolStageTitle(code)));

export default function WarehousePage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/warehouse?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const [recall, setRecall] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayInspect = can({ role }, ACTIONS.RECORD_NDT);
  const mayEngineer = can({ role }, ACTIONS.EDIT_EXTRACTION);
  const { t } = usePrefs();

  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/warehouse", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (r?.recall?.length) setRecall(r.recall);
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const held = data.lots.filter((l) => !l.issuable && l.onHand > 0).length;
  const pendingMir = data.lots.filter((l) => l.inspection === "pending").length;
  const short = data.shortages.filter((s) => s.shortfall > 0).length;
  const suspect = data.lots.filter((l) => l.mtcStatus === "rejected" && l.netIssued > 0).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{t("wa.title")}</h1>
        <span className="sub">
          {t("wa.sub", { items: data.items.length, lots: data.lots.length, mir: pendingMir, held })}
          {short > 0 && ` · ${t("wa.subShort", { n: short })}`}
          {suspect > 0 && ` · ${t("wa.subSuspect", { n: suspect })}`}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}
      {recall && (
        <div className="card" data-keep style={{ borderColor: "rgba(226,87,76,.6)" }}>
          <h2 style={{ color: "var(--bad)" }}>{t("wa.recall")}</h2>
          <Recall list={recall} />
          <div><button className="btn ghost" onClick={() => setRecall(null)}>{t("common.close")}</button></div>
        </div>
      )}

      <Tabs name="warehouse">
      <div className="card">
        <h2>{t("wa.lots")}</h2>
        {data.lots.length === 0 ? <p className="empty-note">{t("wa.lotsEmpty")}</p> : (
          <TableKit name="warehouse-1">
            <table className="dtable">
              <thead><tr><th>{t("pu.f.item")}</th><th>{t("pu.receipt")}</th><th>Heat</th><th>MIR</th><th>MTC</th><th>{t("wa.h.received")}</th><th>{t("wa.h.accepted")}</th>
                <th>{t("wa.h.netIssued")}</th><th>{t("wa.h.onHand")}</th><th>{t("wa.h.issuable")}</th><th /></tr></thead>
              <tbody>
                {data.lots.map((l) => (
                  <LotRow key={l.id} l={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)}
                          data={data} post={post} mayRecord={mayRecord} mayInspect={mayInspect} call={call} projectId={projectId} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRecord && data.items.length > 0 && <Fold title={t("wa.mrr")}><Receive items={data.items} post={post} /></Fold>}
        {mayEngineer && <Fold title={t("wa.newItem")}><ItemForm post={post} /></Fold>}
        {mayEngineer && data.items.length > 0 && <Fold title={t("wa.mto")}><Requirement items={data.items} post={post} /></Fold>}
      </div>

      <Shortages rows={data.shortages} />
      <HeatTrace call={call} projectId={projectId} />
      <Stores projectId={projectId} call={call} mayStore={mayRecord} mayApprove={can({ role }, ACTIONS.MANAGE_CONTROLS)} />

      <Mesc projectId={projectId} call={call} may={mayEngineer} />
      </Tabs>
    </div>
  );
}

function Shortages({ rows }) {
  const any = rows.some((r) => r.required > 0);
  const { t, date } = usePrefs();
  if (!any) return null;
  return (
    <div className="card">
      <h2>{t("wa.short.title")}</h2>
      <p className="muted sm">{t("wa.short.note")}</p>
      <TableKit name="warehouse-2">
        <table className="dtable">
          <thead><tr><th>{t("pu.f.item")}</th><th>{t("wa.h.source")}</th><th>{t("wa.h.required")}</th><th>{t("wa.h.issued")}</th><th>{t("wa.h.issuable")}</th><th>{t("wa.h.held")}</th><th>{t("wa.h.shortfall")}</th><th>{t("wa.h.availability")}</th><th>{t("wa.h.onOrder")}</th></tr></thead>
          <tbody>
            {rows.filter((r) => r.required > 0).map((r) => (
              <tr key={r.itemId}>
                <td className="mono">{r.code}</td><td className="sm">{r.sources}</td>
                <td className="mono">{r.required} {r.uom}</td><td className="mono">{r.issued}</td>
                <td className="mono">{r.issuable}</td><td className="mono">{r.held}</td>
                <td className="mono">{r.shortfall > 0 ? <span className="pill bad">{r.shortfall}</span> : <span className="pill ok">0</span>}</td>
                <td className="mono">{r.availabilityPct}%</td>
                <td className="mono sm">{r.onOrder?.qty > 0
                  ? <a href="/procurement">{r.onOrder.qty} {r.uom}{r.onOrder.nextOn && ` · ${date(r.onOrder.nextOn)}`}</a>
                  : r.shortfall > 0 ? <span className="pill bad">{t("wa.noOrder")}</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
    </div>
  );
}

function LotRow({ l, open, onToggle, data, post, mayRecord, mayInspect, call, projectId }) {
  const { t, date } = usePrefs();
  return (
    <>
      <tr>
        <td className="sm"><span className="mono">{l.code}</span><div className="muted">{l.description}</div></td>
        <td className="mono sm">{l.receiptNo}<div className="muted">{date(l.receivedOn)}</div></td>
        <td className="mono">{l.heatNo || (l.traceable ? <span className="pill bad">{t("wa.none")}</span> : "—")}</td>
        <td><span className={"pill " + INSPECTION[l.inspection]}>{t(`wa.ins.${l.inspection}`)}</span>
          {l.itpHold?.mir && <div className="sm" style={{ color: "var(--warn)" }} title={holdText(l.itpHold.mir, t)}>{t("wa.itpHold")} · {l.itpHold.mir.irNo || t("wa.irNeeded")}</div>}</td>
        <td>{l.traceable ? <span className={"pill " + MTC[l.mtcStatus]}>{t(`wa.mtc.${l.mtcStatus}`)}</span> : <span className="muted sm">{t("wa.notNeeded")}</span>}
          {l.traceable && l.itpHold?.mtc && <div className="sm" style={{ color: "var(--warn)" }} title={holdText(l.itpHold.mtc, t)}>{t("wa.itpHold")} · {l.itpHold.mtc.irNo || t("wa.irNeeded")}</div>}</td>
        <td className="mono">{l.qtyReceived} {l.uom}</td>
        <td className="mono">{l.accepted}</td>
        <td className="mono">{l.netIssued}</td>
        <td className="mono">{l.onHand}</td>
        <td>{l.issuable ? <span className="pill ok">{t("wa.yes")}</span> : <span className="pill bad" title={l.holdReasons.join(" · ")}>{t("wa.no")}</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>{open ? t("common.close") : t("pu.details")}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={11} style={{ background: "rgba(255,255,255,.02)" }}>
            <LotDetail l={l} data={data} post={post} mayRecord={mayRecord} mayInspect={mayInspect} call={call} projectId={projectId} />
          </td>
        </tr>
      )}
    </>
  );
}

function LotDetail({ l, data, post, mayRecord, mayInspect, call, projectId }) {
  const [ins, setIns] = useState({ qtyAccepted: l.accepted || l.qtyReceived, qtyRejected: 0, mirRef: "", inspectedOn: today() });
  const [mtc, setMtc] = useState({ mtcRef: l.mtcRef || "", heatNo: l.heatNo || "" });
  const [mv, setMv] = useState({ kind: "issue", qty: "", refNo: "", spoolId: "", contractorId: "", purpose: "", movedOn: today() });
  const [dest, setDest] = useState(null);
  const { t } = usePrefs();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!l.issuable && <p className="sm err">{t("wa.notIssuable")} {l.holdReasons.join(" · ")}</p>}
      {(l.itpHold?.mir || (l.traceable && l.itpHold?.mtc)) && (
        <div className="card" style={{ padding: 10, borderColor: "var(--warn)" }}>
          <b className="sm">{t("wa.holdTitle")}</b>
          {l.itpHold?.mir && <p className="sm">MIR: {holdText(l.itpHold.mir, t)} — «{l.itpHold.mir.title}»</p>}
          {l.traceable && l.itpHold?.mtc && <p className="sm">MTC: {holdText(l.itpHold.mtc, t)} — «{l.itpHold.mtc.title}»</p>}
          <a className="sm" href="/inspection">{t("wa.toInspection")}</a>
        </div>
      )}
      <p className="sm muted">{l.spec || ""} {l.poRef ? `· PO ${l.poRef}` : ""} {l.supplier ? `· ${l.supplier}` : ""} {l.location ? `· ${t("wa.at", { loc: l.location })}` : ""}</p>
      {mayInspect && (
        <div className="grid2">
          <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={(e) => {
            e.preventDefault(); post({ kind: "inspect", lotId: l.id, ...ins });
          }}>
            <b className="sm" style={{ gridColumn: "1/-1" }}>{t("wa.mir")}</b>
            <Field id={`ia-${l.id}`} label={t("wa.h.accepted")} type="number" value={ins.qtyAccepted} on={(v) => setIns({ ...ins, qtyAccepted: v })} />
            <Field id={`ir-${l.id}`} label={t("wa.rejected")} type="number" value={ins.qtyRejected} on={(v) => setIns({ ...ins, qtyRejected: v })} />
            <Field id={`im-${l.id}`} label={t("wa.mirNo")} value={ins.mirRef} on={(v) => setIns({ ...ins, mirRef: v })} />
            <Field id={`id-${l.id}`} label={t("pu.f.inspectedOn")} type="date" value={ins.inspectedOn} on={(v) => setIns({ ...ins, inspectedOn: v })} />
            <div><button className="btn" type="submit">{t("wa.saveMir")}</button></div>
          </form>
          {l.traceable && (
            <div className="card grid2" style={{ padding: 10, alignItems: "end" }}>
              <b className="sm" style={{ gridColumn: "1/-1" }}>{t("wa.mtcTitle")}</b>
              <Field id={`mr-${l.id}`} label={t("wa.mtcNo")} value={mtc.mtcRef} on={(v) => setMtc({ ...mtc, mtcRef: v })} />
              <Field id={`mh-${l.id}`} label={t("wa.heatNo")} value={mtc.heatNo} on={(v) => setMtc({ ...mtc, heatNo: v })} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => post({ kind: "mtc", lotId: l.id, ...mtc, mtcStatus: "accepted" })}>{t("pu.vdt.accept")}</button>
                <button className="btn ghost" onClick={() => post({ kind: "mtc", lotId: l.id, ...mtc, mtcStatus: "rejected" })}>{t("wa.reject")}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {mayRecord && (
        <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: mv.kind, lotId: l.id, qty: mv.qty, movedOn: mv.movedOn, refNo: mv.refNo || null,
            spoolId: mv.spoolId || null, contractorId: mv.contractorId || null, purpose: mv.purpose || null })) {
            setMv({ ...mv, qty: "", refNo: "" });
          }
        }}>
          <b className="sm" style={{ gridColumn: "1/-1" }}>{t("wa.move")}</b>
          <div className="field"><label htmlFor={`mk-${l.id}`}>{t("pu.f.kind")}</label>
            <select id={`mk-${l.id}`} value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}>
              <option value="issue">{t("wa.issue")}</option><option value="return">{t("wa.return")}</option></select></div>
          <Field id={`mq-${l.id}`} label={t("wa.qtyUom", { uom: l.uom })} type="number" value={mv.qty} on={(v) => setMv({ ...mv, qty: v })}
                 hint={t("wa.qtyHint", { onHand: l.onHand, net: l.netIssued })} />
          <div className="field"><label htmlFor={`ms-${l.id}`}>{t("wa.spool")}</label>
            <select id={`ms-${l.id}`} value={mv.spoolId} onChange={(e) => setMv({ ...mv, spoolId: e.target.value })}>
              <option value="">—</option>
              {data.spools.map((s) => <option key={s.id} value={s.id}>{s.line_no} / {s.spool_no}</option>)}
            </select></div>
          <div className="field"><label htmlFor={`mc-${l.id}`}>{t("c.contractor")}</label>
            <select id={`mc-${l.id}`} value={mv.contractorId} onChange={(e) => setMv({ ...mv, contractorId: e.target.value })}>
              <option value="">—</option>
              {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select></div>
          <Field id={`mp-${l.id}`} label={t("wa.purposeIfNot")} value={mv.purpose} on={(v) => setMv({ ...mv, purpose: v })} />
          <Field id={`mn-${l.id}`} label={t("wa.issueNo")} value={mv.refNo} on={(v) => setMv({ ...mv, refNo: v })} />
          <Field id={`mo-${l.id}`} label={t("c.date")} type="date" value={mv.movedOn} on={(v) => setMv({ ...mv, movedOn: v })} />
          <div><button className="btn" type="submit" disabled={!mv.qty}>{t("c.submit")}</button></div>
        </form>
      )}
      <div>
        <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={async () =>
          setDest((await call(`/api/warehouse?projectId=${projectId}&lotId=${l.id}`)).destinations)}>{t("wa.whereWent")}</button>
        {dest && <Recall list={dest} />}
      </div>
    </div>
  );
}

function Recall({ list }) {
  const { t, L } = usePrefs();
  if (!list.length) return <p className="muted sm">{t("wa.recallEmpty")}</p>;
  return (
    <TableKit name="warehouse-3">
      <table className="dtable">
        <thead><tr><th>{t("wa.h.lineSpool")}</th><th>{t("wa.h.tagUse")}</th><th>{t("pu.h.qty")}</th><th>{t("wa.h.spoolStage")}</th></tr></thead>
        <tbody>
          {list.map((d, k) => (
            <tr key={k}>
              <td className="mono">{d.spool_no ? `${d.line_no || ""} / ${d.spool_no}` : "—"}</td>
              <td className="mono">{d.tag_no || d.purpose || "—"}</td>
              <td className="mono">{d.qty}</td>
              <td className="sm">{d.spool_no ? spoolStage(d.spool_stage, t, L) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableKit>
  );
}

function HeatTrace({ call, projectId }) {
  const [h, setH] = useState("");
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  const { t } = usePrefs();
  return (
    <div className="card">
      <h2>{t("wa.heat.title")}</h2>
      <form style={{ display: "flex", gap: 8 }} onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        try { setR(await call(`/api/warehouse?projectId=${projectId}&heat=${encodeURIComponent(h)}`)); } catch (x) { setErr(x.message); }
      }}>
        <input className="search" dir="ltr" placeholder="Heat No." value={h} onChange={(e) => setH(e.target.value)} style={{ maxWidth: 220 }} aria-label={t("wa.heatNo")} />
        <button className="btn" type="submit" disabled={!h.trim()}>{t("pu.v.search")}</button>
      </form>
      {err && <p className="err">{err}</p>}
      {r && (r.lots.length === 0 ? <p className="muted sm">{t("wa.heat.none")}</p> : (
        <>
          <p className="sm">{t("wa.heat.lots", { n: r.lots.length })} {r.lots.map((l) => `${l.receiptNo} (${l.code}${t("c.sep")}MTC ${t(`wa.mtc.${l.mtcStatus}`)})`).join(" · ")}</p>
          <Recall list={r.destinations} />
        </>
      ))}
    </div>
  );
}

function Receive({ items, post }) {
  const blank = { itemId: items[0].id, receiptNo: "", poRef: "", supplier: "", heatNo: "", mtcRef: "", qtyReceived: "", location: "", receivedOn: today() };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "receive", ...f })) setF({ ...blank, itemId: f.itemId, receivedOn: f.receivedOn }); }}>
      <h2>{t("wa.mrr")}</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="rc-item">{t("pu.f.item")}</label>
          <select id="rc-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
          </select></div>
        <FormNo id="rc-no" form="receipt" label={t("wa.receiptNo")} value={f.receiptNo} on={(v) => setF({ ...f, receiptNo: v })} />
        <Field id="rc-po" label="PO" value={f.poRef} on={(v) => setF({ ...f, poRef: v })} />
        <Field id="rc-sup" label={t("wa.supplier")} value={f.supplier} on={(v) => setF({ ...f, supplier: v })} />
        <Field id="rc-heat" label={t("wa.heatNoHeat")} value={f.heatNo} on={(v) => setF({ ...f, heatNo: v })} />
        <Field id="rc-mtc" label={t("wa.mtcNo")} value={f.mtcRef} on={(v) => setF({ ...f, mtcRef: v })} />
        <Field id="rc-qty" label={t("wa.qtyReceived")} type="number" value={f.qtyReceived} on={(v) => setF({ ...f, qtyReceived: v })} required />
        <Field id="rc-loc" label={t("pu.f.storeLoc")} value={f.location} on={(v) => setF({ ...f, location: v })} />
        <Field id="rc-on" label={t("wa.receivedOn")} type="date" value={f.receivedOn} on={(v) => setF({ ...f, receivedOn: v })} required />
      </div>
      <p className="muted sm">{t("wa.quarantineNote")}</p>
      <div><button className="btn" type="submit">{t("wa.saveReceipt")}</button></div>
    </form>
  );
}

function ItemForm({ post }) {
  const blank = { code: "", description: "", category: "pipe", uom: "m", spec: "" };
  const [f, setF] = useState(blank);
  const { t, L } = usePrefs();
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "item", ...f })) setF(blank); }}>
      <h2>{t("wa.newItem")}</h2>
      <div className="grid2">
        <Field id="it-code" label={t("wa.ident")} value={f.code} on={(v) => setF({ ...f, code: v })} required />
        <Field id="it-desc" label={t("c.description")} value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <div className="field"><label htmlFor="it-cat">{t("c.category")}</label>
          <select id="it-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{L(`wh.cat.${k}`, v)}</option>)}
          </select></div>
        <Field id="it-uom" label={t("wa.uom")} value={f.uom} on={(v) => setF({ ...f, uom: v })} required hint={t("wa.uomHint")} />
        <Field id="it-spec" label={t("wa.spec")} value={f.spec} on={(v) => setF({ ...f, spec: v })} hint={t("wa.specHint")} />
      </div>
      <div><button className="btn" type="submit">{t("wa.saveItem")}</button></div>
    </form>
  );
}

function Requirement({ items, post }) {
  const [f, setF] = useState({ itemId: items[0].id, qty: "", source: "" });
  const { t } = usePrefs();
  return (
    <form className="card grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "requirement", ...f })) setF({ ...f, qty: "" }); }}>
      <h2 style={{ gridColumn: "1/-1" }}>{t("wa.mto")}</h2>
      <div className="field"><label htmlFor="rq-item">{t("pu.f.item")}</label>
        <select id="rq-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}
        </select></div>
      <Field id="rq-qty" label={t("pu.h.qty")} type="number" value={f.qty} on={(v) => setF({ ...f, qty: v })} required />
      <Field id="rq-src" label={t("wa.mtoSource")} value={f.source} on={(v) => setF({ ...f, source: v })} required />
      <div><button className="btn" type="submit">{t("wa.saveReq")}</button></div>
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"}
             required={required} value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
