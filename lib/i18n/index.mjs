/**
 * The platform's three languages (owner's request, 2026-10-18): Persian,
 * Arabic and English. Persian is the language the platform was written in
 * and every string has it; a key another language does not have yet falls
 * back to Persian rather than to the key, so a page is never left with
 * placeholders. Arabic and Persian are right to left, English left to right.
 *
 *   const t = useT();  t("shell.signOut")  t("tk.rows", { n: 12 })
 *
 * Strings live in fa.mjs / en.mjs / ar.mjs, one flat object each, keyed by
 * area ("shell.", "tk.", "settings." …). The menu's titles are keyed by the
 * page's address (nav.mjs), so a page keeps its translation wherever the
 * menu puts it.
 */
import fa from "./fa.mjs";
import en from "./en.mjs";
import ar from "./ar.mjs";
import quality from "./sections/quality.mjs";
import contracts from "./sections/contracts.mjs";
import reports from "./sections/reports.mjs";
import grid from "./sections/grid.mjs";
import eps from "./sections/eps.mjs";
import supply from "./sections/supply.mjs";
import hse from "./sections/hse.mjs";
import mechanical from "./sections/mechanical.mjs";
import ei from "./sections/ei.mjs";

// A section's pages keep their strings in sections/<name>.mjs, [fa, en, ar] per key.
const SECTIONS = [quality, contracts, reports, grid, eps, supply, hse, mechanical, ei];

export const LANGS = {
  fa: { name: "فارسی", dir: "rtl", locale: "fa-IR", font: "fa" },
  ar: { name: "العربية", dir: "rtl", locale: "ar", font: "ar" },
  en: { name: "English", dir: "ltr", locale: "en-GB", font: "en" },
};
export const DEFAULT_LANG = "fa";
const merge = (base, lang) => Object.assign({}, base, ...SECTIONS.map((x) => x[lang]));
const DICTS = { fa: merge(fa, "fa"), en: merge(en, "en"), ar: merge(ar, "ar") };

export const langOf = (l) => (LANGS[l] ? l : DEFAULT_LANG);
export const dirOf = (l) => LANGS[langOf(l)].dir;
export const localeOf = (l) => LANGS[langOf(l)].locale;

/** The string for a key in a language, with {name} filled in; Persian when the language lacks it, the key when nothing has it. */
export function translate(lang, key, vars) {
  const d = DICTS[langOf(lang)];
  let s = d[key] ?? DICTS.fa[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined ? m : String(vars[k])));
  return s;
}

/** Whether a key is translated into a language (not falling back to Persian). Used by the coverage test. */
export const has = (lang, key) => Object.prototype.hasOwnProperty.call(DICTS[langOf(lang)], key);
export const keys = (lang) => Object.keys(DICTS[langOf(lang)]);

/** A number as the language writes it: Persian and Arabic-Indic digits, or Latin. */
export function num(lang, v, opts) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  return Number.isFinite(n) ? n.toLocaleString(localeOf(lang), opts) : String(v);
}

/**
 * A date as the language writes it: the Persian calendar in Persian, the
 * Gregorian one in English and Arabic. Empty → "—". Arabic's format carries
 * right-to-left marks between its parts; in a left-to-right cell (a code or
 * date column) they scrambled "25/10/2026" into "252026/10/", so they go.
 */
const unmark = (s) => s.replace(/[\u200e\u200f\u061c]/g, "");
export function dateIn(lang, d) {
  if (!d) return "—";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : unmark(x.toLocaleDateString(localeOf(lang)));
}
export function dateTimeIn(lang, d) {
  if (!d) return "—";
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? String(d) : unmark(x.toLocaleString(localeOf(lang), { dateStyle: "short", timeStyle: "short" }));
}
