"use client";
import { createContext, useContext, useState } from "react";

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
 */
const Ctx = createContext(null);

/** Today in the browser's own time zone — not UTC, which is yesterday before 03:30 in Tehran. */
export function localToday() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
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
  const today = localToday();
  return (
    <div className="workdate no-print" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", margin: "6px 0" }}>
      <label htmlFor="work-date" className="sm"><b>تاریخ انجام کار</b></label>
      <input id="work-date" type="date" dir="ltr" value={c.on} max={today} onChange={(e) => c.setOn(e.target.value || today)} />
      {c.on !== today && <button type="button" className="btn ghost" onClick={() => c.setOn(today)}>امروز</button>}
      <span className="muted sm">{note}</span>
    </div>
  );
}
