"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { CATEGORIES } from "../../lib/warehouse/stock.mjs";
import { spoolStageTitle } from "../../lib/platform/precedence.mjs";

/**
 * Warehouse: what arrived, what inspection and the certificates allow out,
 * where it went, and what the MTO still lacks.
 *
 * Stock is never typed: it is accepted less issued plus returned. A lot of
 * pipe, fittings, flanges, valves, plate, structural steel or bolting leaves
 * only with a heat number and an accepted MTC; every issue says where it
 * went, so a certificate rejected late turns into a recall list at once.
 */
const INSPECTION = { pending: ["", "منتظر MIR"], accepted: ["ok", "پذیرفته"], partial: ["", "پذیرش جزئی"], rejected: ["bad", "رد"] };
const MTC = { pending: ["", "بررسی‌نشده"], accepted: ["ok", "پذیرفته"], rejected: ["bad", "رد — قرنطینه"] };

export default function WarehousePage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/warehouse?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const [recall, setRecall] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayInspect = can({ role }, ACTIONS.RECORD_NDT);
  const mayEngineer = can({ role }, ACTIONS.EDIT_EXTRACTION);

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
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const held = data.lots.filter((l) => !l.issuable && l.onHand > 0).length;
  const pendingMir = data.lots.filter((l) => l.inspection === "pending").length;
  const short = data.shortages.filter((s) => s.shortfall > 0).length;
  const suspect = data.lots.filter((l) => l.mtcStatus === "rejected" && l.netIssued > 0).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>انبار و مواد</h1>
        <span className="sub">
          {data.items.length} کالا · {data.lots.length} لات · {pendingMir} منتظر MIR · {held} لات در قرنطینه
          {short > 0 && ` · ${short} کالا با کسری نسبت به MTO`}
          {suspect > 0 && ` · ${suspect} لات مشکوک حواله‌شده`}
        </span>
      </div>
      {msg && <p className="err">{msg}</p>}
      {recall && (
        <div className="card" style={{ borderColor: "rgba(226,87,76,.6)" }}>
          <h2 style={{ color: "var(--bad)" }}>فراخوان — مواد این لات قبلاً حواله شده</h2>
          <Recall list={recall} />
          <div><button className="btn ghost" onClick={() => setRecall(null)}>بستن</button></div>
        </div>
      )}

      <Shortages rows={data.shortages} />

      <div className="card">
        <h2>موجودی به تفکیک لات</h2>
        {data.lots.length === 0 ? <p className="empty-note">هنوز رسیدی ثبت نشده است.</p> : (
          <div className="wrap">
            <table className="dtable">
              <thead><tr><th>کالا</th><th>رسید</th><th>Heat</th><th>MIR</th><th>MTC</th><th>دریافتی</th><th>پذیرفته</th>
                <th>حواله خالص</th><th>موجود</th><th>قابل حواله</th><th /></tr></thead>
              <tbody>
                {data.lots.map((l) => (
                  <LotRow key={l.id} l={l} open={open === l.id} onToggle={() => setOpen(open === l.id ? null : l.id)}
                          data={data} post={post} mayRecord={mayRecord} mayInspect={mayInspect} call={call} projectId={projectId} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <HeatTrace call={call} projectId={projectId} />
      {mayRecord && data.items.length > 0 && <Receive items={data.items} post={post} />}
      {mayEngineer && <ItemForm post={post} />}
      {mayEngineer && data.items.length > 0 && <Requirement items={data.items} post={post} />}
    </div>
  );
}

function Shortages({ rows }) {
  const any = rows.some((r) => r.required > 0);
  if (!any) return null;
  return (
    <div className="card">
      <h2>نیاز MTO در برابر موجودی</h2>
      <p className="muted sm">موجودی قرنطینه (بدون MIR یا MTC پذیرفته) از کسری کم نمی‌شود — لوله‌ای که نمی‌شود جوش داد موجودی نیست.</p>
      <div className="wrap">
        <table className="dtable">
          <thead><tr><th>کالا</th><th>منبع</th><th>نیاز</th><th>حواله‌شده</th><th>قابل حواله</th><th>قرنطینه</th><th>کسری</th><th>دسترسی</th><th>در راه (PO)</th></tr></thead>
          <tbody>
            {rows.filter((r) => r.required > 0).map((r) => (
              <tr key={r.itemId}>
                <td className="mono">{r.code}</td><td className="sm">{r.sources}</td>
                <td className="mono">{r.required} {r.uom}</td><td className="mono">{r.issued}</td>
                <td className="mono">{r.issuable}</td><td className="mono">{r.held}</td>
                <td className="mono">{r.shortfall > 0 ? <span className="pill bad">{r.shortfall}</span> : <span className="pill ok">0</span>}</td>
                <td className="mono">{r.availabilityPct}%</td>
                <td className="mono sm">{r.onOrder?.qty > 0
                  ? <a href="/procurement">{r.onOrder.qty} {r.uom}{r.onOrder.nextOn && ` · ${new Date(r.onOrder.nextOn).toLocaleDateString("fa-IR")}`}</a>
                  : r.shortfall > 0 ? <span className="pill bad">سفارشی نیست</span> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LotRow({ l, open, onToggle, data, post, mayRecord, mayInspect, call, projectId }) {
  return (
    <>
      <tr>
        <td className="sm"><span className="mono">{l.code}</span><div className="muted">{l.description}</div></td>
        <td className="mono sm">{l.receiptNo}<div className="muted">{fa(l.receivedOn)}</div></td>
        <td className="mono">{l.heatNo || (l.traceable ? <span className="pill bad">ندارد</span> : "—")}</td>
        <td><span className={"pill " + INSPECTION[l.inspection][0]}>{INSPECTION[l.inspection][1]}</span></td>
        <td>{l.traceable ? <span className={"pill " + MTC[l.mtcStatus][0]}>{MTC[l.mtcStatus][1]}</span> : <span className="muted sm">لازم نیست</span>}</td>
        <td className="mono">{l.qtyReceived} {l.uom}</td>
        <td className="mono">{l.accepted}</td>
        <td className="mono">{l.netIssued}</td>
        <td className="mono">{l.onHand}</td>
        <td>{l.issuable ? <span className="pill ok">بله</span> : <span className="pill bad" title={l.holdReasons.join(" · ")}>خیر</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>{open ? "بستن" : "جزئیات"}</button></td>
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
  const [ins, setIns] = useState({ qtyAccepted: l.accepted || l.qtyReceived, qtyRejected: 0, mirRef: "" });
  const [mtc, setMtc] = useState({ mtcRef: l.mtcRef || "", heatNo: l.heatNo || "" });
  const [mv, setMv] = useState({ kind: "issue", qty: "", refNo: "", spoolId: "", contractorId: "", purpose: "" });
  const [dest, setDest] = useState(null);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {!l.issuable && <p className="sm err">قابل حواله نیست: {l.holdReasons.join(" · ")}</p>}
      <p className="sm muted">{l.spec || ""} {l.poRef ? `· PO ${l.poRef}` : ""} {l.supplier ? `· ${l.supplier}` : ""} {l.location ? `· محل ${l.location}` : ""}</p>
      {mayInspect && (
        <div className="grid2">
          <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={(e) => {
            e.preventDefault(); post({ kind: "inspect", lotId: l.id, ...ins, inspectedOn: today() });
          }}>
            <b className="sm" style={{ gridColumn: "1/-1" }}>بازرسی ورود (MIR)</b>
            <Field id={`ia-${l.id}`} label="پذیرفته" type="number" value={ins.qtyAccepted} on={(v) => setIns({ ...ins, qtyAccepted: v })} />
            <Field id={`ir-${l.id}`} label="ردشده" type="number" value={ins.qtyRejected} on={(v) => setIns({ ...ins, qtyRejected: v })} />
            <Field id={`im-${l.id}`} label="شمارهٔ MIR" value={ins.mirRef} on={(v) => setIns({ ...ins, mirRef: v })} />
            <div><button className="btn" type="submit">ثبت MIR</button></div>
          </form>
          {l.traceable && (
            <div className="card grid2" style={{ padding: 10, alignItems: "end" }}>
              <b className="sm" style={{ gridColumn: "1/-1" }}>گواهی آزمون مواد (MTC)</b>
              <Field id={`mr-${l.id}`} label="شمارهٔ MTC" value={mtc.mtcRef} on={(v) => setMtc({ ...mtc, mtcRef: v })} />
              <Field id={`mh-${l.id}`} label="شمارهٔ ذوب" value={mtc.heatNo} on={(v) => setMtc({ ...mtc, heatNo: v })} />
              <div style={{ display: "flex", gap: 6 }}>
                <button className="btn" onClick={() => post({ kind: "mtc", lotId: l.id, ...mtc, mtcStatus: "accepted" })}>پذیرش</button>
                <button className="btn ghost" onClick={() => post({ kind: "mtc", lotId: l.id, ...mtc, mtcStatus: "rejected" })}>رد</button>
              </div>
            </div>
          )}
        </div>
      )}
      {mayRecord && (
        <form className="card grid2" style={{ padding: 10, alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: mv.kind, lotId: l.id, qty: mv.qty, movedOn: today(), refNo: mv.refNo || null,
            spoolId: mv.spoolId || null, contractorId: mv.contractorId || null, purpose: mv.purpose || null })) {
            setMv({ ...mv, qty: "", refNo: "" });
          }
        }}>
          <b className="sm" style={{ gridColumn: "1/-1" }}>حواله / برگشت</b>
          <div className="field"><label htmlFor={`mk-${l.id}`}>نوع</label>
            <select id={`mk-${l.id}`} value={mv.kind} onChange={(e) => setMv({ ...mv, kind: e.target.value })}>
              <option value="issue">حواله (MIV)</option><option value="return">برگشت</option></select></div>
          <Field id={`mq-${l.id}`} label={`مقدار (${l.uom})`} type="number" value={mv.qty} on={(v) => setMv({ ...mv, qty: v })}
                 hint={`موجود ${l.onHand} · حواله خالص ${l.netIssued}`} />
          <div className="field"><label htmlFor={`ms-${l.id}`}>اسپول</label>
            <select id={`ms-${l.id}`} value={mv.spoolId} onChange={(e) => setMv({ ...mv, spoolId: e.target.value })}>
              <option value="">—</option>
              {data.spools.map((s) => <option key={s.id} value={s.id}>{s.line_no} / {s.spool_no}</option>)}
            </select></div>
          <div className="field"><label htmlFor={`mc-${l.id}`}>پیمانکار</label>
            <select id={`mc-${l.id}`} value={mv.contractorId} onChange={(e) => setMv({ ...mv, contractorId: e.target.value })}>
              <option value="">—</option>
              {data.contractors.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select></div>
          <Field id={`mp-${l.id}`} label="شرح مصرف (اگر اسپول نیست)" value={mv.purpose} on={(v) => setMv({ ...mv, purpose: v })} />
          <Field id={`mn-${l.id}`} label="شمارهٔ حواله" value={mv.refNo} on={(v) => setMv({ ...mv, refNo: v })} />
          <div><button className="btn" type="submit" disabled={!mv.qty}>ثبت</button></div>
        </form>
      )}
      <div>
        <button className="btn ghost" style={{ padding: "4px 10px" }} onClick={async () =>
          setDest((await call(`/api/warehouse?projectId=${projectId}&lotId=${l.id}`)).destinations)}>مقصد مواد این لات</button>
        {dest && <Recall list={dest} />}
      </div>
    </div>
  );
}

function Recall({ list }) {
  if (!list.length) return <p className="muted sm">چیزی از این لات در کار نیست.</p>;
  return (
    <div className="wrap">
      <table className="dtable">
        <thead><tr><th>خط / اسپول</th><th>تگ / مصرف</th><th>مقدار</th><th>مرحلهٔ اسپول</th></tr></thead>
        <tbody>
          {list.map((d, k) => (
            <tr key={k}>
              <td className="mono">{d.spool_no ? `${d.line_no || ""} / ${d.spool_no}` : "—"}</td>
              <td className="mono">{d.tag_no || d.purpose || "—"}</td>
              <td className="mono">{d.qty}</td>
              <td className="sm">{d.spool_no ? spoolStageTitle(d.spool_stage) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HeatTrace({ call, projectId }) {
  const [h, setH] = useState("");
  const [r, setR] = useState(null);
  const [err, setErr] = useState(null);
  return (
    <div className="card">
      <h2>ردیابی شمارهٔ ذوب</h2>
      <form style={{ display: "flex", gap: 8 }} onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        try { setR(await call(`/api/warehouse?projectId=${projectId}&heat=${encodeURIComponent(h)}`)); } catch (x) { setErr(x.message); }
      }}>
        <input className="search" dir="ltr" placeholder="Heat No." value={h} onChange={(e) => setH(e.target.value)} style={{ maxWidth: 220 }} aria-label="شمارهٔ ذوب" />
        <button className="btn" type="submit" disabled={!h.trim()}>جستجو</button>
      </form>
      {err && <p className="err">{err}</p>}
      {r && (r.lots.length === 0 ? <p className="muted sm">این شمارهٔ ذوب در هیچ رسیدی نیست.</p> : (
        <>
          <p className="sm">{r.lots.length} لات: {r.lots.map((l) => `${l.receiptNo} (${l.code}، MTC ${MTC[l.mtcStatus][1]})`).join(" · ")}</p>
          <Recall list={r.destinations} />
        </>
      ))}
    </div>
  );
}

function Receive({ items, post }) {
  const blank = { itemId: items[0].id, receiptNo: "", poRef: "", supplier: "", heatNo: "", mtcRef: "", qtyReceived: "", location: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "receive", ...f, receivedOn: today() })) setF({ ...blank, itemId: f.itemId }); }}>
      <h2>رسید کالا (MRR)</h2>
      <div className="grid2">
        <div className="field"><label htmlFor="rc-item">کالا</label>
          <select id="rc-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
            {items.map((i) => <option key={i.id} value={i.id}>{i.code} — {i.description}</option>)}
          </select></div>
        <Field id="rc-no" label="شمارهٔ رسید" value={f.receiptNo} on={(v) => setF({ ...f, receiptNo: v })} required />
        <Field id="rc-po" label="PO" value={f.poRef} on={(v) => setF({ ...f, poRef: v })} />
        <Field id="rc-sup" label="تأمین‌کننده" value={f.supplier} on={(v) => setF({ ...f, supplier: v })} />
        <Field id="rc-heat" label="شمارهٔ ذوب (Heat)" value={f.heatNo} on={(v) => setF({ ...f, heatNo: v })} />
        <Field id="rc-mtc" label="شمارهٔ MTC" value={f.mtcRef} on={(v) => setF({ ...f, mtcRef: v })} />
        <Field id="rc-qty" label="مقدار دریافتی" type="number" value={f.qtyReceived} on={(v) => setF({ ...f, qtyReceived: v })} required />
        <Field id="rc-loc" label="محل انبار" value={f.location} on={(v) => setF({ ...f, location: v })} />
      </div>
      <p className="muted sm">لات تا ثبت MIR (و برای مواد ردیابی‌پذیر، پذیرش MTC) قرنطینه است.</p>
      <div><button className="btn" type="submit">ثبت رسید</button></div>
    </form>
  );
}

function ItemForm({ post }) {
  const blank = { code: "", description: "", category: "pipe", uom: "m", spec: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="card" onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "item", ...f })) setF(blank); }}>
      <h2>کالای جدید</h2>
      <div className="grid2">
        <Field id="it-code" label="کد (Ident)" value={f.code} on={(v) => setF({ ...f, code: v })} required />
        <Field id="it-desc" label="شرح" value={f.description} on={(v) => setF({ ...f, description: v })} required />
        <div className="field"><label htmlFor="it-cat">دسته</label>
          <select id="it-cat" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
            {Object.entries(CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></div>
        <Field id="it-uom" label="واحد" value={f.uom} on={(v) => setF({ ...f, uom: v })} required hint="m، EA، kg — تبدیل خودکار انجام نمی‌شود" />
        <Field id="it-spec" label="مشخصات مواد" value={f.spec} on={(v) => setF({ ...f, spec: v })} hint="مثلاً ASTM A106 Gr.B" />
      </div>
      <div><button className="btn" type="submit">ثبت کالا</button></div>
    </form>
  );
}

function Requirement({ items, post }) {
  const [f, setF] = useState({ itemId: items[0].id, qty: "", source: "" });
  return (
    <form className="card grid2" style={{ alignItems: "end" }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "requirement", ...f })) setF({ ...f, qty: "" }); }}>
      <h2 style={{ gridColumn: "1/-1" }}>نیاز از MTO</h2>
      <div className="field"><label htmlFor="rq-item">کالا</label>
        <select id="rq-item" value={f.itemId} onChange={(e) => setF({ ...f, itemId: e.target.value })}>
          {items.map((i) => <option key={i.id} value={i.id}>{i.code}</option>)}
        </select></div>
      <Field id="rq-qty" label="مقدار" type="number" value={f.qty} on={(v) => setF({ ...f, qty: v })} required />
      <Field id="rq-src" label="منبع (MTO و رویژن)" value={f.source} on={(v) => setF({ ...f, source: v })} required />
      <div><button className="btn" type="submit">ثبت نیاز</button></div>
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
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
