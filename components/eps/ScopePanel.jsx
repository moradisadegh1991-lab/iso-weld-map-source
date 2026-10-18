"use client";
import { useMemo, useState } from "react";
import { useEpsFmt } from "./ActivityDetail";
import { usePrefs } from "../../lib/client/prefs.mjs";

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

/**
 * The scope labels the server sends (lib/eps/scope.mjs, in Persian) in the
 * reader's language — `eps.scope.*` in lib/i18n/labels.mjs — and a rule in
 * one line: «Equipment · subsystem 20-01 · measure: count · done: grouted».
 */
export function useScopeL(L) {
  const { t, L: lab } = usePrefs();
  return useMemo(() => {
    const disc = (k) => lab(`eps.scope.disc.${k}`, L.disciplines[k]?.title || k);
    const measure = (k) => lab(`eps.scope.measure.${k}`, L.measures[k] || k);
    const milestone = (d, k) => lab(`eps.scope.ms.${d}.${k}`, L.disciplines[d]?.milestones[k] || k);
    const kind = (d) => lab(`eps.scope.kind.${d}`, L.disciplines[d]?.kindLabel || "");
    const sep = t("ep.sep");
    const describe = (r, choices) => {
      const f = r.filter || {};
      const parts = [];
      if (f.subsystemIds?.length) parts.push(t("ep.sc.subsystem", { list: f.subsystemIds.map((id) => choices?.subsystems.find((s) => s.id === id)?.code || "?").join(sep) }));
      if (f.unitIds?.length) parts.push(t("ep.sc.unit", { list: f.unitIds.map((id) => choices?.units.find((s) => s.id === id)?.code || "?").join(sep) }));
      if (f.pattern) parts.push(t("ep.sc.number", { p: f.pattern }));
      if (f.docPattern) parts.push(t("ep.sc.drawing", { p: f.docPattern }));
      if (f.kinds?.length) parts.push(t("ep.sc.kind", { list: f.kinds.join(sep) }));
      return `${disc(r.discipline)} · ${parts.length ? parts.join(" · ") : t("ep.sc.all")} · ${t("ep.sc.measureIs", { m: measure(r.measure) })} · ${t("ep.sc.doneIs", { m: milestone(r.discipline, r.milestone) })}`;
    };
    return { disc, measure, milestone, kind, describe };
  }, [L, t, lab]);
}

export function RuleForm({ init, L, choices, onSave, onCancel, perItem = false }) {
  const { t } = usePrefs();
  const S = useScopeL(L);
  const [f, setF] = useState(init ? toForm(init) : blank());
  const d = L.disciplines[f.discipline];
  const set = (k, v) => setF({ ...f, [k]: v });
  const setFilter = (k, v) => setF({ ...f, filter: { ...f.filter, [k]: v } });
  const multi = (k, opts) => (
    <select multiple size={Math.min(5, Math.max(2, opts.length))} value={f.filter[k]} aria-label={t(k === "subsystemIds" ? "ep.sc.subsystems" : "ep.sc.units")}
      onChange={(e) => setFilter(k, [...e.target.selectedOptions].map((o) => o.value))}>
      {opts.map((o) => <option key={o.id} value={o.id}>{o.code}{o.name ? ` — ${o.name}` : ""}</option>)}</select>);
  return (
    <form className="card" data-scope-form onSubmit={(e) => { e.preventDefault(); onSave({ ...f, milestone: f.milestone || Object.keys(d.milestones).pop(),
      filter: { ...f.filter, kinds: String(f.filter.kinds || "").split(",").map((x) => x.trim()).filter(Boolean) } }); }}>
      <h3>{t(perItem ? "ep.sc.perItemTitle" : "ep.sc.activityTitle")}</h3>
      <div className="grid2">
        <div className="field"><label htmlFor="sr-d">{t("ep.sc.discipline")}</label><select id="sr-d" value={f.discipline} onChange={(e) => setF({ ...f, discipline: e.target.value, measure: "count", milestone: "" })}>
          {Object.keys(L.disciplines).map((k) => <option key={k} value={k}>{S.disc(k)}</option>)}</select></div>
        <div className="field"><label htmlFor="sr-m">{t("ep.sc.measure")}</label><select id="sr-m" value={f.measure} onChange={(e) => set("measure", e.target.value)}>
          {d.measures.map((m) => <option key={m} value={m}>{S.measure(m)}</option>)}</select></div>
        <div className="field"><label htmlFor="sr-ms">{t("ep.sc.milestone")}</label><select id="sr-ms" value={f.milestone || Object.keys(d.milestones).pop()} onChange={(e) => set("milestone", e.target.value)}>
          {Object.keys(d.milestones).map((k) => <option key={k} value={k}>{S.milestone(f.discipline, k)}</option>)}</select></div>
        <div className="field"><label htmlFor="sr-p">{t("ep.sc.pattern")}</label>
          <input id="sr-p" dir="ltr" value={f.filter.pattern} onChange={(e) => setFilter("pattern", e.target.value)} placeholder="20-P-*, 20-E-*" /></div>
        {d.docs && <div className="field"><label htmlFor="sr-doc">{t("ep.sc.docPattern")}</label>
          <input id="sr-doc" dir="ltr" value={f.filter.docPattern} onChange={(e) => setFilter("docPattern", e.target.value)} placeholder="ISO-20-*" /></div>}
        {d.kindLabel && <div className="field"><label htmlFor="sr-k">{t("ep.sc.kinds", { kind: S.kind(f.discipline) })}</label>
          <input id="sr-k" dir="ltr" value={f.filter.kinds} onChange={(e) => setFilter("kinds", e.target.value)} /></div>}
        <div className="field"><label>{t("ep.sc.subsystemsAll")}</label>{multi("subsystemIds", choices.subsystems)}</div>
        <div className="field"><label>{t("ep.sc.unitsAll")}</label>{multi("unitIds", choices.units)}</div>
      </div>
      <label className="sm"><input type="checkbox" checked={f.autoApply} onChange={(e) => set("autoApply", e.target.checked)} /> {t("ep.sc.auto")}</label>
      <p><button className="btn" type="submit">{t("ep.save")}</button> {onCancel && <button className="btn ghost" type="button" onClick={onCancel}>{t("ep.cancel")}</button>}</p>
    </form>);
}

