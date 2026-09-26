"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import { useRemove } from "../../lib/client/remove.mjs";
import Tabs from "../../components/ui/Tabs";

/**
 * NDT of support, structural and equipment welds, as the project's NDT
 * matrix requires. Rules: lib/ndt/joints.mjs and lib/ndt/compliance.mjs.
 */
const TONE = { accepted: "ok", accepted_by_sample: "ok", not_welded: "", awaiting: "warn", awaiting_sample: "warn", progressive: "warn",
  rejected: "bad", full_examination: "bad", extension_unknown: "bad", unknown: "bad", sample_not_drawn: "bad", welder_unsampled: "bad", no_welder: "bad" };

export default function NdtJointsPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/ndt-joints?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [open, setOpen] = useState(null);
  const may = { eng: can({ role }, ACTIONS.EDIT_EXTRACTION), weld: can({ role }, ACTIONS.ASSIGN_WELD),
    ndt: can({ role }, ACTIONS.RECORD_NDT), draw: can({ role }, ACTIONS.DRAW_NDT_SAMPLE) };
  const removeJoint = useRemove("weld-joint", reload);

  async function post(body, done) {
    setMsg(null);
    try {
      const r = await call("/api/ndt-joints", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (done) setMsg({ ok: true, text: done(r.result) });
      reload();
      return true;
    } catch (e) { setMsg({ ok: false, text: e.message }); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const c = data.counts;
  const methodsText = (r) => r.methods.map((m) => `${m.method} ${m.percent}%`).join(" + ");

  return (
    <div className="page">
      <div className="pagehead">
        <h1>NDT جوش‌های سازه، ساپورت و تجهیزات</h1>
        <span className="sub">{c.total} جوش · {c.welded} زده‌شده · {c.done} NDT کامل · {c.unknown} بدون قاعده</span>
      </div>
      {msg && <p className={msg.ok ? "muted" : "err"}>{msg.text}</p>}

      <Tabs name="ndt-joints">
      <div className="card">
        <h2>ماتریس NDT پروژه</h2>
        <p className="muted sm">روش و درصد هر نوع جوش از مشخصات فنی پروژه می‌آید (کد جوشکاری سازه، آزمون غیرچشمی را به مدارک قرارداد می‌سپارد) — پلتفرم درصد پیش‌فرض ندارد. RT و UT روی جوش گوشه پذیرفته نمی‌شود. «گسترش» یعنی اگر نمونهٔ تصادفی رد شد چه باید کرد؛ اگر تعیین نشود، لات پذیرفته نمی‌شود.</p>
        {data.matrix.length === 0 ? <p className="empty-note">قاعده‌ای ثبت نشده — همهٔ جوش‌ها «بدون قاعده» می‌مانند.</p> : (
          <TableKit name="ndt-matrix" onDelete={may.eng ? (ruleId) => post({ kind: "rule-remove", ruleId }) : undefined}>
          <table className="dtable">
            <thead><tr><th>دامنه</th><th>نوع اتصال</th><th>روش</th><th>درصد</th><th>گسترش در صورت رد</th><th>مرجع</th></tr></thead>
            <tbody>{data.matrix.map((r) => (
              <tr key={r.id} data-key={r.id}><td>{data.scopes[r.scope]}</td><td>{data.jointTypes[r.joint_type]}</td><td className="mono">{r.method}</td>
                <td className="mono">{r.percent}%</td><td className="sm">{r.percent < 100 ? (data.extensions[r.extension] || "تعیین نشده") : "—"}</td>
                <td className="sm">{r.basis}</td></tr>
            ))}</tbody>
          </table>
          </TableKit>
        )}
        {may.eng && <Fold title="قاعدهٔ جدید"><RuleForm data={data} post={post} /></Fold>}
      </div>

      {(data.needSample.length > 0 || data.lots.length > 0) && (
        <div className="card">
          <h2>نمونه‌گیری و گسترش بازرسی</h2>
          {data.needSample.map((g) => (
            <p key={`${g.group}|${g.jointType}|${g.method}`} className="sm">
              <b>{g.groupLabel}</b> — {data.jointTypes[g.jointType]} — {g.method} {g.percent}٪: نمونه کشیده نشده{" "}
              {may.draw && <button className="btn" onClick={() => post({ kind: "sample", group: g.group, jointType: g.jointType, method: g.method },
                (r) => `قرعه: ${r.jointNos.join("، ")} — seed ${r.seed}`)}>قرعه</button>}</p>
          ))}
          {data.lots.map((l) => (
            <p key={`${l.group}|${l.jointType}|${l.method}|${l.welderId}`} className="sm">
              <b>{l.groupLabel}</b> — {l.method} — جوشکار {l.stamp}: <span className={`pill ${TONE[l.status]}`}>{data.statusText[l.status]}</span>
              {l.defects.length > 0 && ` — معیوب: ${l.defects.join("، ")}`}
              {l.drawn.length > 0 && ` — قرعه: ${l.drawn.join("، ")}`}
              {l.waiting.length > 0 && ` — منتظر NDT: ${l.waiting.join("، ")}`}
              {l.drawNeeded !== null && may.draw && <> {" "}<button className="btn" onClick={() => post({ kind: "progressive", group: l.group, jointType: l.jointType, method: l.method, welderId: l.welderId },
                (r) => `قرعهٔ تدریجی: ${r.jointNos.join("، ")}`)}>قرعهٔ {l.drawNeeded} جوش</button></>}</p>
          ))}
        </div>
      )}

      <div className="card">
        <h2>رجیستر جوش‌ها</h2>
        {data.joints.length === 0 ? <p className="empty-note">جوشی ثبت نشده.</p> : (
          <TableKit name="ndt-joints" {...(may.eng ? removeJoint : {})}>
            <table className="dtable">
              <thead><tr><th>جوش</th><th>دامنه</th><th>تگ / ساپورت</th><th>نوع</th><th>الزام</th><th>جوشکار</th><th>وضعیت</th><th /></tr></thead>
              <tbody>{data.joints.map((j) => (
                <tr key={j.id} data-key={j.id}>
                  <td className="mono">{j.jointNo}</td><td className="sm">{data.scopes[j.scope]}</td><td className="mono">{j.parent}</td>
                  <td className="sm">{data.jointTypes[j.jointType]}{j.thicknessMm && ` · ${j.thicknessMm} mm`}</td>
                  <td className="mono sm">{methodsText(j) || "—"}</td>
                  <td className="mono">{j.stamp || "—"}{j.weldedOn && <div className="muted sm">{j.weldedOn}</div>}</td>
                  <td><span className={`pill ${TONE[j.status]}`}>{data.statusText[j.status]}</span>
                    {j.methods.length > 1 && <div className="muted sm">{j.methods.map((m) => `${m.method}: ${m.text}`).join(" · ")}</div>}</td>
                  <td><button className="btn ghost" onClick={() => setOpen(open === j.id ? null : j.id)}>{open === j.id ? "بستن" : "ثبت"}</button></td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
        {data.joints.filter((j) => j.id === open).map((j) => <JointActions key={j.id} j={j} data={data} post={post} may={may} />)}
        {may.eng && <Fold title="جوش جدید"><JointForm data={data} post={post} /></Fold>}
      </div>
      </Tabs>
    </div>
  );
}

function RuleForm({ data, post }) {
  const blank = { scope: "structural", jointType: "cjp", method: "VT", percent: "100", extension: "", basis: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "rule", ...f, extension: f.extension || null })) setF({ ...blank, scope: f.scope }); }}>
      <div className="grid2">
        <Select id="r-s" label="دامنه" value={f.scope} on={on("scope")} opts={Object.entries(data.scopes)} />
        <Select id="r-j" label="نوع اتصال" value={f.jointType} on={on("jointType")} opts={Object.entries(data.jointTypes)} />
        <Select id="r-m" label="روش" value={f.method} on={on("method")} opts={data.methods.map((m) => [m, m])} />
        <Field id="r-p" label="درصد" type="number" value={f.percent} on={on("percent")} />
        {Number(f.percent) < 100 && <Select id="r-e" label="گسترش در صورت رد نمونه" value={f.extension} on={on("extension")} opts={Object.entries(data.extensions)} blank="— تعیین نشده —" />}
        <Field id="r-b" label="مرجع (بند مشخصات یا کد)" value={f.basis} on={on("basis")} />
      </div>
      <button className="btn">ثبت قاعده</button>
    </form>
  );
}

function JointForm({ data, post }) {
  const blank = { scope: "structural", jointNo: "", parent: "", jointType: "cjp", thicknessMm: "", drawingRef: "" };
  const [f, setF] = useState(blank);
  const on = (k) => (v) => setF({ ...f, [k]: v });
  const parents = f.scope === "support" ? data.supports.map((s) => [s.id, `${s.support_no}${s.line_no ? ` · ${s.line_no}` : ""}`])
    : data.tags.filter((t) => t.discipline === (f.scope === "structural" ? "structural" : "equipment")).map((t) => [t.id, t.tag_no]);
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      const { parent, ...rest } = f;
      if (await post({ kind: "joint", ...rest, tagId: f.scope === "support" ? null : parent, supportId: f.scope === "support" ? parent : null })) setF({ ...blank, scope: f.scope, parent: f.parent });
    }}>
      <div className="grid2">
        <Select id="j-s" label="دامنه" value={f.scope} on={(v) => setF({ ...f, scope: v, parent: "" })} opts={Object.entries(data.scopes)} />
        <Select id="j-p" label={f.scope === "support" ? "ساپورت" : "تگ"} value={f.parent} on={on("parent")} opts={parents} blank="—" />
        <Field id="j-n" label="شمارهٔ جوش" value={f.jointNo} on={on("jointNo")} />
        <Select id="j-t" label="نوع اتصال" value={f.jointType} on={on("jointType")} opts={Object.entries(data.jointTypes)} />
        <Field id="j-th" label="ضخامت (mm)" type="number" value={f.thicknessMm} on={on("thicknessMm")} />
        <Field id="j-d" label="نقشه / جزئیات" value={f.drawingRef} on={on("drawingRef")} />
      </div>
      <button className="btn">ثبت جوش</button>
    </form>
  );
}

