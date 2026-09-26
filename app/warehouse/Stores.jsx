"use client";
import { useState } from "react";
import { useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Reservations and stock counts. Rules: lib/warehouse/reserve.mjs.
 */
const RES = { active: ["warn", "فعال"], fulfilled: ["ok", "حواله شد"], released: ["", "آزاد شد"] };
const VAR = { match: ["ok", "برابر"], gain: ["warn", "اضافه"], loss: ["bad", "کسری"] };

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
  return (
    <div className="card">
      <h2>رزرو کالا</h2>
      <p className="muted sm">کالای رزروشده برای یک اسپول یا تگ به مقصد دیگری حواله نمی‌شود. «مانده» از حواله‌های همان مقصد حساب می‌شود. رزرو فقط از موجودیِ قابل‌حواله و آزاد ممکن است.</p>
      {data.reservations.length === 0 ? <p className="empty-note">رزروی ثبت نشده.</p> : (
        <TableKit name="reservations">
          <table className="dtable">
            <thead><tr><th>کالا</th><th>لات</th><th>مقصد</th><th>رزرو</th><th>حواله‌شده</th><th>مانده</th><th>نیاز تا</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {data.reservations.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{r.itemCode}</td><td className="sm">{r.lot || "هر لات"}</td><td>{r.dest}</td>
                  <td className="mono">{r.qty} {r.uom}</td><td className="mono">{r.issued}</td><td className="mono">{r.left}</td>
                  <td className="mono">{r.needBy || "—"}</td>
                  <td><span className={`pill ${RES[r.state][0]}`}>{RES[r.state][1]}</span>{r.releaseReason && <div className="muted sm">{r.releaseReason}</div>}</td>
                  <td>{may && r.state === "active" && <Release r={r} post={post} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {may && <Fold title="رزرو جدید"><ReserveForm data={data} post={post} /></Fold>}
      {active.length > 0 && <p className="muted sm">{active.length} رزرو فعال.</p>}
    </div>
  );
}

function Release({ r, post }) {
  const [reason, setReason] = useState("");
  return (
    <span style={{ display: "flex", gap: 4 }}>
      <input aria-label="دلیل آزادسازی" placeholder="دلیل" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 130 }} />
      <button className="btn ghost" onClick={() => post({ kind: "release", reservationId: r.id, reason })}>آزادسازی</button>
    </span>
  );
}

function ReserveForm({ data, post }) {
  const blank = { itemId: "", lotId: "", qty: "", dest: "", purpose: "", needBy: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const lots = data.lots.filter((l) => l.itemId === f.itemId && l.onHand > 0);
  const dests = [...data.spools.map((s) => [`s:${s.id}`, `اسپول ${s.spool_no}`]), ...data.tags.map((t) => [`t:${t.id}`, `تگ ${t.tag_no}`])];
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const [k, id] = f.dest.split(":");
      if (await post({ kind: "reserve", itemId: f.itemId, lotId: f.lotId || null, qty: f.qty, needBy: f.needBy || null,
        spoolId: k === "s" ? id : null, tagId: k === "t" ? id : null, purpose: f.dest ? null : f.purpose })) setF(blank);
    }}>
      <div className="grid2">
        <Select id="rs-i" label="کالا" value={f.itemId} on={(v) => setF({ ...f, itemId: v, lotId: "" })} opts={data.items.map((i) => [i.id, `${i.code} (${i.uom})`])} blank="—" />
        <Select id="rs-l" label="لات (وقتی ذوب مهم است)" value={f.lotId} on={on("lotId")} opts={lots.map((l) => [l.id, `${l.receiptNo}${l.heatNo ? ` · ${l.heatNo}` : ""} — ${l.onHand}`])} blank="هر لات قابل‌حواله" />
        <Field id="rs-q" label="مقدار" type="number" value={f.qty} on={on("qty")} />
        <Select id="rs-d" label="مقصد" value={f.dest} on={on("dest")} opts={dests} blank="— شرح مصرف —" />
        {!f.dest && <Field id="rs-p" label="شرح مصرف" value={f.purpose} on={on("purpose")} />}
        <Field id="rs-n" label="نیاز تا" type="date" value={f.needBy} on={on("needBy")} />
      </div>
      <button className="btn">رزرو</button>
    </form>
  );
}

