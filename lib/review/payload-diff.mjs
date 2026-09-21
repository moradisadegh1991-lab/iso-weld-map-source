/**
 * Field-level diff of two extraction payloads.
 *
 * This is the record of what a human had to correct in what the model read —
 * and that record is the single most useful dataset this programme produces.
 * It says, field by field, where extraction is weak: if `nodes[*].E` is edited
 * on one drawing in three, the prompt has a problem with running dimensions,
 * and no amount of staring at aggregate accuracy would have told you which
 * field to fix.
 *
 * So the diff is deliberately fine-grained. "The engineer changed the nodes"
 * is not actionable; "N3.E was 118948 and should have been 118984" is.
 */

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * @returns {Array<{path, field, before, after, kind}>}
 *          kind is "changed" | "added" | "removed"
 */
export function diffPayload(before, after, { path = "", out = [] } = {}) {
  if (Array.isArray(before) || Array.isArray(after)) {
    const a = Array.isArray(before) ? before : [];
    const b = Array.isArray(after) ? after : [];
    // Arrays are matched by index. For `nodes` and `edges` that is right —
    // they are ordered along the route — and for `bom` it matches the part
    // numbers in practice. Matching by content would hide a reordering that
    // the engineer actually made on purpose.
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
      diffPayload(a[i], b[i], { path: `${path}[${i}]`, out });
    }
    return out;
  }

  if (isObject(before) || isObject(after)) {
    const a = isObject(before) ? before : {};
    const b = isObject(after) ? after : {};
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
      diffPayload(a[key], b[key], { path: path ? `${path}.${key}` : key, out });
    }
    return out;
  }

  if (same(before, after)) return out;
  out.push({
    path,
    field: leafOf(path),
    before: before === undefined ? null : before,
    after: after === undefined ? null : after,
    kind: before === undefined ? "added" : after === undefined ? "removed" : "changed",
  });
  return out;
}

/**
 * Which fields get corrected most often.
 *
 * Indices are stripped, so `nodes[0].E` and `nodes[7].E` both count towards
 * `nodes[].E`. The question being answered is "which FIELD does extraction
 * get wrong", not "which row was wrong this time".
 */
export function editHotspots(edits) {
  const counts = new Map();
  for (const e of edits) {
    const key = String(e.path).replace(/\[\d+\]/g, "[]");
    if (!counts.has(key)) counts.set(key, { path: key, field: leafOf(key), count: 0, examples: [] });
    const c = counts.get(key);
    c.count++;
    if (c.examples.length < 3) c.examples.push({ before: e.before, after: e.after });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}

const leafOf = (path) => String(path).split(".").pop().replace(/\[\d+\]/g, "");

function same(a, b) {
  if (a === b) return true;
  // 36 and "36" off a re-typed JSON field are the same reading, and logging
  // that as a correction would bury the real ones in noise.
  if (a == null || b == null) return false;
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return String(a) === String(b);
}
