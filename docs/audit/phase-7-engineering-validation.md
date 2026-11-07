# Phase 7 — Engineering Validation & Reconciliation Center

Branch `feat/engineering-validation-center`, from `master` at `e405a16` (Phases 1–6 merged). Working tree clean at the start.

## 0. Evidence about the Phase 6 «pending Vercel checks»
Read from GitHub with `gh api` (not assumed):
* PR #80 head `420e150`: combined status **success**, four Vercel statuses (`iso-weld-map-source`, `-acai`, `-gemini-relay`, `-petd`), each «Deployment has completed».
* Master merge commit `e405a16`: the same four Vercel statuses are **success** (09:33–09:36 UTC); check runs `build`, `eval`, `pg-scope` completed **success**; `data-layer` of the master push run was **still in progress** when this was written (re-checked at the end of the phase, see the results section).
So nothing is «pending» on Vercel; the only open item at that moment was `data-layer` of the push run.

## 1. Existing validation, as found

| where | what | server? | structured? |
|---|---|---|---|
| `lib/register/weld-list.mjs` `modelFromWeldList` | per row: number missing/duplicate, location not Shop/Field, joint type, NPS, shop weld without spool → `problems` (Persian strings); the **save refuses** a list with problems (400) | yes (`POST /api/runs`) | no (strings «ردیف N: …») |
| `lib/sheet/markup.mjs` `problems`, `rules`, `componentChecks`, `equipmentChecks` | duplicate/missing numbers, spool/support rules, weld components vs BOM, equipment vs BOM/welds/spool/accessories | no (client) | no (strings; some are uid-less) |
| `lib/register/bom-allocation.mjs` `usage`, `canTake`, `allocationChecks`, `pieceDemands`, `ledgerDemands` | live use of each BOM row's welded ends and pieces; over-allocation text | the **rules** are shared; the **ceiling** is the DB trigger | no |
| `lib/register/bom-table.mjs` `rowIssues`, `decorate`, `deleteCheck` | BOM row checks, saved-ledger overlay | client | partly |
| `lib/register/cut-model.mjs`, `cut-bom.mjs` | cut table vs sheet, vs BOM | no | no |
| `lib/register/workspace-validation.mjs` (Phase 3) + `ValidationPanel.jsx` | one **list of strings** from all of the above, grouped by source; a link only when the text starts «سرجوش N:» | no | `{ source, level, message, ref }` |
| `lib/register/mark-protection.mjs` | delete preview (saved equipment/allocations/approved) | advice only | reasons |
| server-side refusals | `BOM_LOCKED`, `BOM_IN_USE`, `BOM_ALLOCATION` (capacity trigger, installed lines), `EQUIPMENT` (installed/tested), `EQUIPMENT_WELD_MISSING`, `MARK_IDENTITY_AMBIGUOUS`, `MARK_UID_CONFLICT`, `RUN_LOCKED`, `RUN_NOT_CURRENT`, `STALE_RUN` | yes | error codes |

**Warning storage and resolution.** `sheet_mark_warning` (migration 105; `kind IN ('ambiguous','removed')`, `detail jsonb`, `resolved_at/by`, `resolution`) is written by `recordMarkWarnings` (identity ambiguity) and, since Phase 6, `recordEquipmentWeldWarnings` (legacy equipment → weld). `markWarnings` reads them and `resolveMarkWarning` closes one with a required note. **There is no route and no screen for either**: warnings are written and never seen.

**Revision and approval protections (relied on, not changed).** An approved run is locked (`RUN_LOCKED`, DB trigger); BOM of an approved revision is `BOM_LOCKED`; dependents belong to the revision's **current** run (`RUN_NOT_CURRENT`); a uid belongs to one drawing revision (`MARK_UID_CONFLICT`); corrections can name the state they were made against (`STALE_RUN`).