function Counts({ data, post, mayStore, mayApprove }) {
  // Until someone picks, the count in progress is the one shown — including one just opened.
  const [picked, setOpen] = useState(undefined);
  const open = picked === undefined ? data.counts.find((c) => c.status === "open")?.id ?? null : picked;
  return (
    <div className="card">
      <h2>انبارگردانی</h2>
      <p className="muted sm">شمارش هر لات با موجودی دفتری همان روز مقایسه می‌شود. مغایرت با ویرایش دفتر رفع نمی‌شود: کسی غیر از ثبت‌کنندهٔ شمارش تصمیم می‌گیرد — اصلاح دفتر (حرکت «اضافه/کسری شمارش» با دلیل) یا حفظ دفتر. دقت موجودی = سهم لات‌هایی که دقیقاً برابر بودند.</p>
      {data.counts.length === 0 ? <p className="empty-note">انبارگردانی ثبت نشده.</p> : (
        <TableKit name="counts">
          <table className="dtable">
            <thead><tr><th>شماره</th><th>تاریخ</th><th>محدوده</th><th>لات شمرده</th><th>دقت</th><th>مغایرت باز</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {data.counts.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.countNo}</td><td className="mono">{c.countedOn}</td><td>{c.scope || "—"}</td>
                  <td className="mono">{c.lines.length}</td><td className="mono">{c.accuracyPct === null ? "—" : `${c.accuracyPct}٪`}</td>
                  <td className="mono">{c.pending}</td><td>{c.status === "open" ? <span className="pill warn">باز</span> : <span className="pill ok">بسته</span>}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === c.id ? null : c.id)}>{open === c.id ? "بستن" : "جزئیات"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {data.counts.filter((c) => c.id === open).map((c) => <CountDetail key={c.id} c={c} data={data} post={post} mayStore={mayStore} mayApprove={mayApprove} />)}
      {mayStore && <Fold title="انبارگردانی جدید"><OpenCount post={post} /></Fold>}
    </div>
  );
}

function CountDetail({ c, data, post, mayStore, mayApprove }) {
  const counted = new Set(c.lines.map((l) => l.lotId));
  const [f, setF] = useState({ lotId: "", countedQty: "", countedBy: "" });
  const openC = c.status === "open";
  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3>{c.countNo} — {c.countedOn}</h3>
      {c.lines.length > 0 && (
        <TableKit name="count-lines">
          <table className="dtable">
            <thead><tr><th>کالا</th><th>لات</th><th>دفتر</th><th>شمارش</th><th>مغایرت</th><th>تصمیم</th></tr></thead>
            <tbody>
              {c.lines.map((l) => (
                <tr key={l.id}>
                  <td className="mono">{l.itemCode}</td><td className="sm">{l.receiptNo}{l.heatNo && ` · ${l.heatNo}`}{l.location && ` · ${l.location}`}</td>
                  <td className="mono">{l.systemQty}</td><td className="mono">{l.countedQty}{l.countedBy && <div className="muted sm">{l.countedBy}</div>}</td>
                  <td><span className={`pill ${VAR[l.kind][0]}`}>{VAR[l.kind][1]}{l.diff !== 0 && ` ${l.diff > 0 ? "+" : ""}${l.diff}`}</span></td>
                  <td className="sm">{l.decision ? `${l.decision === "adjust" ? "دفتر اصلاح شد" : "دفتر حفظ شد"} — ${l.decisionReason}${l.decidedName ? ` (${l.decidedName})` : ""}`
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
            <Select id={`cl-l-${c.id}`} label="لات" value={f.lotId} on={(v) => setF({ ...f, lotId: v })}
                    opts={data.lots.filter((l) => !counted.has(l.id) && l.inspection !== "pending").map((l) => [l.id, `${l.code} · ${l.receiptNo}${l.heatNo ? ` · ${l.heatNo}` : ""}`])} blank="—" />
            <Field id={`cl-q-${c.id}`} label="مقدار شمرده‌شده" type="number" value={f.countedQty} on={(v) => setF({ ...f, countedQty: v })} />
            <Field id={`cl-b-${c.id}`} label="شمارنده" value={f.countedBy} on={(v) => setF({ ...f, countedBy: v })} />
          </div>
          <button className="btn ghost">ثبت شمارش</button>
        </form>
      )}
      {openC && mayApprove && <p><button className="btn" onClick={() => post({ kind: "count-close", countId: c.id })}>بستن انبارگردانی</button></p>}
    </div>
  );
}

function Decide({ l, post }) {
  const [reason, setReason] = useState("");
  return (
    <span style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      <input aria-label="دلیل تصمیم" placeholder="دلیل" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 150 }} />
      <button className="btn ghost" onClick={() => post({ kind: "count-decide", lineId: l.id, decision: "adjust", reason })}>اصلاح دفتر</button>
      <button className="btn ghost" onClick={() => post({ kind: "count-decide", lineId: l.id, decision: "keep_book", reason })}>حفظ دفتر</button>
    </span>
  );
}

function OpenCount({ post }) {
  const blank = { countNo: "", countedOn: new Date().toISOString().slice(0, 10), scope: "" };
  const [f, setF] = useState(blank);
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "count-open", ...f })) setF(blank); }}>
      <div className="grid2">
        <Field id="sc-no" label="شمارهٔ انبارگردانی" value={f.countNo} on={(v) => setF({ ...f, countNo: v })} />
        <Field id="sc-on" label="تاریخ شمارش" type="date" value={f.countedOn} on={(v) => setF({ ...f, countedOn: v })} />
        <Field id="sc-sc" label="محدوده (محل یا گروه کالا)" value={f.scope} on={(v) => setF({ ...f, scope: v })} />
      </div>
      <button className="btn">شروع انبارگردانی</button>
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
