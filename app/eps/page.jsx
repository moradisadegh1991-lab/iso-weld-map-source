"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import TemplateButton from "../../components/ui/TemplateButton";
import Link from "next/link";
import { usePlatform, useProjectData } from "../../lib/client/platform.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { useEpsFmt } from "../../components/eps/ActivityDetail";
import ActivityGrid, { useSplit } from "../../components/eps/ActivityGrid";
/**
 * The contract's EPS (owner's requirements 2026-10-22: «کادر بالای صفحه
 * بهینه‌تر و ارتفاع به حداقل… ساختار دقیقاً شبیه بخش ساختار درختی صفحهٔ
 * activities»): its PMSs, and under each the versions of its schedule, as
 * the activities page's tree — a PMS's or a version's row edited where it
 * stands, a version added under its PMS from the right-click menu, a version
 * cut onto another PMS, a row moved above or below its sibling, deleted
 * after a question; the Gantt shows each one's span. Below the tree the row
 * picked in full: a PMS (its WBS opens from there) or a version (its
 * planning and activities open from there; one version of each PMS may be
 * its master plan, the baseline the delay claim is measured against).
 */
const BLANK_PMS = { id: null, code: "", title: "", pmsType: "", description: "", registeredOn: "", planStart: "", planEnd: "", actualStart: "", actualEnd: "", budgetPlan: "", budgetActual: "" };
const span = (a, b) => (a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1 : null);
const EPS_COLUMNS = [
  { key: "code", title: "ep.code", width: 170, mono: true, hits: true, get: (r) => r.item.code },
  { key: "name", title: "ep.title", width: 230, hits: true, get: (r) => r.item.name },
  { key: "type", title: "ep.bd.pmsType", width: 90, get: (r) => (r.kind === "node" ? r.item.pms_type || "" : "") },
  { key: "master", title: "Master", width: 70, get: (r) => (r.kind === "act" && r.item.master ? "★ Master" : "") },
  { key: "registered", title: "ep.g.registered", width: 95, mono: true, get: (r, x) => x.day(r.item.registered_on) },
  { key: "start", title: "ep.start", width: 95, mono: true, get: (r, x) => x.day(r.item.plan_start) },
  { key: "finish", title: "ep.finish", width: 95, mono: true, get: (r, x) => x.day(r.item.plan_end) },
  { key: "dur", title: "ep.dur", width: 55, mono: true, get: (r, x) => x.fmt(r.item.planDays) },
  { key: "aStart", title: "ep.actualStart", width: 95, mono: true, get: (r, x) => x.day(r.item.actual_start) },
  { key: "aFinish", title: "ep.actualEnd", width: 95, mono: true, get: (r, x) => x.day(r.item.actual_end) },
  { key: "budget", title: "ep.col.budgetPlan", width: 110, mono: true, get: (r, x) => x.fmt(r.item.budget_plan) },
  { key: "budgetA", title: "ep.col.budgetActual", width: 110, mono: true, get: (r, x) => x.fmt(r.item.budget_actual) },
  { key: "count", title: "ep.bd.versionsNodes", width: 150, get: (r, x) => (r.kind === "node" ? x.t("ep.bd.pmsCounts", { v: r.item.activities.length, n: r.item.nodes }) : x.t("ep.bd.planned", { n: r.item.planned })) },
  { key: "description", title: "ep.description", width: 200, hits: true, get: (r) => r.item.description || "" },
];
const DEFAULT_COLS = ["code", "active", "name", "type", "master", "start", "finish", "dur", "aStart", "aFinish", "budget", "count"];
const COLORS = ["#1f6f8b", "#7d3c98"];
// the board as the tree's data: a PMS is a node, its versions the rows under it (a version's span on the chart is its schedule's)
const asTree = (pms) => ({ roots: pms.map((p) => ({ ...p, name: p.title, level: 1, color: COLORS[0], children: [],
  activities: p.versions.map((v) => ({ ...v, name: v.title, node_id: p.id, pms_id: p.id, plan_start: v.start_on, plan_end: v.end_on, planDays: v.days })) })) });

