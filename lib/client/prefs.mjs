"use client";
/**
 * The person's own settings — language, theme, accent, density, text size and
 * the default table view — applied to the page and kept on their account.
 *
 * Applied as attributes on <html> (lang, dir, data-theme, data-accent,
 * data-density, data-scale), so the stylesheet does the rest and no component
 * has to read a setting to look right. The same values are kept in this
 * browser too, for the script in app/layout.jsx that sets them before the
 * first paint: without it a light-theme or English user would see the dark
 * Persian page flash on every load.
 *
 * Signed in, the account's settings win (they are what the person chose on
 * another device); an account with none yet takes this browser's.
 *
 *   const t = useT();            t("shell.signOut")
 *   const { L, date } = usePrefs();  L("itp.party.tpi", data.parties.tpi)  date(row.due_on)
 *   const { prefs, setPref } = usePrefs();
 */
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { usePlatform } from "./platform.mjs";
import { DEFAULT_PREFS, cleanPrefs, withDefaults } from "../prefs.mjs";
import { LANGS, translate, num as numIn, localeOf, dateIn, dateTimeIn } from "../i18n/index.mjs";
import { label } from "../i18n/labels.mjs";

const KEY = "epc.prefs";
const LEGACY_THEME = "epc.theme";          // the light/dark toggle before 078

const readLocal = () => {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || "null");
    if (p) return cleanPrefs(p);
    const t = localStorage.getItem(LEGACY_THEME);
    return t === "light" || t === "dark" ? { theme: t } : {};
  } catch { return {}; }
};
const writeLocal = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); localStorage.removeItem(LEGACY_THEME); } catch { /* private mode */ } };

const systemDark = () => typeof window === "undefined" || !window.matchMedia || window.matchMedia("(prefers-color-scheme: dark)").matches;

/** The settings onto <html>. Kept identical to the pre-paint script in app/layout.jsx. */
export function applyPrefs(p) {
  const el = document.documentElement;
  const lang = LANGS[p.lang] ? p.lang : DEFAULT_PREFS.lang;
  el.lang = lang;
  el.dir = LANGS[lang].dir;
  el.dataset.theme = p.theme === "system" ? (systemDark() ? "dark" : "light") : p.theme;
  el.dataset.accent = p.accent;
  el.dataset.density = p.density;
  el.dataset.scale = p.scale;
}

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
const Ctx = createContext(null);

export function PrefsProvider({ children }) {
  const { status, user, offline } = usePlatform();
  // The server render has no settings; the browser's are read before paint.
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [saveError, setSaveError] = useState(null);
  const synced = useRef(null);              // the user whose account settings were taken

  useIsoLayoutEffect(() => { setPrefs(withDefaults(readLocal())); }, []);
  useIsoLayoutEffect(() => { applyPrefs(prefs); }, [prefs]);

  // "Match system" follows the system while the page is open.
  useEffect(() => {
    if (prefs.theme !== "system" || !window.matchMedia) return;
    const m = window.matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyPrefs(prefs);
    m.addEventListener?.("change", on);
    return () => m.removeEventListener?.("change", on);
  }, [prefs]);

  const save = useCallback(async (patch) => {
    try {
      const res = await fetch("/api/auth/prefs", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      setSaveError(null);
      return true;
    } catch (e) { setSaveError(e.message); return false; }
  }, []);

  // Signing in: the account's settings, or this browser's onto an account that has none.
  useEffect(() => {
    if (status !== "in" || !user || offline || synced.current === user.id) return;
    synced.current = user.id;
    const stored = cleanPrefs(user.prefs);
    if (Object.keys(stored).length) {
      const next = withDefaults({ ...readLocal(), ...stored });
      setPrefs(next); writeLocal(next);
    } else {
      const local = readLocal();
      if (Object.keys(local).length) save(local);
    }
  }, [status, user, offline, save]);
  useEffect(() => { if (status === "anon") synced.current = null; }, [status]);

  /** One setting: applied now, kept in this browser, and saved to the account when signed in. Resolves to whether the account took it. */
  const setPref = useCallback((key, value) => {
    const patch = cleanPrefs({ [key]: value });
    if (!Object.keys(patch).length) return Promise.resolve(false);
    setPrefs((p) => ({ ...p, ...patch }));
    writeLocal({ ...readLocal(), ...patch });
    return status === "in" && !offline ? save(patch) : Promise.resolve(false);
  }, [status, offline, save]);

  const value = useMemo(() => {
    const lang = prefs.lang;
    const t = (key, vars) => translate(lang, key, vars);
    return { prefs, setPref, saveError, lang, dir: LANGS[lang]?.dir || "rtl", locale: localeOf(lang), t,
      num: (v, o) => numIn(lang, v, o), L: (key, fa) => label(lang, key, fa),
      date: (d) => dateIn(lang, d), dateTime: (d) => dateTimeIn(lang, d) };
  }, [prefs, setPref, saveError]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK = {
  prefs: DEFAULT_PREFS, setPref: async () => false, saveError: null, lang: "fa", dir: "rtl", locale: "fa-IR",
  t: (k, v) => translate("fa", k, v), num: (v, o) => numIn("fa", v, o), L: (k, fa) => fa,
  date: (d) => dateIn("fa", d), dateTime: (d) => dateTimeIn("fa", d),
};

/** Settings and the translator. Outside the provider (a page rendered on its own, /setup), Persian and the defaults. */
export function usePrefs() { return useContext(Ctx) || FALLBACK; }
export function useT() { return usePrefs().t; }
