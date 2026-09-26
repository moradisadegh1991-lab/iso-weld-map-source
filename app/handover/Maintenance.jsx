"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import TableKit from "../../components/ui/TableKit";
import Fold from "../../components/ui/Fold";

/**
 * Handover to maintenance, phase 2: the maintenance plan, spare parts from
 * the SPIR, and periodic calibration (lib/cmms/maintenance.mjs).
 *
 * Every interval shown here cites its source; the page has no default
 * interval to offer, by design. A task is prepared by one person and
 * approved by another; only approved tasks are exported.
 */
const STATUS = { draft: ["", "پیش‌نویس"], approved: ["ok", "تأییدشده"], superseded: ["", "منسوخ"] };
const COVER = {
  covered: ["ok", "موجود"], short: ["bad", "کسری"], not_stocked: ["", "به کالای انبار وصل نیست"], not_decided: ["", "مقدار تأیید نشده"],
};
const DUE = {
  ok: ["ok", "در موعد"], due_soon: ["", "نزدیک سررسید"], overdue: ["bad", "گذشته"], failed: ["bad", "آخرین کالیبراسیون رد"],
  no_baseline: ["", "بدون کالیبراسیون قبول‌شده"], no_plan: ["", "بدون برنامه"],
};

export default function Maintenance({ tab, may }) {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/handover?projectId=${id}&view=maintenance`, []);
  const [msg, setMsg] = useState(null);
  async function post(body) {
    setMsg(null);
    try {
      const r = await call("/api/handover", { method: "POST", body: JSON.stringify({ projectId, ...body }) });
      reload();
      return r || true;
    } catch (e) { setMsg(e.message); return false; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  return (
    <>
      {msg && <p className="err">{msg}</p>}
      {tab === "pm" && <PmPlan data={data} post={post} may={may} projectId={projectId} />}
      {tab === "spares" && <Spares data={data} post={post} may={may} projectId={projectId} />}
      {tab === "calibration" && <Calibration data={data} post={post} may={may} />}
    </>
  );
}

// ── the plan ─────────────────────────────────────────────────────────────

function PmPlan({ data, post, may, projectId }) {
  const L = data.labels;
  const [edit, setEdit] = useState(null);
  // One row per task code: the approved revision, and a draft beside it if one is being written.
  const codes = new Map();
  for (const t of data.plan) {
    const k = `${t.tagId}|${t.taskCode}`;
    if (!codes.has(k)) codes.set(k, { approved: null, draft: null, history: [] });
    const c = codes.get(k);
    if (t.status === "approved") c.approved = t; else if (t.status === "draft") c.draft = t; else c.history.push(t);
  }
  const rows = [...codes.values()];
  const tagsWithPlan = new Set(rows.filter((r) => r.approved).map((r) => (r.approved.tagId)));
  const drafts = rows.filter((r) => r.draft).length;
  return (
    <>
      <div className="kpis">
        <Kpi v={`${tagsWithPlan.size}/${data.tags.length}`} l="تجهیز با برنامهٔ تأییدشده" tone={tagsWithPlan.size && tagsWithPlan.size === data.tags.length ? "ok" : ""} />
        <Kpi v={rows.filter((r) => r.approved).length} l="تسک در حال اجرا" />
        <Kpi v={drafts} l="پیش‌نویس منتظر تأیید" tone={drafts ? "warn" : ""} />
      </div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>برنامهٔ نگهداری (PM)</h2>
          {may && <a className="btn" href={`/api/handover?projectId=${projectId}&format=csv&kind=pm_plan`} download>خروجی CSV (فقط تأییدشده‌ها)</a>}
        </div>
        <p className="muted sm">هر بازه منبع دارد: دفترچهٔ سازنده، RCM، الزام قانونی یا استاندارد شرکت — پلتفرم بازه پیشنهاد نمی‌دهد. تهیه‌کننده تأیید نمی‌کند؛ تغییر تسک تأییدشده یک رویژن تازه است.</p>
        {rows.length === 0 ? <p className="empty-note">هنوز تسکی ثبت نشده است.</p> : (
          <TableKit name="pm">
            <table className="dtable">
              <thead><tr><th>تگ</th><th>تسک</th><th>شرح</th><th>راهبرد</th><th>بازه</th><th>تخصص</th><th>منبع</th><th>وضعیت</th><th /></tr></thead>
              <tbody>{rows.map((r) => {
                const t = r.approved || r.draft;
                return (
                  <tr key={`${t.tagId}-${t.taskCode}`}>
                    <td className="mono" style={{ whiteSpace: "nowrap" }}>{t.tagNo}</td>
                    <td className="mono">{t.taskCode} <span className="muted sm">rev {t.revision}</span></td>
                    <td className="sm">{t.title}</td>
                    <td className="sm">{L.strategies[t.strategy]}</td>
                    <td className="sm">{t.interval}</td>
                    <td className="sm">{L.crafts[t.craft] || "—"}{t.durationH ? ` · ${t.durationH} h` : ""}</td>
                    <td className="sm">{L.sources[t.source]}<div className="muted">{t.sourceRef}</div></td>
                    <td className="sm">
                      {r.approved && <span className="pill ok" title={`${r.approved.approvedByName || ""}`}>تأییدشده rev {r.approved.revision}</span>}
                      {r.draft && <span className="pill" style={{ marginInlineStart: 4 }} title={`تهیه: ${r.draft.preparedByName || "?"}`}>پیش‌نویس rev {r.draft.revision}</span>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{may && <>
                      <button className="btn ghost" onClick={() => setEdit(r.draft || { ...r.approved, fromApproved: true })}>{r.draft ? "ویرایش" : "رویژن جدید"}</button>
                      {r.draft && r.draft.preparedBy !== data.me && <button className="btn" style={{ marginInlineStart: 4 }} onClick={() => post({ kind: "pm-approve", taskId: r.draft.id })}>تأیید</button>}
                      {r.draft && <button className="btn ghost" style={{ marginInlineStart: 4 }} onClick={() => post({ kind: "pm-discard", taskId: r.draft.id })}>حذف پیش‌نویس</button>}
                    </>}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </TableKit>
        )}
      </div>
      {may && (
        <Fold key={edit ? `${edit.tagId}-${edit.taskCode}-${edit.revision}` : "new"} title={edit ? `${edit.fromApproved ? "رویژن جدید" : "ویرایش پیش‌نویس"} ${edit.taskCode} — ${edit.tagNo}` : "تسک نگهداری جدید"} defaultOpen={!!edit}>
          <TaskForm data={data} post={post} init={edit} done={() => setEdit(null)} />
        </Fold>
      )}
    </>
  );
}

function TaskForm({ data, post, init, done }) {
  const L = data.labels;
  const blank = { tagId: data.tags[0]?.id || "", taskCode: "", title: "", strategy: "time_based", intervalValue: "", intervalUnit: "month",
    craft: "mechanical", durationH: "", source: "oem", sourceRef: "", notes: "" };
  const [f, setF] = useState(init ? { ...blank, ...init, intervalValue: init.intervalValue ?? "", intervalUnit: init.intervalUnit || "month",
    craft: init.craft || "", durationH: init.durationH ?? "", notes: init.notes || "" } : blank);
  const rtf = f.strategy === "run_to_failure";
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={async (e) => {
      e.preventDefault();
      if (await post({ kind: "pm", ...f, intervalValue: rtf ? null : f.intervalValue, intervalUnit: rtf ? null : f.intervalUnit })) { setF(blank); done(); }
    }}>
      <h2>تسک نگهداری</h2>
      <div className="grid2">
        <Sel id="pm-tag" label="تگ تجهیز" value={f.tagId} on={set("tagId")} disabled={!!init}
             options={data.tags.map((t) => [t.id, `${t.tag_no} — ${t.description || ""}`])} />
        <Field id="pm-code" label="کد تسک (مثلاً PM-01)" value={f.taskCode} on={set("taskCode")} disabled={!!init} />
        <Field id="pm-title" label="شرح" value={f.title} on={set("title")} />
        <Sel id="pm-strategy" label="راهبرد" value={f.strategy} on={set("strategy")} options={Object.entries(L.strategies)} />
        {!rtf && <Field id="pm-iv" label="بازه" type="number" value={f.intervalValue} on={set("intervalValue")} />}
        {!rtf && <Sel id="pm-unit" label="واحد بازه" value={f.intervalUnit} on={set("intervalUnit")} options={Object.entries(L.units)} />}
        <Sel id="pm-craft" label="تخصص" value={f.craft} on={set("craft")} options={[["", "—"], ...Object.entries(L.crafts)]} />
        <Field id="pm-dur" label="مدت (ساعت)" type="number" value={f.durationH} on={set("durationH")} />
        <Sel id="pm-src" label="منبع بازه / تصمیم" value={f.source} on={set("source")} options={Object.entries(L.sources)} />
        <Field id="pm-ref" label="مرجع (دفترچه و بخش، گزارش RCM، بند مقررات)" value={f.sourceRef} on={set("sourceRef")} />
        <Field id="pm-notes" label="یادداشت" value={f.notes} on={set("notes")} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button className="btn" type="submit">ذخیره به‌عنوان پیش‌نویس</button>
        {init && <button type="button" className="btn ghost" onClick={done}>انصراف</button>}
      </div>
    </form>
  );
}

// ── spares ───────────────────────────────────────────────────────────────

function Spares({ data, post, may, projectId }) {
  const L = data.labels;
  const { parts, interchangeable } = data.spares;
  const short = parts.filter((p) => p.cover.state === "short");
  const commissioningShort = short.filter((p) => p.category === "commissioning");
  return (
    <>
      <div className="kpis">
        <Kpi v={parts.length} l="ردیف SPIR" />
        <Kpi v={new Set(parts.map((p) => p.tagId)).size} l="تجهیز با لیست یدکی" />
        <Kpi v={commissioningShort.length} l="کسری قطعات راه‌اندازی" tone={commissioningShort.length ? "bad" : ""} />
        <Kpi v={interchangeable.length} l="قطعهٔ مشترک بین تجهیزات" />
      </div>
      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>قطعات یدکی (SPIR)</h2>
          {may && <a className="btn" href={`/api/handover?projectId=${projectId}&format=csv&kind=spares`} download>خروجی CSV</a>}
        </div>
        <p className="muted sm">فروشنده پیشنهاد می‌دهد، مالک مقدار را تأیید می‌کند. «موجود» از موجودی قابل حوالهٔ انبار (پذیرفته، MTC در صورت لزوم) خوانده می‌شود.</p>
        {parts.length === 0 ? <p className="empty-note">هنوز قطعه‌ای ثبت نشده است.</p> : (
          <TableKit name="spares">
            <table className="dtable">
              <thead><tr><th>تگ</th><th>شمارهٔ قطعه</th><th>شرح</th><th>دسته</th><th>نصب</th><th>پیشنهاد</th><th>تأیید</th><th>انبار</th><th /></tr></thead>
              <tbody>{parts.map((p) => (
                <tr key={p.id}>
                  <td className="mono" style={{ whiteSpace: "nowrap" }}>{p.tagNo}</td>
                  <td className="mono sm">{p.partNo}<div className="muted">{p.manufacturer || ""}</div></td>
                  <td className="sm">{p.description}</td>
                  <td className="sm">{L.spareCategories[p.category]}</td>
                  <td className="mono">{p.qtyInstalled ?? "—"}</td><td className="mono">{p.qtyRecommended ?? "—"}</td>
                  <td className="mono">{p.qtyApproved ?? "—"} <span className="muted">{p.uom}</span></td>
                  <td className="sm"><span className={"pill " + COVER[p.cover.state][0]}>{COVER[p.cover.state][1]}</span>
                    {p.cover.state === "short" && <span className="mono"> {p.cover.have}/{p.cover.need}</span>}
                    {p.itemCode && <div className="muted mono">{p.itemCode}</div>}</td>
                  <td>{may && <button className="btn ghost" onClick={() => post({ kind: "spare-remove", spareId: p.id })}>حذف</button>}</td>
                </tr>
              ))}</tbody>
            </table>
          </TableKit>
        )}
        {interchangeable.length > 0 && (
          <>
            <h2 style={{ marginTop: 16 }}>قطعات مشترک (Interchangeability)</h2>
            <ul className="sm">{interchangeable.map((g) => (
              <li key={g.partNo + g.manufacturer}><span className="mono">{g.partNo}</span> {g.manufacturer ? `(${g.manufacturer})` : ""} — {g.description}: {g.tags.join("، ")}</li>
            ))}</ul>
          </>
        )}
      </div>
      {may && <Fold title="ثبت قطعهٔ یدکی"><SpareForm data={data} post={post} /></Fold>}
    </>
  );
}

function SpareForm({ data, post }) {
  const L = data.labels;
  const blank = { tagId: data.tags[0]?.id || "", partNo: "", manufacturer: "", description: "", category: "operational", uom: "EA",
    qtyInstalled: "", qtyRecommended: "", qtyApproved: "", itemId: "", spirRef: "" };
  const [f, setF] = useState(blank);
  const set = (k) => (v) => setF({ ...f, [k]: v });
  return (
    <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "spare", ...f, itemId: f.itemId || null })) setF({ ...blank, tagId: f.tagId }); }}>
      <h2>قطعهٔ یدکی</h2>
      <div className="grid2">
        <Sel id="sp-tag" label="تگ تجهیز" value={f.tagId} on={set("tagId")} options={data.tags.map((t) => [t.id, `${t.tag_no} — ${t.description || ""}`])} />
        <Field id="sp-no" label="شمارهٔ قطعهٔ سازنده" value={f.partNo} on={set("partNo")} />
        <Field id="sp-mf" label="سازنده" value={f.manufacturer} on={set("manufacturer")} />
        <Field id="sp-desc" label="شرح" value={f.description} on={set("description")} />
        <Sel id="sp-cat" label="دسته" value={f.category} on={set("category")} options={Object.entries(L.spareCategories)} />
        <Field id="sp-uom" label="واحد" value={f.uom} on={set("uom")} />
        <Field id="sp-inst" label="تعداد نصب‌شده" type="number" value={f.qtyInstalled} on={set("qtyInstalled")} />
        <Field id="sp-rec" label="پیشنهاد SPIR" type="number" value={f.qtyRecommended} on={set("qtyRecommended")} />
        <Field id="sp-app" label="تأیید مالک" type="number" value={f.qtyApproved} on={set("qtyApproved")} />
        <Sel id="sp-item" label="کالای انبار (اختیاری)" value={f.itemId} on={set("itemId")}
             options={[["", "—"], ...data.items.map((i) => [i.id, `${i.code} — ${i.description} (${i.uom})`])]} />
        <Field id="sp-ref" label="مرجع SPIR" value={f.spirRef} on={set("spirRef")} />
      </div>
      <div style={{ marginTop: 8 }}><button className="btn" type="submit">ذخیره</button></div>
    </form>
  );
}

// ── calibration ──────────────────────────────────────────────────────────

function Calibration({ data, post, may }) {
  const L = data.labels;
  const rows = data.calibration;
  const [open, setOpen] = useState(null);
  const n = (s) => rows.filter((r) => r.due.state === s).length;
  return (
    <>
      <div className="kpis">
        <Kpi v={`${rows.filter((r) => r.plan).length}/${rows.length}`} l="ابزار با برنامهٔ کالیبراسیون" />
        <Kpi v={n("overdue")} l="سررسید گذشته" tone={n("overdue") ? "bad" : ""} />
        <Kpi v={n("due_soon")} l="تا ۳۰ روز آینده" tone={n("due_soon") ? "warn" : ""} />
        <Kpi v={n("failed")} l="آخرین کالیبراسیون رد" tone={n("failed") ? "bad" : ""} />
      </div>
      <div className="card">
        <h2>کالیبراسیون دوره‌ای</h2>
        <p className="muted sm">سررسید = آخرین کالیبراسیون <b>قبول‌شده</b> + بازهٔ برنامه. ترنسمیتر و گیج از نقاط کالیبراسیون قضاوت می‌شوند؛ شیر، سوئیچ و المان از امضای تکنسین. بدون برنامه یا بدون کالیبراسیون قبول‌شده سررسیدی ساخته نمی‌شود.</p>
        <TableKit name="calplan">
          <table className="dtable">
            <thead><tr><th>ابزار</th><th>نوع</th><th>ساب‌سیستم</th><th>برنامه</th><th>آخرین قبول</th><th>سررسید</th><th>وضعیت</th><th /></tr></thead>
            <tbody>{rows.map((r) => [
              <tr key={r.id}>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>{r.tagNo}<div className="muted sm">{r.service || ""}</div></td>
                <td className="sm">{r.category || "—"}</td>
                <td className="mono sm">{r.subsystem || "—"}</td>
                <td className="sm">{r.plan ? <>هر {r.plan.intervalMonths} ماه<div className="muted">{L.sources[r.plan.source]} — {r.plan.sourceRef}</div></> : "—"}</td>
                <td className="sm">{r.lastPass ? new Date(r.lastPass).toLocaleDateString("fa-IR") : "—"}</td>
                <td className="sm">{r.due.due ? new Date(r.due.due).toLocaleDateString("fa-IR") : "—"}</td>
                <td><span className={"pill " + DUE[r.due.state][0]} title={r.due.text || ""}>{DUE[r.due.state][1]}</span>
                  {r.due.days !== undefined && <span className="muted sm"> {r.due.days < 0 ? `${-r.due.days} روز گذشته` : `${r.due.days} روز مانده`}</span>}</td>
                <td>{may && <button className="btn ghost" onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? "بستن" : "برنامه"}</button>}</td>
              </tr>,
              open === r.id && <tr key={r.id + "-x"}><td colSpan={8}><PlanForm r={r} L={L} post={post} done={() => setOpen(null)} /></td></tr>,
            ])}</tbody>
          </table>
        </TableKit>
      </div>
    </>
  );
}

function PlanForm({ r, L, post, done }) {
  const [f, setF] = useState({ intervalMonths: r.plan?.intervalMonths ?? "", source: r.plan?.source || "company", sourceRef: r.plan?.sourceRef || "" });
  return (
    <form className="grid2" style={{ alignItems: "end" }} onSubmit={async (e) => {
      e.preventDefault(); if (await post({ kind: "calplan", instrumentId: r.id, ...f })) done();
    }}>
      <Field id={`cp-m-${r.id}`} label="بازه (ماه)" type="number" value={f.intervalMonths} on={(v) => setF({ ...f, intervalMonths: v })} />
      <Sel id={`cp-s-${r.id}`} label="منبع" value={f.source} on={(v) => setF({ ...f, source: v })} options={Object.entries(L.sources)} />
      <Field id={`cp-r-${r.id}`} label="مرجع (استاندارد، دفترچه، مقررات)" value={f.sourceRef} on={(v) => setF({ ...f, sourceRef: v })} />
      <div><button className="btn" type="submit">ذخیره</button></div>
    </form>
  );
}

// ── bits ─────────────────────────────────────────────────────────────────

function Kpi({ v, l, tone = "" }) {
  return <div className={`kpi ${tone}`}><span className="v">{v}</span><span className="l">{l}</span></div>;
}
function Field({ id, label, value, on, type = "text", disabled = false }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <input id={id} type={type} dir="auto" value={value} disabled={disabled} onChange={(e) => on(e.target.value)} step={type === "number" ? "any" : undefined} /></div>
  );
}
function Sel({ id, label, value, on, options, disabled = false }) {
  return (
    <div className="field"><label htmlFor={id}>{label}</label>
      <select id={id} value={value} disabled={disabled} onChange={(e) => on(e.target.value)}>
        {options.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select></div>
  );
}