export default function EpsPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { data, error, reload } = useProjectData((id) => (contractId ? `/api/eps?projectId=${id}&contractId=${contractId}` : null), [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [sel, setSel] = useState(null);
  const [adding, setAdding] = useState(false);
  const [imp, setImp] = useState(null);
  const { t } = usePrefs();
  const { height, grip } = useSplit("p6-eps", 300);
  const live = useRef({});
  live.current = { reload };
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  const tree = useMemo(() => (data ? asTree(data.pms) : null), [data]);
  // a deletion asked in a box of its own (owner's requirements 2026-10-26, item 5): what each row holds — for a PMS asked of the
  // server — and «delete all under it» to tick; resolves to null (cancelled) or { all }
  const [asking, setAsking] = useState(null);
  async function askRemove(rows) {
    setMsg(null);
    const items = [];
    for (const r of rows) {
      if (r.kind === "pms") {
        let c;
        try { c = await call(`/api/eps?projectId=${projectId}&pmsId=${r.item.id}&contents=1`); } catch (e) { setMsg(e.message); return null; }
        items.push({ ...r, counts: c.counts, stop: c.stops });
      } else items.push({ ...r, counts: { plans: r.item.planned || 0 } });
    }
    return new Promise((resolve) => setAsking({ items, resolve }));
  }
  const removeNow = async (rows, all) => {
    setMsg(null); setOk(null);
    try {
      for (const r of rows) await call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, contractId, kind: "eps-remove", epsKind: r.kind, id: r.item.id, all }) });
      setOk(t("ep.removed")); reload(); return true;
    } catch (e) { setMsg(e.message); reload(); return false; }
  };
  async function askRemovePms(p) {
    const a = await askRemove([{ kind: "pms", item: p }]);
    return a ? removeNow([{ kind: "pms", item: p }], a.all) : false;
  }
  live.current.askRemove = askRemove;
  live.current.removeNow = removeNow;
  // a PMS ticked active is offered where a PMS is picked; one set aside is not (item 5)
  const columns = useMemo(() => [EPS_COLUMNS[0],
    { key: "active", title: "ep.bd.active", width: 60, get: (r) => (r.kind !== "node" ? "" : (
      <input type="checkbox" aria-label={t("ep.bd.activeOf", { code: r.item.code })} checked={r.item.active !== false} disabled={!data?.may?.edit} data-pms-active={r.item.code}
        onChange={(e) => post({ kind: "pms-active", id: r.item.id, active: e.target.checked }, () => t(e.target.checked ? "ep.bd.activeOn" : "ep.bd.activeOff", { code: r.item.code }))} />)) },
    ...EPS_COLUMNS.slice(1)], [data?.may?.edit, t]); // eslint-disable-line react-hooks/exhaustive-deps
  const ops = useMemo(() => {
    if (!data?.may?.edit) return null;
    const send = (body) => call("/api/eps", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) });
    const batch = async (list, done) => {
      setMsg(null); setOk(null);
      try { for (const b of list) await send(b); live.current.reload(); if (done) setOk(done); return true; }
      catch (e) { setMsg(e.message); live.current.reload(); return false; }
    };
    const n = (v) => (v === "" || v === undefined ? null : v);
    const pmsBody = (p, v) => ({ kind: "pms", id: p.id, code: p.code, title: v.name, pmsType: v.type, description: v.description, registeredOn: p.registered_on,
      planStart: v.start || null, planEnd: v.finish || null, actualStart: v.aStart || null, actualEnd: v.aFinish || null, budgetPlan: n(v.budget), budgetActual: n(v.budgetA) });
    const verBody = (x, v) => ({ kind: "version", id: x.id, pmsId: x.pms_id, code: x.code, title: v.name, description: v.description, registeredOn: x.registered_on,
      startOn: v.start || null, endOn: v.finish || null, budgetPlan: n(v.budget), budgetActual: n(v.budgetA) });
    const list = (row) => (row.kind === "node" ? data.pms : data.pms.find((p) => p.id === row.item.pms_id)?.versions || []);
    return {
      fields: (row) => (row.kind === "node"
        ? ["name", "type", "start", "finish", "aStart", "aFinish", "budget", "budgetA", "description"]
        : ["name", "start", "finish", "budget", "budgetA", "description"]).map((key) => ({ key, type: ["start", "finish", "aStart", "aFinish"].includes(key) ? "date" : ["budget", "budgetA"].includes(key) ? "number" : "text" })),
      value: (row) => {
        const it = row.item;
        const v = { name: it.name ?? "", start: it.plan_start || "", finish: it.plan_end || "", budget: it.budget_plan ?? "", budgetA: it.budget_actual ?? "", description: it.description ?? "" };
        return row.kind === "node" ? { ...v, type: it.pms_type ?? "", aStart: it.actual_start || "", aFinish: it.actual_end || "" } : v;
      },
      save: (row, v) => batch([row.kind === "node" ? pmsBody(row.item, v) : verBody(row.item, v)], t("ep.bd.saved", { code: row.item.code })),
      // a row typed under a PMS is a new version of it, numbered after the last
      create: (node, v) => batch([{ ...verBody({ pms_id: node.id, code: `${node.item.code}-R${node.item.activities.length + 1}` }, v), id: null }], t("ep.bd.verSaved", { code: `${node.item.code}-R${node.item.activities.length + 1}` })),
      // the question is the page's own box, with «delete all under it» (item 5), not the grid's
      asks: true,
      remove: async (rows) => {
        const list = [...rows.filter((x) => x.kind === "act" && !rows.some((p) => p.id === x.parentId)).map((x) => ({ kind: "version", item: x.item })),
          ...rows.filter((x) => x.kind === "node").map((x) => ({ kind: "pms", item: x.item }))];
        const a = await live.current.askRemove(list);
        return a ? live.current.removeNow(list, a.all) : false;
      },
      // versions cut onto another PMS move there; a copy of a version is made on the planning page (copy between versions)
      paste: async (node, rows, how) => {
        if (how !== "cut") { setMsg(t("ep.bd.copyNo")); return false; }
        return batch(rows.filter((x) => x.kind === "act").map((x) => ({ kind: "eps-move", epsKind: "version", id: x.id, pmsId: node.id })), t("ep.bd.versionMoved", { code: node.item.code }));
      },
      reorderable: () => true,
      reorder: (row, dir) => {
        const sib = list(row), i = sib.findIndex((x) => x.id === row.id), to = sib[i + dir];
        if (!to) return true;
        return batch([{ kind: "eps-move", epsKind: row.kind === "node" ? "pms" : "version", id: row.id, ...(row.kind === "node" ? {} : { pmsId: row.item.pms_id }),
          [dir < 0 ? "beforeId" : "afterId"]: to.id }], t(row.kind === "node" ? "ep.bd.pmsOrder" : "ep.bd.versionOrder"));
      },
    };
  }, [data, projectId, contractId, call]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!sel || !tree) return;
    const it = tree.roots.find((p) => p.id === sel.id) || tree.roots.flatMap((p) => p.activities).find((v) => v.id === sel.id);
    if (!it) setSel(null); else if (it !== sel.item) setSel({ ...sel, item: it });
  }, [tree]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!contractId) return <div className="page"><div className="pagehead"><h1>{t("ep.link.board")}</h1></div><p className="empty-note">{t("cs.pick")}</p></div>;
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const may = data.may.edit;
  const toolbar = may && <>
    <button className="btn sm" type="button" data-new-pms onClick={() => { setAdding(true); setSel(null); }}>{t("ep.bd.newPms")}</button>
    <button className="btn ghost sm" type="button" data-import-open onClick={() => setImp({ mode: data.pms.some((p) => p.active !== false) ? "replace" : "new", pmsId: data.pms.find((p) => p.active !== false)?.id || "", pmsCode: "", title: "", versionCode: "", fileKind: "mspdi", file: null })}>{t("ep.bd.importOpen")}</button></>;
  const pickedPms = sel?.kind === "node" ? data.pms.find((p) => p.id === sel.id) : null;
  const pickedVer = sel?.kind === "act" ? data.pms.flatMap((p) => p.versions.map((v) => ({ v, p }))).find((x) => x.v.id === sel.id) : null;
  return (
    <div className="page">
      <div className="pagehead"><h1>{t("ep.link.board")}</h1>
        <span className="sub">{t("ep.bd.sub", { no: contract?.contract_no || "", title: contract?.title || "" })}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg toast" role="status">{ok}</p>}
      {asking && <RemoveAsk items={asking.items} close={(r) => { asking.resolve(r); setAsking(null); }} />}
      {imp && <ImportPlan data={data} imp={imp} setImp={setImp} projectId={projectId} contractId={contractId} call={call} done={(m) => { setImp(null); setOk(m); reload(); }} fail={setMsg} />}
      {data.pms.length === 0 && !adding ? <div className="card"><p className="empty-note">{t("ep.bd.none")}</p>{may && <p className="row" style={{ gap: 6 }}><button className="btn" type="button" data-new-pms onClick={() => setAdding(true)}>{t("ep.bd.newPms")}</button>
        <button className="btn ghost" type="button" data-import-open onClick={() => setImp({ mode: "new", pmsId: "", pmsCode: "", title: "", versionCode: "", fileKind: "mspdi", file: null })}>{t("ep.bd.importOpen")}</button></p>}</div> : <>
        <div style={{ height }} data-eps-tree>
          <ActivityGrid data={tree} columns={columns} defaultCols={DEFAULT_COLS} storeKey="p6-eps" customKey="eps-board" selected={sel?.id}
            onSelect={(r) => { setSel(r); setAdding(false); }} toolbar={toolbar} ops={ops} />
        </div>
        {grip}</>}
      <div className="p6-detail" data-eps-detail>
        {adding ? <PmsForm init={{ ...BLANK_PMS }} labels={data.labels} post={post} close={() => setAdding(false)} />
          : pickedPms ? <PmsForm key={`${pickedPms.id}|${pickedPms.title}|${pickedPms.budget_plan}`} p={pickedPms} labels={data.labels} post={post} may={may} askRemove={askRemovePms} />
          : pickedVer ? <VersionForm key={pickedVer.v.id} v={pickedVer.v} p={pickedVer.p} post={post} may={may}
            askRemove={async () => { const a = await askRemove([{ kind: "version", item: pickedVer.v }]); if (a) await removeNow([{ kind: "version", item: pickedVer.v }], a.all); }} />
          : data.pms.length > 0 && <p className="empty-note">{t("ep.bd.pick")}</p>}
      </div>
    </div>
  );
}

