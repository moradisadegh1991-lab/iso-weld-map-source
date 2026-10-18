/**
 * What a person may set for themselves, and the values each may take. The
 * server stores only these (anything else is dropped), and the page applies
 * them as attributes on <html>, so a value outside the list could never reach
 * the stylesheet as an unknown theme.
 */
export const PREFS = {
  lang: ["fa", "en", "ar"],
  theme: ["system", "dark", "light"],
  accent: ["teal", "blue", "indigo", "green", "amber", "rose"],
  density: ["comfortable", "compact"],
  scale: ["s", "m", "l"],
  grid: ["table", "grid", "cards"],
};
export const DEFAULT_PREFS = { lang: "fa", theme: "dark", accent: "teal", density: "comfortable", scale: "m", grid: "table" };

/** Only known keys with allowed values; the rest is dropped. */
export function cleanPrefs(input) {
  const out = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, allowed] of Object.entries(PREFS)) if (allowed.includes(input[k])) out[k] = input[k];
  return out;
}

/** Stored settings over the defaults. */
export const withDefaults = (p) => ({ ...DEFAULT_PREFS, ...cleanPrefs(p) });
