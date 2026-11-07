"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * The delete confirmation, in the page (a native alert can neither be styled nor looked at later):
 *   blocked   the item cannot be deleted — says exactly why and which authorised workflow clears it; only «بستن»
 *   confirm   the item can be deleted — lists what still refers to it (nothing is deleted with it); «حذف» / «انصراف»
 * The server stays the authority: this is the advice given before the request, not the rule.
 *
 *   const [ask, dialog] = useConfirm();   …   if (!(await ask({ title, lines, blocked }))) return;   …   {dialog}
 */
export function useConfirm() {
  const [st, set] = useState(null);
  const ask = (o) => new Promise((res) => set({ ...o, res }));
  const done = (v) => { st?.res(v); set(null); };
  return [ask, st ? <ConfirmDialog {...st} onDone={done} /> : null];
}

/**
 * The whole delete question for one mark: refused (with the reasons and the authorised way) → false; otherwise the dependants are listed and
 * the person confirms or not. `pr` is the saved-state advice (lib/register/mark-protection.mjs), `deps` what else on the sheet refers to it.
 */
export async function askDelete(ask, { label, no, pr, deps = [] }) {
  const name = `${label} ${no || ""}`.trim();
  if (pr?.blocked) { await ask({ title: `${name} حذف نمی‌شود`, lines: pr.reasons, blocked: true }); return false; }
  const lines = [...(pr?.reasons || []), ...deps];
  return ask({ title: `${name} حذف شود؟`, lines: lines.length ? ["این‌ها هنوز به آن ارجاع می‌دهند و همان‌طور می‌مانند (نیمه‌کاره حذف نمی‌شود):", ...lines.slice(0, 12), ...(lines.length > 12 ? ["…"] : [])] : ["فقط همین نشان حذف می‌شود؛ چیز دیگری به آن وابسته نیست."] });
}

export default function ConfirmDialog({ title, lines = [], blocked = false, confirmLabel = "حذف", onDone }) {
  const box = useRef(null);
  useEffect(() => { box.current?.querySelector("button")?.focus(); }, []);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="tk-view mk-form-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onDone(false); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onDone(false); } }}>
      <div ref={box} role="alertdialog" aria-modal="true" aria-label={title} className="mk-form" style={{ maxWidth: 520 }} data-confirm={blocked ? "blocked" : "confirm"}>
        <header><b>{title}</b><span className={`pill sm ${blocked ? "warn" : ""}`}>{blocked ? "حذف نمی‌شود" : "تأیید حذف"}</span></header>
        <div className="mk-form-body">
          {lines.length > 0 && (
            <ul className="sm" data-confirm-lines style={{ margin: "6px 0", paddingInlineStart: 18 }}>
              {lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>)}
          <footer className="mk-form-actions">
            {blocked
              ? <button type="button" className="ghost" data-confirm-close onClick={() => onDone(false)}>بستن</button>
              : (<>
                <button type="button" data-confirm-yes onClick={() => onDone(true)}>{confirmLabel}</button>
                <button type="button" className="ghost" data-confirm-no onClick={() => onDone(false)}>انصراف</button>
              </>)}
          </footer>
        </div>
      </div>
    </div>,
    document.body);
}
