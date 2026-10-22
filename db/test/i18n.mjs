#!/usr/bin/env node
/**
 * Three languages and a person's own settings (owner's request, 2026-10-18).
 *
 *   - Persian, English and Arabic hold the same keys, none empty, and each
 *     string fills the same {placeholders} as the Persian one — a missing
 *     {n} prints a sentence without its number.
 *   - Every group, section and page of the menu has its English and Arabic
 *     name (lib/i18n/nav.mjs), so no menu entry falls back to Persian.
 *   - A section's pages (lib/i18n/sections/*) hold every key in all three,
 *     every domain label they show (chain steps, ITP parties, NDT statuses…)
 *     has its English and Arabic (lib/i18n/labels.mjs), and a translated page
 *     keeps no Persian of its own — a string typed into the page instead of
 *     the dictionary would stay Persian in every language.
 *   - Settings (078): only the listed keys and values are stored, a save
 *     merges into what is there, and they are the account's — read back by
 *     a second sign-in, not kept in one browser.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import base from "../../lib/i18n/fa.mjs";
import quality from "../../lib/i18n/sections/quality.mjs";
import contracts from "../../lib/i18n/sections/contracts.mjs";
import reports from "../../lib/i18n/sections/reports.mjs";
import grid from "../../lib/i18n/sections/grid.mjs";
import eps from "../../lib/i18n/sections/eps.mjs";
import supply from "../../lib/i18n/sections/supply.mjs";
import hseSection from "../../lib/i18n/sections/hse.mjs";
import mechanical from "../../lib/i18n/sections/mechanical.mjs";
import ei from "../../lib/i18n/sections/ei.mjs";
import piping from "../../lib/i18n/sections/piping.mjs";
import { translate, dirOf, num, dateIn, keys as keysOf } from "../../lib/i18n/index.mjs";
import { LABELS, label } from "../../lib/i18n/labels.mjs";
import { INSPECTABLE, EQUIPMENT_KINDS as TAG_KINDS } from "../../lib/platform/precedence.mjs";
import { INSULATION } from "../../lib/coating/coating.mjs";
import { CATEGORIES as ISA_CATEGORIES } from "../../lib/instrumentation/isa.mjs";
import { SCOPES as ITP_SCOPES, PARTIES, POINTS, OUTCOMES } from "../../lib/inspection/itp.mjs";
import { PUNCH_CATEGORIES, DISPOSITIONS, NCR_SEVERITY } from "../../lib/quality/quality.mjs";
import { PHOTO_STAGES } from "../../lib/quality/photo.mjs";
import { SCOPES as NDT_SCOPES, JOINT_TYPES, EXTENSIONS } from "../../lib/ndt/joints.mjs";
import { STATUS as NDT_STATUS } from "../../lib/ndt/compliance.mjs";
import { ACTION_FA } from "../../lib/db/repos/log.mjs";
import { METHODS as BOQ_METHODS, STATUS as STATEMENT_STATUS, CONTRACT_STATUS, CONTRACT_KIND } from "../../lib/contracts/statement.mjs";
import { METRICS } from "../../lib/contracts/metrics.mjs";
import { CONTRACT_ROLES, AMENDMENT_KINDS, TREES } from "../../lib/db/repos/org.mjs";
import { STATUS as RESOURCE_STATUS } from "../../lib/db/repos/resources.mjs";
import { KIND as RESOURCE_KIND } from "../../lib/reports/catalog.mjs";
import { STATUS_FA as REPORT_STATUS } from "../../lib/db/repos/reports.mjs";
import { DAY_STATUS, WEATHER, SECTIONS as REPORT_SECTIONS } from "../../lib/reports/contract-daily.mjs";
import { PERMISSIONS } from "../../lib/reports/workflow.mjs";
import { SIGNATURE_KIND } from "../../lib/db/repos/signatures.mjs";
import { ORIENTATION, ALIGN, FOOTER_ELEMENTS, PLACEHOLDERS } from "../../lib/reports/print.mjs";
import { SOURCE as DAILY_SOURCE, SHIFT as DAILY_SHIFT, WEATHER as DAILY_WEATHER } from "../../lib/reports/daily.mjs";
import { FORM_PARTS } from "../../lib/db/repos/workflows.mjs";
import { REL_TYPES, BUDGET_UNITS, ROLE_STATUS, QTY_MODES } from "../../lib/eps/activities.mjs";
import { DISCIPLINES as SCOPE_DISC, MEASURES as SCOPE_MEASURES, MODES as SCOPE_MODES } from "../../lib/eps/scope.mjs";
import { BUDGET_MODES, SEPARATORS, SEPARATOR_NAMES } from "../../lib/eps/wbs.mjs";
import { REVIEW_CODES, FAT_RESULTS, STAGE_FA as PO_STAGES } from "../../lib/procurement/procurement.mjs";
import { TECH_STATUS } from "../../lib/procurement/tender.mjs";
import { CATEGORIES as STOCK_CATEGORIES } from "../../lib/warehouse/stock.mjs";
import { DEST_FA } from "../../lib/warehouse/reserve.mjs";
import { CLASSES as HSE_CLASSES, TREATMENTS, PERMIT_TYPES, GAS_LIMITS, OBSERVATION_KINDS, SEVERITIES as OBS_SEVERITIES } from "../../lib/hse/hse.mjs";
import { COMPETENCES, EQUIPMENT_KINDS as HSE_EQUIPMENT } from "../../lib/hse/safework.mjs";
import { NAV_I18N, localizeNav } from "../../lib/i18n/nav.mjs";
import { SECTIONS } from "../../lib/platform/navigation.mjs";
import { cleanPrefs, withDefaults, PREFS } from "../../lib/prefs.mjs";

process.env.AUTH_MODE = "dev";
process.env.PGLITE_DIR = await scratchDir("i18n-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const users = await import("../../lib/db/repos/users.mjs");

const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

// the dictionaries as the page reads them: the platform's and every section's
const dict = (lang) => Object.fromEntries(keysOf(lang).map((k) => [k, translate(lang, k)]));
const fa = dict("fa"), en = dict("en"), ar = dict("ar");

test("the three dictionaries hold the same keys, none empty", () => {
  const F = Object.keys(fa);
  for (const [name, d] of [["en", en], ["ar", ar]]) {
    const K = Object.keys(d);
    equal(K.filter((k) => !(k in fa)), [], `${name}: keys Persian does not have`);
    equal(F.filter((k) => !(k in d)), [], `${name}: keys it lacks`);
    equal(K.filter((k) => !String(d[k]).trim()), [], `${name}: empty strings`);
  }
  assert(F.length > 150, `${F.length} keys`);
  const sections = [quality, contracts, reports, grid, eps, supply, hseSection, mechanical, ei, piping];
  const seen = new Set(Object.keys(base));
  const twice = [];
  for (const x of sections) for (const k of Object.keys(x.fa)) { if (seen.has(k)) twice.push(k); seen.add(k); }
  equal(twice, [], "a key two sections (or a section and the platform) both define — the later would silently win");
});

test("each translation fills the same placeholders as the Persian", () => {
  for (const [name, d] of [["en", en], ["ar", ar]]) {
    const off = Object.keys(fa).filter((k) => holes(fa[k]) !== holes(d[k]));
    equal(off, [], `${name}: placeholders differ`);
  }
});

test("translate fills placeholders, falls back to Persian, then to the key", () => {
  equal(translate("en", "tk.rowsOf", { shown: 3, total: 9 }), "3 of 9 rows");
  equal(translate("ar", "tk.page", { p: 1, n: 2 }), "صفحة 1 من 2");
  equal(translate("en", "no.such.key"), "no.such.key");
  equal(translate("xx", "settings.title"), fa["settings.title"], "an unknown language is Persian");
  equal([dirOf("fa"), dirOf("ar"), dirOf("en")], ["rtl", "rtl", "ltr"]);
  equal(num("fa", 1203), "۱٬۲۰۳");
  equal(num("en", 1203), "1,203");
});

test("every group, section and page of the menu is in English and Arabic", () => {
  const missing = [];
  for (const g of SECTIONS) {
    if (!NAV_I18N.GROUPS[g.group]?.en || !NAV_I18N.GROUPS[g.group]?.ar) missing.push(`group ${g.group}`);
    for (const s of g.items) {
      const t = NAV_I18N.SECTIONS[s.key];
      if (!t?.en?.[0] || !t?.ar?.[0]) missing.push(`section ${s.key}`);
      for (const tab of s.tabs) if (!tab.log && (!NAV_I18N.TABS[tab.href]?.en || !NAV_I18N.TABS[tab.href]?.ar)) missing.push(`page ${tab.href}`);
    }
  }
  equal(missing, [], "untranslated menu entries");
  const nav = localizeNav(SECTIONS.map((g) => ({ ...g, items: g.items.map((s) => ({ ...s })) })), "en");
  equal(nav[0].group, SECTIONS[0].group, "the Persian group name stays the key folded groups are kept by");
  equal(nav[0].label, NAV_I18N.GROUPS[SECTIONS[0].group].en);
  assert(nav.flatMap((g) => g.items.flatMap((s) => s.tabs)).every((t) => !/[؀-ۿ]/.test(t.title) || t.href.startsWith("/handover/")),
    "no English menu page keeps a Persian title");
});

test("every domain label a translated page shows is in English and Arabic", () => {
  const want = [
    ...Object.entries(INSPECTABLE).flatMap(([k, steps]) => steps.map((x) => `chain.${k}.${x.code}`)),
    ...Object.keys(ITP_SCOPES).map((k) => `itp.scope.${k}`), ...Object.keys(PARTIES).map((k) => `itp.party.${k}`),
    ...Object.keys(POINTS).map((k) => `itp.point.${k}`), ...Object.keys(OUTCOMES).map((k) => `itp.outcome.${k}`),
    ...Object.keys(PUNCH_CATEGORIES).map((k) => `punch.cat.${k}`), ...Object.keys(PHOTO_STAGES).map((k) => `punch.photo.${k}`),
    ...Object.keys(DISPOSITIONS).map((k) => `ncr.disp.${k}`), ...Object.keys(NCR_SEVERITY).map((k) => `ncr.sev.${k}`),
    ...Object.keys(NDT_SCOPES).map((k) => `ndt.scope.${k}`), ...Object.keys(JOINT_TYPES).map((k) => `ndt.joint.${k}`),
    ...Object.keys(EXTENSIONS).map((k) => `ndt.ext.${k}`), ...Object.keys(NDT_STATUS).map((k) => `ndt.status.${k}`),
    ...Object.keys(ACTION_FA).map((k) => `log.action.${k}`),
    ...Object.keys(CONTRACT_KIND).map((k) => `contract.kind.${k}`), ...Object.keys(CONTRACT_STATUS).map((k) => `contract.status.${k}`),
    ...Object.keys(STATEMENT_STATUS).map((k) => `statement.status.${k}`), ...Object.keys(BOQ_METHODS).map((k) => `boq.method.${k}`),
    ...Object.keys(METRICS).map((k) => `metric.${k}`), ...Object.keys(CONTRACT_ROLES).map((k) => `contract.role.${k}`),
    ...Object.keys(AMENDMENT_KINDS).map((k) => `amendment.kind.${k}`), ...Object.keys(TREES).map((k) => `tree.${k}`),
    ...Object.keys(RESOURCE_KIND).map((k) => `resource.kind.${k}`), ...Object.keys(RESOURCE_STATUS).map((k) => `resource.status.${k}`),
    ...Object.keys(REPORT_STATUS).map((k) => `report.status.${k}`), ...Object.keys(DAY_STATUS).map((k) => `report.day.${k}`),
    ...Object.keys(REPORT_SECTIONS).map((k) => `report.section.${k}`), ...Object.keys(PERMISSIONS).map((k) => `report.perm.${k}`),
    ...[...new Set([...Object.keys(WEATHER), ...Object.keys(DAILY_WEATHER)])].map((k) => `weather.${k}`),
    ...Object.keys(SIGNATURE_KIND).map((k) => `signature.kind.${k}`), ...Object.keys(ORIENTATION).map((k) => `print.orientation.${k}`),
    ...Object.keys(ALIGN).map((k) => `print.align.${k}`), ...Object.keys(FOOTER_ELEMENTS).map((k) => `print.element.${k}`),
    ...Object.keys(PLACEHOLDERS).map((k) => `print.placeholder.${k}`), ...Object.keys(DAILY_SOURCE).map((k) => `daily.source.${k}`),
    ...Object.keys(DAILY_SHIFT).map((k) => `daily.shift.${k}`),
    ...[...new Set(Object.values(FORM_PARTS).flatMap((x) => Object.keys(x)))].map((k) => `report.part.${k}`),
    ...Object.keys(REL_TYPES).map((k) => `eps.relType.${k}`), ...Object.keys(BUDGET_UNITS).map((k) => `eps.budgetUnit.${k}`),
    ...Object.keys(ROLE_STATUS).map((k) => `eps.roleStatus.${k}`), ...Object.keys(QTY_MODES).map((k) => `eps.qtyMode.${k}`),
    ...Object.entries(SCOPE_DISC).flatMap(([k, d]) => [`eps.scope.disc.${k}`, ...(d.kindLabel ? [`eps.scope.kind.${k}`] : []),
      ...Object.keys(d.milestones).map((m) => `eps.scope.ms.${k}.${m}`)]),
    ...Object.keys(SCOPE_MEASURES).map((k) => `eps.scope.measure.${k}`), ...Object.keys(SCOPE_MODES).map((k) => `eps.scope.mode.${k}`),
    ...Object.keys(BUDGET_MODES).map((k) => `eps.budgetMode.${k}`), ...Object.keys(SEPARATORS).map((k) => `eps.separator.${SEPARATOR_NAMES[k]}`),
    ...Object.keys(REVIEW_CODES).map((k) => `proc.review.${k}`), ...Object.keys(FAT_RESULTS).map((k) => `proc.fat.${k}`),
    ...Object.keys(PO_STAGES).map((k) => `proc.stage.${k}`), ...Object.keys(TECH_STATUS).map((k) => `proc.tech.${k}`),
    ...Object.keys(STOCK_CATEGORIES).map((k) => `wh.cat.${k}`), ...Object.keys(DEST_FA).map((k) => `wh.dest.${k}`),
    ...Object.keys(HSE_CLASSES).map((k) => `hse.cls.${k}`), ...Object.keys(TREATMENTS).map((k) => `hse.treat.${k}`),
    ...Object.keys(PERMIT_TYPES).map((k) => `hse.permit.${k}`), ...[...Object.keys(GAS_LIMITS), "hse_permit_max_hours"].map((k) => `hse.limit.${k}`),
    ...Object.keys(OBSERVATION_KINDS).map((k) => `hse.obs.${k}`), ...Object.keys(OBS_SEVERITIES).map((k) => `hse.sev.${k}`),
    ...Object.keys(COMPETENCES).map((k) => `hse.comp.${k}`), ...Object.keys(HSE_EQUIPMENT).map((k) => `hse.eq.${k}`),
    ...Object.keys(TAG_KINDS).map((k) => `equip.kind.${k}`), ...Object.keys(INSULATION).map((k) => `coat.ins.${k}`),
    ...Object.keys(ISA_CATEGORIES).map((k) => `isa.cat.${k}`),
  ];
  equal(want.filter((k) => !LABELS[k]?.en || !LABELS[k]?.ar), [], "labels missing a translation");
  equal(Object.keys(LABELS).filter((k) => !want.includes(k)), [], "labels for nothing the platform declares");
  equal(label("en", "itp.party.tpi", PARTIES.tpi), "Third-party inspector (TPI)");
  equal(label("fa", "itp.party.tpi", PARTIES.tpi), PARTIES.tpi, "Persian is the declaration itself");
  equal(label("ar", "no.such", "فارسی"), "فارسی", "a label not here shows the Persian");
  equal(dateIn("fa", "2026-10-18"), "۱۴۰۵/۷/۲۶", "the Persian calendar in Persian");
  equal(dateIn("en", "2026-10-18"), "18/10/2026");
  equal(dateIn("en", null), "—");
  equal(dateIn("ar", "2026-10-25"), "25/10/2026", "no direction marks to scramble the date in a left-to-right cell");
});

// The pages translated so far, section by section (docs/digital-epc/11-ui-i18n.md).
const TRANSLATED = ["app/quality/page.jsx", "app/inspection/page.jsx", "app/ndt-joints/page.jsx", "app/log/[section]/page.jsx",
  "app/contracts/page.jsx", "app/contracts/setup/page.jsx", "app/contracts/resources/page.jsx", "app/contracts/statements/page.jsx",
  "app/contracts/design/page.jsx", "components/ui/TreeEditor.jsx", "components/contracts/ui.jsx", "components/ui/FormNo.jsx", "components/ui/WorkDate.jsx",
  "components/ui/EntityLog.jsx", "components/ui/Fold.jsx", "components/ui/TableKit.jsx", "components/platform/Shell.jsx",
  "components/platform/SignIn.jsx", "app/account/page.jsx",
  "app/contract-reports/page.jsx", "components/reports/WorkflowPanel.jsx", "app/report-setup/page.jsx", "app/report-print-setup/page.jsx",
  "app/signature/page.jsx", "app/daily-reports/page.jsx",
  "app/eps/page.jsx", "app/eps/wbs/page.jsx", "app/eps/templates/page.jsx", "app/eps/codes/page.jsx", "app/eps/activities/page.jsx",
  "app/eps/progress/page.jsx", "app/eps/progress/days/page.jsx", "app/eps/scope/page.jsx", "app/eps/planning/page.jsx", "app/eps/planning/preview/page.jsx", "app/eps/progress/preview/page.jsx",
  "components/eps/ActivityDetail.jsx", "components/eps/ActivityGrid.jsx", "components/eps/ScopePanel.jsx", "components/eps/shared.jsx",
  "app/procurement/page.jsx", "app/procurement/Tender.jsx", "app/procurement/Vendors.jsx",
  "app/warehouse/page.jsx", "app/warehouse/Stores.jsx", "app/warehouse/Mesc.jsx", "app/hse/page.jsx", "app/hse/SafeWork.jsx",
  "components/ui/Tabs.jsx", "app/equipment/page.jsx", "app/coating/page.jsx",
  "app/electrical/page.jsx", "app/instrumentation/page.jsx",
  "app/piping/overview/page.jsx", "app/piping/execution/page.jsx", "app/piping/welding/page.jsx", "app/piping/joint/page.jsx", "app/qc/page.jsx",
  "app/piping/reports/page.jsx"];

test("a translated page keeps no Persian of its own", async () => {
  const left = [];
  for (const f of TRANSLATED) {
    const lines = (await readFile(f, "utf8")).split("\n");
    lines.forEach((l, i) => {
      const t = l.trim();
      if (/^(\*|\/\*|\/\/)/.test(t)) return;                     // comments
      const code = l.replace(/\/\/.*$/, "");
      // a label's Persian fallback (L(key, "…")), or Persian that is not text for the reader, marked "i18n:" with why
      if (/[\u0600-\u06FF]/.test(code) && !/\bL\("[^"]+", "[^"]*"\)/.test(code) && !/i18n:/.test(l) && !/i18n:/.test(lines[i - 1] || "")) left.push(`${f}:${i + 1}`);
    });
  }
  equal(left, [], "Persian typed into a translated page");
});

test("settings: only the listed keys and values", () => {
  equal(cleanPrefs({ lang: "en", theme: "light", accent: "rose", density: "compact", scale: "l", grid: "cards" }),
    { lang: "en", theme: "light", accent: "rose", density: "compact", scale: "l", grid: "cards" });
  equal(cleanPrefs({ lang: "de", theme: "purple", evil: "<script>", accent: ["teal"] }), {}, "unknown keys and values dropped");
  equal(cleanPrefs(null), {});
  equal(withDefaults({ lang: "ar" }).theme, "dark");
  for (const [k, vals] of Object.entries(PREFS)) for (const v of vals) assert(fa[`settings.${k}.${v}`] || k === "lang" || k === "grid", `a label for ${k}=${v}`);
});

test("settings are the account's: merged on save, read back on the next sign-in", async () => {
  const db = await getDb();
  const u = await projects.ensureUser(db, { subject: "kc|i18n" });
  equal((await db.query("SELECT prefs FROM app_user WHERE id = $1", [u.id])).rows[0].prefs, {}, "none until set");
  equal(await users.savePrefs(db, { userId: u.id, patch: { lang: "en", theme: "light" } }), { lang: "en", theme: "light" });
  equal(await users.savePrefs(db, { userId: u.id, patch: { accent: "rose", lang: "xx", junk: 1 } }), { lang: "en", theme: "light", accent: "rose" },
    "a save merges, and drops what is not a setting");
  const again = (await db.query("SELECT prefs FROM app_user WHERE id = $1", [u.id])).rows[0].prefs;
  equal(again, { lang: "en", theme: "light", accent: "rose" }, "stored on the account");
  await throws(() => db.query("UPDATE app_user SET prefs = '[]'::jsonb WHERE id = $1", [u.id]), "app_user_prefs_object");
  await throws(() => users.savePrefs(db, { userId: "00000000-0000-0000-0000-000000000000", patch: { lang: "fa" } }), "یافت نشد");
});

await run();