const field = (st, set, k, l, type = "text", extra = {}) => (
  <div className="field" key={k}><label htmlFor={`ep-${k}`}>{l}</label>
    <input id={`ep-${k}`} type={type} dir={type === "text" && k !== "title" && k !== "description" ? "ltr" : undefined} value={st[k] ?? ""} onChange={(e) => set({ ...st, [k]: e.target.value })} {...extra} /></div>);

/** A PMS: new, or the one picked — its WBS opens from here. */
function PmsForm({ p = null, init = null, labels, post, may = true, close = null, askRemove = null }) {
  const { t } = usePrefs();
  const { fmt } = useEpsFmt();
  const [pf, setPf] = useState(() => init || { id: p.id, code: p.code, title: p.title, pmsType: p.pms_type || "", description: p.description || "", registeredOn: p.registered_on || "",
    planStart: p.plan_start || "", planEnd: p.plan_end || "", actualStart: p.actual_start || "", actualEnd: p.actual_end || "", budgetPlan: p.budget_plan ?? "", budgetActual: p.budget_actual ?? "" });
  const F = (k, l, type, extra) => field(pf, setPf, k, l, type, extra);
  return (
    <form data-pms-form={pf.code || "new"} onSubmit={async (e) => { e.preventDefault(); if (!window.confirm(t(pf.id ? "gr.saveAsk" : "gr.addAsk"))) return;
      if (await post({ kind: "pms", ...pf }, (r) => t("ep.bd.pmsSaved", { code: r.row.code })) && close) close(); }}>
      <h3 style={{ margin: "0 0 6px" }}>{pf.id ? t("ep.bd.pmsEdit", { code: pf.code }) : t("ep.bd.pmsNew")}
        {p && <Link className="btn sm" style={{ marginInlineStart: 8 }} href={`/eps/wbs?pms=${p.id}`}>WBS</Link>}</h3>
      <fieldset disabled={!may} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          {F("code", t("ep.bd.pmsCode"), "text", { required: true, placeholder: "PM01" })}{F("title", t("ep.bd.pmsTitle"), "text", { required: true })}
          <div className="field"><label htmlFor="ep-pmsType">{t("ep.bd.pmsType")}</label>
            <input id="ep-pmsType" dir="ltr" list="pms-types" value={pf.pmsType} onChange={(e) => setPf({ ...pf, pmsType: e.target.value })} placeholder="Level 3" />
            <datalist id="pms-types">{(labels.pmsTypes || []).map((x) => <option key={x} value={x} />)}</datalist></div>
          {F("description", t("ep.bd.pmsDesc"))}
          {F("registeredOn", t("ep.bd.registered"), "date")}
          {F("planStart", t("ep.planStart"), "date")}{F("planEnd", t("ep.planEnd"), "date")}
          {F("actualStart", t("ep.actualStart"), "date")}{F("actualEnd", t("ep.actualEnd"), "date")}
          {F("budgetPlan", t("ep.bd.rootBudget"), "text", { inputMode: "decimal" })}{F("budgetActual", t("ep.d.budgetActual"), "text", { inputMode: "decimal" })}
        </div>
        <p className="sm muted">{t("ep.bd.spans", { plan: fmt(span(pf.planStart, pf.planEnd)), actual: fmt(span(pf.actualStart, pf.actualEnd)) })}</p>
        {may && <p className="row" style={{ gap: 6 }}><button className="btn" type="submit">{t("ep.save")}</button>
          {close && <button className="btn ghost" type="button" onClick={close}>{t("ep.cancel")}</button>}
          {p && <button className="btn ghost danger" type="button" data-pms-remove onClick={() => askRemove(p)}>{t("ep.remove")}</button>}</p>}
      </fieldset>
    </form>);
}

