"use client";
import { useRef, useState } from "react";

/**
 * The tabs of the workspace's data panel. Every panel stays mounted and the
 * inactive ones are hidden, so what a section holds (a form half filled, a
 * check already run) survives switching tabs — unmounting them would reset
 * their state and re-run their effects.
 *
 *   tabs   [{ k, label, badge?, tone?, hint?, node }]  badge: a short count; tone: "warn" | "bad" | "ok" | undefined
 *   value, onChange   controlled; or leave them out and the tabs keep their own
 *
 * Arrow keys, Home and End move between tabs (the ARIA tabs pattern).
 */
export default function WorkspaceTabs({ tabs, value, onChange, label = "بخش‌های داده" }) {
  const [own, setOwn] = useState(tabs[0]?.k);
  const cur = value ?? own;
  const set = (k) => { (onChange || setOwn)(k); };
  const list = useRef(null);
  const onKey = (e) => {
    const i = tabs.findIndex((t) => t.k === cur);
    const rtl = getComputedStyle(list.current).direction === "rtl";
    const next = e.key === "Home" ? 0 : e.key === "End" ? tabs.length - 1
      : e.key === (rtl ? "ArrowLeft" : "ArrowRight") ? (i + 1) % tabs.length
      : e.key === (rtl ? "ArrowRight" : "ArrowLeft") ? (i - 1 + tabs.length) % tabs.length : null;
    if (next == null) return;
    e.preventDefault();
    set(tabs[next].k);
    list.current.querySelectorAll("[role=tab]")[next]?.focus();
  };
  return (
    <div className="wstabs" data-ws-tabs>
      <div className="wstabs-list" role="tablist" aria-label={label} ref={list} onKeyDown={onKey}>
        {tabs.map((t) => (
          <button key={t.k} type="button" role="tab" id={`wst-${t.k}`} aria-selected={cur === t.k} aria-controls={`wsp-${t.k}`}
            tabIndex={cur === t.k ? 0 : -1} className={cur === t.k ? "on" : ""} title={t.hint} data-ws-tab={t.k} onClick={() => set(t.k)}>
            {t.label}
            {t.badge != null && t.badge !== "" && <span className={`wstabs-badge ${t.tone || ""}`}>{t.badge}</span>}
          </button>))}
      </div>
      {tabs.map((t) => (
        <div key={t.k} role="tabpanel" id={`wsp-${t.k}`} aria-labelledby={`wst-${t.k}`} hidden={cur !== t.k} className="wstabs-panel" data-ws-panel-of={t.k}>
          {t.node}
        </div>))}
    </div>
  );
}
