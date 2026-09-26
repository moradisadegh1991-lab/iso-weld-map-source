"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import TableKit from "../../../components/ui/TableKit";

/**
 * Joint history (Master Plan §12): one weld, from the drawing revision that
 * first carried it to the pressure test of its line — every record the
 * platform already holds about it, in order, and what among them does not
 * add up. Nothing is typed here; each section is another module's record.
 *
 * ?uid= opens a weld directly; ?q= starts with a search (a spool, a line).
 */
const RESULT = { accept: ["ok", "قبول"], reject: ["bad", "رد"], pending: ["", "در انتظار"] };
const KIND_FA = { drawing: "نقشه", material: "مواد", fitup: "فیت‌آپ", inspection: "بازرسی", weld: "جوشکاری", pwht: "PWHT", ndt: "NDT", test: "تست" };
const MTC = { pending: ["", "بررسی‌نشده"], accepted: ["ok", "پذیرفته"], rejected: ["bad", "رد"] };

export default function JointPage() {
  const { projectId, call } = usePlatform();
  const [q, setQ] = useState("");
  const [uid, setUid] = useState("");
  const [h, setH] = useState(null);
  const [err, setErr] = useState(null);
  const { data: list } = useProjectData((id) => `/api/welds?projectId=${id}&q=${encodeURIComponent(q)}`, [q]);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("uid")) setUid(p.get("uid"));
    if (p.get("q")) setQ(p.get("q"));
  }, []);

  useEffect(() => {
    if (!uid || !projectId) { setH(null); return; }
    setErr(null); setH(null);
    call(`/api/welds/${encodeURIComponent(uid)}?projectId=${projectId}`).then(setH).catch((e) => setErr(e.message));
    window.history.replaceState(null, "", `/piping/joint?uid=${encodeURIComponent(uid)}`);
  }, [uid, projectId, call]);

  return (
    <div className="page">
      <div className="pagehead">
        <h1>سابقهٔ جوش (Joint History)</h1>
        <span className="sub">هر جوش از رویژن نقشه تا تست فشار — طراحی، مواد، فیت‌آپ، جوشکار، NDT و تعمیر، PWHT</span>
      </div>
      {!uid && <Finder q={q} setQ={setQ} list={list} open={setUid} />}
      {uid && (
        <div><button className="btn ghost" onClick={() => { setUid(""); window.history.replaceState(null, "", "/piping/joint"); }}>← فهرست جوش‌ها</button></div>
      )}
      {err && <p className="err">{err}</p>}
      {uid && !h && !err && <p className="muted">در حال بارگذاری…</p>}
      {h && <History h={h} />}
    </div>
  );
}