/** A version picked: its schedule's fields, master plan or not, and its planning and activities a click away. */
function VersionForm({ v, p, post, may, askRemove }) {
  const { t } = usePrefs();
  const [vf, setVf] = useState({ id: v.id, pmsId: p.id, code: v.code, title: v.title, description: v.description || "", registeredOn: v.registered_on || "",
    startOn: v.start_on || "", endOn: v.end_on || "", budgetPlan: v.budget_plan ?? "", budgetActual: v.budget_actual ?? "" });
  const F = (k, l, type, extra) => field(vf, setVf, k, l, type, extra);
  return (
    <form data-version-form={v.code} onSubmit={async (e) => { e.preventDefault(); if (!window.confirm(t("gr.saveAsk"))) return; await post({ kind: "version", ...vf }, (r) => t("ep.bd.verSaved", { code: r.row.code })); }}>
      <h3 style={{ margin: "0 0 6px" }}>{t("ep.bd.verEdit", { code: v.code })} <span className="sm muted">— PMS {p.code}</span>
        <Link className="btn sm" style={{ marginInlineStart: 8 }} href={`/eps/planning?version=${v.id}`}>{t("ep.link.planning")}</Link>
        <Link className="btn ghost sm" href={`/eps/activities?version=${v.id}`}>{t("ep.link.activities")}</Link></h3>
      <fieldset disabled={!may} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="grid2">
          {F("code", t("ep.bd.verCode"), "text", { required: true })}{F("title", t("ep.bd.verTitle"), "text", { required: true })}
          {F("description", t("ep.bd.verDesc"))}{F("registeredOn", t("ep.bd.registered"), "date")}
          {F("startOn", t("ep.bd.verStart"), "date")}{F("endOn", t("ep.bd.verEnd"), "date")}
          {F("budgetPlan", t("ep.bd.budgetPlan"), "text", { inputMode: "decimal" })}{F("budgetActual", t("ep.d.budgetActual"), "text", { inputMode: "decimal" })}
        </div>
        <label className="sm" title={t("ep.bd.masterTip")} data-master-toggle>
          <input type="checkbox" checked={!!v.master} onChange={(e) => post({ kind: "version-master", id: v.id, master: e.target.checked }, () => (e.target.checked ? t("ep.bd.masterSet", { code: v.code, pms: p.code }) : t("ep.bd.masterOff", { code: v.code })))} /> Master plan</label>
        {may && <p className="row" style={{ gap: 6 }}><button className="btn" type="submit">{t("ep.save")}</button>
          <button className="btn ghost danger" type="button" data-version-remove onClick={askRemove}>{t("ep.remove")}</button></p>}
      </fieldset>
    </form>);
}