## 2. Gaps (what is genuinely missing)
1. The checks are strings without an entity identity, a code, a category, a revision or a source; a finding cannot be navigated to its mark or row by uid, nor filtered, nor counted by category.
2. **No view of the saved ledger/equipment against the draft** (preview vs saved vs installed vs available are never shown side by side).
3. Rules that exist nowhere: duplicate persistent uid; typed weld without uid; a weld naming a PT that is not in the BOM (only a *snapshot* difference is reported); BOM row deleted/shrunk while the saved ledger holds it (only found by the server's refusal at save); installed line whose owner disappeared; dangling equipment→weld uid; ambiguous legacy number; unlinked sheet weld marks (Phase 6 deferred); duplicate representation; saved ledger over capacity; installed/tested equipment whose mark is gone; BOM unit validity; weldable row without size.
4. No screen for `sheet_mark_warning`.
5. The Validation tab exists only in the typed workspace (`WeldListEntry`); the model route has none (left as it is, stated).

## 3. Architecture

### 3.1 One engine, one structure — `lib/engineering/validation.mjs` (pure)
`validate(ctx)` returns findings in one shape: `{ id, code, category, severity, entityType, entityUid, entityNumber, title, message, suggestedAction, source, revision, resolved, blocking, … }` with categories `identity · geometry · weld · bom · allocation · equipment · spool · support · revision · data-integrity`. `id` is deterministic (`code:entityUid:detail`) so a refresh keeps selection and a resolved/unresolved comparison is possible. `entityUid` is always the persistent uid when one exists; the printed number is `entityNumber` (display).
It is **not** another data source. Its input is exactly what already exists:
* the payload (`weldList`, `sheetMarkup.items`, `bom`, `cutLengths`) through `projectWelds` (Phase 6) — typed rows and sheet marks each once;
* the saved state: `listEquipment`, `availability` (+ lines), `markWarnings` — the same repository functions the existing routes use;
* the revision (`document`, run status).
It **reuses** the existing rules instead of re-writing them: `modelFromWeldList` (made to also return structured row problems, strings unchanged), `rowIssues`/`rowCapacity` (BOM), `usage`/`ledgerDemands`/`pieceDemands` (capacity and demand), `equipmentWelds` (links), `cutChecks`/`cutVsBom` (cut table). The old string functions stay for the inline table notes; the Center stops using them as its source.
The engine runs **in the page** (draft, live preview — labelled as such) and **on the server** (saved state — authoritative): same code, different input, a `source` on every finding says which.

### 3.2 Server API (read-only, one new route + the warning pair)
* `GET /api/validation?projectId&documentId` — authenticated (`VIEW_PROJECT`), project/revision-scoped; loads the revision's latest valid run, saved equipment, ledger (rows + lines) and warnings in a **fixed number of queries** (no per-entity queries) and returns `{ revision, findings, summary, payloadHash, generatedAt }`. Nothing is cached or stored: a result table has no demonstrated need (the result is cheap and always derivable).
* `GET /api/mark-warnings?projectId&documentId` (read, history included) and `POST /api/mark-warnings` `{ projectId, warningId, resolution }` — `EDIT_EXTRACTION`; refuses on an approved revision; **the server verifies that the relationship has actually been established** before it closes a warning (below); the warning's `detail` and creation are never touched — only `resolved_at/by/resolution` are set (existing `resolveMarkWarning`), so the evidence stays.

### 3.3 Resolution = an action the user performs with the existing forms
The Center offers *navigation to the place where the user fixes it* (the weld form, the equipment form, the BOM row form, the mark on the drawing). Nothing is repaired automatically. After a save, the Center re-validates; a finding that no longer holds disappears (it is a computed finding), and a warning is closed only through the explicit «حل شد» action, which the server accepts only if:
* `equipment_weld` warning: in the saved revision the equipment no longer names that legacy number (the number is not left unresolved or ambiguous) and it is joined to at least one weld **by uid** — i.e. the person made the choice in the equipment form and saved;
* identity `ambiguous` warning: nothing hangs on the previous identities any more (no equipment, no installed/reserved allocation, no link) — then the note is recorded as the acknowledgement; if something does hang on them it stays open.

### 3.4 Unlinked sheet weld marks (Phase 6 deferred)
`projectWelds` already reports them. Today the typed workspace **drops** them silently at the next save (it keeps only spool/support/equipment). They are kept: the workspace carries them untouched in `sheetMarkup.items`, shows them on the drawing and in the weld table as marks that are not register rows (never converted into rows, never matched by number or position), and lists each as a finding with its uid, number, attributes and the reason.

### 3.5 Not changed
Extraction, geometry, uid contracts, migrations 104/105, constraints, revision protections, installed allocations and history. **No migration** is planned: warnings keep their table; findings are computed.

## 4. Plan
1. This document. 2. Structured row problems in `weld-list.mjs`. 3. The engine + catalog + tests. 4. Routes. 5. UI (Validation tab → Center, unlinked marks). 6. Tests, browser drive, results.

## 5. Rule catalog (generated from `lib/engineering/validation.mjs` `CATALOG`; 64 codes)
`blocking` is set on a finding only when the server would **refuse** the save/approval for that very reason (found early). Everything else is advice.

| Code | Category | Severity | Meaning | Fix via |
|---|---|---|---|---|
| `ID_NO_UID` | identity | warning | ردیف تایپ‌شده شناسهٔ پایدار ندارد | ویرایش سرجوش |
| `ID_DUP_UID` | identity | error | یک شناسهٔ پایدار روی بیش از یک نشان/ردیف است | ویرایش سرجوش |
| `ID_WARNING` | identity | warning | هشدار هویت حل‌نشده (تطبیق نشانه‌ها مبهم بود) | تاریخچهٔ هشدارها |
| `W_NO_NUMBER` | weld | error | شمارهٔ جوش خالی است | ویرایش سرجوش |
| `W_DUP_NUMBER` | weld | error | شمارهٔ جوش تکراری است | ویرایش سرجوش |
| `W_BAD_LOC` | weld | error | محل جوش کارگاه/سایت نیست | ویرایش سرجوش |
| `W_NO_KIND` | weld | error | نوع جوش خالی است | ویرایش سرجوش |
| `W_NO_NPS` | weld | error | قطر جوش مشخص نیست | ویرایش سرجوش |
| `W_SHOP_NO_SPOOL` | weld | error | جوش کارگاهی اسپول ندارد | ویرایش سرجوش |
| `W_NO_COMPONENT` | weld | info | برای این سرجوش قطعهٔ BOM انتخاب نشده (چیزی رزرو نمی‌کند) | ویرایش سرجوش |
| `W_ONE_COMPONENT` | weld | info | فقط یک قطعهٔ BOM برای این سرجوش انتخاب شده | ویرایش سرجوش |
| `W_PT_MISSING` | weld | error | سرجوش PT‌ای را نام برده که در BOM این رویژن نیست | ویرایش سرجوش |
| `W_PT_CHANGED` | weld | warning | ردیف BOM از وقتی انتخاب شد عوض شده | ویرایش سرجوش |
| `W_SIZE_MISMATCH` | weld | warning | قطر سرجوش با قطر قطعه نمی‌خواند | ویرایش سرجوش |
| `W_UNLINKED` | weld | warning | نشان سرجوش روی نقشه به هیچ ردیف لیست جوش وصل نیست | نمایش روی نقشه |
| `W_DUP_REPRESENTATION` | allocation | info | همین سرجوش هم ردیف لیست است هم نشان روی نقشه؛ یک بار شمرده می‌شود | نمایش روی نقشه |
| `G_NOT_PLACED` | geometry | info | این سرجوش هنوز روی نقشه جا ندارد | نمایش روی نقشه |
| `G_MARK_NOT_PLACED` | geometry | info | این نشان هنوز روی نقشه جا ندارد | نمایش روی نقشه |
| `B_NO_PT` | bom | error | ردیف BOM شمارهٔ PT ندارد | ویرایش ردیف BOM |
| `B_DUP_PT` | bom | error | شمارهٔ PT در BOM تکراری است | ویرایش ردیف BOM |
| `B_NO_DESC` | bom | warning | ردیف BOM شرح ندارد | ویرایش ردیف BOM |
| `B_QTY_UNREAD` | bom | warning | تعداد ردیف BOM خوانده نشده | ویرایش ردیف BOM |
| `B_QTY_INVALID` | bom | error | تعداد ردیف BOM عدد ≥ ۰ نیست | ویرایش ردیف BOM |
| `B_BAD_UNIT` | bom | error | واحد ردیف BOM نه عدد است نه متر | ویرایش ردیف BOM |
| `B_NO_SIZE` | bom | warning | ردیف جوشی‌شدنی BOM قطر (N.S.) ندارد | ویرایش ردیف BOM |
| `A_OVER_CAPACITY` | allocation | error | سرجوش‌ها بیش از سرهای جوشی‌شدنی این PT از آن خواسته‌اند (پیش‌نمایش صفحه) | ویرایش سرجوش |
| `A_PREVIEW_DIFF` | allocation | info | پیش‌نمایش صفحه با تخصیص ذخیره‌شدهٔ سرور فرق دارد | ذخیرهٔ رجیستر |
| `A_SAVED_OVER` | allocation | error | تخصیص ذخیره‌شده از ظرفیت ردیف بیشتر است (سرور) | دفتر تخصیص BOM |
| `A_INSTALLED_OVER` | allocation | error | مقدار نصب‌شده از ظرفیت ردیف بیشتر است (سرور) | دفتر تخصیص BOM |
| `A_ROW_HELD` | allocation | info | این ردیف BOM تخصیص فعال دارد | ویرایش ردیف BOM |
| `A_ROW_GONE` | allocation | error | ردیف BOM حذف شده ولی هنوز در دفتر تخصیص نگه داشته شده | ویرایش ردیف BOM |
| `A_ROW_SHRUNK` | allocation | error | ظرفیت جدید ردیف BOM از تخصیص ثبت‌شده کمتر است | ویرایش ردیف BOM |
| `A_INSTALLED_OWNER_GONE` | allocation | error | خط نصب‌شده صاحبی ندارد (سرجوش/تجهیز حذف شده) | دفتر تخصیص BOM |
| `A_DUP_LINE` | data-integrity | error | خط تخصیص فعال تکراری برای یک صاحب و یک PT | دفتر تخصیص BOM |
| `E_NO_UID` | equipment | warning | تجهیز شناسهٔ پایدار ندارد | ویرایش تجهیز |
| `E_DUP_ID` | equipment | error | شناسهٔ تجهیز تکراری است | ویرایش تجهیز |
| `E_NO_TAG` | equipment | info | تجهیز تگ ندارد | ویرایش تجهیز |
| `E_NO_TYPE` | equipment | info | نوع تجهیز مشخص نیست | ویرایش تجهیز |
| `E_NO_PT` | equipment | warning | ردیف BOM تجهیز انتخاب نشده | ویرایش تجهیز |
| `E_BAD_PT` | equipment | error | ردیف BOM تجهیز در BOM این رویژن نیست | ویرایش تجهیز |
| `E_NO_WELD` | equipment | warning | تجهیز به هیچ سرجوشی وصل نیست | ویرایش تجهیز |
| `E_WELD_DANGLING` | equipment | error | تجهیز به سرجوشی وصل است که روی برگ نیست | ویرایش تجهیز |
| `E_WELD_AMBIGUOUS` | equipment | warning | شمارهٔ قدیمی سرجوش نام چند سرجوش است | ویرایش تجهیز |
| `E_WELD_UNKNOWN_NO` | equipment | warning | شمارهٔ قدیمی سرجوش روی برگ نیست | ویرایش تجهیز |
| `E_WELD_DUP_REF` | equipment | info | یک سرجوش چند بار در فهرست اتصال تجهیز آمده | ویرایش تجهیز |
| `E_NO_ACC` | equipment | info | تجهیز متعلقاتی ندارد | ویرایش تجهیز |
| `E_ACC_PT` | equipment | warning | متعلق تجهیز ردیفی از BOM نیست | ویرایش تجهیز |
| `E_ACC_QTY` | equipment | error | تجهیزات و متعلقات بیش از تعداد BOM می‌خواهند | ویرایش تجهیز |
| `E_STATE_SOURCE` | equipment | error | تجهیز نصب/تست‌شده در دفتر هست ولی نشانش روی برگ نیست | ویرایش تجهیز |
| `E_STATE_DRIFT` | equipment | info | وضعیت تجهیز در پیش‌نویس با وضعیت ذخیره‌شده فرق دارد | ویرایش تجهیز |
| `E_LEGACY_WARNING` | equipment | warning | پیوند قدیمی تجهیز به سرجوش حل‌نشده (هشدار ثبت‌شده) | تاریخچهٔ هشدارها |
| `SP_NO_NUMBER` | spool | error | نشان اسپول شماره ندارد | ویرایش اسپول |
| `SP_DUP` | spool | error | شمارهٔ اسپول تکراری است | ویرایش اسپول |
| `SP_WELD_UNKNOWN` | spool | warning | سرجوش اسپولی را نام برده که نشانش روی برگ نیست | ویرایش سرجوش |
| `SP_SHOP_NONE` | spool | warning | سرجوش کارگاهی اسپول ندارد | ویرایش سرجوش |
| `SP_EMPTY` | spool | info | اسپول روی برگ هست ولی هیچ سرجوشی در آن نیست | ویرایش اسپول |
| `SP_EQUIPMENT_UNKNOWN` | spool | warning | تجهیز اسپولی را نام برده که روی برگ نیست | ویرایش تجهیز |
| `SUP_NO_NUMBER` | support | error | نشان ساپورت شماره ندارد | ویرایش ساپورت |
| `SUP_DUP` | support | error | شمارهٔ ساپورت تکراری است | ویرایش ساپورت |
| `SUP_NO_TYPE` | support | warning | نوع ساپورت مشخص نیست | ویرایش ساپورت |
| `REV_APPROVED` | revision | info | رجیستر این رویژن تأیید شده؛ تغییر با رویژن جدید است | ثبت رویژن جدید |
| `REV_UNSAVED` | revision | info | این برگ هنوز ذخیره نشده؛ بررسی‌های وابسته به سرور اجرا نشد | ذخیرهٔ رجیستر |
| `DI_CUT` | data-integrity | warning | جدول برش با برگ ناسازگار است | ویرایش جدول برش |
| `DI_CUT_BOM` | data-integrity | warning | جدول برش با BOM ناسازگار است | ویرایش ردیف BOM |

Severity may be lowered per finding (e.g. a duplicate printed number on a sheet-only list is a *warning*, on a typed list — which the register refuses — an *error*). Finding ids are deterministic (`code:uid:detail`).

## 6. What was built
* **Engine** `lib/engineering/validation.mjs` (pure; runs in the page on the draft and on the server on the saved state). Reuses `modelFromWeldList` (now also returns structured `rowProblems`, strings unchanged), `rowIssueCodes` (`lib/register/bom-table.mjs`, `rowIssues` unchanged), `usage/pieceUsage/ledgerDemands/rowCapacity`, `equipmentWelds`, `cutChecks/cutVsBom`, `projectWelds`.
* **Server** `lib/db/repos/validation.mjs` + `GET /api/validation` (read-only; `VIEW_PROJECT`; fixed queries: document, latest run, equipment, ledger rows+lines, warnings; returns `{revision, findings, summary, saved, payloadHash, generatedAt}` — `saved` lets the page run the same engine on the draft against the server's ledger) and `GET/POST /api/mark-warnings` (`EDIT_EXTRACTION`; `RUN_LOCKED` on an approved revision, `STALE_RUN` against `baseHash`, `WARNING_NOT_RESOLVABLE` until the relationship exists, `ALREADY_RESOLVED`, revision-boundary 404). `markWarnings` now also returns `resolved_by`. **No migration.**
* **UI** `components/ValidationPanel.jsx` (Reconciliation Center) in the existing Validation tab: summary (total / errors / warnings / info / resolved / blocking), table (severity, category, entity, identifier, description, suggested action, status), search, category / severity / status filters, sort, group by category / entity, refresh, **draft vs saved** source toggle (labelled preview vs server), details pane (explanation, entity, UID, revision, source, BOM/ledger numbers, stored resolution), navigation to the existing weld / equipment / BOM-row forms, the drawing, the ledger tab, cut and save tabs; warning resolution with a mandatory note. Selecting a finding selects its mark (same selection as the drawing and tables); picking a mark highlights its findings. `lib/client/validation-center.mjs` holds the data hook.
* **Unlinked sheet weld marks** are no longer dropped by the typed workspace: they are kept untouched in `sheetMarkup.items`, drawn (red) on the sheet, listed as `W_UNLINKED` with uid / number / attributes, and never converted into rows, matched by number/position or deleted by a save. A person may still move or delete one on the drawing (their own action).
* `lib/register/workspace-validation.mjs` (Phase 3 string list) is superseded; kept only for its tests.

## 7. Deliberately not done / risks
* The model route (`app/piping/page.jsx`, no typed list) has no Validation tab; the Center lives in the typed workspace, where the findings' forms exist.
* Placement is only flagged when *some* welds are placed (the register does not require placement); a stricter "required placement" rule would be a policy decision for the owner.
* The identity-ambiguity warning is closed only when nothing hangs on the previous identities; it has no "pick which old mark became which" action (that would be identity guessing).
* Preview-vs-saved (`A_PREVIEW_DIFF`) is informational: the draft is a preview, the server's ledger is authoritative, and a save aligns them.
* Findings are computed on request, not stored (no result table, no cache): there is no invalidation problem to get wrong; cost is one read-only request.
* Disk note for the session: the container's writable allowance was nearly exhausted by earlier test scratch directories; the shared scratch sweep was not performed.
