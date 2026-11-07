/**
 * The SLD draft ENVELOPE (docs/audit/phase-12-sld-intelligence.md §16.3) — the only contract Phase 12.2 enforces.
 *
 *   { kind:"sld", schema:1, meta:{}, page:{}, items:[], edges:[], source:{ kind, reader, hash, generatedAt } }
 *
 * `items` and `edges` are carried VERBATIM: this phase does not interpret, classify, normalise or validate their content (no classes, no Facts, no graph —
 * those are Phases 12.3/12.4). What is checked is shape and size only, so a draft can be stored, compared by hash, edited by a person and signed without
 * the platform having an opinion about electrical engineering yet. Pure: no I/O.
 */
export const SLD_KIND = "sld";
export const SLD_SCHEMA = 1;
export const LIMITS = Object.freeze({ bytes: 2_000_000, items: 20_000, edges: 50_000, metaKeys: 100, hashLength: 128, textLength: 200 });
const TOP = ["kind", "schema", "meta", "page", "items", "edges", "source"];

const bad = (code, message, details) => Object.assign(new Error(message), { status: code === "PAYLOAD_TOO_LARGE" ? 413 : 400, code, ...(details ? { details } : {}) });
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v.trim() : "");

/** Serialised size in bytes (UTF-8) of what would be stored. */
export const sizeOf = (v) => Buffer.byteLength(JSON.stringify(v ?? null), "utf8");

/**
 * Check and normalise an envelope. Unknown top-level keys are refused (the contract is closed in 12.2); `meta`/`page` default to `{}`, `items`/`edges` to `[]`.
 * @returns {object} the envelope to store (a copy; element content untouched)
 * @throws 400 INVALID_ENVELOPE · 413 PAYLOAD_TOO_LARGE
 */
export function validateEnvelope(input) {
  if (!isObj(input)) throw bad("INVALID_ENVELOPE", "the draft must be an object");
  const extra = Object.keys(input).filter((k) => !TOP.includes(k));
  if (extra.length) throw bad("INVALID_ENVELOPE", `unknown field(s): ${extra.slice(0, 5).join(", ")}`, { unknown: extra.slice(0, 20) });
  if (input.kind !== SLD_KIND) throw bad("INVALID_ENVELOPE", `kind must be "${SLD_KIND}"`);
  if (input.schema !== SLD_SCHEMA) throw bad("INVALID_ENVELOPE", `schema must be ${SLD_SCHEMA}`);
  const meta = input.meta ?? {}, page = input.page ?? {}, items = input.items ?? [], edges = input.edges ?? [];
  if (!isObj(meta)) throw bad("INVALID_ENVELOPE", "meta must be an object");
  if (!isObj(page)) throw bad("INVALID_ENVELOPE", "page must be an object");
  if (!Array.isArray(items)) throw bad("INVALID_ENVELOPE", "items must be an array");
  if (!Array.isArray(edges)) throw bad("INVALID_ENVELOPE", "edges must be an array");
  if (Object.keys(meta).length > LIMITS.metaKeys) throw bad("PAYLOAD_TOO_LARGE", `meta has more than ${LIMITS.metaKeys} keys`);
  if (items.length > LIMITS.items) throw bad("PAYLOAD_TOO_LARGE", `more than ${LIMITS.items} items`, { limit: LIMITS.items });
  if (edges.length > LIMITS.edges) throw bad("PAYLOAD_TOO_LARGE", `more than ${LIMITS.edges} edges`, { limit: LIMITS.edges });
  if (!items.every(isObj)) throw bad("INVALID_ENVELOPE", "every item must be an object");
  if (!edges.every(isObj)) throw bad("INVALID_ENVELOPE", "every edge must be an object");
  const src = input.source;
  if (!isObj(src)) throw bad("INVALID_ENVELOPE", "source must be an object { kind, reader, hash, generatedAt }");
  const source = { kind: str(src.kind), reader: str(src.reader), hash: str(src.hash), generatedAt: str(src.generatedAt) };
  for (const k of ["kind", "reader", "hash", "generatedAt"]) if (!source[k]) throw bad("INVALID_ENVELOPE", `source.${k} is required`);
  if (source.hash.length > LIMITS.hashLength || /[\s]/.test(source.hash)) throw bad("INVALID_ENVELOPE", "source.hash must be a token of at most 128 characters");
  for (const k of ["kind", "reader", "generatedAt"]) if (source[k].length > LIMITS.textLength) throw bad("INVALID_ENVELOPE", `source.${k} is too long`);
  if (Number.isNaN(Date.parse(source.generatedAt))) throw bad("INVALID_ENVELOPE", "source.generatedAt must be a date-time");
  const env = { kind: SLD_KIND, schema: SLD_SCHEMA, meta, page, items, edges, source };
  const bytes = sizeOf(env);
  if (bytes > LIMITS.bytes) throw bad("PAYLOAD_TOO_LARGE", `the draft is ${bytes} bytes; the limit is ${LIMITS.bytes}`, { bytes, limit: LIMITS.bytes });
  return env;
}
