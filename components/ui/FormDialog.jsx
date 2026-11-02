"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * One record's form, over the page (the platform's view dialog, components/ui/TableKit.jsx
 * `.tk-view`): the title, the fields, and the actions of its mode —
 *
 *   view    the fields shown, not editable; «ویرایش» (when allowed) and «بستن»
 *   edit    «ذخیره» and «انصراف»
 *   create  «افزودن» and «انصراف»
 *
 * Escape, the ✕ or a click outside close it; a changed form (`dirty`) asks first.
 * The first field takes the focus when it opens.
 */
export default function FormDialog({ title, subtitle = "", mode = "view", dirty = false, canEdit = true, saving = false, error = "",
  onSave, onEdit, onClose, children, width = 680, ...rest }) {
  const box = useRef(null);
  const close = () => { if (dirty && mode !== "view" && !window.confirm("تغییرهای این فرم ذخیره نشده — بسته شود؟")) return; onClose?.(); };
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    (el.querySelector("[data-autofocus]") || el.querySelector("input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled])") || el.querySelector("button"))?.focus();
  }, [mode]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="tk-view mk-form-back" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); close(); } }}>
      <div ref={box} role="dialog" aria-modal="true" aria-label={title} className="mk-form" data-form-mode={mode} style={{ maxWidth: width }} {...rest}>
        <header>
          <b>{title}</b>{subtitle && <span className="muted sm">{subtitle}</span>}
          <span className="pill sm" data-form-mode-label>{mode === "view" ? "مشاهده" : mode === "edit" ? "ویرایش" : "افزودن"}</span>
          <button type="button" aria-label="بستن" onClick={close}>✕</button>
        </header>
        <form className="mk-form-body" onSubmit={(e) => { e.preventDefault(); if (mode !== "view") onSave?.(); }}>
          <fieldset disabled={mode === "view" || saving} className="mk-form-fields">{children}</fieldset>
          {error && <p className="err sm" role="alert" data-form-error>{error}</p>}
          <footer className="mk-form-actions">
            {mode === "view" ? (<>
              {/* distinct keys: the edit button must not become the save button in the click that switches modes */}
              {canEdit && onEdit && <button key="edit" type="button" data-form-edit onClick={onEdit}>ویرایش</button>}
              <button key="close" type="button" className="ghost" data-form-close onClick={close}>بستن</button>
            </>) : (<>
              <button key="save" type="submit" data-form-save disabled={saving}>{mode === "create" ? "افزودن" : "ذخیره"}</button>
              <button key="cancel" type="button" className="ghost" data-form-cancel onClick={close}>انصراف</button>
              {dirty && <span className="pill warn sm" data-form-dirty>تغییرات ذخیره‌نشده</span>}
            </>)}
          </footer>
        </form>
      </div>
    </div>,
    document.body);
}