/**
 * A plan file as a PMS of the contract (owner's request 2026-10-24: «یا
 * جایگزین PMS گردد یا به عنوان PMS جدید ذخیره شود، نه به عنوان نسخه
 * جدید»): the MS Project schedule (Save As ◄ XML), the PMS workbook or the
 * EPS sheet replaces what a PMS holds — asked first, with what goes — or
 * becomes a new PMS. What was imported before (into the old «برنامه و PMS»
 * page) is still carried over from here as a version, without the file.
 */
function ImportPlan({ data, imp, setImp, projectId, contractId, call, done, fail }) {
  const { t } = usePrefs();
  const [busy, setBusy] = useState(false);
  const pms = data.pms.find((p) => p.id === imp.pmsId);
  async function send(e) {
    e.preventDefault(); fail(null);
    if (imp.mode === "replace") {
      // replacing takes what the PMS holds: said first, and refused here already when something stops it
      let c;
      try { c = await call(`/api/eps?projectId=${projectId}&pmsId=${imp.pmsId}&contents=1`); } catch (e2) { fail(e2.message); return; }
      if (c.blockers.length) { fail(t("ep.im.replaceBlocked", { code: pms?.code, why: c.blockers.join(" ") })); return; }
      if (!window.confirm(t("ep.im.replaceAsk", { code: pms?.code, ...c.counts }))) return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      const fields = imp.mode === "new" ? { contractId, pmsCode: imp.pmsCode, title: imp.title } : { pmsId: imp.pmsId };
      for (const [k, v] of Object.entries({ projectId, kind: "import-plan", mode: imp.mode, fileKind: imp.fileKind, ...fields })) form.set(k, v);
      form.set("file", imp.file);
      const res = await fetch("/api/eps", { method: "POST", body: form, credentials: "same-origin" });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || t("ep.im.status", { n: res.status }));
      const r = b.row;
      done(t(imp.mode === "new" ? "ep.im.doneNew" : "ep.im.doneReplace", { code: r.pms.code, nodes: r.nodes, acts: r.activities, rels: r.relations })
        + (r.problems.length ? ` · ${t("ep.im.notes", { n: r.problems.length })} ${r.problems.slice(0, 3).join(" · ")}` : ""));
    } catch (e2) { fail(e2.message); } finally { setBusy(false); }
  }
  async function convert(source, importId, label) {
    const code = imp.versionCode;
    if (!code) { fail(t("ep.im.needCode")); return; }
    setBusy(true); fail(null);
    try {
      const res = await fetch("/api/eps", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, kind: "convert-legacy", pmsId: imp.pmsId, versionCode: code, source, importId }) });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(b.error || t("ep.im.status", { n: res.status }));
      done(t("ep.im.converted", { code: b.row.version.code, label, nodes: b.row.nodes, acts: b.row.activities }));
    } catch (e2) { fail(e2.message); } finally { setBusy(false); }
  }
  const legacy = data.legacy || { schedules: [], pms: [] };
  return (
    <form className="card" onSubmit={send} data-import-plan>
      <h2>{t("ep.im.title")}</h2>
      <p className="sm muted">{t("ep.im.note")}</p>
      <div role="radiogroup" aria-label={t("ep.im.mode")} className="row" style={{ gap: 14, marginBottom: 6 }}>
        <label className="sm"><input type="radio" name="im-mode" value="replace" data-im-mode="replace" disabled={!data.pms.length} checked={imp.mode === "replace"}
          onChange={() => setImp({ ...imp, mode: "replace" })} /> {t("ep.im.modeReplace")}</label>
        <label className="sm"><input type="radio" name="im-mode" value="new" data-im-mode="new" checked={imp.mode === "new"}
          onChange={() => setImp({ ...imp, mode: "new" })} /> {t("ep.im.modeNew")}</label>
      </div>
      <div className="grid2">
        {imp.mode === "replace" ? (
          <div className="field"><label htmlFor="im-pms">{t("ep.im.replaceWhich")}</label>
            <select id="im-pms" value={imp.pmsId} onChange={(e) => setImp({ ...imp, pmsId: e.target.value })}>
              {data.pms.filter((p) => p.active !== false || p.id === imp.pmsId).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}</select></div>
        ) : <>
          <div className="field"><label htmlFor="im-newcode">{t("ep.bd.pmsCode")}</label>
            <input id="im-newcode" dir="ltr" required value={imp.pmsCode} placeholder={`PM${String(data.pms.length + 1).padStart(2, "0")}`}
              onChange={(e) => setImp({ ...imp, pmsCode: e.target.value.toUpperCase() })} /></div>
          <div className="field"><label htmlFor="im-newtitle">{t("ep.im.newTitle")}</label>
            <input id="im-newtitle" value={imp.title} onChange={(e) => setImp({ ...imp, title: e.target.value })} /></div></>}
        <div className="field"><label htmlFor="im-kind">{t("ep.im.kind")}</label>
          <select id="im-kind" value={imp.fileKind} onChange={(e) => setImp({ ...imp, fileKind: e.target.value })}>
            <option value="mspdi">MS Project (XML — Save As ◄ XML Format)</option>
            <option value="pms">{t("ep.im.kindPms")}</option>
            <option value="sheet">{t("ep.im.kindSheet")}</option></select></div>
        <div className="field"><label htmlFor="im-file">{t("ep.im.file")}</label>
          <input id="im-file" type="file" required accept={imp.fileKind === "mspdi" ? ".xml" : ".xlsx,.xls"} onChange={(e) => setImp({ ...imp, file: e.target.files?.[0] || null })} />
          {imp.fileKind !== "mspdi" && <TemplateButton kind={imp.fileKind === "sheet" ? "eps" : "pms"} />}</div>
      </div>
      <button className="btn" type="submit" data-im-go disabled={busy || !imp.file || (imp.mode === "new" ? !imp.pmsCode : !imp.pmsId)}>
        {busy ? t("ep.im.busy") : t(imp.mode === "new" ? "ep.im.goNew" : "ep.im.goReplace")}</button>{" "}
      <button className="btn ghost" type="button" onClick={() => setImp(null)}>{t("ep.cancel")}</button>
      {(legacy.schedules.length > 0 || legacy.pms.length > 0) && (
        <div style={{ marginTop: 12 }} data-legacy>
          <h3>{t("ep.im.legacy")}</h3>
          <p className="sm muted">{t("ep.im.legacyNote")}</p>
          <div className="grid2">
            <div className="field"><label htmlFor="im-lpms">PMS</label>
              <select id="im-lpms" value={imp.pmsId} onChange={(e) => setImp({ ...imp, pmsId: e.target.value })}>
                {data.pms.filter((p) => p.active !== false).map((p) => <option key={p.id} value={p.id}>{p.code} — {p.title}</option>)}</select></div>
            <div className="field"><label htmlFor="im-code">{t("ep.im.code")}</label>
              <input id="im-code" dir="ltr" value={imp.versionCode} placeholder={`${pms?.code || "PM01"}-R${(pms?.versions.length || 0) + 1}`}
                onChange={(e) => setImp({ ...imp, versionCode: e.target.value })} /></div></div>
          <ul className="sm">
            {legacy.schedules.map((s) => <li key={s.id}>{t("ep.im.legacySchedule", { name: s.source_name, n: s.task_count })} <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => convert("schedule", s.id, s.source_name)}>{t("ep.im.convert")}</button></li>)}
            {legacy.pms.map((s) => <li key={s.id}>{t("ep.im.legacyPms", { name: s.source_name })}{s.data_date && ` ${t("ep.im.dataDate", { d: s.data_date })}`} <button type="button" className="btn ghost sm" disabled={busy}
              onClick={() => convert("pms", s.id, s.source_name)}>{t("ep.im.convert")}</button></li>)}
          </ul>
        </div>)}
    </form>
  );
}

