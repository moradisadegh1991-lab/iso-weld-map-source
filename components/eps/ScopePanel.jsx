"use client";
import { useState } from "react";
import { fmt } from "./ActivityDetail";

import TableKit from "../ui/TableKit";
/**
 * The link between a PMS activity (or a WBS node) and the platform's records
 * (lib/eps/scope.mjs): which equipment, welds, cables, instruments,
 * foundations or structures it covers, in what measure, and which milestone
 * counts as done. The volume and the done are the items' — a new drawing,
 * P&ID or register reaches the activity by itself; what changed since the
 * rule was last applied is shown, with who applied it and when.
 */
const blank = (discipline = "equipment") => ({ discipline, measure: "count", milestone: "", autoApply: true,
  filter: { subsystemIds: [], unitIds: [], pattern: "", docPattern: "", kinds: "" } });
const toForm = (r) => ({ id: r.id, discipline: r.discipline, measure: r.measure, milestone: r.milestone, autoApply: r.auto_apply,
  filter: { subsystemIds: r.filter.subsystemIds || [], unitIds: r.filter.unitIds || [], pattern: r.filter.pattern || "", docPattern: r.filter.docPattern || "", kinds: (r.filter.kinds || []).join(", ") } });

export function describeRule(r, L, choices) {
  const d = L.disciplines[r.discipline];
  const f = r.filter || {};
  const parts = [];
  if (f.subsystemIds?.length) parts.push(`زیرسیستم ${f.subsystemIds.map((id) => choices?.subsystems.find((s) => s.id === id)?.code || "?").join("، ")}`);
  if (f.unitIds?.length) parts.push(`واحد ${f.unitIds.map((id) => choices?.units.find((s) => s.id === id)?.code || "?").join("، ")}`);
  if (f.pattern) parts.push(`شماره ${f.pattern}`);
  if (f.docPattern) parts.push(`نقشه ${f.docPattern}`);
  if (f.kinds?.length) parts.push(`نوع ${f.kinds.join("، ")}`);
  return `${d?.title || r.discipline} · ${parts.length ? parts.join(" · ") : "همه"} · سنجه: ${L.measures[r.measure]} · انجام‌شده: ${d?.milestones[r.milestone] || r.milestone}`;
}

export function RuleForm({ init, L, choices, onSave, onCancel, perItem = false }) {
  const [f, setF] = useState(init ? toForm(init) : blank());
  const d = L.disciplines[f.discipline];
  const set = (k, v) => setF({ ...f, [k]: v });
  const setFilter = (k, v) => setF({ ...f, filter: { ...f.filter, [k]: v } });
  const multi = (k, opts) => (
    <select multiple size={Math.min(5, Math.max(2, opts.length))} value={f.filter[k]} aria-label={k === "subsystemIds" ? "زیرسیستم‌ها" : "واحدها"}
      onChange={(e) => setFilter(k, [...e.target.selectedOptions].map((o) => o.value))}>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.code}{o.name ? ` — ${o.name}` : ""}</option>)}</select>);
  return (
    <form className="card" data-scope-form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, milestone: f.milestone || Object.keys(d.milestones).pop(),
      filter: { ...f.filter, kinds: String(f.filter.kinds || "").split(",").map((x) => x.trim()).filter(Boolean) } }); }}>
      <h3>{perItem ? "یک فعالیت برای هر قلم (هر خط در پایپینگ)" : "محدودهٔ این فعالیت از داده‌های پلتفرم"}</h3>
      <div className="grid2">
        <div className="field"><label htmlFor="sr-d">رشته</label><select id="sr-d" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value, measure: "count", milestone: "" })}>
          {Object.entries(L.disciplines).map(([k, v]) => <option key={k} value={k}>{v.title}</option>)}</select></div>
        <div className="field"><label htmlFor="sr-m">سنجه</label><select id="sr-m" value={f.measure} onChange={(e) => set("measure", e.target.value)}>
          {d.measures.map((m) => <option key={m} value={m}>{L.measures[m]}</option>)}</select></div>
        <div className="field"><label htmlFor="sr-ms">کِی انجام‌شده شمرده شود</label><select id="sr-ms" value={f.milestone || Object.keys(d.milestones).pop()} onChange={(e) => set("milestone", e.target.value)}>
          {Object.entries(d.milestones).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        <div className="field"><label htmlFor="sr-p">الگوی شماره (تگ، کابل، خط) — * و ? و چند الگو با ویرگول</label>
          <input id="sr-p" dir="ltr" value={f.filter.pattern} onChange={(e) => setFilter("pattern", e.target.value)} placeholder="20-P-*, 20-E-*" /></div>
        {d.docs && <div className="field"><label htmlFor="sr-doc">الگوی شمارهٔ نقشه (ایزومتریک)</label>
          <input id="sr-doc" dir="ltr" value={f.filter.docPattern} onChange={(e) => setFilter("docPattern", e.target.value)} placeholder="ISO-20-*" /></div>}
        {d.kindLabel && <div className="field"><label htmlFor="sr-k">{d.kindLabel} (با ویرگول)</label>
          <input id="sr-k" dir="ltr" value={f.filter.kinds} onChange={(e) => setFilter("kinds", e.target.value)} /></div>}
        <div className="field"><label>زیرسیستم‌ها (هیچ = همه)</label>{multi("subsystemIds", choices.subsystems)}</div>
        <div className="field"><label>واحدها (هیچ = همه)</label>{multi("unitIds", choices.units)}</div>
      </div>
      <label className="sm"><input type="checkbox" checked={f.autoApply} onChange={(e) => set("autoApply", e.target.checked)} /> تغییرات نقشه‌ها، P&ID و فهرست‌های تازه خودکار در PMS اعمال شود</label>
      <p><button className="btn" type="submit">ذخیره</button> {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>انصراف</button>}</p>
    </form>);
}

