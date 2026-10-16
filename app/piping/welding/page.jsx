"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import TableKit from "../../../components/ui/TableKit";
import Tabs from "../../../components/ui/Tabs";
import Fold from "../../../components/ui/Fold";

/**
 * Who welded which joint, and what its NDT said — the daily entries of a
 * piping QC office, against the welds the approved registers created.
 *
 * Everything decisive is the server's: a welder outside his ticket (ASME IX
 * range, expiry, six-month continuity) is refused with the clause, NDT
 * before the weld is refused, and the repair cycle is numbered by the
 * server, not typed. The page picks welds in bulk because a shift's work
 * is one welder on several joints, or one RT report over several.
 */
const METHODS = ["RT", "UT", "PT", "MT", "VT"];
const RESULT_FA = { accept: "پذیرفته", reject: "رد" };

export default function WeldingPage() {
  const { projectId, role, call } = usePlatform();
  const may = { welders: can({ role }, ACTIONS.MANAGE_WELDERS), weld: can({ role }, ACTIONS.ASSIGN_WELD), ndt: can({ role }, ACTIONS.RECORD_NDT) };
  const { data: wd, reload: reloadWelders } = useProjectData((id) => `/api/welders?projectId=${id}`, []);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const { data: wl, reload: reloadWelds } = useProjectData((id) => `/api/welds?projectId=${id}&q=${encodeURIComponent(term)}`, [term]);
  const [picked, setPicked] = useState([]);
  const [msg, setMsg] = useState(null);
  const [results, setResults] = useState(null);
  useEffect(() => setPicked([]), [term]);

  const welders = wd?.welders || [];
  const welds = wl?.welds || [];

  /** One request per weld; each one's own answer is shown, because one refused joint does not undo the others. */
  async function forEach(label, path, body) {
    setMsg(null); setResults(null);
    const out = [];
    for (const uid of picked) {
      const w = welds.find((x) => x.weld_uid === uid);
      try {
        await call(`/api/welds/${encodeURIComponent(uid)}/${path}`, { method: "POST", body: JSON.stringify({ projectId, ...body }) });
        out.push({ no: w?.weld_no || uid, ok: true });
      } catch (e) { out.push({ no: w?.weld_no || uid, ok: false, text: e.message }); }
    }
    setResults({ label, out });
    // What was refused stays selected, to correct and send again.
    setPicked(picked.filter((uid, k) => !out[k].ok));
    if (out.some((r) => r.ok)) { reloadWelds(); reloadWelders(); }
  }

  return (
    <div className="page">
      <div className="pagehead">
        <h1>جوشکاری و NDT</h1>
        <span className="sub">{welders.length} جوشکار · {welds.length} جوش در فهرست</span>
      </div>
      {msg && <p className="err">{msg}</p>}

      <Tabs name="welding">
        <div className="card">
          <h2>ثبت جوشکاری و NDT</h2>
          <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
            <div className="field" style={{ flex: "1 1 260px" }}><label htmlFor="wj-q">خط، اسپول، نقشه، شمارهٔ جوش یا مهر جوشکار</label>
              <input id="wj-q" dir="ltr" value={q} onChange={(e) => setQ(e.target.value)} placeholder="70-DMW-7001" /></div>
            <button className="btn ghost" type="submit">جستجو</button>
          </form>
          {welds.length === 0 ? <p className="empty-note">{term ? "جوشی با این جستجو نیست." : "جوشی نیست — جوش‌ها از رجیستر تأییدشدهٔ ایزومتریک می‌آیند."}</p> : (
            <TableKit name="welding">
              <table className="dtable">
                <thead><tr>
                  <th><input type="checkbox" aria-label="انتخاب همه" checked={picked.length === welds.length}
                             onChange={(e) => setPicked(e.target.checked ? welds.map((w) => w.weld_uid) : [])} /></th>
                  <th>جوش</th><th>خط / اسپول</th><th>محل</th><th>نوع</th><th>جوشکاری</th><th>NDT</th></tr></thead>
                <tbody>{welds.map((w) => (
                  <tr key={w.weld_uid}>
                    <td><input type="checkbox" aria-label={`انتخاب ${w.weld_no} ${w.line_no || ""}`} checked={picked.includes(w.weld_uid)}
                               onChange={(e) => setPicked(e.target.checked ? [...picked, w.weld_uid] : picked.filter((x) => x !== w.weld_uid))} /></td>
                    <td className="mono"><a className="cy" href={`/piping/joint?uid=${encodeURIComponent(w.weld_uid)}`}>{w.weld_no}</a></td>
                    <td className="mono sm">{w.line_no || "—"} / {w.spool_no || "—"}</td>
                    <td className="sm">{w.shop_field === "Shop" ? "کارگاه" : "سایت"}</td>
                    <td className="mono sm">{w.weld_kind}{w.nps ? ` · ${w.nps}"` : ""}</td>
                    <td className="sm">{w.is_welded ? <span className="pill ok">{w.stamp_no} · {fa(w.welded_at)}</span> : <span className="muted">—</span>}</td>
                    <td className="sm">{w.is_accepted ? <span className="pill ok">پذیرفته</span>
                      : w.is_examined ? <span className="pill bad">رد / تعمیر</span>
                      : w.awaiting_ndt ? <span className="pill warn">منتظر NDT</span> : <span className="muted">—</span>}</td>
                  </tr>))}</tbody>
              </table>
            </TableKit>
          )}
          <p className="sm muted">{picked.length} جوش انتخاب شده.</p>
          {may.weld && <Fold title="ثبت جوشکاری"><WeldForm welders={welders} disabled={!picked.length}
            onSubmit={(b) => forEach("جوشکاری", "assign", b)} /></Fold>}
          {may.ndt && <Fold title="ثبت نتیجهٔ NDT"><NdtForm disabled={!picked.length} onSubmit={(b) => forEach("NDT", "ndt", b)} /></Fold>}
          {results && (
            <ul className="sm">{results.out.map((r) => (
              <li key={r.no}><span className="mono">{r.no}</span>: {r.ok ? <span className="pill ok">{results.label} ثبت شد</span> : <span className="err">{r.text}</span>}</li>
            ))}</ul>
          )}
        </div>

        <div className="card">
          <h2>جوشکاران</h2>
          {welders.length === 0 ? <p className="empty-note">جوشکاری ثبت نشده.</p> : (
            <TableKit name="welders">
              <table className="dtable">
                <thead><tr><th>مهر</th><th>نام</th><th>کارفرمای جوشکار</th><th>صلاحیت معتبر</th></tr></thead>
                <tbody>{welders.map((w) => (
                  <tr key={w.id}><td className="mono">{w.stamp_no}</td><td>{w.name}</td><td className="sm">{w.employer || "—"}</td>
                    <td className="mono">{Number(w.live_qualifications) || <span className="pill bad">ندارد</span>}</td></tr>
                ))}</tbody>
              </table>
            </TableKit>
          )}
          {may.welders && <Fold title="جوشکار جدید"><WelderForm onSaved={reloadWelders} setMsg={setMsg} /></Fold>}
          {may.welders && welders.length > 0 && <Fold title="صلاحیت جوشکار (WPQ)"><QualificationForm welders={welders} onSaved={reloadWelders} setMsg={setMsg} /></Fold>}
        </div>
      </Tabs>
    </div>
  );
}