function JointActions({ j, data, post, may }) {
  const today = new Date().toISOString().slice(0, 10);
  const [w, setW] = useState({ welderId: "", weldedOn: today });
  const [n, setN] = useState({ method: j.methods[0]?.method || "VT", result: "accept", reportNo: "", defectType: "", inspectedOn: today, inspector: "" });
  return (
    <div className="card" style={{ marginTop: 8 }}>
      <h3>{j.jointNo}</h3>
      {may.weld && (
        <form style={{ display: "flex", gap: 8, alignItems: "end", flexWrap: "wrap" }} onSubmit={async (e) => { e.preventDefault(); await post({ kind: "weld", jointId: j.id, ...w }); }}>
          <Select id={`w-${j.id}`} label="جوشکار" value={w.welderId} on={(v) => setW({ ...w, welderId: v })} opts={data.welders.map((x) => [x.id, `${x.stamp_no} — ${x.name}`])} blank="—" />
          <Field id={`wd-${j.id}`} label="تاریخ جوشکاری" type="date" value={w.weldedOn} on={(v) => setW({ ...w, weldedOn: v })} />
          <button className="btn ghost">ثبت جوشکاری</button>
        </form>
      )}
      {may.ndt && j.weldedOn && (
        <form style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "ndt", jointId: j.id, ...n })) setN({ ...n, reportNo: "", defectType: "" }); }}>
          <div className="grid2">
            <Select id={`nm-${j.id}`} label="روش" value={n.method} on={(v) => setN({ ...n, method: v })} opts={data.methods.map((m) => [m, m])} />
            <Select id={`nr-${j.id}`} label="نتیجه" value={n.result} on={(v) => setN({ ...n, result: v })} opts={[["accept", "پذیرفته"], ["reject", "رد"], ["pending", "در انتظار"]]} />
            {n.result === "reject" && <Field id={`nd-${j.id}`} label="نوع عیب" value={n.defectType} on={(v) => setN({ ...n, defectType: v })} />}
            <Field id={`nn-${j.id}`} label="شمارهٔ گزارش" value={n.reportNo} on={(v) => setN({ ...n, reportNo: v })} />
            <Field id={`no-${j.id}`} label="تاریخ" type="date" value={n.inspectedOn} on={(v) => setN({ ...n, inspectedOn: v })} />
            <Field id={`ni-${j.id}`} label="بازرس" value={n.inspector} on={(v) => setN({ ...n, inspector: v })} />
          </div>
          <button className="btn">ثبت NDT</button>
        </form>
      )}
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
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined} dir={type === "text" ? "auto" : "ltr"} value={value} onChange={(e) => on(e.target.value)} /></div>
  );
}
