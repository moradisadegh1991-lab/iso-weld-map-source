"use client";
import { useEffect, useState } from "react";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { usePlatformMaybe } from "../../lib/client/platform.mjs";
import { downloadTemplate, pickable } from "../../lib/import-templates.mjs";
import { FloatBox } from "./float";

/**
 * «Excel template» beside a file import: the columns its importer reads, with
 * examples and a guide sheet. Where the importer reads columns by heading
 * (lib/import-templates.mjs `pick`), a menu instead: the full template, the
 * project's templates people built, and a new one — the columns chosen (the
 * ones the importer cannot do without stay ticked) under a name of its own
 * (owner's requirements 2026-10-22, «فایل الگو با نام خاص»).
 */
export default function TemplateButton({ kind, className = "btn ghost sm" }) {
  const { t } = usePrefs();
  const platform = usePlatformMaybe();
  const p = pickable(kind);
  const [open, setOpen] = useState(false);
  if (!p || !platform?.projectId) return <button type="button" className={className} data-template={kind} onClick={() => downloadTemplate(kind)}>{t("imp.template")}</button>;
  return (
    <span style={{ position: "relative" }}>
      <button type="button" className={className} data-template={kind} aria-expanded={open} onClick={() => setOpen(!open)}>{t("imp.template")} ▾</button>
      {open && <Templates kind={kind} p={p} platform={platform} onClose={() => setOpen(false)} />}
    </span>);
}

function Templates({ kind, p, platform, onClose }) {
  const { t } = usePrefs();
  const [list, setList] = useState(null);
  const [made, setMade] = useState(null);
  const [msg, setMsg] = useState("");
  const load = async () => {
    try { setList(await platform.call(`/api/import-templates?projectId=${platform.projectId}&kind=${kind}`)); } catch (e) { setMsg(e.message); }
  };
  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const send = async (body) => {
    try { await platform.call("/api/import-templates", { method: "POST", body: JSON.stringify({ projectId: platform.projectId, ...body }) }); setMsg(""); await load(); return true; }
    catch (e) { setMsg(e.message); return false; }
  };
  const fresh = () => ({ name: "", columns: [...p.columns] });
  return (
    <FloatBox className="tk-dialog card" style={{ position: "absolute", zIndex: 40, top: "100%", insetInlineStart: 0, minWidth: 280 }} role="dialog"
      aria-label={t("imp.template")} onClose={onClose} data-templates={kind}>
      <ul className="sm" style={{ margin: 0, paddingInlineStart: 16 }}>
        <li><button type="button" className="btn ghost sm" data-template-full onClick={() => downloadTemplate(kind)}>{t("imp.full")}</button></li>
        {(list?.templates || []).map((x) => (
          <li key={x.id} data-template-name={x.name}>
            <button type="button" className="btn ghost sm" onClick={() => downloadTemplate(kind, { columns: x.columns, name: x.name })}>{x.name}</button>
            <span className="muted"> ({x.columns.length})</span>
            {(list.may.removeAny || x.created_by === list.me) && <button type="button" className="btn ghost sm danger" aria-label={t("imp.removeTemplate", { name: x.name })}
              onClick={() => { if (window.confirm(t("imp.removeTemplate", { name: x.name }))) send({ kind: "remove", id: x.id }); }}>×</button>}
          </li>))}
      </ul>
      {list?.may.save && !made && <button type="button" className="btn sm" data-template-new onClick={() => setMade(fresh())}>{t("imp.newTemplate")}</button>}
      {made && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await send({ kind: "save", template: kind, name: made.name, columns: made.columns })) { await downloadTemplate(kind, made); setMade(null); } }}>
          <label className="field"><span className="sm">{t("imp.templateName")}</span>
            <input required maxLength={80} value={made.name} onChange={(e) => setMade({ ...made, name: e.target.value })} data-template-name-input /></label>
          <div className="sm" style={{ display: "flex", flexDirection: "column", gap: 2, margin: "6px 0" }}>
            {p.columns.map((c) => {
              const must = p.required.includes(c);
              return <label key={c} title={must ? t("imp.required") : undefined}><input type="checkbox" disabled={must} checked={made.columns.includes(c)} data-template-col={c}
                onChange={(e) => setMade({ ...made, columns: e.target.checked ? [...made.columns, c] : made.columns.filter((x) => x !== c) })} /> {c}{must ? " *" : ""}</label>;
            })}
          </div>
          <p className="row" style={{ gap: 6 }}><button type="submit" className="btn sm" data-template-save>{t("imp.saveTemplate")}</button>
            <button type="button" className="btn ghost sm" onClick={() => setMade(null)}>{t("common.cancel")}</button></p>
        </form>)}
      {msg && <p className="err sm">{msg}</p>}
    </FloatBox>);
}