/** Pending changes of a rule: what came in and what went out since it was last applied. */
export function Pending({ pending, firstApply }) {
  const { t } = usePrefs();
  const { fmt } = useEpsFmt();
  if (!pending) return null;
  if (!pending.any && !firstApply) return <p className="sm muted">{t("ep.pe.none")}</p>;
  const sep = t("ep.sep");
  return (
    <div className="sm" data-pending>
      {firstApply && <p>{t("ep.pe.first")}</p>}
      {pending.added.length > 0 && <p style={{ color: "var(--ok, #1e8449)" }}>+ {t("ep.pe.added", { n: pending.added.length })} {pending.added.slice(0, 20).map((x) => x.label).join(sep)}{pending.added.length > 20 ? "…" : ""}</p>}
      {pending.removed.length > 0 && <p style={{ color: "var(--bad, #c0392b)" }}>− {t("ep.pe.removed", { n: pending.removed.length })} {pending.removed.slice(0, 20).map((x) => x.label).join(sep)}{pending.removed.length > 20 ? "…" : ""}</p>}
      {pending.changed.length > 0 && <p>~ {t("ep.pe.changed", { n: pending.changed.length })} {pending.changed.slice(0, 10).map((x) => `${x.label} (${fmt(x.from)} → ${fmt(x.to)})`).join(sep)}</p>}
    </div>);
}

/** The scope sub-form of an activity. */
export function ScopeTab({ d, may, post, L }) {
  const { t } = usePrefs();
  const { fmt } = useEpsFmt();
  const S = useScopeL(L);
  const [edit, setEdit] = useState(false);
  const a = d.activity, s = d.scope;
  if (!s || edit) {
    if (!may) return <p className="empty-note">{t("ep.sc.unlinked")}</p>;
    return (
      <div>
        {!s && <p className="sm muted">{t("ep.sc.why")}</p>}
        <RuleForm init={s?.rule} L={L} choices={d.scopeChoices} onCancel={s ? () => setEdit(false) : null}
          onSave={async (f) => { if (await post("/api/eps/activities", { kind: "scope-rule", activityId: a.id, ...f }, () => t("ep.sc.linkSaved"))) setEdit(false); }} />
      </div>);
  }
  const r = s.rule;
  const m = S.measure(r.measure);
  return (
    <div data-scope-tab>
      <p className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b>{s.madeBy ? t("ep.sc.madeBy", { item: s.item }) : t("ep.sc.link")}</b>
        <span className="sm">{S.describe(r, d.scopeChoices)}</span>
        {s.removed && <span className="chip" style={{ color: "var(--bad)" }}>{t("ep.sc.outOfScope")}</span>}
        {may && !s.madeBy && <>
          <button className="btn ghost sm" type="button" onClick={() => setEdit(true)}>{t("ep.edit")}</button>
          <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "scope-rule-remove", id: r.id }, () => t("ep.sc.linkRemoved"))}>{t("ep.sc.unlink")}</button></>}
      </p>
      <p className="sm">{t("ep.sc.items")} <b>{fmt(s.summary.items)}</b> · {t("ep.sc.qty")} <b>{fmt(s.summary.qty)}</b> {m} · {t("ep.sc.doneQty")} <b>{fmt(s.summary.done)}</b> ({t("ep.sc.nItems", { n: fmt(s.summary.doneCount) })}) ·{" "}
        {t("ep.sc.pct")} <b>{s.summary.pct == null ? t("ep.unknown") : `${fmt(s.summary.pct)}%`}</b>
        {s.summary.unknown > 0 && <span style={{ color: "var(--warn)" }}> · {t("ep.sc.noMeasure", { n: s.summary.unknown, m })}</span>}</p>
      {!s.madeBy && <>
        <Pending pending={s.pending} firstApply={!r.applied_at} />
        {may && (s.pending?.any || !r.applied_at) && <button className="btn sm" type="button" onClick={() => post("/api/eps/activities", { kind: "scope-apply", ruleId: r.id }, (x) => t("ep.sc.applied", { added: x.row.added, removed: x.row.removed }))}>{t("ep.sc.apply")}</button>}</>}
      <div className="tablewrap" style={{ maxHeight: 260, marginTop: 6 }}><TableKit name="eps-scopepanel-1" min={8}><table className="dtable">
        <thead><tr><th>{t("ep.sc.item")}</th><th>{t("ep.description")}</th><th>{t("ep.sc.subsystemH")}</th><th>{t("ep.sc.drawingH")}</th><th>{t("ep.type")}</th><th>{m}</th><th>{t("ep.done")}</th></tr></thead>
        <tbody>{s.items.map((i) => (
          <tr key={i.key} data-scope-item={i.label}><td className="mono" dir="ltr">{i.label}</td><td className="sm">{i.name || ""}</td><td className="mono sm">{i.subsystem || "—"}</td>
            <td className="mono sm">{i.docNo || "—"}</td><td className="sm">{i.kind || "—"}</td><td className="mono">{i.qty == null ? "?" : fmt(i.qty)}</td><td>{i.done ? "✓" : ""}</td></tr>))}</tbody></table></TableKit>
        {s.more > 0 && <p className="sm muted">{t("ep.sc.more", { n: s.more })}</p>}</div>
      <History h={s.history} />
    </div>);
}

