/**
 * Browser evidence for Phase 5 (docs/audit/phase-5-engineering-crud.md): drives the real typed-weld-list workspace of a SAVED run.
 *   DRIVE_URL=… DRIVE_EMAIL=… DRIVE_PASSWORD=… DRIVE_SHOTS=… node tools/drive-engineering-crud.mjs [sheet.pdf]
 * It creates a document and a run through the page's own authenticated session (the same routes the UI uses) with a weld list, a spool, a
 * support and an INSTALLED piece of equipment, opens it from the review queue, and exercises the right-click menu, the forms, the delete
 * protection preview and the table/drawing synchronisation, in both themes and at a narrow width. Needs a running server and an account.
 */
import { openWorkspace, tab } from "./drive-lib.mjs";
import { readFileSync } from "node:fs";

const pdf = process.argv[2] || "/root/.claude/uploads/9965cb1b-55f5-5165-aadc-93103c66b847/250abb3f-25-1029-SH1-0.pdf";
const { page, b, errs, dialogs, shot, url } = await openWorkspace({});
const out = { checks: {} };
// the theme is a stored preference: set it explicitly rather than assume where it starts
const setTheme = async (want) => {
  for (let i = 0; i < 2; i++) {
    const cur = await page.evaluate(() => document.documentElement.getAttribute("data-theme") || "dark");
    if (cur === want) return;
    await page.locator("button[aria-label*='theme' i], .topbar button:has-text('☀'), .topbar button:has-text('☾')").first().click();
    await page.waitForTimeout(500);
  }
};
const ok = (k, v) => { out.checks[k] = v; };
const UID = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

