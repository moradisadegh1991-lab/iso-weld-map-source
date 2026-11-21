"use client";
import { useId, useState } from "react";
import { usePrefs } from "../../lib/client/prefs.mjs";

export function CalendarSelect({ calendars = [], value, onChange, inherited, required = false, disabled = false }) {
  const { t } = usePrefs();
  const id = useId();
  return <div className="field">
    <label htmlFor={id}>{t("ep.cal.title")}</label>
    <select id={id} value={value || ""} onChange={(e) => onChange(e.target.value)} required={required} disabled={disabled}>
      <option value="">{required ? t(calendars.length ? "ep.cal.pick" : "ep.cal.defineFirst") : inherited ? t("ep.cal.inheritName", { name: inherited }) : t("ep.cal.allDays")}</option>
      {calendars.map((c) => <option key={c.id} value={c.id}>{c.name}{c.is_default ? ` · ${t("ep.g.default")}` : ""}</option>)}
    </select>
  </div>;
}

const empty = () => ({ id: null, name: "", weekdays: [0, 1, 2, 3, 4, 5, 6], exceptions: {}, isDefault: false });
export default function WorkCalendar({ calendars, post, may }) {
  const { t, lang } = usePrefs();
  const [draft, setDraft] = useState(null);
  const [date, setDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [working, setWorking] = useState(false);
  const [busy, setBusy] = useState(false);
  const weekday = new Intl.DateTimeFormat(lang, { weekday: "long", timeZone: "UTC" });
  const choose = (c) => { setDraft(c ? { ...c, isDefault: c.is_default } : empty()); setDate(""); setEndDate(""); setWorking(false); };
  const dates = date ? Math.round((Date.parse(endDate || date) - Date.parse(date)) / 86400000) + 1 : 0;
  function addException() {
    if (dates < 1 || dates > 366) return;
    const start = Date.parse(date);
    const values = Object.fromEntries(Array.from({ length: dates }, (_, i) =>
      [new Date(start + i * 86400000).toISOString().slice(0, 10), working]));
    setDraft({ ...draft, exceptions: { ...draft.exceptions, ...values } });
    setDate(""); setEndDate("");
  }

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try { if (await post({ kind: "calendar", ...draft }, () => t("ep.cal.saved"))) setDraft(null); }
    finally { setBusy(false); }
  }
  return <details className="card" data-contract-calendars>
    <summary>{t("ep.cal.list")}</summary>
    <ul>{calendars.map((c) => <li key={c.id}>
      {c.name} {c.is_default && <span className="pill sm">{t("ep.g.default")}</span>}
      {may && <>
        <button className="btn ghost sm" type="button" disabled={busy} onClick={() => choose(c)}>{t("ep.edit")}</button>
        <button className="btn ghost sm" type="button" disabled={busy} onClick={() => choose({ ...c, id: null, name: "", is_default: false })}>{t("ep.cal.copy")}</button>
        {!c.is_default && <button className="btn ghost sm" type="button" disabled={busy} onClick={async () => {
          if (!window.confirm(t("ep.cal.removeAsk", { name: c.name }))) return;
          setBusy(true);
          try { if (await post({ kind: "calendar-remove", id: c.id }, () => t("ep.cal.removed")) && draft?.id === c.id) setDraft(null); }
          finally { setBusy(false); }
        }}>{t("ep.remove")}</button>}
      </>}
    </li>)}</ul>
    {may && !draft && <button className="btn sm" type="button" onClick={() => choose(null)}>+ {t("ep.cal.new")}</button>}
    {may && draft && <form onSubmit={save}>
      <label>{t("ep.cal.name")} <input required maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
      <fieldset><legend>{t("ep.cal.week")}</legend>
        {[6, 0, 1, 2, 3, 4, 5].map((n) => <label key={n} style={{ marginInlineEnd: 12 }}>
          <input type="checkbox" checked={draft.weekdays.includes(n)} onChange={(e) => setDraft({ ...draft, weekdays: e.target.checked ? [...draft.weekdays, n] : draft.weekdays.filter((x) => x !== n) })} />
          {weekday.format(new Date(Date.UTC(2026, 0, 4 + n)))}
        </label>)}
      </fieldset>
      <fieldset><legend>{t("ep.cal.exceptions")}</legend>
        <label>{t("ep.date")} <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>{t("ep.cal.until")} <input type="date" min={date || undefined} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></label>
        <select aria-label={t("ep.cal.exceptions")} value={String(working)} onChange={(e) => setWorking(e.target.value === "true")}>
          <option value="false">{t("ep.cal.off")}</option><option value="true">{t("ep.cal.on")}</option>
        </select>
        <button className="btn ghost sm" type="button" disabled={dates < 1 || dates > 366} onClick={addException}>{t("ep.cal.addException")}</button>
        <ul>{Object.entries(draft.exceptions).sort().map(([d, on]) => <li key={d}>
          <bdi>{d}</bdi> · {t(on ? "ep.cal.on" : "ep.cal.off")}
          <button className="btn ghost sm" type="button" onClick={() => setDraft({ ...draft, exceptions: Object.fromEntries(Object.entries(draft.exceptions).filter(([key]) => key !== d)) })}>{t("ep.remove")}</button>
        </li>)}</ul>
      </fieldset>
      <label><input type="checkbox" checked={draft.isDefault || !calendars.length} disabled={draft.is_default || !calendars.length}
        onChange={(e) => setDraft({ ...draft, isDefault: e.target.checked })} /> {t("ep.cal.default")}</label>
      <div className="row"><button className="btn" type="submit" disabled={busy || !draft.weekdays.length}>{t("ep.save")}</button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => setDraft(null)}>{t("ep.cancel")}</button></div>
    </form>}
  </details>;
}
