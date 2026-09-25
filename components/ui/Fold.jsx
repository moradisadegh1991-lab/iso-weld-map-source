"use client";
import { useState } from "react";

/**
 * A form that opens when it is needed and closes when it is not.
 *
 *   <Fold title="ثبت Punch جدید"><PunchForm … /></Fold>
 *
 * Closed, it is one line saying what it adds; the page shows its records,
 * not a wall of empty fields. The form inside keeps its own heading hidden
 * (the fold's title says it) and its own submit behaviour.
 */
export default function Fold({ title, hint = null, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className={`fold ${open ? "open" : ""}`}>
      <button type="button" className="fold-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="plus" aria-hidden>+</span>
        <span>{title}</span>
        {hint && <span className="hint">{hint}</span>}
        <span className="x">{open ? "بستن" : "باز کردن"}</span>
      </button>
      {open && <div className="fold-body">{children}</div>}
    </section>
  );
}
