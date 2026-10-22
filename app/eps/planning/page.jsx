"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import ActivityGrid, { useSplit } from "../../../components/eps/ActivityGrid";
import { useEpsFmt } from "../../../components/eps/ActivityDetail";
import { COLUMNS, useVersion } from "../../../components/eps/shared";
import { usePrefs } from "../../../lib/client/prefs.mjs";
import { PLAN_HEAD } from "../../../lib/eps/planning.mjs";
import TemplateButton from "../../../components/ui/TemplateButton";
import TableKit from "../../../components/ui/TableKit";

/**
 * A version's planning (owner's requirements 2026-10-22, «PLANING»): like the
 * daily work entry, but what is entered is the plan. The PMS and its version
 * are picked first (the version is the plan the rows belong to). Above the
 * activities: the start, days, finish, work done before, planned quantity
 * and a description — each left empty takes what the activity gives (the
 * finish = start + days − 1, done before from the daily reports, planned =
 * the whole − done before). «Add item single» (or a double click on an
 * activity) adds the selected one; «add item multi» every activity the
 * filter shows. Below: the version's rows, edited where they stand. A
 * version's plan is copied into another of the same PMS, and read from or
 * written to Excel.
 */
const BLANK = { startOn: "", days: "", endOn: "", doneBefore: "", volumePlan: "", description: "" };

