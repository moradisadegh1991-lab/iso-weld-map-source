/**
 * The closed set of drawing types a `document` row may carry (docs/audit/phase-12-sld-intelligence.md §16.3).
 *
 *   isometric  the default (a piping isometric: weld register, spools, BOM)
 *   pid        a P&ID (lib/pid, lib/db/repos/pid.mjs)
 *   sld        a single-line diagram (lib/db/repos/sld.mjs; Phase 12.2 stores drafts only)
 *
 * A type is NEVER guessed: an absent type is the historical default `isometric`, a type that is not in the set is refused (INVALID_DOC_TYPE) — it
 * used to be filed as an isometric silently, which is how a foreign drawing ends up in the weld register's figures.
 */
export const DOC_TYPES = Object.freeze(["isometric", "pid", "sld"]);
export const DEFAULT_DOC_TYPE = "isometric";

const fail = (status, code, message, details) => Object.assign(new Error(message), { status, code, ...(details ? { details } : {}) });

/**
 * @param {unknown} raw  what the caller sent (undefined / null / "" = not stated)
 * @returns {"isometric"|"pid"|"sld"}
 * @throws 400 INVALID_DOC_TYPE
 */
export function normalizeDocType(raw) {
  if (raw === undefined || raw === null) return DEFAULT_DOC_TYPE;
  if (typeof raw !== "string") throw fail(400, "INVALID_DOC_TYPE", `docType must be one of ${DOC_TYPES.join(", ")}`, { allowed: DOC_TYPES });
  const t = raw.trim().toLowerCase();
  if (t === "") return DEFAULT_DOC_TYPE;
  if (!DOC_TYPES.includes(t)) throw fail(400, "INVALID_DOC_TYPE", `unknown docType «${raw.slice(0, 40)}»; allowed: ${DOC_TYPES.join(", ")}`, { allowed: DOC_TYPES });
  return t;
}
