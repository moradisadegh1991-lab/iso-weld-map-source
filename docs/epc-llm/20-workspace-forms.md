# 20 — A cleaner workspace: forms for every row, the sheet's layers in the navigator

The owner's request (2026-11-02, from screenshots of the workspace):

1. **The notes above the sheet are gone** — «رجیستر از … شمارهٔ جوش…», «جدول عنوان (OCR…)», the
   style-template block and the red notes under it. The drawing style's template has a tab of its own,
   **«الگوی نقشه»**, opened (it appears for a sheet of another designer's style, as the template did).
2. **«افزودن مستقیم روی نقشه» is gone from the sheet** — a mark is added by right-clicking the sheet
   where it goes. The layer toggles (**نمایش**: welds, spools, supports, equipment, leaders) moved into
   the navigator, «نمایش روی نقشه»; they are a view setting only.
3. **The engineering inspector is removed** (components/workspace/Inspector.jsx deleted). What it
   showed is the mark's form in view mode.
4. **Tables only show.** The weld, spool, support and equipment tables have no fields any more; each
   row has «مشاهده» and «ویرایش», and «+» adds one. All three open **one form**
   (components/MarkForm.jsx in components/ui/FormDialog.jsx), the same form the sheet's right-click
   «مشاهدهٔ مشخصات», «ویرایش مشخصات» and «افزودن … همین‌جا» open:
   - **view**: every field shown, not editable; «ویرایش» switches to edit;
   - **edit / add**: the same pickers as before — the project's lists, the sheet's BOM rows (a row with
     no welded end left is not offered), the sheet's spools and weld numbers, accessories — on a draft;
     nothing reaches the sheet until «ذخیره»/«افزودن»; «انصراف», Escape or a click outside drop it
     (asking first when something changed). A number already used by that class is refused.
   - added from the sheet: placed where it was clicked; added from a table: the sheet then waits for
     its place, as before. An approved register opens the form in view only.

   Joining a row to the drawing, taking it off and deleting it stay the row's own buttons; the review
   tick of a weld stays in its row. The BOM table on the BOM tab is unchanged (its cells are the BOM read
   off the sheet, checked against the drawing in place).

The same holds on the model route's workspace (app/piping/page.jsx).

## BOM table (follow-up)

The BOM table of the sheet is now display-only too: «مشاهده» / «ویرایش» per row and
«+ ردیف BOM» open `components/BomForm.jsx` (same `FormDialog`). PT is required and unique;
nothing reaches the sheet until «ذخیره»/«افزودن». The allocation column (reserved/capacity) stays read-only.

## Tie-in picked, and the cut table as a form

- **Tie-in** (`components/TieInPick.jsx`, `lib/sheet/tie-in.mjs`, `GET /api/tie-in-targets`): the weld form picks
  the isometric («همین برگ» or another drawing of the project), its sheet and the weld; the reference is kept in
  `attrs.ref` as `ISO | sheet | weld` (a plain weld number is this sheet's; «متن آزاد» keeps an external note
  as typed). It is a stored reference, not yet a live link: renaming the target does not rewrite it.
- **Cut table** (`components/CutForm.jsx`): display-only with «مشاهده / ویرایش / حذف» per piece and «+ ثبت قطعه».
  Fields: piece number (unique), length mm (> 0), N.S., spool (from the sheet's spools), cut angle, note.
  Saved with the register's `cutLengths`; the cut-vs-BOM check recomputes from the edited pieces.
