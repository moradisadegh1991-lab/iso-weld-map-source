"use client";
import { badgeFor } from "../lib/client/tab-badges.mjs";

/**
 * The navigator for the right-hand pane.
 *
 * It replaced a plain strip of six buttons, and the reason is a real one.
 * On the first live extraction the engine raised exactly one warning — the
 * MTO listed a weld-neck flange that the model had not put in the geometry —
 * and that warning sat inside the اعتبارسنجی tab where nobody would see it
 * without going looking. A drawing that extracts cleanly and a drawing that
 * is quietly missing a component looked identical from here.
 *
 * So each entry carries the number that says whether it is worth opening. The
 * counts are neutral; only a real problem takes the warning colour, because a
 * badge that is always lit is a badge nobody reads.
 */

const TABS = [
  { k: "weld",   label: "سرجوش",       hint: "رجیستر جوش‌ها" },
  { k: "check",  label: "اعتبارسنجی",  hint: "تطابق هندسه با MTO" },
  { k: "line",   label: "Line Data",   hint: "مشخصات خط" },
  { k: "mto",    label: "MTO",         hint: "لیست متریال" },
  { k: "json",   label: "JSON",        hint: "دادهٔ خام و ویرایش" },
  { k: "review", label: "بازبینی",     hint: "ثبت و تأیید" },
];

export default function TabNav({ tab, setTab, model, data }) {
  return (
    <nav className="tabnav" aria-label="بخش‌های رجیستر">
      {TABS.map(({ k, label, hint }) => {
        const badge = badgeFor(k, model, data);
        const on = tab === k;
        return (
          <button
            key={k}
            className={on ? "on" : ""}
            onClick={() => setTab(k)}
            aria-current={on ? "page" : undefined}
            title={hint}
          >
            <span className="tabnav-label">{label}</span>
            {badge && <span className={"tabnav-badge " + badge.tone}>{badge.text}</span>}
            <span className="tabnav-hint">{hint}</span>
          </button>
        );
      })}
    </nav>
  );
}