function WeldForm({ welders, disabled, onSubmit }) {
  const [f, setF] = useState({ welderId: "", weldedAt: "", process: "", position: "" });
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(f); }}>
      <div className="grid2">
        <div className="field"><label htmlFor="wa-welder">جوشکار</label>
          <select id="wa-welder" value={f.welderId} onChange={on("welderId")} required>
            <option value="">—</option>{welders.map((w) => <option key={w.id} value={w.id}>{w.stamp_no} — {w.name}</option>)}</select></div>
        <div className="field"><label htmlFor="wa-on">تاریخ جوشکاری</label><input id="wa-on" type="date" dir="ltr" value={f.weldedAt} onChange={on("weldedAt")} required /></div>
        <div className="field"><label htmlFor="wa-proc">فرایند</label>
          <select id="wa-proc" value={f.process} onChange={on("process")} required>
            <option value="">—</option>{["GTAW", "SMAW", "GMAW", "FCAW", "SAW", "GTAW/SMAW"].map((p) => <option key={p} value={p}>{p}</option>)}</select></div>
        <div className="field"><label htmlFor="wa-pos">وضعیت جوشکاری (مثلاً 5G، 6G یا V)</label><input id="wa-pos" dir="ltr" value={f.position} onChange={on("position")} /></div>
      </div>
      <p className="muted sm">صلاحیت جوشکار برای هر جوش جدا سنجیده می‌شود (ASME IX: فرایند، وضعیت، قطر و ضخامت، اعتبار و تداوم شش‌ماهه)؛ جوشی که خارج از صلاحیت باشد با دلیل رد می‌شود.</p>
      <button className="btn" type="submit" disabled={disabled}>ثبت جوشکاری برای جوش‌های انتخاب‌شده</button>
    </form>
  );
}