// 1. a saved run with a weld list, a spool, a support and an installed piece of equipment
const b64 = readFileSync(pdf).toString("base64");
const made = await page.evaluate(async (b64) => {
  const pj = await (await fetch("/api/projects", { credentials: "same-origin" })).json();
  const projectId = (pj.projects || [])[0]?.id;
  const call = async (u, body) => (await fetch(u, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const d = await call("/api/documents", { projectId, docNo: `CRUD-${Date.now()}`, revision: "0", fileBase64: b64, contentType: "application/pdf" });
  const uid = () => crypto.randomUUID();
  const rows = ["1", "2", "3"].map((no, i) => ({ no, spool: "SP-1", loc: i === 2 ? "Field" : "Shop", kind: "BW", nps: "4", uid: uid() }));
  const items = [
    { id: "m1", uid: uid(), kind: "spool", no: "SP-1", x: 0.3, y: 0.3, src: "hand" },
    { id: "m2", uid: uid(), kind: "support", no: "S-1", x: 0.5, y: 0.35, src: "hand", attrs: { type: "REST" } },
    { id: "m3", uid: uid(), kind: "equipment", no: "V-1", x: 0.6, y: 0.5, src: "hand", attrs: { tag: "XV-100", type: "valve", status: "installed" } },
  ];
  const byUid = Object.fromEntries(rows.map((r, i) => [r.uid, { x: 0.15 + i * 0.12, y: 0.55, src: "hand" }]));
  const r = await call("/api/runs", { projectId, documentId: d.document.id, lineNo: "CRUD-L1", payload: {
    meta: { drawingNo: "CRUD-X", rev: "0", sheet: "1/1", lineNo: "CRUD-L1", nps: 4 }, weldList: rows, weldMarkup: { page: 1, marks: {}, byUid }, sheetMarkup: { page: 1, items } } });
  return { projectId, runId: r.run?.id, err: r.error, status: r.status };
}, b64);
out.made = made;
if (!made.runId) { console.log(JSON.stringify(out, null, 1)); await b.close(); process.exit(1); }

// 2. open it from the review queue
await page.goto(`${url}/piping`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.locator("button:has-text('باز کردن')").first().click().catch(() => {});
await page.waitForSelector("[data-sheet-markup]", { timeout: 60000 }).catch(() => {});
await page.waitForTimeout(1500);
ok("workspaceOpen", await page.locator("[data-sheet-markup]").count() === 1);
const refsOf = () => page.locator("[data-mark-id]").evaluateAll((e) => e.map((x) => [x.dataset.markId, x.textContent.trim().slice(0, 8)]));
out.marks = (await refsOf()).length;
const byText = async (t) => (await refsOf()).find(([, txt]) => txt === t || txt.startsWith(t))?.[0];
const spoolRef = await byText("SP-1"), supportRef = await byText("S-1"), equipRef = await byText("V-1"), weldRef = await byText("1");
ok("marksCarryUids", [spoolRef, supportRef, equipRef, weldRef].every((r) => r && UID.test(r)));
const rightClick = async (ref) => { await page.locator(`[data-mark-id="${ref}"]`).first().click({ button: "right" }); await page.waitForSelector("[role=menu]"); };
const menuItems = () => page.locator("[role=menuitem]").evaluateAll((e) => e.map((x) => x.textContent.trim()));
const closeMenu = () => page.keyboard.press("Escape");

await setTheme("dark");
// 3. right-click on a weld, a spool, a support, an equipment
for (const [name, ref] of [["weld", weldRef], ["spool", spoolRef], ["support", supportRef], ["equipment", equipRef]]) {
  await rightClick(ref);
  const items = await menuItems();
  ok(`menu_${name}`, items.length === 5);
  await shot(`menu-${name}-dark`);
  await closeMenu();
}
// 4. the empty sheet
const sheetBox = await page.locator("[data-sheet]").boundingBox();
await page.mouse.click(sheetBox.x + sheetBox.width * 0.9, sheetBox.y + sheetBox.height * 0.9, { button: "right" });
await page.waitForSelector("[role=menu]");
const empty = await menuItems();
ok("menu_empty_has_four_types", ["سرجوش", "اسپول", "ساپورت", "تجهیز"].every((w) => empty.some((t) => t.includes(w))));
await shot("menu-empty-dark");
await closeMenu();

// 5. edit form: all fields, uid shown read-only
await rightClick(weldRef);
await page.locator("[role=menuitem]", { hasText: "ویرایش" }).click();
await page.waitForSelector("[data-mark-form]");
ok("form_shows_uid", (await page.locator("[data-mark-identity]").textContent()).includes(weldRef));
ok("form_uid_not_editable", await page.locator("[data-mark-identity] input").count() === 0);
await shot("edit-form-dark");
// dirty guard
await page.fill("[data-input=no]", "999");
ok("dirty_pill", await page.locator("[data-form-dirty]").count() === 1);
let cancelAsked = null;
page.removeAllListeners("dialog");
page.on("dialog", async (d) => { cancelAsked = d.message(); await d.dismiss(); });   // refuse to discard: the form must stay open
await page.click("[data-form-cancel]");
await page.waitForTimeout(400);
ok("cancel_with_changes_asks_first", Boolean(cancelAsked));
ok("form_stays_open_when_not_confirmed", await page.locator("[data-mark-form]").count() === 1);
page.removeAllListeners("dialog");
page.on("dialog", async (d) => { await d.accept(); });
await page.click("[data-form-cancel]");
await page.waitForTimeout(400);
ok("form_closes_when_confirmed", await page.locator("[data-mark-form]").count() === 0);
ok("cancel_changed_nothing", Boolean(await byText("1")) && !(await byText("999")));

// 6. protected deletion: the installed equipment cannot be deleted, and the dialog says how
await rightClick(equipRef);
await page.locator("[role=menuitem]", { hasText: "حذف" }).click();
await page.waitForSelector('[data-confirm="blocked"]');
const protectText = await page.locator("[data-confirm-lines]").textContent();
ok("protected_delete_dialog", /نصب‌شده/.test(protectText) && /برنامه‌ریزی‌شده/.test(protectText) && await page.locator("[data-confirm-yes]").count() === 0);
out.protectText = protectText;
await shot("delete-protection-dark");
await page.click("[data-confirm-close]");
ok("equipment_still_there", (await refsOf()).some(([r]) => r === equipRef));

// 6b. duplicate (new uid), move (same uid), delete with confirmation
const before = await refsOf();
await rightClick(weldRef);
await page.locator("[role=menuitem]", { hasText: "کپی" }).click();
await page.waitForTimeout(500);
const afterDup = await refsOf();
const newRef = afterDup.map(([r]) => r).find((r) => !before.some(([x]) => x === r));
ok("duplicate_adds_one_mark", afterDup.length === before.length + 1);
ok("duplicate_has_new_uid", Boolean(newRef) && UID.test(newRef) && newRef !== weldRef);
await rightClick(newRef);
await page.locator("[role=menuitem]", { hasText: "حذف" }).click();
await page.waitForSelector('[data-confirm="confirm"]');
await shot("delete-confirm-dark");
await page.click("[data-confirm-no]");
ok("delete_cancel_keeps_mark", (await refsOf()).some(([r]) => r === newRef));
await rightClick(newRef);
await page.locator("[role=menuitem]", { hasText: "حذف" }).click();
await page.waitForSelector('[data-confirm="confirm"]');
await page.click("[data-confirm-yes]");
await page.waitForTimeout(400);
const afterDel = await refsOf();
ok("delete_confirmed_removes_only_that_mark", afterDel.length === before.length && !afterDel.some(([r]) => r === newRef) && afterDel.some(([r]) => r === weldRef));
// move: the support, by its menu, to another point on the sheet — same uid, other place
const pre = await page.locator(`[data-mark-id="${supportRef}"]`).first().boundingBox();
await rightClick(supportRef);
await page.locator("[role=menuitem]", { hasText: "جابه‌جایی" }).click();
const sb = await page.locator("[data-sheet]").boundingBox();
await page.mouse.click(sb.x + sb.width * 0.25, sb.y + sb.height * 0.8);
await page.waitForTimeout(500);
const post = await page.locator(`[data-mark-id="${supportRef}"]`).first().boundingBox();
ok("move_keeps_uid_and_changes_place", Boolean(post) && (Math.abs(post.x - pre.x) > 20 || Math.abs(post.y - pre.y) > 20));

// 7. synchronisation: a click on the drawing selects its row; a click on a row selects its mark
await page.keyboard.press("Escape").catch(() => {});
await tab(page, "spools");
await page.locator(`[data-mark-id="${weldRef}"]`).first().click();
await page.waitForTimeout(500);
ok("drawing_click_moves_panel_to_welds_table", await page.locator('[data-ws-tab="welds"][aria-selected="true"]').count() === 1);
ok("row_selected", await page.locator(`[data-mark-row="${weldRef}"][aria-selected="true"]`).count() === 1);
await shot("sync-selection-dark");
await tab(page, "supports");
await page.locator(`[data-mark-row="${supportRef}"]`).first().click();
await page.waitForTimeout(300);
ok("table_click_selects_drawing_mark", await page.locator(`[data-mark-id="${supportRef}"][data-picked="true"]`).count() === 1);
ok("only_one_mark_selected", await page.locator('[data-mark-id][data-picked="true"]').count() === 1);

// 8. themes and narrow viewport
await setTheme("light");
await rightClick(spoolRef); await shot("menu-spool-light"); await closeMenu();
await tab(page, "welds"); await page.locator(`[data-mark-id="${weldRef}"]`).first().click(); await shot("sync-selection-light");
await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(500);
await shot("workspace-narrow-light");
ok("narrow_no_hscroll", !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)));
out.errs = errs;
console.log(JSON.stringify(out, null, 1));
await b.close();
