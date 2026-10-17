"use client";
import { useState } from "react";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { localToday, DayHint } from "../../components/ui/WorkDate";

/**
 * The daily site report: written by the contractor, reviewed, signed and
 * approved stage by stage (lib/reports/workflow.mjs decides who may do
 * what). People, machines and materials are separate lists with their own
 * units; what the project already holds for the day can be brought in, and
 * every row says where it came from.
 */
const EMPTY = { shift: "day", working: true, weather: { condition: "", tempMin: "", tempMax: "", humidity: "" },
  manpower: [], equipment: [], materials: [], work: [], stoppages: [], hse: { incidents: "", permits: "", observations: "", note: "" }, notes: "" };

const COLS = {
  manpower: [["role", "سمت", "text"], ["discipline", "رشته", "text"], ["employer", "پیمانکار / کارفرما", "text"], ["present", "حاضر", "number"],
    ["leave", "مرخصی", "number"], ["night", "شب‌کار", "number"], ["hours", "ساعت", "number"]],
  equipment: [["name", "دستگاه", "text"], ["owner", "مالک", "text"], ["working", "فعال", "number"], ["idle", "غیرفعال", "number"], ["note", "توضیح", "text"]],
  materials: [["name", "مصالح / مصرفی", "text"], ["unit", "واحد", "text"], ["qty", "مقدار", "number"], ["note", "توضیح", "text"]],
  work: [["description", "شرح کار", "text"], ["discipline", "رشته", "text"], ["location", "محل", "text"], ["qty", "مقدار", "number"], ["unit", "واحد", "text"]],
  stoppages: [["reason", "علت توقف", "text"], ["scope", "محدوده / گروه", "text"], ["hours", "ساعت", "number"], ["note", "توضیح", "text"]],
};
const TITLES = { manpower: "نیروی انسانی (نفر)", equipment: "ماشین‌آلات (دستگاه)", materials: "مصالح و مصرفی (هر ردیف با واحد خودش)",
  work: "کار انجام‌شده", stoppages: "توقف‌ها و موانع" };

// which catalogue list a column suggests from (lib/reports/catalog.mjs kinds)
const SUGGEST = { "manpower.role": "dl-person", "manpower.discipline": "dl-disc", "equipment.name": "dl-machine",
  "materials.name": "dl-material", "materials.unit": "dl-unit", "work.discipline": "dl-disc" };
const KINDS = { manpower: ["person"], equipment: ["machine", "tool"], materials: ["consumable", "material", "project_material"] };

