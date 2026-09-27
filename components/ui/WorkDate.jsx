"use client";
import { createContext, useContext, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";

/**
 * The day the work was done, for every one-click record on a page — a chain
 * step's «ثبت انجام», a MIR, a stock movement, a loop check.
 *
 *   <WorkDateScope> … <WorkDateField /> … </WorkDateScope>
 *   const on = useWorkDate();   post({ …, doneAt: on })
 *
 * Site records are entered late — the evening's paperwork, Saturday's
 * backlog. A button that stamped the day it was pressed would write a date
 * nobody measured (and a 28-day cube break could never be entered against a
 * pour recorded «today»). So the day is a field, it starts at today because
 * that is the day most records are about, and it is shown beside the
 * buttons it governs. The server still refuses a day in the future.
 *
 * Schedules and site diaries count days from the project's start ("day 60"),
 * so where the project has a start date the day can be typed as that number
 * too, and every date shows which project day it is — the date is the
 * record, the number is only a way to reach it.
 */
const Ctx = createContext(null);

/** Today in the browser's own time zone — not UTC, which is yesterday before 03:30 in Tehran. */
export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

const DAY = 86_400_000;
const utc = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);

/** Days from the project's start to `iso`; null when either is unknown. */
export function projectDay(start, iso) {
  if (!start || !iso) return null;
  const n = Math.round((utc(iso) - utc(start)) / DAY);
  return Number.isFinite(n) ? n : null;
}

/** The date of project day `n`. */
export function dateOfDay(start, n) {
  return new Date(utc(start) + n * DAY).toISOString().slice(0, 10);
}

/**
 * Under a date field: which project day it is, and whether it is still to
 * come — so a wrong day is seen before the server refuses it.
 */
export function DayHint({ date }) {
  const { project } = usePlatform();
  if (!date) return null;
  const n = projectDay(project?.start_date, date);
  const future = date > localToday();
  if (n === null && !future) return null;
  return (
    <span className={`hint${future ? " bad" : ""}`} data-day={n ?? ""}>
      {n !== null && `روز ${n} پروژه`}{n !== null && future && " — "}{future && "هنوز نرسیده؛ تاریخ آینده ثبت نمی‌شود"}
    </span>
  );
}

export function WorkDateScope({ children }) {
  const [on, setOn] = useState(localToday);
  return <Ctx.Provider value={{ on, setOn }}>{children}</Ctx.Provider>;
}

/** The date the buttons below will record. A component outside a scope has no date to give, and says so. */
export function useWorkDate() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWorkDate outside <WorkDateScope>");
  return c.on;
}

export function WorkDateField({ note = "ثبت‌های یک‌کلیکی این صفحه با این تاریخ ثبت می‌شوند — کار دیروز را با تاریخ دیروز ثبت کنید." }) {
  const c = useContext(Ctx);
  if (!c) throw new Error("WorkDateField outside <WorkDateScope>");
  const { project } = usePlatform();
  const [typed, setTyped] = useState(null);
  const today = localToday();
  const start = project?.start_date || null;
  const last = projectDay(start, today);
  const n = typed ?? String(projectDay(start, c.on) ?? "");
  const wanted = /^\d+$/.test(n.trim()) ? Number(n) : null;
  function onDay(v) {
    setTyped(v);
    const k = /^\d+$/.test(v.trim()) ? Number(v) : null;
    if (k !== null && k <= last) c.setOn(dateOfDay(start, k));
  }
  return (
    <div className="workdate no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
      <label htmlFor="work-date" className="sm"><b>تاریخ انجام کار</b></label>
      <input id="work-date" type="date" dir="ltr" value={c.on} max={today} onChange={(e) => { setTyped(null); c.setOn(e.target.value || today); }} />
      {start && last >= 0 && (
        <>
          <label htmlFor="work-day" className="sm">روز پروژه</label>
          <input id="work-day" type="number" inputMode="numeric" dir="ltr" min={0} max={last} style={{ width: 90 }}
                 value={n} onChange={(e) => onDay(e.target.value)} onBlur={() => setTyped(null)}
                 title={`روز 0 = ${start} (تاریخ شروع پروژه) · امروز روز ${last} است`} />
        </>
      )}
      {c.on !== today && <button type="button" className="btn ghost" onClick={() => { setTyped(null); c.setOn(today); }}>امروز</button>}
      {wanted !== null && wanted > last
        ? <span className="err sm" role="alert">روز {wanted} هنوز نرسیده — امروز روز {last} پروژه است (روز 0 = {start}).</span>
        : <span className="muted sm">{note}</span>}
    </div>
  );
}
