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
import { translate, dirOf, num, dateIn, keys as keysOf } from "../../lib/i18n/index.mjs";
import { LABELS, label } from "../../lib/i18n/labels.mjs";
import { INSPECTABLE } from "../../lib/platform/precedence.mjs";
import { SCOPES as ITP_SCOPES, PARTIES, POINTS, OUTCOMES } from "../../lib/inspection/itp.mjs";
import { PUNCH_CATEGORIES, DISPOSITIONS, NCR_SEVERITY } from "../../lib/quality/quality.mjs";
import { PHOTO_STAGES } from "../../lib/quality/photo.mjs";
import { SCOPES as NDT_SCOPES, JOINT_TYPES, EXTENSIONS } from "../../lib/ndt/joints.mjs";
import { STATUS as NDT_STATUS } from "../../lib/ndt/compliance.mjs";
import { ACTION_FA } from "../../lib/db/repos/log.mjs";
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
  const shared = Object.keys(quality.fa).filter((k) => k in base);
  equal(shared, [], "a section's key overriding a platform key");
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
  "components/ui/EntityLog.jsx", "components/ui/Fold.jsx", "components/ui/TableKit.jsx", "components/platform/Shell.jsx",
  "components/platform/SignIn.jsx", "app/account/page.jsx"];

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