/** Pending changes of a rule: what came in and what went out since it was last applied. */
export function Pending({ pending, firstApply }) {
  if (!pending) return null;
  if (!pending.any && !firstApply) return <p className="sm muted">از آخرین اعمال تغییری نیست.</p>;
  return (
    <div className="sm" data-pending>
      {firstApply && <p>این قاعده هنوز اعمال نشده است.</p>}
      {pending.added.length > 0 && <p style={{ color: "var(--ok, #1e8449)" }}>+ {pending.added.length} قلم تازه: {pending.added.slice(0, 20).map((x) => x.label).join("، ")}{pending.added.length > 20 ? "…" : ""}</p>}
      {pending.removed.length > 0 && <p style={{ color: "var(--bad, #c0392b)" }}>− {pending.removed.length} قلم حذف‌شده: {pending.removed.slice(0, 20).map((x) => x.label).join("، ")}{pending.removed.length > 20 ? "…" : ""}</p>}
      {pending.changed.length > 0 && <p>~ {pending.changed.length} قلم با مقدار تغییرکرده: {pending.changed.slice(0, 10).map((x) => `${x.label} (${fmt(x.from)} → ${fmt(x.to)})`).join("، ")}</p>}
    </div>);
}

/** The scope sub-form of an activity. */
export function ScopeTab({ d, may, post, L }) {
  const [edit, setEdit] = useState(false);
  const a = d.activity, s = d.scope;
  if (!s || edit) {
    if (!may) return <p className="empty-note">این فعالیت به داده‌های پلتفرم پیوند ندارد؛ پیشرفتش از گزارش روزانه است.</p>;
    return (
      <div>
        {!s && <p className="sm muted">با پیوند، حجم و پیشرفت این فعالیت از تجهیزات، جوش‌ها، کابل‌ها، ابزارها، فونداسیون‌ها یا سازه‌های ثبت‌شده در پلتفرم خوانده می‌شود؛ هر نقشه، P&ID یا فهرست تازه خودبه‌خود به آن می‌رسد و پیشرفتش دیگر در گزارش روزانه ثبت نمی‌شود.</p>}
        <RuleForm init={s?.rule} L={L} choices={d.scopeChoices} onCancel={s ? () => setEdit(false) : null}
          onSave={async (f) => { if (await post("/api/eps/activities", { kind: "scope-rule", activityId: a.id, ...f }, () => "پیوند ذخیره شد.")) setEdit(false); }} />
      </div>);
  }
  const r = s.rule;
  return (
    <div data-scope-tab>
      <p className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b>{s.madeBy ? `ساخته‌شده از قاعدهٔ گره — قلم ${s.item}` : "پیوند فعالیت"}</b>
        <span className="sm">{describeRule(r, L, d.scopeChoices)}</span>
        {s.removed && <span className="chip" style={{ color: "var(--bad)" }}>از محدوده خارج شده</span>}
        {may && !s.madeBy && <>
          <button className="btn ghost sm" type="button" onClick={() => setEdit(true)}>ویرایش</button>
          <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "scope-rule-remove", id: r.id }, () => "پیوند برداشته شد.")}>برداشتن پیوند</button></>}
      </p>
      <p className="sm">اقلام: <b>{fmt(s.summary.items)}</b> · حجم: <b>{fmt(s.summary.qty)}</b> {L.measures[r.measure]} · انجام‌شده: <b>{fmt(s.summary.done)}</b> ({fmt(s.summary.doneCount)} قلم) ·
        پیشرفت: <b>{s.summary.pct == null ? "نامعلوم" : `${fmt(s.summary.pct)}٪`}</b>
        {s.summary.unknown > 0 && <span style={{ color: "var(--warn)" }}> · {s.summary.unknown} قلم بدون {L.measures[r.measure]} (در حجم نیامده)</span>}</p>
      {!s.madeBy && <>
        <Pending pending={s.pending} firstApply={!r.applied_at} />
        {may && (s.pending?.any || !r.applied_at) && <button className="btn sm" type="button" onClick={() => post("/api/eps/activities", { kind: "scope-apply", ruleId: r.id }, (x) => `اعمال شد: +${x.row.added} / −${x.row.removed}.`)}>اعمال در PMS</button>}</>}
      <div className="tablewrap" style={{ maxHeight: 260, marginTop: 6 }}><TableKit name="eps-scopepanel-1" min={8}><table className="dtable">
        <thead><tr><th>قلم</th><th>شرح</th><th>زیرسیستم</th><th>نقشه</th><th>نوع</th><th>{L.measures[r.measure]}</th><th>انجام‌شده</th></tr></thead>
        <tbody>{s.items.map((i) => (
          <tr key={i.key} data-scope-item={i.label}><td className="mono" dir="ltr">{i.label}</td><td className="sm">{i.name || ""}</td><td className="mono sm">{i.subsystem || "—"}</td>
            <td className="mono sm">{i.docNo || "—"}</td><td className="sm">{i.kind || "—"}</td><td className="mono">{i.qty == null ? "؟" : fmt(i.qty)}</td><td>{i.done ? "✓" : ""}</td></tr>))}</tbody></table></TableKit>
        {s.more > 0 && <p className="sm muted">و {s.more} قلم دیگر…</p>}</div>
      <History h={s.history} />
    </div>);
}

