"use client";
import { useEffect, useState } from "react";
import { usePlatform, useProjectData } from "../../../lib/client/platform.mjs";
import { flatten } from "../../../components/ui/TreeEditor";
import { usePrefs } from "../../../lib/client/prefs.mjs";

import TableKit from "../../../components/ui/TableKit";
/**
 * Step 4 of the organisation's process: a contract's resources, shown in its
 * resource tree (discipline and work group). A resource or a branch moves by
 * drag and drop: drop it on a branch to put it there, on the top strip to
 * take it out of every branch.
 */
/**
 * The project's resource library — names, kinds and units the project already
 * knows (the old Access daily report's list, and what is added here). It is
 * kept on this page, not on a page of its own: a contract takes its resources
 * from it, and nobody types a name the project already holds.
 */
function Library({ data, T, post }) {
  const { t, L } = usePrefs();
  const kindName = (k) => L(`resource.kind.${k}`, data.kinds[k]);
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("");
  const [pick, setPick] = useState(new Set());
  const [nf, setNf] = useState({ itemKind: "person", name: "", unit: "", discipline: "" });
  const lib = data.library || [];
  const inContract = new Set((T?.resources || []).map((r) => `${r.kind}|${r.name}`));
  const shown = lib.filter((i) => (!kind || i.kind === kind) && (!q || `${i.name} ${i.discipline || ""}`.includes(q)));
  const toggle = (id) => { const s = new Set(pick); s.has(id) ? s.delete(id) : s.add(id); setPick(s); };
  return (
    <div className="card" data-library>
      <h2>{t("cr.library")}</h2>
      <p className="sm muted">{t("cr.libraryNote")}
        {data.bundled && data.may.library && t("cr.accessNote", { n: data.bundled.items })}</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        <div className="field"><label htmlFor="lb-q">{t("cr.search")}</label><input id="lb-q" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field"><label htmlFor="lb-k">{t("cr.kind")}</label><select id="lb-k" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">{t("c.all")}</option>
          {Object.keys(data.kinds).map((k) => <option key={k} value={k}>{kindName(k)}</option>)}</select></div>
        {T && data.may.edit && <button className="btn" type="button" disabled={!pick.size}
          onClick={async () => { const r = await post({ kind: "from-library", ids: [...pick] }, (x) => `${t("cr.addedToContract", { added: x.row.added })}${x.row.kept ? t("cr.alreadyThere", { n: x.row.kept }) : ""}.`); if (r) setPick(new Set()); }}>
          {t("cr.addPicked", { n: pick.size || "" })}</button>}
        {data.bundled && data.may.library && <button className="btn ghost" type="button"
          onClick={() => post({ kind: "library-import-access" }, (x) => t("cr.imported", { added: x.row.added, kept: x.row.kept }))}>{t("cr.importAccess")}</button>}
      </div>
      {lib.length === 0 ? <p className="empty-note">{t("cr.libEmpty")}</p> : (
        <div className="tablewrap" style={{ maxHeight: 360, overflow: "auto" }}><TableKit name="contracts-resources-1"><table className="dtable">
          <thead><tr>{T && data.may.edit && <th />}<th>{t("cr.h.name")}</th><th>{t("cr.kind")}</th><th>{t("cr.h.discipline")}</th><th>{t("cr.h.unit")}</th><th>{t("cr.h.inContract")}</th></tr></thead>
          <tbody>{shown.slice(0, 400).map((i) => { const has = inContract.has(`${i.kind}|${i.name}`); return (
            <tr key={i.id} data-lib={i.name}>
              {T && data.may.edit && <td><input type="checkbox" aria-label={t("cr.pickName", { name: i.name })} disabled={has} checked={pick.has(i.id)} onChange={() => toggle(i.id)} /></td>}
              <td>{i.name}</td><td className="sm">{kindName(i.kind)}</td><td className="sm">{i.discipline || "—"}</td>
              <td className="sm">{i.unit || (i.kind === "person" ? t("cr.unitPerson") : i.kind === "machine" ? t("cr.unitMachine") : "—")}</td>
              <td>{has ? <span className="pill ok">{t("cr.present")}</span> : ""}</td></tr>); })}</tbody></table></TableKit></div>)}
      {data.may.library && (
        <form style={{ marginTop: 8 }} onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "library-add", ...nf }, () => t("cr.libAdded"))) setNf({ ...nf, name: "", unit: "" }); }}>
          <div className="grid2">
            <div className="field"><label htmlFor="lb-nk">{t("cr.kind")}</label><select id="lb-nk" value={nf.itemKind} onChange={(e) => setNf({ ...nf, itemKind: e.target.value })}>
              {Object.keys(data.kinds).map((k) => <option key={k} value={k}>{kindName(k)}</option>)}</select></div>
            <div className="field"><label htmlFor="lb-nn">{t("cr.h.name")}</label><input id="lb-nn" required value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} /></div>
            <div className="field"><label htmlFor="lb-nd">{t("cr.h.discipline")}</label><input id="lb-nd" value={nf.discipline} onChange={(e) => setNf({ ...nf, discipline: e.target.value })} /></div>
            <div className="field"><label htmlFor="lb-nu">{t("cr.h.unit")}</label><input id="lb-nu" value={nf.unit} onChange={(e) => setNf({ ...nf, unit: e.target.value })} /></div>
          </div>
          <button className="btn ghost" type="submit">{t("cr.addToLib")}</button>
        </form>)}
    </div>
  );
}

