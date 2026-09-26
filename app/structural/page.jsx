"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../lib/authz.mjs";
import { STRUCTURE_TYPES } from "../../lib/platform/precedence.mjs";
import {
  ERECTION_STANDARDS, JOINT_TYPES, BOLT_GRADES, STRESS_AREA, METHODS, minPretension,
} from "../../lib/structural/steel.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";
import Tabs from "../../components/ui/Tabs";

/**
 * Structural steel: pipe racks, platforms and shelters, from the foundation
 * civil hands over to the rack piping is erected on.
 *
 * Two columns on the board carry the verdicts a site would otherwise tick by
 * eye — is it plumb, is it bolted — and neither can be ticked here: the
 * survey and the bolting records answer them (lib/structural/steel.mjs).
 * When a rack is waiting on its foundations, the board says so in civil's
 * words, because that is the crew that has to move.
 */
export default function StructuralPage() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/structural?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);
  const mayRegister = can({ role }, ACTIONS.EDIT_EXTRACTION);

  const load = async (tagId) => setDetail(await call(`/api/structural?projectId=${projectId}&tagId=${tagId}`));

  async function expand(tagId) {
    if (open === tagId) { setOpen(null); setDetail(null); return; }
    setOpen(tagId); setDetail(null);
    try { await load(tagId); } catch (e) { setMsg(e.message); }
  }

  async function post(body) {
    setMsg(null);
    try {
      await call("/api/structural", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      if (open) await load(open);
      reload();
      return true;
    } catch (e) { setMsg(e.message); return false; }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  const list = data.structures;
  const handed = list.filter((s) => s.ready).length;
  const held = list.filter((s) => s.plumb?.note?.level === "bad" || s.bolting?.note?.level === "bad").length;
  const onCivil = list.filter((s) => s.waitingOn.some((w) => w.code === "foundation")).length;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>استراکچر فلزی</h1>
        <span className="sub">
          {list.length} سازه · {handed} تحویل‌شده
          {held > 0 && ` · ${held} با شاقولی یا پیچ رد‌شده`}
          {onCivil > 0 && ` · ${onCivil} منتظر فونداسیون`}
        </span>
      </div>

      <Tabs name="structural">
      {msg && <p className="err">{msg}</p>}

      {!data.standard && (
        <div className="card" data-keep style={{ borderColor: "rgba(224,163,62,.5)" }}>
          <h2 style={{ color: "var(--warn)" }}>استاندارد رواداری نصب اسکلت ثبت نشده</h2>
          <p className="muted sm">
            شاقولی هیچ ستونی حکم نمی‌گیرد تا استاندارد در{" "}
            <a href="/project" className="cy">مشخصات پروژه ← اسکلت فلزی</a> انتخاب شود.
            ۱:۵۰۰ (AISC 303) و h/300 (EN 1090-2) هر دو درست‌اند، برای قراردادهای متفاوت.
          </p>
        </div>
      )}

      <div className="card">
        <h2>سازه‌ها</h2>
        {list.length === 0 ? <p className="empty-note">هنوز سازه‌ای ثبت نشده است.</p> : (
          <TableKit name="structural">
            <table className="dtable">
              <thead>
                <tr><th>سازه</th><th>نوع</th><th>ساب‌سیستم</th><th>فونداسیون‌ها</th><th>پیشرفت</th>
                    <th>امروز می‌شود</th><th>شاقولی</th><th>پیچ‌ها</th><th /></tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <StructureRow key={s.id} s={s} open={open === s.id}
                    detail={open === s.id ? detail : null} onToggle={() => expand(s.id)}
                    mayRecord={mayRecord} post={post} standard={data.standard} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
        {mayRegister && <Fold title="ثبت سازهٔ جدید"><AddStructure subsystems={data.subsystems} post={post} /></Fold>}
      </div>

      <PretensionTable />

      </Tabs>
    </div>
  );
}

function StructureRow({ s, open, detail, onToggle, mayRecord, post, standard }) {
  const civilHold = s.waitingOn.find((w) => w.code === "foundation");
  return (
    <>
      <tr>
        <td className="mono">{s.tag_no}</td>
        <td className="sm">{STRUCTURE_TYPES[s.structure_type] || "—"}</td>
        <td className="mono">{s.subsystem || "—"}</td>
        <td className="mono sm">{s.foundations || <span className="muted">دستی</span>}</td>
        <td><Bar pct={s.pct} /></td>
        <td className="sm">
          {s.ready ? <span className="pill ok">تحویل‌شده</span>
            : civilHold ? <span className="pill">منتظر سیویل: فونداسیون</span>
            : s.next.map((n) => n.title).join("، ") || "—"}
          {s.outOfOrder.length > 0 &&
            <div><span className="pill bad">خارج از ترتیب: {s.outOfOrder.join("، ")}</span></div>}
        </td>
        <td><Verdict v={s.plumb} /></td>
        <td><Verdict v={s.bolting} /></td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? "بستن" : "جزئیات"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={9} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">در حال بارگذاری…</span>
              : <Detail s={s} detail={detail} mayRecord={mayRecord} post={post} standard={standard} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Verdict({ v }) {
  if (!v) return <span className="muted sm">—</span>;
  if (v.na) return <span className="pill">لازم نیست</span>;
  if (v.status === "done") return <span className="pill ok">پذیرفته</span>;
  if (v.note?.level === "bad") return <span className="pill bad">رد</span>;
  if (v.status === "in_progress") return <span className="pill">در جریان</span>;
  if (v.note?.level === "warn") return <span className="pill">بدون حکم</span>;
  return <span className="muted sm">—</span>;
}

function Detail({ s, detail, mayRecord, post, standard }) {
  const steps = detail.status.steps || [];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gap: 6, gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))" }}>
        {steps.map((x) => (
          <div key={x.code} className="card" style={{ padding: 10, gap: 6,
            borderColor: x.note?.level === "bad" ? "rgba(226,87,76,.6)"
              : x.status === "done" ? "rgba(63,178,127,.5)"
              : x.blocked ? undefined : "rgba(67,160,180,.6)" }}>
            <span className="sm"><b>{x.derived ? "⚙ " : ""}{x.title}</b></span>
            <span className="sm muted">
              {x.na ? "لازم نیست (طبق مشخصات سازه)"
                : x.status === "done" ? `انجام شد${x.doneAt ? " · " + fa(x.doneAt) : ""}`
                : x.note?.level === "bad" ? "رد — اصلاح لازم است"
                : x.status === "in_progress" ? "در حال انجام"
                : x.blocked ? `منتظر: ${x.waitingOn.map((w) => w.title).join("، ")}`
                : "آمادهٔ شروع"}
            </span>
            {x.note && <span className={"sm " + (x.note.level === "bad" ? "err" : "muted")}>{x.note.text}</span>}
            {x.outOfOrder && <span className="pill bad">خارج از ترتیب ثبت شده</span>}
            {mayRecord && !x.derived && x.status !== "done" && !x.blocked && (
              <button className="btn" style={{ padding: "4px 10px" }}
                      onClick={() => post({ kind: "activity", tagId: s.id, code: x.code, doneAt: today() })}>
                ثبت انجام (امروز)</button>
            )}
          </div>
        ))}
      </div>
      <p className="muted sm">
        مراحل ⚙ از داده خوانده می‌شوند: فونداسیون از سیویل، شاقولی از نقشه‌برداری ستون‌ها،
        پیچ‌ها از رکورد سفت‌کاری و آزمون پیش از نصب.
        {s.drawing_ref && <> نقشهٔ نصب: <span className="mono">{s.drawing_ref}</span>.</>}
      </p>
      <Survey s={s} survey={detail.survey} mayRecord={mayRecord} post={post} standard={standard} />
      <Bolting s={s} bolting={detail.bolting} mayRecord={mayRecord} post={post} />
    </div>
  );
}

function Survey({ s, survey, mayRecord, post, standard }) {
  const blank = { columnMark: "", heightMm: "", dxMm: "", dyMm: "", surveyedOn: today() };
  const [r, setR] = useState(blank);
  const std = ERECTION_STANDARDS[standard];
  return (
    <div className="card" style={{ padding: 12 }}>
      <h2>نقشه‌برداری شاقولی ستون‌ها {std && <span className="muted sm">— {std.cite}</span>}</h2>
      <p className="muted sm">
        {survey.expected ? `${survey.surveyed} از ${survey.expected} ستون` : `${survey.surveyed} ستون — تعداد کل ثبت نشده`}
        {" · "}آخرین قرائت هر ستون حکم می‌گیرد؛ قرائت پیشین در سابقه می‌ماند.
      </p>
      {survey.columns.length > 0 && (
        <TableKit name="structural">
          <table className="dtable">
            <thead><tr><th>ستون</th><th>ارتفاع mm</th><th>ΔE mm</th><th>ΔN mm</th><th>مجاز mm</th><th>تاریخ</th><th>حکم</th></tr></thead>
            <tbody>
              {survey.columns.map((c) => (
                <tr key={c.mark}>
                  <td className="mono">{c.mark}</td>
                  <td className="mono">{c.heightMm}</td>
                  <td className="mono">{c.dxMm}</td>
                  <td className="mono">{c.dyMm}</td>
                  <td className="mono">{c.limitMm ?? "—"}</td>
                  <td className="mono">{fa(c.surveyedOn)}</td>
                  <td>{!survey.judged ? <span className="pill">بدون حکم</span>
                    : !c.valid ? <span className="pill bad">{c.reason}</span>
                    : c.ok ? <span className="pill ok">در رواداری</span>
                    : <span className="pill bad">خارج از رواداری</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRecord && (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "plumb", tagId: s.id, ...r })) setR({ ...blank, heightMm: r.heightMm });
        }}>
          <Field id="pl-mark" label="علامت ستون" value={r.columnMark} on={(v) => setR({ ...r, columnMark: v })} required />
          <Field id="pl-h" label="ارتفاع بین نقاط کار (mm)" type="number" value={r.heightMm}
                 on={(v) => setR({ ...r, heightMm: v })} required
                 hint={std && Number(r.heightMm) > 0 ? `مجاز: ${Math.round(Number(r.heightMm) / std.ratio * 10) / 10} mm در هر جهت` : null} />
          <Field id="pl-dx" label="انحراف سر ستون، شرق (mm)" type="number" value={r.dxMm}
                 on={(v) => setR({ ...r, dxMm: v })} required />
          <Field id="pl-dy" label="انحراف سر ستون، شمال (mm)" type="number" value={r.dyMm}
                 on={(v) => setR({ ...r, dyMm: v })} required hint="هر دو جهت لازم است" />
          <Field id="pl-on" label="تاریخ" type="date" value={r.surveyedOn} on={(v) => setR({ ...r, surveyedOn: v })} required />
          <div><button className="btn" type="submit">ثبت قرائت</button></div>
        </form>
      )}
    </div>
  );
}

function Bolting({ s, bolting, mayRecord, post }) {
  const blank = { jointType: "pretensioned", boltGrade: "A325M", boltSize: "M20", method: "calibrated_wrench",
    joints: "", verifiedKn: "", lotRef: "", inspectedOn: today() };
  const [b, setB] = useState(blank);
  const pre = JOINT_TYPES[b.jointType]?.pretensioned;
  const required = minPretension(b.boltGrade, b.boltSize);
  const family = BOLT_GRADES[b.boltGrade]?.family;
  const target = required === null ? null : Math.round(required * (family === "ASTM" ? 1.05 : 1) * 10) / 10;
  const failed = new Set(bolting.failed.map((r) => r.id));
  return (
    <div className="card" style={{ padding: 12 }}>
      <h2>سفت‌کاری پیچ‌ها</h2>
      <p className="muted sm">
        {bolting.expected ? `${bolting.joints} از ${bolting.expected} اتصال تأیید شده` : `${bolting.joints} اتصال تأیید شده — تعداد کل ثبت نشده`}
        {" · "}اتصال پیش‌تنیده بدون آزمون پیش از نصب روی کالیبراتور کشش پذیرفته نمی‌شود.
      </p>
      {bolting.records.length > 0 && (
        <TableKit name="structural">
          <table className="dtable">
            <thead><tr><th>تاریخ</th><th>نوع اتصال</th><th>پیچ</th><th>روش</th><th>تعداد</th><th>آزمون kN</th><th>لات</th><th>حکم</th></tr></thead>
            <tbody>
              {bolting.records.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{fa(r.inspectedOn)}</td>
                  <td className="sm">{JOINT_TYPES[r.jointType]?.title}</td>
                  <td className="mono">{r.boltGrade} {r.boltSize}</td>
                  <td className="sm">{METHODS[r.method]?.title || "—"}</td>
                  <td className="mono">{r.joints}</td>
                  <td className="mono">{r.verifiedKn ?? "—"}{r.target ? <span className="muted"> / {r.target}</span> : null}</td>
                  <td className="mono">{r.lotRef || "—"}</td>
                  <td>{r.valid ? <span className="pill ok">پذیرفته</span>
                    : failed.has(r.id) ? <span className="pill bad">{r.reason}</span>
                    : <span className="pill">رد — با آزمون بعدی همین لات رفع شد</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
      {mayRecord && (
        <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
          e.preventDefault();
          if (await post({ kind: "bolting", tagId: s.id, ...b, joints: Number(b.joints),
            method: pre ? b.method : null, verifiedKn: pre && b.verifiedKn !== "" ? Number(b.verifiedKn) : null })) {
            setB({ ...b, joints: "", verifiedKn: "" });
          }
        }}>
          <Select id="bt-type" label="نوع اتصال" value={b.jointType} on={(v) => setB({ ...b, jointType: v })}
                  options={Object.entries(JOINT_TYPES).map(([k, v]) => [k, v.title])} />
          <Select id="bt-grade" label="گرید پیچ" value={b.boltGrade}
                  on={(v) => {
                    // A method of the other family would stay in state while the
                    // select showed a different one — and be saved.
                    const fam = BOLT_GRADES[v].family;
                    setB({ ...b, boltGrade: v, method: METHODS[b.method]?.families.includes(fam) ? b.method
                      : Object.keys(METHODS).find((k) => METHODS[k].families.includes(fam)) });
                  }}
                  options={Object.entries(BOLT_GRADES).map(([k, v]) => [k, v.title])} />
          <Select id="bt-size" label="سایز" value={b.boltSize} on={(v) => setB({ ...b, boltSize: v })}
                  options={Object.keys(STRESS_AREA).map((k) => [k, k])} />
          {pre && (
            <Select id="bt-method" label="روش سفت‌کردن" value={b.method} on={(v) => setB({ ...b, method: v })}
                    options={Object.entries(METHODS).filter(([, m]) => m.families.includes(family))
                      .map(([k, m]) => [k, m.title])} />
          )}
          <Field id="bt-n" label="تعداد اتصال" type="number" value={b.joints} on={(v) => setB({ ...b, joints: v })} required />
          {pre && (
            <Field id="bt-kn" label="آزمون پیش از نصب (kN)" type="number" value={b.verifiedKn}
                   on={(v) => setB({ ...b, verifiedKn: v })}
                   hint={required === null ? "این سایز در جدول پیش‌تنیدگی نیست"
                     : `حداقل پیش‌تنیدگی ${required} kN — آزمون باید به ${target} kN برسد`} />
          )}
          <Field id="bt-lot" label="شمارهٔ لات پیچ" value={b.lotRef} on={(v) => setB({ ...b, lotRef: v })} />
          <Field id="bt-on" label="تاریخ بازرسی" type="date" value={b.inspectedOn} on={(v) => setB({ ...b, inspectedOn: v })} required />
          <div><button className="btn" type="submit">ثبت سفت‌کاری</button></div>
        </form>
      )}
    </div>
  );
}

/** The minimum pretension each bolt must reach, so nobody reads it off a PDF on site. */
function PretensionTable() {
  const sizes = Object.keys(STRESS_AREA);
  return (
    <div className="card">
      <h2>حداقل پیش‌تنیدگی پیچ (kN)</h2>
      <p className="muted sm">
        ASTM: جدول J3.1M از AISC 360 — آزمون پیش از نصب ≥ ۱٫۰۵ برابر (RCSC). ·
        ISO/EN: Fp,C = 0.7·fub·As (EN 1090-2) — آزمون ≥ Fp,C. خانهٔ خالی یعنی استاندارد عددی نداده و سامانه هم فرض نمی‌کند.
      </p>
      <TableKit name="structural">
        <table className="dtable">
          <thead><tr><th>گرید</th>{sizes.map((z) => <th key={z}>{z}</th>)}</tr></thead>
          <tbody>
            {Object.entries(BOLT_GRADES).map(([g, v]) => (
              <tr key={g}>
                <td className="sm">{v.title}</td>
                {sizes.map((z) => <td key={z} className="mono">{minPretension(g, z) ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </TableKit>
    </div>
  );
}

function AddStructure({ subsystems, post }) {
  const blank = { tagNo: "", structureType: "pipe_rack", subsystemId: "", columns: "", boltedJoints: "",
    fireproofingRequired: "", tonnageT: "", drawingRef: "" };
  const [f, setF] = useState(blank);
  return (
    <form className="card" onSubmit={async (e) => {
      e.preventDefault();
      const fp = f.fireproofingRequired === "" ? null : f.fireproofingRequired === "yes";
      if (await post({ kind: "structure", ...f, subsystemId: f.subsystemId || null,
        fireproofingRequired: fp })) setF(blank);
    }}>
      <h2>سازهٔ جدید</h2>
      <div className="grid2">
        <Field id="st-no" label="شمارهٔ سازه" value={f.tagNo} on={(v) => setF({ ...f, tagNo: v })} required />
        <Select id="st-type" label="نوع" value={f.structureType} on={(v) => setF({ ...f, structureType: v })}
                options={Object.entries(STRUCTURE_TYPES)} />
        <Select id="st-sub" label="ساب‌سیستم" value={f.subsystemId} on={(v) => setF({ ...f, subsystemId: v })}
                options={[["", "—"], ...subsystems.map((x) => [x.id, x.code])]} />
        <Field id="st-cols" label="تعداد ستون" type="number" value={f.columns} on={(v) => setF({ ...f, columns: v })}
               hint="بدون آن، «همهٔ ستون‌ها نقشه‌برداری شد» گفته نمی‌شود" />
        <Field id="st-joints" label="تعداد کل اتصالات پیچی" type="number" value={f.boltedJoints}
               on={(v) => setF({ ...f, boltedJoints: v })} />
        <Select id="st-fp" label="ضدحریق" value={f.fireproofingRequired}
                on={(v) => setF({ ...f, fireproofingRequired: v })}
                options={[["", "— ثبت نشده —"], ["yes", "لازم است"], ["no", "لازم نیست"]]}
                hint="«ثبت نشده» مرحله را دستی نگه می‌دارد، نه حذف" />
        <Field id="st-t" label="وزن (تن)" type="number" value={f.tonnageT} on={(v) => setF({ ...f, tonnageT: v })} />
        <Field id="st-dwg" label="نقشهٔ نصب" value={f.drawingRef} on={(v) => setF({ ...f, drawingRef: v })} />
      </div>
      <p className="muted sm">فونداسیون‌های زیر سازه را در بخش سیویل ثبت کنید و این سازه را «روی آن» انتخاب کنید.</p>
      <div><button className="btn" type="submit" disabled={!f.tagNo}>ثبت سازه</button></div>
    </form>
  );
}

function Field({ id, label, value, on, type = "text", required, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} type={type} step={type === "number" ? "any" : undefined}
             dir={type === "text" ? "auto" : "ltr"} required={required}
             value={value} onChange={(e) => on(e.target.value)} />
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Select({ id, label, value, on, options, hint }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => on(e.target.value)}>
        {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

function Bar({ pct }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span className="bar"><i style={{ width: `${pct}%` }} /></span>
      <span className="mono sm">{pct}%</span>
    </span>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
