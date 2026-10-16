/**
 * Getting a JSON object out of whatever the model actually sent.
 *
 * Pure, provider-independent, and separated from the transport because this
 * is the part that has to cope with reality: a generation cut off at the
 * token ceiling, a stray code fence, a trailing comma. An incomplete
 * extraction the engineer can finish by hand beats a hard failure, so the
 * bias here is always towards salvaging something.
 */

/**
 * Parse JSON, repairing a generation that stopped mid-structure.
 *
 * Repairs are tried in order of how much they throw away, and the first
 * candidate that parses wins. That ordering is what makes the aggressive
 * repairs safe: a truncation that only needed its brackets closed is already
 * parsed and returned before anything reaches the step that would have
 * discarded a perfectly good value.
 */
export function parseLoose(t) {
  try { return JSON.parse(t); } catch { /* fall through */ }

  const { stack, inStr } = scan(t);

  let base = t;
  if (inStr) base = base.slice(0, base.lastIndexOf('"'));   // drop the half-written string
  base = base.replace(/,\s*$/, "");                          // and the comma that led to it

  // None of these substitutions removes a bracket, so the stack counted over
  // the original text still describes what is left open.
  const candidates = [
    base,
    // a key/value pair left half-written at the end of an object or array
    base.replace(/,\s*"[^"]*"?\s*:?\s*[^,{}[\]]*$/, ""),
    // the FIRST key of an object, cut right after its colon — no comma in
    // front of it, so the rule above cannot see it
    base.replace(/(\{)\s*"[^"]*"?\s*:\s*$/, "$1"),
    // ...and the same, but with a partial value after the colon
    base.replace(/(\{)\s*"[^"]*"?\s*:\s*[^,{}[\]]*$/, "$1"),
  ];

  for (const candidate of candidates) {
    try { return JSON.parse(close(candidate, stack)); } catch { /* try the next */ }
  }
  return null;
}

/** Where the text left off: what is still open, and whether it ended inside a string. */
function scan(t) {
  let inStr = false, esc = false;
  const stack = [];
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (esc) { esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === "{" || ch === "[") stack.push(ch);
    else if (ch === "}" || ch === "]") stack.pop();
  }
  return { stack, inStr };
}

const close = (s, stack) => {
  let out = s;
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === "{" ? "}" : "]";
  return out;
};

/** Strip fences and anything either side of the outermost object. */
export function cleanJsonText(text) {
  let cleaned = String(text).replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = cleaned.indexOf("{");
  if (s < 0) return cleaned;
  const e = cleaned.lastIndexOf("}");
  return e > s ? cleaned.slice(s, e + 1) : cleaned.slice(s);
}
