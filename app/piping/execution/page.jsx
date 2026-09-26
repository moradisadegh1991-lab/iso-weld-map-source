"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { can, ACTIONS } from "../../../lib/authz.mjs";
import { CHAINS, spoolStageTitle } from "../../../lib/platform/precedence.mjs";
import TableKit from "../../../components/ui/TableKit";

/**
 * Piping execution: every spool's place in its chain, the supports, and
 * how much of the piping is in the ground.
 *
 * The board leads, sorted worst first, because the question on site each
 * morning is "what can we start", not "what have we done". Derived steps are
 * shown with a marker and no button: they come from the weld register, and a
 * button beside them would invite exactly the double entry they replace.
 */
const CHAIN = CHAINS.piping_spool;
const KIND_FA = {
  shoe: "شو", guide: "گاید", anchor: "انکر", line_stop: "لاین استاپ",
  spring_hanger: "اسپرینگ هنگر", rigid_hanger: "هنگر صلب", trunnion: "ترانیون",
  resting: "نشیمن", other: "سایر",
};

export default function PipingExecution() {
  const { projectId, role, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/piping/execution?projectId=${id}`, []);
  const [open, setOpen] = useState(null);
  const [detail, setDetail] = useState(null);
  const [msg, setMsg] = useState(null);
  const mayRecord = can({ role }, ACTIONS.ASSIGN_WELD);

  const detailUrl = (spoolId) => `/api/piping/execution?projectId=${projectId}&spoolId=${spoolId}`;

  async function expand(spoolId) {
    if (open === spoolId) { setOpen(null); setDetail(null); return; }
    setOpen(spoolId); setDetail(null);
    try { setDetail(await call(detailUrl(spoolId))); } catch (e) { setMsg(e.message); }
  }

  async function record(spoolId, code) {
    setMsg(null);
    try {
      await call("/api/piping/execution", { method: "POST", body: JSON.stringify({
        projectId, kind: "activity", spoolId, code, doneAt: today() }) });
      setDetail(await call(detailUrl(spoolId)));
      reload();
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>اجرای پایپینگ</h1>
        <span className="sub">{data.board.length} اسپول · {data.supports.length} ساپورت</span>
      </div>

      {msg && <p className="err">{msg}</p>}

      <Buried data={data} />

      <div className="card">
        <h2>مراحل اجرا</h2>
        <p className="muted sm">
          {CHAIN.map((s) => s.title).join(" ← ")}.
          {" "}مراحل علامت‌دار (⚙) از رجیستر جوش خوانده می‌شوند و دستی ثبت نمی‌شوند.
        </p>
        {data.board.length === 0 ? (
          <p className="empty-note">
            هنوز رجیستری ذخیره نشده است. اسپول‌ها از رجیستر جوش هر ایزومتریک ساخته می‌شوند.
          </p>
        ) : (
          <TableKit name="execution">
            <table className="dtable">
              <thead>
                <tr><th>اسپول</th><th>خط</th><th>مرحلهٔ فعلی</th><th>پیشرفت</th><th>امروز می‌شود</th>
                    <th>منتظرِ</th><th>زیرزمینی</th><th /></tr>
              </thead>
              <tbody>
                {data.board.map((b) => (
                  <SpoolRow key={b.spoolId} b={b} open={open === b.spoolId}
                    detail={open === b.spoolId ? detail : null}
                    onToggle={() => expand(b.spoolId)}
                    onRecord={mayRecord ? (code) => record(b.spoolId, code) : null} />
                ))}
              </tbody>
            </table>
          </TableKit>
        )}
      </div>

      <Supports data={data} projectId={projectId} call={call} reload={reload}
                mayRecord={mayRecord} setMsg={setMsg} />
    </div>
  );
}

function SpoolRow({ b, open, detail, onToggle, onRecord }) {
  return (
    <>
      <tr>
        <td className="mono"><a href={`/piping/joint?q=${encodeURIComponent(b.spoolNo)}`} title="جوش‌های این اسپول و سابقهٔ هرکدام">{b.spoolNo}</a></td>
        <td className="mono">{b.lineNo || "—"}</td>
        <td className="sm">{spoolStageTitle(b.stage)}</td>
        <td><Bar pct={b.pct} /></td>
        <td className="sm">{b.ready ? <span className="pill ok">تحویل‌شده</span>
          : b.next.map((n) => n.title).join("، ") || "—"}</td>
        <td className="sm muted">{b.waitingOn.map((n) => n.title).join("، ") || "—"}</td>
        <td>{b.buried === null ? <span className="muted sm">نامعلوم</span>
          : b.buried ? <span className="pill warn">زیرزمینی</span>
          : <span className="pill">روزمینی</span>}</td>
        <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={onToggle}>
          {open ? "بستن" : "مراحل"}</button></td>
      </tr>
      {open && (
        <tr>
          <td colSpan={8} style={{ background: "rgba(255,255,255,.02)" }}>
            {!detail ? <span className="muted sm">در حال بارگذاری…</span> : (
              <div style={{ display: "grid", gap: 6,
                gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))" }}>
                {detail.steps.map((s) => (
                  <div key={s.code} className="card" style={{ padding: 10, gap: 6,
                    opacity: s.na ? 0.55 : 1,
                    borderColor: s.na ? undefined : s.status === "done" ? "rgba(63,178,127,.5)"
                      : s.blocked ? undefined : "rgba(67,160,180,.6)" }}>
                    <span className="sm"><b>{s.derived ? "⚙ " : ""}{s.title}</b></span>
                    <span className="sm muted">
                      {s.na ? "ندارد — این اسپول جوشی از این نوع ندارد"
                        : s.status === "done" ? `انجام شد${s.doneAt ? " · " + fa(s.doneAt) : ""}`
                        : s.status === "in_progress" ? "در حال انجام"
                        : s.blocked ? `منتظر: ${s.waitingOn.map((w) => w.title).join("، ")}`
                        : "آمادهٔ شروع"}
                      {s.refNo ? ` · ${s.refNo}` : ""}
                    </span>
                    {s.outOfOrder && <span className="pill bad">خارج از ترتیب ثبت شده</span>}
                    {onRecord && !s.derived && s.status !== "done" && !s.blocked && (
                      <button className="btn" style={{ padding: "4px 10px" }}
                              onClick={() => onRecord(s.code)}>ثبت انجام (امروز)</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * How much of the piping is in the ground.
 *
 * With no grade elevation recorded this says so and points at where to
 * record it — rather than a column of zeros that reads as "nothing is buried".
 */
function Buried({ data }) {
  const known = data.buried.some((r) => r.welds > r.unknown);
  if (!known) {
    return (
      <div className="card" style={{ borderColor: "rgba(224,163,62,.5)" }}>
        <h2 style={{ color: "var(--warn)" }}>تراز گرید پلنت ثبت نشده</h2>
        <p className="muted sm">
          بدون تراز گرید، سامانه نمی‌تواند بگوید کدام جوش زیرزمینی است — و «صفر
          جوش زیرزمینی» نشان نمی‌دهد، چون آن یک ادعا است نه یک ندانستن. تراز را در
          {" "}<a href="/project" className="cy">مشخصات پروژه ← مبدأ و ترازهای پلنت</a> وارد کنید.
        </p>
      </div>
    );
  }
  const rows = data.buried.filter((r) => r.welds > 0);
  return (
    <div className="card">
      <h2>زیرزمینی و روزمینی</h2>
      <p className="muted sm">
        هر خط نسبت به گرید واحد خودش سنجیده می‌شود، و اگر واحد گرید جدا
        نداشته باشد نسبت به گرید پروژه
        {data.grade !== null ? ` (EL ${data.grade.toLocaleString("en-US")} mm${data.datum ? "، " + data.datum : ""})` : ""}.
        جوش زیرزمینی باید پیش از خاک‌ریزی تست و پوشش شود.
      </p>
      {rows.length === 0 ? <p className="empty-note">هنوز جوشی ثبت نشده است.</p> : (
        <TableKit name="execution">
          <table className="dtable">
            <thead><tr><th>خط</th><th>جوش</th><th>زیرزمینی</th><th>روزمینی</th>
                       <th>نامعلوم</th><th>گرید اعمال‌شده (mm)</th>
                       <th>عمیق‌ترین نقطه نسبت به گرید</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.lineId || r.lineNo}>
                  <td className="mono">{r.lineNo || "—"}</td>
                  <td className="mono">{r.welds}</td>
                  <td className="mono">{r.buried}</td>
                  <td className="mono">{r.aboveGround}</td>
                  <td className="mono">{r.unknown || "—"}</td>
                  <td className="mono">
                    {r.gradeMinMm === null ? "ثبت نشده"
                      : r.gradeMinMm === r.gradeMaxMm ? r.gradeMinMm.toLocaleString("en-US")
                      : `${r.gradeMinMm.toLocaleString("en-US")} – ${r.gradeMaxMm.toLocaleString("en-US")}`}
                  </td>
                  <td className="mono" dir="ltr">
                    {r.deepestMm === null ? "—" : `${(r.deepestMm / 1000).toFixed(2)} m`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function Supports({ data, projectId, call, reload, mayRecord, setMsg }) {
  const blank = { supportNo: "", supportKind: "shoe", loadKn: "", drawingRef: "" };
  const [f, setF] = useState(blank);

  async function add(e) {
    e.preventDefault();
    setMsg(null);
    try {
      // `kind` routes the request; the support's own type travels as
      // `supportKind`. Sending both as `kind` made every support a "support".
      await call("/api/piping/execution", { method: "POST",
        body: JSON.stringify({ projectId, kind: "support", ...f }) });
      setF({ ...blank, supportKind: f.supportKind });
      reload();
    } catch (e2) { setMsg(e2.message); }
  }

  async function mark(id, step) {
    setMsg(null);
    try {
      await call("/api/piping/execution", { method: "POST",
        body: JSON.stringify({ projectId, kind: "support_mark", supportId: id, step, on: today() }) });
      reload();
    } catch (e) { setMsg(e.message); }
  }

  const small = { padding: "3px 9px" };
  return (
    <div className="card">
      <h2>ساپورت‌ها</h2>
      <p className="muted sm">
        نصب و بازرسی <b>تاریخ</b> دارند نه تیک — تاریخ همان مدرک است. ساپورتی که
        نصب نشده بازرسی نمی‌شود، و اسپرینگ هنگر بدون بار ثبت نمی‌شود.
      </p>
      {data.supports.length === 0 ? (
        <p className="empty-note">هنوز ساپورتی ثبت نشده است.</p>
      ) : (
        <TableKit name="execution">
          <table className="dtable">
            <thead><tr><th>شماره</th><th>نوع</th><th>خط</th><th>اسپول</th><th>بار kN</th>
                       <th>نصب</th><th>بازرسی</th></tr></thead>
            <tbody>
              {data.supports.map((s) => (
                <tr key={s.id}>
                  <td className="mono">{s.support_no}</td>
                  <td>{KIND_FA[s.kind] || s.kind}</td>
                  <td className="mono">{s.line_no || "—"}</td>
                  <td className="mono">{s.spool_no || "—"}</td>
                  <td className="mono">{s.load_kn ?? "—"}</td>
                  <td className="mono">{s.installed_at ? fa(s.installed_at)
                    : mayRecord ? <button className="btn ghost" style={small}
                        onClick={() => mark(s.id, "installed")}>نصب شد</button> : "—"}</td>
                  <td className="mono">{s.inspected_at ? fa(s.inspected_at)
                    : s.installed_at && mayRecord ? <button className="btn ghost" style={small}
                        onClick={() => mark(s.id, "inspected")}>بازرسی شد</button> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}

      {mayRecord && (
        <form onSubmit={add} className="grid2" style={{ alignItems: "end" }}>
          <div className="field"><label htmlFor="s-no">شمارهٔ ساپورت</label>
            <input id="s-no" dir="ltr" required value={f.supportNo}
                   onChange={(e) => setF({ ...f, supportNo: e.target.value })} /></div>
          <div className="field"><label htmlFor="s-kind">نوع</label>
            <select id="s-kind" value={f.supportKind}
                    onChange={(e) => setF({ ...f, supportKind: e.target.value })}>
              {Object.entries(KIND_FA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div className="field"><label htmlFor="s-load">بار (kN)</label>
            <input id="s-load" type="number" step="0.1" dir="ltr" value={f.loadKn}
                   onChange={(e) => setF({ ...f, loadKn: e.target.value })} />
            {f.supportKind === "spring_hanger" && <span className="hint">برای اسپرینگ هنگر الزامی است.</span>}
          </div>
          <div className="field"><label htmlFor="s-ref">نقشهٔ استاندارد</label>
            <input id="s-ref" dir="ltr" value={f.drawingRef}
                   onChange={(e) => setF({ ...f, drawingRef: e.target.value })} /></div>
          <div><button className="btn" type="submit" disabled={!f.supportNo}>افزودن ساپورت</button></div>
        </form>
      )}
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
const fa = (d) => new Date(d).toLocaleDateString("fa-IR");
