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

export const LANGS = {
  fa: { name: "فارسی", dir: "rtl", locale: "fa-IR", font: "fa" },
  ar: { name: "العربية", dir: "rtl", locale: "ar", font: "ar" },
  en: { name: "English", dir: "ltr", locale: "en-GB", font: "en" },
};
export const DEFAULT_LANG = "fa";
const DICTS = { fa, en, ar };

export const langOf = (l) => (LANGS[l] ? l : DEFAULT_LANG);
export const dirOf = (l) => LANGS[langOf(l)].dir;
export const localeOf = (l) => LANGS[langOf(l)].locale;

/** The string for a key in a language, with {name} filled in; Persian when the language lacks it, the key when nothing has it. */
export function translate(lang, key, vars) {
  const d = DICTS[langOf(lang)];
  let s = d[key] ?? fa[key] ?? key;
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