function Rows({ list, rows, setRows, labels, readOnly, catalog = [] }) {
  const cols = COLS[list];
  const set = (i, k, v) => setRows(rows.map((r, j) => {
    if (j !== i) return r;
    const next = { ...r, [k]: v, source: r.source === "manual" || !r.source ? "manual" : r.source };
    // a name the catalogue knows brings its discipline and unit — only into empty fields
    const known = (k === "role" || k === "name") && catalog.find((c) => (KINDS[list] || []).includes(c.kind) && c.name === v);
    if (known) {
      if (list === "manpower" && !next.discipline && known.discipline) next.discipline = known.discipline;
      if (list === "materials" && !next.unit && known.unit) next.unit = known.unit;
    }
    return next;
  }));
  if (readOnly && !rows.length) return <p className="muted sm">ثبت نشده.</p>;
  return (
    <div className="tablewrap">
      <table className="dtable">
        <thead><tr>{cols.map(([k, l]) => <th key={k}>{l}</th>)}<th>منبع</th>{!readOnly && <th />}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={i}>
            {cols.map(([k, l, t]) => (
              <td key={k}>{readOnly ? (r[k] ?? "—") : (
                <input aria-label={`${l} ردیف ${i + 1}`} type={t} list={SUGGEST[`${list}.${k}`]} dir={t === "number" ? "ltr" : undefined} min={t === "number" ? 0 : undefined}
                  step={k === "hours" || k === "qty" ? "any" : 1} value={r[k] ?? ""} onChange={(e) => set(i, k, e.target.value)} />
              )}</td>
            ))}
            <td className="sm muted">{labels.SOURCE[r.source || "manual"]}{r.state === "claimed" ? " · ادعای پیمانکار" : ""}</td>
            {!readOnly && <td><button className="btn ghost sm" type="button" aria-label={`حذف ردیف ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td>}
          </tr>
        ))}</tbody>
      </table>
      {!readOnly && <button className="btn ghost sm" type="button" onClick={() => setRows([...rows, { source: "manual" }])}>+ ردیف</button>}
    </div>
  );
}

function Editor({ value, setValue, labels, readOnly, onPrefill, catalog = [] }) {
  const v = value;
  const up = (patch) => setValue({ ...v, ...patch });
  return (
    <>
      <div className="grid2">
        <div className="field"><label htmlFor="d-shift">شیفت</label>
          <select id="d-shift" disabled={readOnly} value={v.shift} onChange={(e) => up({ shift: e.target.value })}>
            {Object.entries(labels.SHIFT).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="field"><label htmlFor="d-work">روز کاری</label>
          <select id="d-work" disabled={readOnly} value={v.working ? "1" : "0"} onChange={(e) => up({ working: e.target.value === "1" })}>
            <option value="1">کاری</option><option value="0">تعطیل / غیرکاری</option></select></div>
        <div className="field"><label htmlFor="d-wc">آب‌وهوا</label>
          <select id="d-wc" disabled={readOnly} value={v.weather.condition || ""} onChange={(e) => up({ weather: { ...v.weather, condition: e.target.value } })}>
            <option value="">—</option>{Object.entries(labels.WEATHER).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        {[["tempMin", "حداقل دما °C"], ["tempMax", "حداکثر دما °C"], ["humidity", "رطوبت ٪"]].map(([k, l]) => (
          <div className="field" key={k}><label htmlFor={`d-${k}`}>{l}</label>
            <input id={`d-${k}`} type="number" dir="ltr" readOnly={readOnly} value={v.weather[k] ?? ""} onChange={(e) => up({ weather: { ...v.weather, [k]: e.target.value } })} /></div>
        ))}
      </div>
      {onPrefill && !readOnly && (
        <p><button className="btn ghost" type="button" onClick={onPrefill}>آوردن داده‌های همین روز از پروژه</button>
          <span className="muted sm"> کارکرد منابع انسانی، مراحل تمام‌شده یا ادعاشده و HSE همان روز — هر ردیف منبعش را نشان می‌دهد و قابل ویرایش است.</span></p>
      )}
      {Object.keys(COLS).map((list) => (
        <section key={list} className="dsection"><h3>{TITLES[list]}</h3>
          <Rows list={list} rows={v[list]} setRows={(rows) => up({ [list]: rows })} labels={labels} readOnly={readOnly} catalog={catalog} /></section>
      ))}
      <section className="dsection"><h3>HSE روز</h3>
        <div className="grid2">
          {[["incidents", "حوادث"], ["permits", "مجوزهای کار معتبر"], ["observations", "مشاهدات"]].map(([k, l]) => (
            <div className="field" key={k}><label htmlFor={`h-${k}`}>{l}</label>
              <input id={`h-${k}`} type="number" min={0} dir="ltr" readOnly={readOnly} value={v.hse[k] ?? ""} onChange={(e) => up({ hse: { ...v.hse, [k]: e.target.value, source: "manual" } })} /></div>
          ))}
          <div className="field"><label htmlFor="h-note">توضیح HSE</label>
            <input id="h-note" readOnly={readOnly} value={v.hse.note ?? ""} onChange={(e) => up({ hse: { ...v.hse, note: e.target.value } })} /></div>
        </div>
        <p className="muted sm">منبع: {labels.SOURCE[v.hse.source || "manual"]}</p>
      </section>
      {!readOnly && <Datalists catalog={catalog} />}
      <div className="field"><label htmlFor="d-notes">توضیحات</label>
        <textarea id="d-notes" rows={3} readOnly={readOnly} value={v.notes ?? ""} onChange={(e) => up({ notes: e.target.value })} /></div>
    </>
  );
}

function Datalists({ catalog }) {
  const names = (kinds) => [...new Set(catalog.filter((c) => kinds.includes(c.kind)).map((c) => c.name))];
  const lists = { "dl-person": names(KINDS.manpower), "dl-machine": names(KINDS.equipment), "dl-material": names(KINDS.materials),
    "dl-disc": [...new Set(catalog.filter((c) => c.kind === "person" && c.discipline).map((c) => c.discipline))],
    "dl-unit": [...new Set(catalog.filter((c) => c.unit && KINDS.materials.includes(c.kind)).map((c) => c.unit))] };
  return <>{Object.entries(lists).map(([id, xs]) => <datalist key={id} id={id}>{xs.map((x) => <option key={x} value={x} />)}</datalist>)}</>;
}

const fromContent = (c) => ({ ...EMPTY, ...c, weather: { ...EMPTY.weather, ...(c?.weather || {}) }, hse: { ...EMPTY.hse, ...(c?.hse || {}) } });

export default function DailyReportsPage() {
  const { projectId, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => `/api/daily-reports?projectId=${id}`, []);
  const [msg, setMsg] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [view, setView] = useState(null);
  const [draft, setDraft] = useState(null);          // a new report being written
  const [date, setDate] = useState(localToday());
  const [title, setTitle] = useState("");
  const [edit, setEdit] = useState(null);            // content being edited on an open report
  const [comment, setComment] = useState("");
  const [send, setSend] = useState({ userIds: [], note: "" });

  async function open(id) {
    setMsg(null); setOpenId(id); setEdit(null); setComment("");
    try { setView(await call(`/api/daily-reports?projectId=${projectId}&id=${id}`)); } catch (e) { setMsg(e.message); }
  }
  async function post(body, after) {
    setMsg(null);
    try { const r = await call("/api/daily-reports", { method: "POST", body: JSON.stringify({ projectId, ...body }) }); reload(); if (after) await after(r); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  async function prefill(target, setTarget, day) {
    setMsg(null);
    try {
      const p = await call(`/api/daily-reports?projectId=${projectId}&prefill=${day}`);
      setTarget({ ...target,
        manpower: [...target.manpower.filter((r) => r.source !== "hr"), ...p.manpower],
        work: [...target.work.filter((r) => r.source !== "platform"), ...p.work],
        hse: { ...target.hse, ...p.hse } });
      if (!p.found.people && !p.found.work) setMsg(`برای ${day} کارکرد یا کار ثبت‌شده‌ای در پروژه نیست.`);
    } catch (e) { setMsg(e.message); }
  }

  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">در حال بارگذاری…</p>;
  const legacyNote = data.contracts > 0 && <p className="note" data-legacy-daily>گزارش روزانهٔ تازه در <a href="/contract-reports">گزارش روزانهٔ قرارداد</a> نوشته می‌شود.
    اینجا گزارش‌هایی که پیش از آن نوشته شده‌اند خوانده، امضا، تأیید و چاپ می‌شوند.</p>;
  if (!data.type) return (
    <div className="page"><div className="pagehead"><h1>گزارش روزانه</h1></div>
      {legacyNote || <p className="empty-note">گردش‌کار گزارش روزانه هنوز تنظیم نشده است. مدیر پروژه آن را در «تنظیم گردش‌کار» می‌سازد و اعضای هر مرحله را تعیین می‌کند.</p>}</div>
  );
  const L = data.labels;
  const v = view;

  return (
    <div className="page">
      <div className="pagehead"><h1>گزارش روزانه</h1>
        <span className="sub">{data.reports.length} گزارش · {data.type.stages.map((s) => s.name).join(" ← ")}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {legacyNote}

      <div className="card">
        <h2>گزارش‌ها</h2>
        {data.may.create && !draft && (
          <p><button className="btn" type="button" onClick={() => { setDraft(fromContent({})); setOpenId(null); setView(null); }}>گزارش روزانهٔ تازه</button></p>
        )}
        {data.reports.length === 0 ? <p className="empty-note">گزارشی نیست.</p> : (
          <div className="tablewrap"><table className="dtable">
            <thead><tr><th>شماره</th><th>تاریخ</th><th>عنوان</th><th>مرحله</th><th>وضعیت</th><th>نسخه</th><th /></tr></thead>
            <tbody>{data.reports.map((r) => (
              <tr key={r.id} className={openId === r.id ? "sel" : ""}>
                <td className="mono">{r.report_no}</td><td className="mono sm">{new Date(r.report_date).toLocaleDateString("fa-IR")}</td>
                <td>{r.title || "—"}</td><td className="sm">{r.status === "open" ? r.stage_name : "—"}</td>
                <td><span className={`pill ${r.status === "approved" ? "ok" : r.status === "cancelled" ? "" : "warn"}`}>{r.status_fa}</span></td>
                <td className="mono">{r.version_no}</td>
                <td><button className="btn ghost sm" type="button" onClick={() => { setDraft(null); open(r.id); }}>باز کردن</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>

      {draft && (
        <div className="card">
          <h2>گزارش روزانهٔ تازه</h2>
          <div className="grid2">
            <div className="field"><label htmlFor="n-date">تاریخ گزارش</label>
              <input id="n-date" type="date" dir="ltr" max={localToday()} value={date} onChange={(e) => setDate(e.target.value)} /><DayHint date={date} /></div>
            <div className="field"><label htmlFor="n-title">عنوان (اختیاری)</label><input id="n-title" value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          </div>
          <Editor value={draft} setValue={setDraft} labels={L} catalog={data.catalog} onPrefill={() => prefill(draft, setDraft, date)} />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn" type="button" onClick={() => post({ kind: "create", reportDate: date, title, content: draft },
              async (r) => { setDraft(null); setTitle(""); await open(r.row.id); })}>ثبت گزارش</button>
            <button className="btn ghost" type="button" onClick={() => setDraft(null)}>انصراف</button>
          </div>
        </div>
      )}

      {v && (
        <div className="card" id="report">
          <h2>{v.report.report_no} — {new Date(v.report.report_date).toLocaleDateString("fa-IR")}{v.report.title ? ` — ${v.report.title}` : ""}</h2>
          <p className="sm">
            <span className={`pill ${v.report.status === "approved" ? "ok" : v.report.status === "cancelled" ? "" : "warn"}`}>{v.report.status_fa}</span>
            {v.report.status === "open" && <> · در مرحلهٔ <b>{v.report.stage_name}</b></>} · نسخهٔ {v.versionNo}
            {v.record && <> · رکورد: نسخهٔ {v.record.versionNo}، <span className="mono">{v.record.hash.slice(0, 12)}…</span></>}
          </p>
          <p><a className="btn ghost sm" href={`/daily-reports/print?id=${v.report.id}`}>نمای چاپ</a></p>
          <div className="moneyrow">
            <div><span>نفرات حاضر</span><b>{v.totals.people}</b></div>
            <div><span>مرخصی</span><b>{v.totals.onLeave}</b></div>
            <div><span>ماشین‌آلات فعال</span><b>{v.totals.machinesWorking}</b></div>
            <div><span>ماشین‌آلات غیرفعال</span><b>{v.totals.machinesIdle}</b></div>
            <div><span>ساعت توقف</span><b>{v.totals.stoppageHours}</b></div>
          </div>

          {edit ? (
            <>
              <Editor value={edit} setValue={setEdit} labels={L} catalog={data.catalog} onPrefill={() => prefill(edit, setEdit, String(v.report.report_date).slice(0, 10))} />
              <div style={{ display: "flex", gap: 8 }}>
                <button className="btn" type="button" onClick={() => post({ kind: "edit", reportId: v.report.id, content: edit }, () => open(v.report.id))}>ذخیرهٔ نسخهٔ تازه</button>
                <button className="btn ghost" type="button" onClick={() => setEdit(null)}>انصراف</button>
              </div>
            </>
          ) : (
            <>
              <Editor value={fromContent(v.content)} setValue={() => {}} labels={L} readOnly />
              {v.may.edit && <button className="btn ghost" type="button" onClick={() => setEdit(fromContent(v.content))}>ویرایش</button>}
            </>
          )}

          <h3 style={{ marginTop: 16 }}>امضاها</h3>
          <div className="sigrow">
            {v.signatureBoxes.flatMap((st) => st.groups.map((g) => (
              <div className="sigcell" key={g.groupId}>
                <div className="sigstage">{st.stageName}</div>
                <div className="siggroup">{g.title || g.name}</div>
                {g.signatures.length === 0 ? <div className="muted sm">—</div> : g.signatures.map((s) => (
                  <div key={s.userId} className={s.current ? "" : "stale"}>
                    {s.signatureId ? <img src={`/api/signature?projectId=${projectId}&id=${s.signatureId}`} alt={`امضای ${s.name || ""}`} /> : null}
                    <div className="sm">{s.onBehalfOf && <span className="muted">از طرف {s.onBehalfOf} — </span>}{s.name || "—"}</div>
                    <div className="mono sm">{new Date(s.at).toLocaleString("fa-IR")}</div>
                    {!s.current && <div className="sm warn">روی نسخهٔ {s.versionNo} — دیگر حساب نمی‌شود</div>}
                  </div>
                ))}
              </div>
            )))}
          </div>

          {v.report.status === "open" && (
            <div className="actions">
              {v.may.signFor.map((gid) => {
                const g = v.signatureBoxes.flatMap((s) => s.groups).find((x) => x.groupId === gid);
                return <button key={gid} className="btn" type="button" onClick={() => post({ kind: "sign", reportId: v.report.id, groupId: gid }, () => open(v.report.id))}>
                  امضا{v.may.signFor.length > 1 ? ` برای ${g?.name}` : ""}</button>;
              })}
              {v.may.withdraw && <button className="btn ghost" type="button" onClick={() => post({ kind: "withdraw", reportId: v.report.id }, () => open(v.report.id))}>پس‌گرفتن امضا</button>}
              {v.may.approve && <button className="btn" type="button" onClick={() => post({ kind: "approve", reportId: v.report.id, comment }, () => open(v.report.id))}>تأیید نهایی مرحله</button>}
              {(v.may.return || v.may.cancel) && (
                <div className="field" style={{ flexBasis: "100%" }}><label htmlFor="r-comment">دلیل (برای برگشت یا حذف)</label>
                  <input id="r-comment" value={comment} onChange={(e) => setComment(e.target.value)} /></div>
              )}
              {v.may.return && <button className="btn ghost" type="button" onClick={() => post({ kind: "return", reportId: v.report.id, comment }, () => open(v.report.id))}>برگشت به مرحلهٔ قبل</button>}
              {v.may.cancel && <button className="btn ghost" type="button" onClick={() => post({ kind: "cancel", reportId: v.report.id, comment }, () => open(v.report.id))}>حذف (لغو) گزارش</button>}
            </div>
          )}

          <details className="inlinefold"><summary>ارسال برای چند نفر</summary>
            <div className="permgrid" role="group" aria-label="گیرندگان">
              {data.users.map((u) => (
                <label key={u.id}><input type="checkbox" checked={send.userIds.includes(u.id)} onChange={(e) => setSend({ ...send,
                  userIds: e.target.checked ? [...send.userIds, u.id] : send.userIds.filter((x) => x !== u.id) })} /> {u.name}</label>
              ))}
            </div>
            <div className="field"><label htmlFor="s-note">یادداشت</label><input id="s-note" value={send.note} onChange={(e) => setSend({ ...send, note: e.target.value })} /></div>
            <button className="btn ghost" type="button" onClick={() => post({ kind: "send", reportId: v.report.id, ...send }, () => setSend({ userIds: [], note: "" }))}>ارسال</button>
          </details>

          <details className="inlinefold"><summary>سابقه: {v.versions.length} نسخه، {v.decisions.length} تصمیم</summary>
            <table className="dtable">
              <thead><tr><th>نسخه</th><th>مرحله</th><th>ویرایشگر</th><th>زمان</th><th>هش</th></tr></thead>
              <tbody>{v.versions.map((x) => (
                <tr key={x.version_no}><td className="mono">{x.version_no}</td><td>{x.stage_seq}</td><td>{x.edited_by || "—"}</td>
                  <td className="mono sm">{new Date(x.edited_at).toLocaleString("fa-IR")}</td><td className="mono sm">{x.content_hash.slice(0, 12)}…</td></tr>
              ))}</tbody>
            </table>
            <table className="dtable">
              <thead><tr><th>مرحله</th><th>تصمیم</th><th>نسخه</th><th>توسط</th><th>توضیح</th><th>زمان</th></tr></thead>
              <tbody>{v.decisions.map((d, i) => (
                <tr key={i}><td>{d.stageSeq}</td><td>{{ approved: "تأیید", returned: "برگشت", cancelled: "لغو" }[d.action]}</td><td className="mono">{d.versionNo}</td>
                  <td>{d.by || "—"}</td><td className="sm">{d.comment || "—"}</td><td className="mono sm">{new Date(d.at).toLocaleString("fa-IR")}</td></tr>
              ))}</tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  );
}