export function History({ h }) {
  if (!h?.length) return null;
  return (
    <details style={{ marginTop: 6 }}><summary className="sm">تاریخچهٔ اعمال ({h.length})</summary>
      <TableKit name="eps-scopepanel-2" min={8}><table className="dtable sm"><thead><tr><th>زمان</th><th>توسط</th><th>تازه</th><th>حذف</th><th>تغییر مقدار</th></tr></thead>
        <tbody>{h.map((c) => (
          <tr key={c.id}><td className="mono">{new Date(c.at).toLocaleString("fa-IR")}</td><td>{c.by_name || "—"}{c.auto ? " (خودکار)" : ""}</td>
            <td>{c.added.map((x) => x.label).join("، ") || "—"}</td><td>{c.removed.map((x) => x.label).join("، ") || "—"}</td><td>{c.changed.length || "—"}</td></tr>))}</tbody></table></TableKit></details>);
}

/** The per-item rule of a WBS node, on the activity page when a node is selected. */
export function NodeScope({ node, state, may, post, L, choices }) {
  const [edit, setEdit] = useState(false);
  if (!state || edit) {
    if (!may) return null;
    return edit || state ? <RuleForm perItem init={state?.rule} L={L} choices={choices} onCancel={() => setEdit(false)}
      onSave={async (f) => { if (await post("/api/eps/activities", { kind: "scope-rule", nodeId: node.id, ...f }, () => "قاعدهٔ گره ذخیره شد.")) setEdit(false); }} />
      : <p><button className="btn ghost sm" type="button" data-node-scope onClick={() => setEdit(true)}>ساخت فعالیت‌های این گره از تجهیزات / خطوط / کابل‌ها / ابزارها…</button></p>;
  }
  const r = state.rule;
  return (
    <div className="card" data-node-scope-state>
      <p className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}><b>یک فعالیت برای هر قلم</b> <span className="sm">{describeRule(r, L, choices)}</span>
        <span className="sm">· {state.groups} قلم · {fmt(state.summary.qty)} {L.measures[r.measure]} · پیشرفت {state.summary.pct == null ? "نامعلوم" : `${fmt(state.summary.pct)}٪`}</span>
        {may && <><button className="btn ghost sm" type="button" onClick={() => setEdit(true)}>ویرایش</button>
          <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "scope-rule-remove", id: r.id }, () => "قاعده برداشته شد؛ فعالیت‌های ساخته‌شده ماندند.")}>برداشتن قاعده</button></>}</p>
      <Pending pending={state.pending} firstApply={state.firstApply} />
      {may && (state.pending.any || state.firstApply) && <button className="btn sm" type="button" data-apply-node
        onClick={() => post("/api/eps/activities", { kind: "scope-apply", ruleId: r.id }, (x) => `اعمال شد: ${x.row.made} فعالیت تازه، ${x.row.dropped} حذف، ${x.row.kept} با W.F صفر نگه داشته شد.`)}>اعمال در PMS</button>}
    </div>);
}