const BLANK = { id: null, resourceKind: "person", categoryId: "", name: "", direct: true, unit: "", forecastQty: "", actualQty: "", status: "active", description: "", seq: "" };

export default function ResourcesPage() {
  const { projectId, contractId, contract, call } = usePlatform();
  const { t, L, num } = usePrefs();
  const fmt = (v) => (v === "" ? "—" : num(v, { maximumFractionDigits: 2 }));
  const { data, error, reload } = useProjectData((id) => `/api/resources?projectId=${id}${contractId ? `&contractId=${contractId}` : ""}`, [contractId]);
  const [msg, setMsg] = useState(null);
  const [ok, setOk] = useState(null);
  const [f, setF] = useState(BLANK);
  useEffect(() => { setF(BLANK); }, [contractId]);
  const [drag, setDrag] = useState(null);         // { type: "resource"|"category", id }
  const [over, setOver] = useState(null);
  async function post(body, done) {
    setMsg(null); setOk(null);
    try { const r = await call("/api/resources", { method: "POST", body: JSON.stringify({ projectId, contractId, ...body }) }); reload(); if (done) setOk(done(r)); return r; }
    catch (e) { setMsg(e.message); return null; }
  }
  if (error) return <p className="err">{error}</p>;
  if (!data) return <p className="muted">{t("common.loading")}</p>;
  const may = data.may.edit;
  const kindName = (k) => L(`resource.kind.${k}`, data.kinds[k]);
  const statusName = (k) => L(`resource.status.${k}`, data.statuses[k]);
  const T = data.tree;
  const drop = (categoryId) => (e) => {
    e.preventDefault();
    const d = drag; setDrag(null); setOver(null);
    if (!d) return;
    if (d.type === "resource") post({ kind: "resource-move", id: d.id, categoryId }, () => t("cr.moved"));
    else if (d.id !== categoryId) post({ kind: "category-move", id: d.id, parentId: categoryId }, () => t("cr.branchMoved"));
  };
  const target = (key, categoryId) => may ? {
    onDragOver: (e) => { e.preventDefault(); if (over !== key) setOver(key); },
    onDragLeave: () => setOver((o) => (o === key ? null : o)),
    onDrop: drop(categoryId),
  } : {};
  const source = (type, id) => may ? {
    draggable: true,
    onDragStart: (e) => { e.stopPropagation(); setDrag({ type, id }); e.dataTransfer.setData("text/plain", `${type}:${id}`); e.dataTransfer.effectAllowed = "move"; },
    onDragEnd: () => { setDrag(null); setOver(null); },
  } : {};
  const edit = (r) => setF({ id: r.id, resourceKind: r.kind, categoryId: r.category_id || "", name: r.name, direct: r.direct, unit: r.unit || "",
    forecastQty: r.forecast_qty ?? "", actualQty: r.actual_qty ?? "", status: r.status, description: r.description || "", seq: String(r.seq ?? "") });

  // rows are built by plain functions, not components defined here: a component created
  // on each render would be remounted while dragging, and the browser would end the drag
  const resourceRow = (r, depth) => (
    <tr key={r.id} data-resource={r.id} {...source("resource", r.id)} style={{ cursor: may ? "grab" : undefined, background: drag?.id === r.id ? "var(--hl, #eef6f8)" : undefined }}>
      <td className="mono sm">{r.seq}</td>
      <td style={{ paddingInlineStart: 12 + depth * 20 }}>{may && <span className="muted" aria-hidden="true">⠿ </span>}{r.name}</td>
      <td className="sm">{kindName(r.kind)}</td><td className="sm">{r.direct ? t("cr.direct") : t("cr.indirect")}</td><td className="sm">{r.unit || "—"}</td>
      <td className="mono">{fmt(r.forecast_qty)}</td><td className="mono">{fmt(r.actual_qty)}</td>
      <td><span className={`pill ${r.status === "active" ? "ok" : r.status === "planned" ? "" : "bad"}`}>{statusName(r.status)}</span></td>
      <td className="sm">{r.description || "—"}</td>
      {may && <td style={{ whiteSpace: "nowrap" }}><button className="btn ghost sm" type="button" onClick={() => edit(r)}>{t("cs.edit")}</button>
        <button className="btn ghost sm" type="button" onClick={() => post({ kind: "resource-remove", id: r.id }, () => t("cs.removed"))}>{t("cs.remove")}</button></td>}
    </tr>
  );
  const branchRows = (n, depth) => [
    <tr key={n.id} data-category={n.id} {...source("category", n.id)} {...target(n.id, n.id)}
      style={{ background: over === n.id ? "var(--hl, #eef6f8)" : "var(--surf2, #f5f7f9)", outline: over === n.id ? "2px dashed var(--cy, #1b7f99)" : undefined, cursor: may ? "grab" : undefined }}>
      <td colSpan={may ? 10 : 9} style={{ paddingInlineStart: 8 + depth * 20 }}>
        <b>{may && <span className="muted" aria-hidden="true">⠿ </span>}▾ {n.name}</b>{n.discipline && <span className="sm muted"> · {n.discipline}</span>}
        <span className="sm muted"> — {t("cr.resources", { n: n.allResources.length })}{Object.entries(n.totals).filter(([, v]) => v).map(([u, v]) => ` · ${fmt(v)} ${u}`).join("")}</span>
      </td>
    </tr>,
    ...n.resources.map((r) => resourceRow(r, depth + 1)),
    ...n.children.flatMap((c) => branchRows(c, depth + 1)),
  ];

  return (
    <div className="page">
      <div className="pagehead"><h1>{t("cr.title")}</h1>
        <span className="sub">{t("cr.sub")}</span></div>
      {msg && <p className="err" role="alert">{msg}</p>}
      {ok && <p className="okmsg" role="status">{ok}</p>}
      {contract ? <p className="sm"><b>{t("cs.contract", { no: contract.contract_no })}</b> — {contract.title}</p>
        : <p className="empty-note">{t("cs.pick")}</p>}
      {T && <>
        {may && (
          <div className="card">
            <h2>{f.id ? t("cr.editResource") : t("cr.newResource")}</h2>
            {T.tree.length === 0 && <p className="sm muted">{t("cr.emptyTree")}</p>}
            <form onSubmit={async (e) => { e.preventDefault(); if (await post({ kind: "resource", ...f }, () => (f.id ? t("cr.saved") : t("cr.added")))) setF({ ...BLANK, resourceKind: f.resourceKind, categoryId: f.categoryId }); }}>
              <div className="grid2">
                <div className="field"><label htmlFor="rs-k">{t("cr.resourceKind")}</label><select id="rs-k" value={f.resourceKind} onChange={(e) => setF({ ...f, resourceKind: e.target.value })}>
                  {Object.keys(data.kinds).map((k) => <option key={k} value={k}>{kindName(k)}</option>)}</select></div>
                <div className="field"><label htmlFor="rs-cat">{t("cr.category")}</label><select id="rs-cat" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
                  <option value="">{t("cr.noCategory")}</option>{flatten(T.tree).map((x) => <option key={x.id} value={x.id}>{x.path}</option>)}</select></div>
                <div className="field"><label htmlFor="rs-n">{t("cr.name")}</label><input id="rs-n" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
                <div className="field"><label htmlFor="rs-d">{t("cr.directOrNot")}</label><select id="rs-d" value={f.direct ? "1" : "0"} onChange={(e) => setF({ ...f, direct: e.target.value === "1" })}>
                  <option value="1">{t("cr.direct")}</option><option value="0">{t("cr.indirect")}</option></select></div>
                <div className="field"><label htmlFor="rs-u">{t("cr.h.unit")}</label><input id="rs-u" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}
                  placeholder={f.resourceKind === "person" ? t("cr.unitPerson") : f.resourceKind === "machine" ? t("cr.unitMachine") : t("cr.unitNeeded")} /></div>
                <div className="field"><label htmlFor="rs-f">{t("cr.forecast")}</label><input id="rs-f" dir="ltr" inputMode="decimal" value={f.forecastQty} onChange={(e) => setF({ ...f, forecastQty: e.target.value })} /></div>
                <div className="field"><label htmlFor="rs-a">{t("cr.actual")}</label><input id="rs-a" dir="ltr" inputMode="decimal" value={f.actualQty} onChange={(e) => setF({ ...f, actualQty: e.target.value })} /></div>
                <div className="field"><label htmlFor="rs-s">{t("c.status")}</label><select id="rs-s" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                  {Object.keys(data.statuses).map((k) => <option key={k} value={k}>{statusName(k)}</option>)}</select></div>
                <div className="field"><label htmlFor="rs-seq">{t("cr.seq")}</label><input id="rs-seq" dir="ltr" inputMode="numeric" value={f.seq}
                  onChange={(e) => setF({ ...f, seq: e.target.value })} placeholder={t("cr.seqPh")} /></div>
                <div className="field"><label htmlFor="rs-ds">{t("cr.description")}</label><input id="rs-ds" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              </div>
              <button className="btn" type="submit">{f.id ? t("c.save") : t("cr.addResource")}</button>
              {f.id && <button className="btn ghost" type="button" onClick={() => setF(BLANK)}>{t("common.cancel")}</button>}
            </form>
          </div>
        )}
        <div className="card">
          <h2>{t("cr.tree")}</h2>
          {may && <div data-drop-root="" {...target("root", null)} className="sm muted"
            style={{ padding: 6, marginBottom: 6, borderRadius: 6, border: `1px dashed ${over === "root" ? "var(--cy, #1b7f99)" : "var(--line, #ccd)"}` }}>
            {t("cr.dropHint")}</div>}
          <div className="tablewrap"><TableKit name="contracts-resources-2"><table className="dtable">
            <thead><tr><th title={t("cr.seq")}>{t("cr.h.seq")}</th><th>{t("cr.name")}</th><th>{t("cr.kind")}</th><th>{t("cr.h.direct")}</th><th>{t("cr.h.unit")}</th><th>{t("cr.h.forecast")}</th><th>{t("cr.h.actual")}</th><th>{t("c.status")}</th><th>{t("cr.description")}</th>{may && <th />}</tr></thead>
            <tbody>
              {T.tree.flatMap((n) => branchRows(n, 0))}
              {T.loose.length > 0 && <tr><td colSpan={may ? 10 : 9}><b>{t("cr.uncategorised")}</b></td></tr>}
              {T.loose.map((r) => resourceRow(r, 1))}
            </tbody></table></TableKit></div>
          {T.resources.length === 0 && <p className="empty-note">{t("cr.none")}</p>}
        </div>
      </>}
      <Library data={data} T={T} post={post} />
    </div>
  );
}