function NdtForm({ disabled, onSubmit }) {
  const [f, setF] = useState({ method: "RT", result: "accept", reportNo: "", inspectedAt: "", defectType: "", inspector: "" });
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit({ ...f, defectType: f.result === "reject" ? f.defectType : null }); }}>
      <div className="grid2">
        <div className="field"><label htmlFor="nd-m">روش</label>
          <select id="nd-m" value={f.method} onChange={on("method")}>{METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
        <div className="field"><label htmlFor="nd-r">نتیجه</label>
          <select id="nd-r" value={f.result} onChange={on("result")}>{Object.entries(RESULT_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="nd-no">شمارهٔ گزارش</label><input id="nd-no" dir="ltr" value={f.reportNo} onChange={on("reportNo")} required /></div>
        <div className="field"><label htmlFor="nd-on">تاریخ بازرسی</label><input id="nd-on" type="date" dir="ltr" value={f.inspectedAt} onChange={on("inspectedAt")} required /></div>
        <div className="field"><label htmlFor="nd-by">بازرس</label><input id="nd-by" value={f.inspector} onChange={on("inspector")} /></div>
        {f.result === "reject" && <div className="field"><label htmlFor="nd-d">نوع عیب</label><input id="nd-d" value={f.defectType} onChange={on("defectType")} required /></div>}
      </div>
      <p className="muted sm">شمارهٔ دفعه (شات اول یا پس از تعمیر) را سرور می‌گذارد؛ NDT پیش از ثبت جوشکاری یا با تاریخی پیش از آن رد می‌شود.</p>
      <button className="btn" type="submit" disabled={disabled}>ثبت NDT برای جوش‌های انتخاب‌شده</button>
    </form>
  );
}

function WelderForm({ onSaved, setMsg }) {
  const { projectId, call } = usePlatform();
  const blank = { stampNo: "", name: "", employer: "" };
  const [f, setF] = useState(blank);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      try { await call("/api/welders", { method: "POST", body: JSON.stringify({ projectId, ...f, employer: f.employer || null }) }); setF(blank); onSaved(); }
      catch (err) { setMsg(err.message); }
    }}>
      <div className="grid2">
        <div className="field"><label htmlFor="wl-stamp">مهر جوشکار</label><input id="wl-stamp" dir="ltr" value={f.stampNo} onChange={(e) => setF({ ...f, stampNo: e.target.value })} required /></div>
        <div className="field"><label htmlFor="wl-name">نام</label><input id="wl-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required /></div>
        <div className="field"><label htmlFor="wl-emp">پیمانکار (کارفرمای جوشکار)</label><input id="wl-emp" dir="ltr" value={f.employer} onChange={(e) => setF({ ...f, employer: e.target.value })} /></div>
      </div>
      <button className="btn" type="submit">ثبت جوشکار</button>
    </form>
  );
}

function QualificationForm({ welders, onSaved, setMsg }) {
  const { projectId, call } = usePlatform();
  const blank = { welderId: "", process: "", positions: "", couponOdMm: "", couponThicknessMm: "", certificateNo: "", qualifiedOn: "", expiresOn: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const num = (v) => (v === "" ? null : Number(v));
  return (
    <form onSubmit={async (e) => {
      e.preventDefault(); setMsg(null);
      try {
        await call(`/api/welders/${f.welderId}/qualifications`, { method: "POST", body: JSON.stringify({ projectId, process: f.process,
          positions: f.positions.split(/[\s,،]+/).filter(Boolean), couponOdMm: num(f.couponOdMm), couponThicknessMm: num(f.couponThicknessMm),
          certificateNo: f.certificateNo || null, qualifiedOn: f.qualifiedOn || null, expiresOn: f.expiresOn || null }) });
        setF({ ...blank, welderId: f.welderId }); onSaved();
      } catch (err) { setMsg(err.message); }
    }}>
      <div className="grid2">
        <div className="field"><label htmlFor="wq-w">جوشکار</label>
          <select id="wq-w" value={f.welderId} onChange={on("welderId")} required>
            <option value="">—</option>{welders.map((w) => <option key={w.id} value={w.id}>{w.stamp_no} — {w.name}</option>)}</select></div>
        <div className="field"><label htmlFor="wq-p">فرایند</label><input id="wq-p" dir="ltr" value={f.process} onChange={on("process")} placeholder="GTAW" required /></div>
        <div className="field"><label htmlFor="wq-pos">وضعیت‌های آزمون (با فاصله)</label><input id="wq-pos" dir="ltr" value={f.positions} onChange={on("positions")} placeholder="6G" /></div>
        <div className="field"><label htmlFor="wq-od">قطر خارجی کوپن (mm)</label><input id="wq-od" type="number" step="any" dir="ltr" value={f.couponOdMm} onChange={on("couponOdMm")} /></div>
        <div className="field"><label htmlFor="wq-t">ضخامت کوپن (mm)</label><input id="wq-t" type="number" step="any" dir="ltr" value={f.couponThicknessMm} onChange={on("couponThicknessMm")} /></div>
        <div className="field"><label htmlFor="wq-c">شمارهٔ گواهی</label><input id="wq-c" dir="ltr" value={f.certificateNo} onChange={on("certificateNo")} /></div>
        <div className="field"><label htmlFor="wq-on">تاریخ آزمون</label><input id="wq-on" type="date" dir="ltr" value={f.qualifiedOn} onChange={on("qualifiedOn")} /></div>
        <div className="field"><label htmlFor="wq-exp">انقضا</label><input id="wq-exp" type="date" dir="ltr" value={f.expiresOn} onChange={on("expiresOn")} /></div>
      </div>
      <p className="muted sm">محدودهٔ مجاز (قطر، ضخامت، وضعیت) را موتور ASME IX از کوپن حساب می‌کند؛ اینجا فقط آنچه روی کارت WPQ است وارد می‌شود.</p>
      <button className="btn" type="submit">ثبت صلاحیت</button>
    </form>
  );
}

const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