export default function PlanningPage() {
  const { projectId, contractId, call } = usePlatform();
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const { pmsId, versionId, picker, pms, reloadBoard } = useVersion(contractId);
  const tree = useProjectData((id) => (versionId ? `/api/eps/activities?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const rows = useProjectData((id) => (versionId ? `/api/eps/planning?projectId=${id}&versionId=${versionId}` : null), [versionId]);
  const [sel, setSel] = useState(null);
  const [visible, setVisible] = useState([]);
  const [f, setF] = useState(BLANK);
  const [copy, setCopy] = useState({ from: "", replace: false });
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [busy, setBusy] = useState(false);
  const { height, grip } = useSplit("p6-planning", 380);

  async function post(body, done, url = "/api/eps/planning") {
    setMsg(null); setOk(null); setBusy(true);
    try { const r = await call(url, { method: "POST", body: JSON.stringify({ projectId, ...body }) }); tree.reload(); rows.reload(); reloadBoard(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; } finally { setBusy(false); }
  }
  const add = (ids) => post({ kind: "plan-add", versionId, activityIds: ids, ...f },
    (r) => (r.row.skipped.length ? t("ep.pl.addedSkip", { n: r.row.added, codes: r.row.skipped.join(", ") }) : t("ep.pl.added", { n: r.row.added })));
  async function importFile(file) {
    if (!file) return;
    setMsg(null); setOk(null); setBusy(true);
    try {
      const form = new FormData();
      for (const [k, v] of Object.entries({ projectId, kind: "plan-import", versionId })) form.set(k, v);
      form.set("file", file);
      const res = await fetch("/api/eps/planning", { method: "POST", body: form, credentials: "same-origin" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || t("ep.im.status", { n: res.status }));
      tree.reload(); rows.reload(); reloadBoard();
      setOk(t("ep.pl.imported", { added: b.row.added, updated: b.row.updated }));
    } catch (e) { setMsg(e.message); } finally { setBusy(false); }
  }
  // the version as a sheet to fill: every activity of the PMS, with this version's figures where it plans them
  async function exportSheet() {
    const XLSX = await import("xlsx");
    const planned = new Map((rows.data?.rows || []).map((r) => [r.activity_id, r]));
    const out = [PLAN_HEAD];
    const walk = (n) => { for (const a of n.activities) {
      const p = planned.get(a.id);
      out.push([n.code, a.code, p?.start_on || "", p?.days ?? "", p?.end_on || "", p?.done_before ?? "", p?.volume_plan ?? "", p?.description || ""]);
    } n.children.forEach(walk); };
    (tree.data?.roots || []).forEach(walk);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(out), "Planning");
    XLSX.writeFile(wb, `planning-${rows.data?.version.code || "version"}.xlsx`);
  }

  const plan = useMemo(() => new Map((rows.data?.rows || []).map((r) => [r.activity_id, r])), [rows.data]);
  const columns = useMemo(() => [...COLUMNS,
    { key: "inPlan", title: t("ep.pl.inPlan"), width: 70, get: (r) => (r.kind === "act" ? (plan.has(r.id) ? "✓" : "") : "") },
    { key: "pStart", title: t("ep.pl.start"), width: 90, mono: true, get: (r, x) => (plan.get(r.id) ? x.day(plan.get(r.id).start_on) : "") },
    { key: "pDays", title: t("ep.pl.days"), width: 60, mono: true, get: (r, x) => (plan.get(r.id) ? x.fmt(plan.get(r.id).days) : "") },
    { key: "pFinish", title: t("ep.pl.finish"), width: 90, mono: true, get: (r, x) => (plan.get(r.id) ? x.day(plan.get(r.id).end_on) : "") },
    { key: "pBefore", title: t("ep.pl.doneBefore"), width: 90, mono: true, get: (r, x) => (plan.get(r.id) ? x.fmt(plan.get(r.id).done_before, 10) : "") },
    { key: "pPlanned", title: t("ep.pl.planned"), width: 90, mono: true, get: (r, x) => (plan.get(r.id) ? x.fmt(plan.get(r.id).volume_plan, 10) : "") },
  ], [plan, t]);

  const head = (
    <div className="pagehead"><h1>{t("ep.pl.title")}</h1>
      <span className="sub">{picker} <Link href="/eps">{t("ep.link.board")}</Link> · <Link href={versionId ? `/eps/planning/preview?version=${versionId}` : "/eps/planning/preview"} data-preview-link>{t("ep.link.planPreview")}</Link> · <Link href={versionId ? `/eps/activities?version=${versionId}` : "/eps/activities"}>{t("ep.link.activities")}</Link> · <Link href="/eps/progress">{t("ep.link.entry")}</Link></span></div>);
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.pl.title")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (tree.error || rows.error) return <div className="page">{head}<p className="err">{tree.error || rows.error}</p></div>;
  if (!pmsId) return <div className="page">{head}<p className="empty-note">{t("ep.noPlan")}</p></div>;
  if (!versionId) return <div className="page">{head}<p className="empty-note">{t("ep.pl.pickVersion")}</p></div>;
  if (!tree.data || !rows.data) return <div className="page">{head}<p className="muted">{t("common.loading")}</p></div>;
  const may = rows.data.may.edit;
  const others = (pms?.versions || []).filter((v) => v.id !== versionId);
  const field = (k, label, type = "text", extra = {}) => (
    <span className="field" key={k}><label htmlFor={`pl-${k}`} className="sm">{label}</label>
      <input id={`pl-${k}`} type={type} dir={type === "text" && k !== "description" ? "ltr" : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></span>);

  return (
    <div className="page">
      {head}
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {may && <>
        <div className="toolbar-left" data-plan-bar>
          {field("startOn", t("ep.pl.start"), "date")}
          {field("days", t("ep.pl.days"), "text", { inputMode: "numeric", style: { width: 70 } })}
          {field("endOn", t("ep.pl.finish"), "date", { disabled: String(f.days).trim() !== "", title: t("ep.pl.finishTip") })}
          {field("doneBefore", t("ep.pl.doneBefore"), "text", { inputMode: "decimal", style: { width: 100 }, placeholder: t("ep.pl.auto") })}
          {field("volumePlan", t("ep.pl.planned"), "text", { inputMode: "decimal", style: { width: 100 }, placeholder: t("ep.pl.auto") })}
          {field("description", t("ep.description"))}
          <button className="btn" type="button" disabled={busy || sel?.kind !== "act"} data-add="single" onClick={() => add([sel.id])}>{t("pg.addSingle")}</button>
          <button className="btn" type="button" disabled={busy || visible.length === 0} data-add="multi"
            onClick={() => { if (window.confirm(t("ep.pl.addMultiAsk", { n: visible.length }))) add(visible.map((a) => a.id)); }}>{t("pg.addMulti", { n: visible.length })}</button>
          <button className="btn ghost sm" type="button" onClick={() => setF(BLANK)}>{t("ep.pl.clear")}</button>
        </div>
        <p className="sm muted">{t("ep.pl.defaults")}</p>
        <div className="toolbar-left" data-plan-tools>
          <span className="field"><label htmlFor="pl-copy" className="sm">{t("ep.pl.copyFrom")}</label>
            <select id="pl-copy" value={copy.from} onChange={(e) => setCopy({ ...copy, from: e.target.value })}>
              <option value="">—</option>{others.map((v) => <option key={v.id} value={v.id}>{v.code} — {v.title}{v.master ? " (Master)" : ""}</option>)}</select></span>
          <label className="sm"><input type="checkbox" checked={copy.replace} onChange={(e) => setCopy({ ...copy, replace: e.target.checked })} /> {t("ep.pl.replace")}</label>
          <button className="btn ghost sm" type="button" disabled={busy || !copy.from} data-plan-copy
            onClick={() => { if (window.confirm(t("ep.pl.copyAsk", { from: others.find((v) => v.id === copy.from)?.code || "", to: rows.data.version.code })))
              post({ kind: "plan-copy", fromVersionId: copy.from, toVersionId: versionId, replace: copy.replace }, (r) => t("ep.pl.copied", r.row)); }}>{t("ep.pl.copy")}</button>
          <TemplateButton kind="planning" />
          <button className="btn ghost sm" type="button" onClick={exportSheet} data-plan-export>{t("ep.pl.export")}</button>
          <label className="btn ghost sm" style={{ cursor: "pointer" }}>{t("ep.pl.import")}
            <input type="file" accept=".xlsx,.xls" hidden data-plan-import onChange={(e) => { const x = e.target.files?.[0]; e.target.value = ""; if (x && window.confirm(t("ep.pl.importAsk", { name: x.name }))) importFile(x); }} /></label>
        </div>
      </>}
      <div style={{ height }}>
        <ActivityGrid data={tree.data} columns={columns} defaultCols={["code", "activityNo", "name", "unit", "volActual", "done", "inPlan", "pStart", "pDays", "pFinish", "pBefore", "pPlanned"]}
          storeKey="p6-planning" selected={sel?.id} onSelect={(r) => setSel(r)} onVisible={setVisible}
          onOpen={may ? (r) => { setSel(r); add([r.id]); } : null} />
      </div>
      {grip}
      <div className="p6-detail" data-plan-rows>
        <div className="p6-tabs" role="tablist"><button type="button" role="tab" aria-selected className="on">{t("ep.pl.rowsTab", { code: rows.data.version.code, n: rows.data.rows.length })}</button></div>
        <PlanRows data={rows.data} may={may} sel={sel} post={post} fmt={fmt} day={day} />
      </div>
    </div>
  );
}

/** The version's rows, each edited where it stands: start, days, finish, done before, planned, description. */
function PlanRows({ data, may, sel, post, fmt, day }) {
  const { t } = usePrefs();
  const H = { start: t("ep.pl.start"), days: t("ep.pl.days"), finish: t("ep.pl.finish"), before: t("ep.pl.doneBefore"), planned: t("ep.pl.planned"), desc: t("ep.description") };
  const byId = new Map(data.rows.map((r) => [r.id, r]));
  const rowEdit = may ? {
    fields: [{ col: H.start, name: "startOn", type: "date" }, { col: H.days, name: "days", type: "number" }, { col: H.finish, name: "endOn", type: "date" },
      { col: H.before, name: "doneBefore", type: "number" }, { col: H.planned, name: "volumePlan", type: "number" }, { col: H.desc, name: "description", type: "text" }],
    value: (k) => { const r = byId.get(k); return { startOn: r.start_on || "", days: r.days ?? "", endOn: r.end_on || "", doneBefore: r.done_before ?? "", volumePlan: r.volume_plan ?? "", description: r.description || "" }; },
    onSave: (k, v) => {
      const r = byId.get(k);
      // a finish typed stands; else a start or days changed move the finish with them (start + days − 1)
      const endChanged = (v.endOn || "") !== (r.end_on || "");
      const byDays = !endChanged && String(v.days).trim() !== "" && (String(v.days) !== String(r.days ?? "") || (v.startOn || "") !== (r.start_on || ""));
      return post({ kind: "plan-edit", id: k, startOn: v.startOn, endOn: byDays ? undefined : v.endOn, days: byDays ? v.days : undefined,
        doneBefore: v.doneBefore, volumePlan: v.volumePlan, description: v.description }, () => t("ep.pl.saved", { code: r.code }));
    },
  } : undefined;
  if (!data.rows.length) return <p className="empty-note">{t("ep.pl.empty")}</p>;
  return (
    <div className="tablewrap"><TableKit name="eps-planning-rows" rowEdit={rowEdit} onDelete={may ? (k) => post({ kind: "plan-remove", ids: [k] }, () => t("ep.pl.removed")) : undefined}>
      <table className="dtable">
        <thead><tr><th>WBS</th><th>{t("ep.code")}</th><th>Activity ID</th><th>{t("ep.name")}</th><th>{t("ep.unit")}</th><th>{H.start}</th><th>{H.days}</th><th>{H.finish}</th>
          <th>{H.before}</th><th>{H.planned}</th><th>{t("ep.pl.total")}</th><th>{t("ep.pl.after")}</th><th>{t("ep.done")}</th><th>{H.desc}</th></tr></thead>
        <tbody>{data.rows.map((r) => (
          <tr key={r.id} data-key={r.id} data-plan-row={r.code} style={{ background: sel?.id === r.activity_id ? "var(--cy-soft)" : undefined }}>
            <td className="mono sm" dir="ltr">{r.node_code}</td><td className="mono" dir="ltr">{r.code}</td><td className="mono sm">{r.activityNo || ""}</td><td>{r.name}</td><td>{r.unit || ""}</td>
            <td className="mono">{day(r.start_on)}</td><td className="mono">{fmt(r.days)}</td><td className="mono">{day(r.end_on)}</td>
            <td className="mono">{fmt(r.done_before, 10)}</td><td className="mono">{fmt(r.volume_plan, 10)}</td><td className="mono">{fmt(r.total, 10)}</td>
            <td className="mono">{fmt(r.remainAfter, 10)}</td><td className="mono">{fmt(r.done, 10)}</td><td>{r.description || ""}</td></tr>))}</tbody>
      </table></TableKit></div>);
}
