"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * A form behind a button at the top of its section.
 *
 *   <Fold title="ثبت Punch جدید"><PunchForm … /></Fold>
 *
 * Wherever a page places it, the button goes to the header row of the card
 * it sits in (beside the card's title), and the form opens directly under
 * that header — not at the bottom of a long table. One form per card is
 * open at a time. Outside a card it stays where it was written.
 *
 * The card's header and form slot are two plain elements this component
 * adds to the card once; React never renders them, so it never tries to
 * reorder or remove them, and the card's own children are left untouched.
 *
 * An edit form opened from a table's «ویرایش» is the same panel without a
 * button of its own: `<Fold title="ویرایش …" open={!!editing} onClose={…}
 * button={false}>` — the page decides when it is open.
 */
const useIso = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function Fold({ title, hint = null, defaultOpen = false, open: shown, onClose, button: withButton = true, children }) {
  const [own, setOwn] = useState(defaultOpen);
  const controlled = shown !== undefined;
  const open = controlled ? !!shown : own;
  const setOpen = (v) => { if (controlled) { if (!v) onClose?.(); } else setOwn(v); };
  const [slots, setSlots] = useState(null);           // { bar, body, card } once mounted in a card
  const anchor = useRef(null);
  const closeRef = useRef(() => {});
  closeRef.current = () => setOpen(false);
  const id = useRef(Math.random().toString(36).slice(2));

  useIso(() => {
    const card = anchor.current?.closest(".card");
    if (!card) return;
    let bar = [...card.children].find((c) => c.classList.contains("card-actions"));
    let body = [...card.children].find((c) => c.classList.contains("card-formslot"));
    if (!bar) {
      bar = document.createElement("div");
      bar.className = "card-actions no-print";
      const head = card.firstElementChild?.tagName === "H2" ? card.firstElementChild : null;
      if (head) head.after(bar); else card.prepend(bar);
      card.dataset.actions = head ? "head" : "nohead";
      body = document.createElement("div");
      body.className = "card-formslot";
      bar.after(body);
    }
    setSlots({ bar, body, card });
    return () => {
      // The last fold of a card takes the card's header and slot with it.
      queueMicrotask(() => {
        if (bar.isConnected && !bar.childElementCount && !body.childElementCount) {
          bar.remove(); body.remove(); delete card.dataset.actions;
        }
      });
    };
  }, []);

  // One open form per card: opening this one closes the others.
  useEffect(() => {
    if (!slots) return;
    const other = (e) => { if (e.detail !== id.current) closeRef.current(); };
    slots.card.addEventListener("fold-open", other);
    return () => slots.card.removeEventListener("fold-open", other);
  }, [slots]);
  useEffect(() => {
    if (!open || !slots) return;
    slots.card.dispatchEvent(new CustomEvent("fold-open", { detail: id.current }));
    slots.body.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [open, slots]);

  const button = (
    <button type="button" className={`fold-btn ${open ? "open" : ""}`} aria-expanded={open} onClick={() => setOpen(!open)}
            aria-label={`${open ? "بستن" : "باز کردن"} فرم ${title}`}
            title={hint || undefined}>
      <span className="plus" aria-hidden>+</span><span>{title}</span>
    </button>
  );
  const panel = open && (
    <section className="fold-panel" aria-label={title}>
      <div className="fold-panel-head">
        <b>{title}</b>{hint && <span className="hint">{hint}</span>}
        <button type="button" className="x" onClick={() => setOpen(false)} aria-label="بستن فرم">✕ بستن</button>
      </div>
      <div className="fold-body">{children}</div>
    </section>
  );

  if (slots) {
    return (
      <>
        <span ref={anchor} hidden />
        {withButton && createPortal(button, slots.bar)}
        {panel && createPortal(panel, slots.body)}
      </>
    );
  }
  // Not (yet) in a card: where the page put it.
  if (!withButton) return open ? <section ref={anchor} className="fold-panel" aria-label={title}>{panel.props.children}</section> : <span ref={anchor} hidden />;
  return (
    <section ref={anchor} className={`fold ${open ? "open" : ""}`}>
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