export function History({ h }) {
  const { t, dateTime } = usePrefs();
  if (!h?.length) return null;
  const sep = t("ep.sep");
  return (
    <details style={{ marginTop: 6 }}><summary className="sm">{t("ep.hi.title", { n: h.length })}</summary>
      <TableKit name="eps-scopepanel-2" min={8}><table className="dtable sm"><thead><tr><th>{t("ep.hi.at")}</th><th>{t("ep.hi.by")}</th><th>{t("ep.hi.added")}</th><th>{t("ep.hi.removed")}</th><th>{t("ep.hi.changed")}</th></tr></thead>
        <tbody>{h.map((c) => (
          <tr key={c.id}><td className="mono">{dateTime(c.at)}</td><td>{c.by_name || "—"}{c.auto ? ` ${t("ep.hi.auto")}` : ""}</td>
            <td>{c.added.map((x) => x.label).join(sep) || "—"}</td><td>{c.removed.map((x) => x.label).join(sep) || "—"}</td><td>{c.changed.length || "—"}</td></tr>))}</tbody></table></TableKit></details>);
}

/** The per-item rule of a WBS node, on the activity page when a node is selected. */
export function NodeScope({ node, state, may, post, L, choices }) {
  const { t } = usePrefs();
  const { fmt } = useEpsFmt();
  const S = useScopeL(L);
  const [edit, setEdit] = useState(false);
  if (!state || edit) {
    if (!may) return null;
    return edit || state ? <RuleForm perItem init={state?.rule} L={L} choices={choices} onCancel={() => setEdit(false)}
      onSave={async (f) => { if (await post("/api/eps/activities", { kind: "scope-rule", nodeId: node.id, ...f }, () => t("ep.sc.ruleSaved"))) setEdit(false); }} />
      : <p><button className="btn ghost sm" type="button" data-node-scope onClick={() => setEdit(true)}>{t("ep.sc.buildNode")}</button></p>;
  }
  const r = state.rule;
  return (
    <div className="card" data-node-scope-state>
      <p className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}><b>{t("ep.sc.perItem")}</b> <span className="sm">{S.describe(r, choices)}</span>
        <span className="sm">· {t("ep.sc.nItems", { n: state.groups })} · {fmt(state.summary.qty)} {S.measure(r.measure)} · {t("ep.sc.pct")} {state.summary.pct == null ? t("ep.unknown") : `${fmt(state.summary.pct)}%`}</span>
        {may && <><button className="btn ghost sm" type="button" onClick={() => setEdit(true)}>{t("ep.edit")}</button>
          <button className="btn ghost sm" type="button" onClick={() => post("/api/eps/activities", { kind: "scope-rule-remove", id: r.id }, () => t("ep.sc.ruleRemoved"))}>{t("ep.sc.removeRule")}</button></>}</p>
      <Pending pending={state.pending} firstApply={state.firstApply} />
      {may && (state.pending.any || state.firstApply) && <button className="btn sm" type="button" data-apply-node
        onClick={() => post("/api/eps/activities", { kind: "scope-apply", ruleId: r.id }, (x) => t("ep.sc.appliedNode", { made: x.row.made, dropped: x.row.dropped, kept: x.row.kept }))}>{t("ep.sc.apply")}</button>}
    </div>);
}