function Finder({ q, setQ, list, open }) {
  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);
  const welds = list?.welds || [];
  return (
    <div className="card">
      <form style={{ display: "flex", gap: 8, flexWrap: "wrap" }} onSubmit={(e) => { e.preventDefault(); setQ(input.trim()); }}>
        <input className="search" dir="ltr" value={input} onChange={(e) => setInput(e.target.value)} style={{ maxWidth: 320 }}
               placeholder="شمارهٔ جوش، خط، اسپول، نقشه یا مهر جوشکار" aria-label="جست‌وجوی جوش" />
        <button className="btn" type="submit">جست‌وجو</button>
      </form>
      {!list ? <p className="muted">در حال بارگذاری…</p> : welds.length === 0 ? <p className="empty-note">جوشی پیدا نشد.</p> : (
        <TableKit name="joint">
          <table className="dtable">
            <thead><tr><th>جوش</th><th>خط</th><th>اسپول</th><th>نقشه</th><th>Shop/Field</th><th>سایز</th><th>جوشکار</th><th>وضعیت</th><th /></tr></thead>
            <tbody>
              {welds.map((w) => (
                <tr key={w.weld_uid}>
                  <td className="mono">{w.weld_no}</td><td className="mono sm">{w.line_no || "—"}</td>
                  <td className="mono sm">{w.spool_no || "—"}</td><td className="mono sm">{w.doc_no} Rev {w.revision}</td>
                  <td>{w.shop_field}</td><td className="mono">{w.nps ?? "—"}"</td><td className="mono">{w.stamp_no || "—"}</td>
                  <td>{!w.is_welded ? <span className="pill">زده نشده</span> : w.is_accepted ? <span className="pill ok">پذیرفته</span>
                    : w.is_examined ? <span className="pill bad">NDT باز</span> : <span className="pill">منتظر NDT</span>}</td>
                  <td><button className="btn ghost" style={{ padding: "4px 10px" }} onClick={() => open(w.weld_uid)}>سابقه</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableKit>
      )}
    </div>
  );
}

function History({ h }) {
  const { identity: id, status: st, execution: ex } = h;
  return (
    <>
      <div className="card">
        <h2 style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <bdi dir="ltr" className="mono">{id.weldNo}</bdi>
          <span className="pill">{id.shopField}</span>
          {!id.current && <span className="pill bad">در رویژن جاری نیست</span>}
          {st.accepted ? <span className="pill ok">NDT پذیرفته</span> : st.examined ? <span className="pill bad">NDT باز</span>
            : st.welded ? <span className="pill">منتظر NDT</span> : <span className="pill">زده نشده</span>}
          {st.repairs > 0 && <span className="pill bad">{st.repairs} تعمیر</span>}
        </h2>
        <div className="kv">
          <KV k="خط" v={id.lineNo} mono /><KV k="کلاس" v={id.pipingClass} mono /><KV k="اسپول" v={id.spoolNo} mono />
          <KV k="نقشه" v={`${id.docNo} Rev ${id.revision}`} mono /><KV k="نوع" v={`${id.kind || "—"}${id.jointRole ? ` · ${id.jointRole}` : ""}`} />
          <KV k="سایز" v={id.nps != null ? `${id.nps}"${id.schedule ? ` · ${id.schedule}` : ""}` : null} mono />
          <KV k="NDT لازم" v={id.ndtRequirement} mono />
          <KV k="دفنی" v={id.buried === null ? "نامعلوم (تراز گرید اعلام نشده)"
            : id.buried ? `بله — ${Math.round(Math.abs(id.heightAboveGradeMm))} mm زیر گرید` : `خیر — ${Math.round(id.heightAboveGradeMm)} mm بالای گرید`} />
          <KV k="شناسهٔ پایدار" v={id.weldUid} mono />
        </div>
      </div>

      {h.attention.length > 0 && (
        <div className="card" style={{ borderColor: "var(--warn)" }}>
          <h2>نیاز به توجه</h2>
          <ul style={{ margin: 0, paddingInlineStart: 18 }}>
            {h.attention.map((a, i) => <li key={i} className="sm" style={{ color: a.level === "bad" ? "var(--bad)" : "var(--warn)" }}>{a.text}</li>)}
          </ul>
        </div>
      )}

      <div className="card">
        <h2>خط زمانی</h2>
        {h.timeline.length === 0 ? <p className="empty-note">رویدادی ثبت نشده است.</p> : (
          <ol className="timeline">
            {h.timeline.map((e, i) => (
              <li key={i} className={e.tone}>
                <span className="mono sm muted">{e.on ? new Date(e.on).toLocaleDateString("fa-IR") : "بدون تاریخ"}</span>
                <span className="pill">{KIND_FA[e.kind] || e.kind}</span>
                <span className="sm">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="grid2">
        <div className="card">
          <h2>جوشکاری</h2>
          {!ex ? <p className="empty-note">هنوز جوشکاری ثبت نشده است.</p> : <>
            <div className="kv">
              <KV k="جوشکار" v={`${ex.welder.stampNo || "—"}${ex.welder.name ? ` — ${ex.welder.name}` : ""}`} />
              <KV k="پیمانکار" v={ex.welder.employer} /><KV k="WPS" v={ex.wpsNo} mono /><KV k="PQR" v={ex.pqrNo} mono />
              <KV k="فرایند / وضعیت" v={[ex.process, ex.position].filter(Boolean).join(" · ")} mono />
              <KV k="تاریخ" v={fa(ex.weldedOn)} /><KV k="چشمی" v={RESULT[ex.visual]?.[1]} />
              <KV k="PWHT" v={ex.pwhtRequired ? (ex.pwhtReportNo ? `${ex.pwhtReportNo} · ${fa(ex.pwhtOn)}` : "لازم — ثبت نشده") : "لازم نیست"} />
              <KV k="ثبت‌کننده" v={ex.recordedBy} />
            </div>
            <p className="sm muted" style={{ marginTop: 8 }}>
              حکم صلاحیت همان است که هنگام تخصیص صادر شد (نه داوری امروز):{" "}
              {ex.verdict?.ok === false ? <span className="pill bad">مسدود</span> : (ex.verdict?.warnings || []).length
                ? <span className="pill">{ex.verdict.warnings.length} هشدار</span> : <span className="pill ok">بدون ایراد</span>}
            </p>
          </>}
        </div>
        <div className="card">
          <h2>NDT و تعمیر</h2>
          {h.selection.length > 0 && (
            <p className="sm">نمونه‌گیری: {h.selection.map((s) => `${s.method} ${s.percent}% (${fa(s.on)}): ${s.selected ? "انتخاب شد" : "انتخاب نشد"}`).join(" · ")}</p>
          )}
          {h.ndt.length === 0 ? <p className="empty-note">NDT ثبت نشده است.</p> : (
            <table className="dtable">
              <thead><tr><th>روش</th><th>چرخه</th><th>نتیجه</th><th>عیب</th><th>گزارش</th><th>تاریخ</th><th>بازرس</th></tr></thead>
              <tbody>{h.ndt.map((n, i) => (
                <tr key={i}><td className="mono">{n.method}</td><td className="mono">{n.cycle === 0 ? "اول" : `R${n.cycle}`}</td>
                  <td><span className={"pill " + (RESULT[n.result]?.[0] || "")}>{RESULT[n.result]?.[1] || n.result}</span></td>
                  <td className="sm">{n.defect || "—"}</td><td className="mono sm">{n.reportNo || "—"}</td>
                  <td className="sm">{fa(n.inspectedOn)}</td><td className="sm">{n.inspector || "—"}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <h2>رویژن‌های نقشه</h2>
        <TableKit name="joint">
          <table className="dtable">
            <thead><tr><th>نقشه</th><th>رویژن</th><th>صدور</th><th>رجیستر</th><th>شمارهٔ جوش</th><th>Shop/Field</th><th>اسپول</th><th>تغییر نسبت به قبل</th></tr></thead>
            <tbody>{h.revisions.map((r, i) => (
              <tr key={i}><td className="mono sm">{r.docNo}</td><td className="mono">{r.revision}{r.current && <span className="pill ok" style={{ marginInlineStart: 6 }}>جاری</span>}</td>
                <td className="sm">{r.issuedOn ? fa(r.issuedOn) : <span className="muted" title="تاریخ رویژن روی نقشه اعلام نشده؛ این تاریخ ثبت در سامانه است">ثبت: {fa(r.registeredOn)}</span>}</td><td className="sm">{r.runStatus === "approved" ? "تأییدشده" : r.runStatus === "superseded" ? "منسوخ" : "پیش‌نویس"}</td>
                <td className="mono">{r.weldNo}</td><td>{r.shopField}</td><td className="mono sm">{r.spoolNo || "—"}</td>
                <td className="sm">{r.changes.length ? r.changes.map((c) => `${c.field}: ${c.from ?? "—"} → ${c.to ?? "—"}`).join(" · ") : "—"}</td></tr>
            ))}</tbody>
          </table>
        </TableKit>
      </div>

      <div className="grid2">
        <div className="card">
          <h2>مواد و ردیابی ذوب</h2>
          {h.material.length === 0 ? <p className="empty-note">حواله‌ای به اسپول این جوش ثبت نشده است.</p> : (
            <table className="dtable">
              <thead><tr><th>کالا</th><th>ذوب</th><th>MTC</th><th>رسید</th><th>مقدار</th><th>تاریخ</th></tr></thead>
              <tbody>{h.material.map((m, i) => (
                <tr key={i}><td className="mono sm">{m.code}</td><td className="mono">{m.heatNo || "—"}</td>
                  <td><span className={"pill " + (MTC[m.mtcStatus]?.[0] || "")}>{MTC[m.mtcStatus]?.[1] || m.mtcStatus}</span></td>
                  <td className="mono sm">{m.receiptNo}</td><td className="mono">{m.kind === "return" ? "−" : ""}{m.qty} {m.uom}</td><td className="sm">{fa(m.on)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </div>
        <div className="card">
          <h2>اسپول، فیت‌آپ و تست</h2>
          {!h.spool ? <p className="empty-note">اسپول ندارد.</p> : (
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {h.spool.steps.map((s) => (
                <li key={s.code} className="sm">{s.title}: {s.na ? "لازم نیست" : s.status === "done" ? `✓ ${s.doneAt ? fa(s.doneAt) : ""}${s.refNo ? ` (${s.refNo})` : ""}` : s.status === "in_progress" ? "در جریان" : "—"}</li>
              ))}
            </ul>
          )}
          <p className="sm" style={{ marginTop: 8 }}>
            {h.testPack ? `بستهٔ تست ${h.testPack.packNo} (${h.testPack.medium === "hydrostatic" ? "هیدرو" : "پنوماتیک"}): ${h.testPack.records.length
              ? h.testPack.records.map((t) => `${fa(t.on)} ${t.verdict === "pass" ? "قبول" : "رد"}${t.accepted ? " و پذیرفته" : ""}`).join(" · ") : "هنوز تست نشده"}`
              : "خط این جوش در هیچ بستهٔ تستی نیست."}
          </p>
        </div>
      </div>

      {h.inspections.length > 0 && (
        <div className="card">
          <h2>درخواست‌های بازرسی اسپول</h2>
          <table className="dtable">
            <thead><tr><th>IR</th><th>ITP · ردیف</th><th>فعالیت</th><th>زمان</th><th>وضعیت</th><th>NCR</th></tr></thead>
            <tbody>{h.inspections.map((i) => (
              <tr key={i.irNo}><td className="mono">{i.irNo}</td><td className="mono sm">{i.itpNo} · {i.seq}</td><td className="sm">{i.title}</td>
                <td className="sm">{fa(i.plannedAt)}</td><td><span className={"pill " + (i.state === "released" ? "ok" : i.state === "rejected" ? "bad" : "")}>{i.state}</span></td>
                <td className="mono">{i.ncrNo || "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      {h.edits.length > 0 && (
        <div className="card">
          <h2>اصلاحات دستی استخراج این نقشه</h2>
          <p className="muted sm">در سطح نقشه ثبت شده‌اند، نه مخصوص این جوش؛ برای اینکه معلوم باشد رجیستر از چه ورودی ساخته شده است.</p>
          <table className="dtable">
            <thead><tr><th>Rev</th><th>مسیر</th><th>قبل</th><th>بعد</th><th>دلیل</th><th>توسط</th></tr></thead>
            <tbody>{h.edits.map((e, i) => (
              <tr key={i}><td className="mono">{e.revision}</td><td className="mono sm">{e.path}</td><td className="mono sm">{JSON.stringify(e.before)}</td>
                <td className="mono sm">{JSON.stringify(e.after)}</td><td className="sm">{e.reason || "—"}</td><td className="sm">{e.by || "—"}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </>
  );
}

function KV({ k, v, mono }) {
  const empty = v === null || v === undefined || v === "";
  // Codes (lines, spools, drawings) read left to right even on a right-to-left page.
  return <div><span className="muted sm">{k}</span><div>{empty ? "—" : mono ? <bdi dir="ltr" className="mono">{v}</bdi> : v}</div></div>;
}
const fa = (d) => (d ? new Date(d).toLocaleDateString("fa-IR") : "—");
