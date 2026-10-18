"use client";
import { useState } from "react";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import FormNo from "../../components/ui/FormNo";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { DEST_FA } from "../../lib/warehouse/reserve.mjs";

/**
 * Reservations and stock counts. Rules: lib/warehouse/reserve.mjs.
 */
// tones; the words are wa.res.<state> and wa.var.<kind>
const RES = { active: "warn", fulfilled: "ok", released: "" };
const VAR = { match: "ok", gain: "warn", loss: "bad" };

export default function Stores({ projectId, call, mayStore, mayApprove }) {
  const { data, error, reload } = useProjectData((id) => `/api/warehouse/stores?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/warehouse/stores", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return null;
  return (
    <>
      {msg && <p className="err">{msg}</p>}
      <Reservations data={data} post={post} may={mayStore} />
      <Counts data={data} post={post} mayStore={mayStore} mayApprove={mayApprove} />
    </>
  );
}

function Reservations({ data, post, may }) {
  const active = data.reservations.filter((r) => r.state === "active");
  const { t, L, date } = usePrefs();
  return (
    <div className="card">
      <h2>{t("wa.res.title")}</h2>
      <p className="muted sm">{t("wa.res.note")}</p>
      {data.reservations.length === 0 ? <p className="empty-note">{t("wa.res.empty")}</p> : (
        <TableKit name="reservations">
          <table className="dtable">
            <thead><tr><th>{t("pu.f.item")}</th><th>{t("wa.lot")}</th><th>{t("wa.res.dest")}</th><th>{t("wa.res.reserved")}</th><th>{t("wa.h.issued")}</th><th>{t("wa.res.left")}</th><th>{t("wa.res.needBy")}</th><th>{t("c.status")}</th><th /></tr></thead>
            <tbody>
              {data.reservations.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.itemCode}</td><td className="sm">{r.lot || t("wa.res.anyLot")}</td><td>{r.destKind === "purpose" ? r.destNo : `${L(`wh.dest.${r.destKind}`, DEST_FA[r.destKind])} ${r.destNo}`}</td>
                  <td className="mono">{r.qty} {r.uom}</td><td className="mono">{r.issued}</td><td className="mono">{r.left}</td>
                  <td className="mono">{r.needBy ? date(r.needBy) : "—"}</td>
                  <td><span className={`pill ${RES[r.state]}`}>{t(`wa.res.${r.state}`)}</span>{r.releaseReason && <div className="muted sm">{r.releaseReason}</div>}</td>
                  <td>{may && r.state === "active" && <Release r={r} post={post} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {may && <Fold title={t("wa.res.new")}><ReserveForm data={data} post={post} /></Fold>}
      {active.length > 0 && <p className="muted sm">{t("wa.res.activeN", { n: active.length })}</p>}
    </div>
  );
}

function Release({ r, post }) {
  const [reason, setReason] = useState("");
  const { t } = usePrefs();
  return (
    <span style={{ display: "flex", gap: 4 }}>
      <input aria-label={t("wa.res.releaseWhy")} placeholder={t("pu.vdt.reason")} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 130 }} />
      <button className="btn ghost" onClick={() => post({ kind: "release", reservationId: r.id, reason })}>{t("wa.res.release")}</button>
    </span>
  );
}

function ReserveForm({ data, post }) {
  const blank = { itemId: "", lotId: "", qty: "", dest: "", purpose: "", needBy: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const lots = data.lots.filter((l) => l.itemId === f.itemId && l.onHand > 0);
  const { t } = usePrefs();
  const dests = [...data.spools.map((s) => [`s:${s.id}`, t("wa.spoolNo", { no: s.spool_no })]), ...data.tags.map((x) => [`t:${x.id}`, t("pu.tagNo", { no: x.tag_no })])];
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const [k, id] = f.dest.split(":");
      if (await post({ kind: "reserve", itemId: f.itemId, lotId: f.lotId || null, qty: f.qty, needBy: f.needBy || null,
        spoolId: k === "s" ? id : null, tagId: k === "t" ? id : null, purpose: f.dest ? null : f.purpose })) setF(blank);
    }}>
      <div className="grid2">
        <Select id="rs-i" label={t("pu.f.item")} value={f.itemId} on={(v) => setF({ ...f, itemId: v, lotId: "" })} opts={data.items.map((i) => [i.id, `${i.code} (${i.uom})`])} blank="—" />
        <Select id="rs-l" label={t("wa.res.lotWhen")} value={f.lotId} on={on("lotId")} opts={lots.map((l) => [l.id, `${l.receiptNo}${l.heatNo ? ` · ${l.heatNo}` : ""} — ${l.onHand}`])} blank={t("wa.res.anyIssuable")} />
        <Field id="rs-q" label={t("pu.h.qty")} type="number" value={f.qty} on={on("qty")} />
        <Select id="rs-d" label={t("wa.res.dest")} value={f.dest} on={on("dest")} opts={dests} blank={t("wa.res.purposeBlank")} />
        {!f.dest && <Field id="rs-p" label={t("wa.res.purpose")} value={f.purpose} on={on("purpose")} />}
        <Field id="rs-n" label={t("wa.res.needBy")} type="date" value={f.needBy} on={on("needBy")} />
      </div>
      <button className="btn">{t("wa.res.reserve")}</button>
    </form>
  );
}

function Counts({ data, post, mayStore, mayApprove }) {
  // Until someone picks, the count in progress is the one shown — including one just opened.
  const [picked, setOpen] = useState(undefined);
  const open = picked === undefined ? data.counts.find((c) => c.status === "open")?.id ?? null : picked;
  const { t, date, num } = usePrefs();
  return (
    <div className="card">
      <h2>{t("wa.cnt.title")}</h2>
      <p className="muted sm">{t("wa.cnt.note")}</p>
      {data.counts.length === 0 ? <p className="empty-note">{t("wa.cnt.empty")}</p> : (
        <TableKit name="counts">
          <table className="dtable">
            <thead><tr><th>{t("c.no")}</th><th>{t("c.date")}</th><th>{t("wa.cnt.scope")}</th><th>{t("wa.cnt.lots")}</th><th>{t("wa.cnt.accuracy")}</th><th>{t("wa.cnt.openDiff")}</th><th>{t("c.status")}</th><th /></tr></thead>
            <tbody>
              {data.counts.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.countNo}</td><td className="mono">{date(c.countedOn)}</td><td>{c.scope || "—"}</td>
                  <td className="mono">{c.lines.length}</td><td className="mono">{c.accuracyPct === null ? "—" : `${num(c.accuracyPct)}%`}</td>
                  <td className="mono">{c.pending}</td><td>{c.status === "open" ? <span className="pill warn">{t("wa.cnt.open")}</span> : <span className="pill ok">{t("wa.cnt.closed")}</span>}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? t("common.close") : t("pu.details")}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {data.counts.filter((c) => c.id === open).map((c) => <CountDetail key={c.id} c={c} data={data} post={post} mayStore={mayStore} mayApprove={mayApprove} />)}
      {mayStore && <Fold title={t("wa.cnt.new")}><OpenCount post={post} /></Fold>}
    </div>
  );
}

function CountDetail({ c, data, post, mayStore, mayApprove }) {
  const counted = new Set(c.lines.map((l) => l.lotId));
  const [f, setF] = useState({ lotId: "", countedQty: "", countedBy: "" });
  const openC = c.status === "open";
  const { t, date } = usePrefs();
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{c.countNo} — {date(c.countedOn)}</h3>
      {c.lines.length > 0 && (
        <TableKit name="count-lines">
          <table className="dtable">
            <thead><tr><th>{t("pu.f.item")}</th><th>{t("wa.lot")}</th><th>{t("wa.cnt.book")}</th><th>{t("wa.cnt.count")}</th><th>{t("wa.cnt.diff")}</th><th>{t("wa.cnt.decision")}</th></tr></thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.itemCode}</td><td className="sm">{l.receiptNo}{l.heatNo && ` · ${l.heatNo}`}{l.location && ` · ${l.location}`}</td>
                  <td className="mono">{l.systemQty}</td><td className="mono">{l.countedQty}{l.countedBy && <div className="muted sm">{l.countedBy}</div>}</td>
                  <td><span className={`pill ${VAR[l.kind]}`}>{t(`wa.var.${l.kind}`)}{l.diff !== 0 && ` ${l.diff > 0 ? "+" : ""}${l.diff}`}</span></td>
                  <td className="sm">{l.decision ? `${l.decision === "adjust" ? t("wa.cnt.adjusted") : t("wa.cnt.kept")} — ${l.decisionReason}${l.decidedName ? ` (${l.decidedName})` : ""}`
                    : l.kind !== "match" && openC && mayApprove ? <Decide l={l} post={post} /> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {openC && mayStore && (
        <form style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "count-enter", countId: c.id, ...f })) setF({ lotId: "", countedQty: "", countedBy: f.countedBy }); }}>
          <div className="grid2">
            <Select id={`cl-l-${c.id}`} label={t("wa.lot")} value={f.lotId} on={(v) => setF({ ...f, lotId: v })}
                    opts={data.lots.filter((l) => !counted.has(l.id) && l.inspection !== "pending").map((l) => [l.id, `${l.code} · ${l.receiptNo}${l.heatNo ? ` · ${l.heatNo}` : ""}`])} blank="—" />
            <Field id={`cl-q-${c.id}`} label={t("wa.cnt.counted")} type="number" value={f.countedQty} on={(v) => setF({ ...f, countedQty: v })} />
            <Field id={`cl-b-${c.id}`} label={t("wa.cnt.counter")} value={f.countedBy} on={(v) => setF({ ...f, countedBy: v })} />
          </div>
          <button className="btn ghost">{t("wa.cnt.saveCount")}</button>
        </form>
      )}
      {openC && mayApprove && <p><button className="btn" onClick={() => post({ kind: "count-close", countId: c.id })}>{t("wa.cnt.close")}</button></p>}
    </div>
  );
}

function Decide({ l, post }) {
  const [reason, setReason] = useState("");
  const { t } = usePrefs();
  return (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <input aria-label={t("wa.cnt.decideWhy")} placeholder={t("pu.vdt.reason")} value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 150 }} />
      <button className="btn ghost" onClick={() => post({ kind: "count-decide", lineId: l.id, decision: "adjust", reason })}>{t("wa.cnt.adjust")}</button>
      <button className="btn ghost" onClick={() => post({ kind: "count-decide", lineId: l.id, decision: "keep_book", reason })}>{t("wa.cnt.keep")}</button>
    </span>
  );
}

function OpenCount({ post }) {
  const blank = { countNo: "", countedOn: new Date().toISOString().slice(0, 10), scope: "" };
  const [f, setF] = useState(blank);
  const { t } = usePrefs();
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "count-open", ...f })) setF(blank); }}>
      <div className="grid2">
        <FormNo id="sc-no" form="stock_count" label={t("wa.cnt.no")} value={f.countNo} on={(v) => setF({ ...f, countNo: v })} />
        <Field id="sc-on" label={t("wa.cnt.on")} type="date" value={f.countedOn} on={(v) => setF({ ...f, countedOn: v })} />
        <Field id="sc-sc" label={t("wa.cnt.scopeHelp")} value={f.scope} on={(v) => setF({ ...f, scope: v })} />
      </div>
      <button className="btn">{t("wa.cnt.start")}</button>
    </form>
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
