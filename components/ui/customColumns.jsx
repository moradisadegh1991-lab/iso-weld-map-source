"use client";
import { useCallback, useEffect, useState } from "react";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { usePlatformMaybe } from "../../lib/client/platform.mjs";

/**
 * The columns a project adds to a table of the platform (owner's
 * requirements 2026-10-22, item 7; lib/db/repos/custom-fields.mjs, migration
 * 085), for every kind of table: TableKit's list tables and the WBS and
 * activity trees (components/eps/ActivityGrid.jsx). A table is known by its
 * name; a row's value by the row's own key.
 *
 *   const { custom, reload, saveValue } = useCustomColumns(name);
 *   custom → { fields: [{ id, label, data_type, options }], values: Map("fieldId|rowKey" → text), may: { define, fill } } | null
 */
export function useCustomColumns(name) {
  const platform = usePlatformMaybe();
  const [custom, setCustom] = useState(null);
  const reload = useCallback(async () => {
    if (!platform?.projectId || !platform.call || !name) return;
    try {
      const r = await platform.call(`/api/custom-fields?projectId=${platform.projectId}&form=${encodeURIComponent(name)}`);
      setCustom({ fields: r.fields, values: new Map(r.values.map((v) => [`${v.field_id}|${v.row_key}`, v.value])), may: r.may });
    } catch { setCustom(null); }
  }, [platform?.projectId, platform?.call, name]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { reload(); }, [reload]);
  /** A row's value in a column (blank removes it); throws the server's reason. */
  const saveValue = async (field, rowKey, value) => {
    await platform.call("/api/custom-fields", { method: "POST", body: JSON.stringify({ projectId: platform.projectId, kind: "value", fieldId: field.id, rowKey, value }) });
    await reload();
  };
  return { custom, reload, saveValue, platform };
}

/** A value as a cell shows it: yes/no in words, the rest as written. */
export const showCustom = (c, f, v) => (v === "" || v == null ? "" : f.data_type === "bool" ? (v === "true" ? c.yes : c.no) : v);

/** «+ ستون»: the table's project columns — added, renamed, removed — by the project's admin. */
export function CustomColumns({ custom, dlg, setDlg, platform, name, reload }) {
  const { t } = usePrefs();
  const [msg, setMsg] = useState("");
  const send = async (body) => {
    try { await platform.call("/api/custom-fields", { method: "POST", body: JSON.stringify({ projectId: platform.projectId, formKey: name, ...body }) }); setMsg(""); await reload(); return true; }
    catch (e) { setMsg(e.message); return false; }
  };
  return (
    <div className="tk-dialog card no-print" role="dialog" aria-label={t("tk.addColumn")} data-tk-coldlg>
      <b>{t("tk.columnsOf")}</b>
      {(custom?.fields || []).length > 0 && <ul className="sm" style={{ margin: "6px 0" }}>{custom.fields.map((f) => (
        <li key={f.id}>{f.label} <span className="muted">({t(`tk.type.${f.data_type}`)}{f.options.length ? `: ${f.options.join(", ")}` : ""})</span>{" "}
          <button type="button" className="btn ghost sm danger" onClick={() => { if (window.confirm(t("tk.removeColumnAsk", { label: f.label }))) send({ kind: "field-remove", id: f.id }); }}>{t("tk.removeColumn")}</button></li>))}</ul>}
      <form className="row" style={{ gap: 6, alignItems: "end", flexWrap: "wrap" }}
        onSubmit={async (e) => { e.preventDefault(); if (await send({ kind: "field", label: dlg.label, dataType: dlg.dataType, options: dlg.options })) setDlg({ label: "", dataType: "text", options: "" }); }}>
        <label className="field"><span className="sm">{t("tk.columnLabel")}</span><input required value={dlg.label} onChange={(e) => setDlg({ ...dlg, label: e.target.value })} data-tk-collabel /></label>
        <label className="field"><span className="sm">{t("tk.columnType")}</span><select value={dlg.dataType} onChange={(e) => setDlg({ ...dlg, dataType: e.target.value })} data-tk-coltype>
          {["text", "number", "date", "bool", "list"].map((k) => <option key={k} value={k}>{t(`tk.type.${k}`)}</option>)}</select></label>
        {dlg.dataType === "list" && <label className="field"><span className="sm">{t("tk.columnOptions")}</span><input value={dlg.options} onChange={(e) => setDlg({ ...dlg, options: e.target.value })} placeholder="A, B, C" /></label>}
        <button className="btn sm" type="submit" data-tk-colsave>{t("tk.addColumnGo")}</button>
        <button className="btn ghost sm" type="button" onClick={() => setDlg(null)}>{t("common.close")}</button>
      </form>
      {msg && <p className="err sm">{msg}</p>}
    </div>);
}
