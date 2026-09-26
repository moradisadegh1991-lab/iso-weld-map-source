"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The parts of one page, one at a time.
 *
 *   <Tabs name="hse">
 *     <div className="card"><h2>مجوز کار</h2>…</div>
 *     <div className="card" data-badge={3} data-tone="bad"><h2>رویدادها</h2>…</div>
 *   </Tabs>
 *
 * Each card directly inside is a tab, titled by its <h2> (or its
 * `data-tab-title`); anything else inside — a warning, a note, a card
 * marked `data-keep` — stays in view above whichever tab is open. Like TableKit, it works on what the
 * page rendered, so a page keeps its cards exactly as they were and a
 * component that renders several cards gives several tabs.
 *
 * The open tab is in the address (#مجوز-کار), so a link, a reload or the
 * back button lands on the same part. The other cards are only hidden, so a
 * half-filled form survives a look at another tab. One card: no tab bar.
 */
export default function Tabs({ name = "tabs", children }) {
  const box = useRef(null);
  const [tabs, setTabs] = useState([]);
  const [active, setActive] = useState(null);
  const current = tabs.some((t) => t.key === active) ? active : tabs[0]?.key;

  const scan = useCallback(() => {
    const el = box.current;
    if (!el) return;
    const cards = [...el.children].filter((c) => c.classList.contains("card") && !("keep" in c.dataset));
    const next = cards.map((c, i) => {
      const h = c.querySelector("h2");
      const title = c.dataset.tabTitle || (h ? h.textContent.replace(/\s+/g, " ").trim() : "") || `بخش ${i + 1}`;
      return { key: c.dataset.tab || keyOf(title), title, badge: Number(c.dataset.badge) || 0, tone: c.dataset.tone || "", el: c };
    });
    setTabs((prev) => (prev.length === next.length && prev.every((p, i) => p.key === next[i].key && p.title === next[i].title
      && p.badge === next[i].badge && p.tone === next[i].tone && p.el === next[i].el) ? prev : next));
  }, []);

  useEffect(() => {
    scan();
    let frame = 0;
    const obs = new MutationObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(scan); });
    obs.observe(box.current, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-badge", "data-tone", "data-tab-title"] });
    return () => { cancelAnimationFrame(frame); obs.disconnect(); };
  }, [scan]);

  // The address names the tab.
  useEffect(() => {
    const fromHash = () => setActive(decodeURIComponent(window.location.hash.slice(1)) || null);
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  useEffect(() => {
    for (const t of tabs) {
      if (tabs.length < 2) delete t.el.dataset.tabHidden;
      else if (t.key === current) delete t.el.dataset.tabHidden;
      else t.el.dataset.tabHidden = "";
      t.el.id ||= `${name}-panel-${t.key}`;
      t.el.setAttribute("role", tabs.length > 1 ? "tabpanel" : "region");
    }
  }, [tabs, current, name]);

  function open(k) {
    setActive(k);
    try { window.history.replaceState(window.history.state, "", `#${encodeURIComponent(k)}`); } catch { /* sandboxed */ }
  }
  function onKey(e) {
    const keys = tabs.map((t) => t.key);
    const i = keys.indexOf(current);
    // RTL: the next tab is to the left.
    const step = e.key === "ArrowLeft" ? 1 : e.key === "ArrowRight" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const k = keys[(i + step + keys.length) % keys.length];
    open(k);
    box.current?.parentElement?.querySelector(`[data-tabkey="${CSS.escape(k)}"]`)?.focus();
  }

  return (
    <div className="ptabs-wrap">
      {tabs.length > 1 && (
        <div className="ptabs no-print" role="tablist" aria-label={name} onKeyDown={onKey}>
          {tabs.map((t) => (
            <button key={t.key} data-tabkey={t.key} type="button" role="tab" aria-selected={t.key === current}
                    aria-controls={t.el.id || undefined} tabIndex={t.key === current ? 0 : -1} onClick={() => open(t.key)}>
              {t.title}
              {t.badge ? <span className={`badge ${t.tone}`}>{t.badge.toLocaleString("fa-IR")}</span> : null}
            </button>
          ))}
        </div>
      )}
      <div className="ptab-panel" ref={box}>{children}</div>
    </div>
  );
}

// A heading's own count ("رویدادها (۳)") is not part of its address.
const keyOf = (title) => title.replace(/[(（][^)）]*[)）]/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "tab";