/**
 * The question before a PMS or a version is deleted (owner's requirements
 * 2026-10-26, item 5): what each holds, and «delete all under it» — with it
 * ticked the row goes with its planning rows, daily-report lines, activities
 * and WBS; without it only an empty one goes. What still stops a PMS (a
 * control account on its WBS) is said, and OK stays shut.
 */
function RemoveAsk({ items, close }) {
  const { t } = usePrefs();
  const [all, setAll] = useState(false);
  const stop = items.flatMap((x) => (x.stop || []).map((why) => `${x.item.code}: ${why}`));
  return (
    <div className="p6-modal" role="dialog" aria-label={t("ep.bd.removeTitle")} data-remove-ask onClick={() => close(null)}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>{t("ep.bd.removeTitle")}</h2>
        <ul className="sm">{items.map((x) => (
          <li key={x.item.id} data-remove-item={x.item.code}>{x.kind === "pms"
            ? t("ep.bd.removePmsHolds", { code: x.item.code, ...x.counts })
            : t("ep.bd.removeVerHolds", { code: x.item.code, plans: x.counts.plans })}</li>))}</ul>
        <label className="sm" data-remove-all><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> {t("ep.bd.removeAll")}</label>
        <p className="sm muted">{t(all ? "ep.bd.removeAllNote" : "ep.bd.removeEmptyNote")}</p>
        {stop.length > 0 && <p className="err sm">{stop.join(" ")}</p>}
        <p className="row" style={{ gap: 6 }}>
          <button className="btn danger" type="button" data-remove-ok disabled={stop.length > 0} onClick={() => close({ all })}>{t("ep.bd.ok")}</button>
          <button className="btn ghost" type="button" onClick={() => close(null)}>{t("ep.cancel")}</button></p>
      </div>
    </div>);
}
