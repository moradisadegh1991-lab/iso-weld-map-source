/**
 * Marks drawn on the isometric sheet itself.
 *
 * A sheet is marked with four shapes, one per thing a fabricator looks for:
 *
 *   weld-shop   circle       a weld made in the shop
 *   weld-field  square       a weld made on site
 *   spool       oval         a spool number
 *   support     hexagon      a support number
 *
 * and a fifth, a dashed circle, for a weld whose place is known but whose
 * Shop/Field is not: UNKNOWN is shown as unknown, never guessed.
 *
 * The split is the platform's everywhere: the MODEL reports where it saw a
 * marker and what shape the designer drew it in (never shop or field); the
 * project's declared symbol convention turns a shape into Shop or Field; the
 * ENGINE's register, where a weld is not on the sheet as a printed number,
 * says Shop or Field for the welds the person then places by hand. A person
 * can move, renumber, retype and delete every mark: what the model put there
 * is a suggestion, not a finding.
 *
 * Places are fractions (0..1) of the sheet image, so a mark keeps its place
 * at any zoom and on any rendering of the same sheet.
 */
export const KINDS = {
  "weld-shop": { shape: "circle", label: "سرجوش کارگاه", cls: "weld" },
  "weld-field": { shape: "square", label: "سرجوش سایت", cls: "weld" },
  "weld-unknown": { shape: "circle-dashed", label: "سرجوش (کارگاه/سایت نامعلوم)", cls: "weld" },
  spool: { shape: "oval", label: "شمارهٔ اسپول", cls: "spool" },
  support: { shape: "hexagon", label: "شمارهٔ ساپورت", cls: "support" },
};
export const KIND_IDS = Object.keys(KINDS);

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const place = (v) => Math.round(clamp01(v) * 10000) / 10000;
const text = (v) => String(v ?? "").trim();

/** A mark with a well-formed kind, number and place, or null. */
function clean(m, src) {
  if (!m || !(m.kind in KINDS)) return null;
  const x = Number(m.x), y = Number(m.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { id: text(m.id), kind: m.kind, no: text(m.no), x: place(x), y: place(y), src: m.src || src };
}

/**
 * The marks to start from, out of what the model read off the sheet.
 *
 * `pass.items` is [{ kind: "weld"|"spool"|"support", no, shape, x, y }].
 * A weld is Shop or Field only by the project's declared symbols (the shape
 * its designer drew); a shape the project did not declare is a weld of
 * unknown location. Anything unreadable, unplaced or malformed is left out
 * and named in `dropped`, and a number the model gave twice is kept once.
 *
 * @param {{shop?: string, field?: string}} symbols  project.weld_symbol_shop / _field
 * @returns {{items: object[], dropped: string[]}}
 */
export function seedFromPass(pass, symbols = {}) {
  const items = [], dropped = [], seen = new Set();
  for (const raw of Array.isArray(pass?.items) ? pass.items : []) {
    const no = text(raw?.no);
    const label = `${text(raw?.kind) || "؟"} ${no || "بدون شماره"}`;
    if (!no) { dropped.push(`${label}: شماره‌اش خوانده نشد`); continue; }
    if (!Number.isFinite(Number(raw.x)) || !Number.isFinite(Number(raw.y))) { dropped.push(`${label}: محلش مشخص نبود`); continue; }
    let kind;
    if (raw.kind === "spool") kind = "spool";
    else if (raw.kind === "support") kind = "support";
    else if (raw.kind === "weld") {
      const shape = text(raw.shape).toLowerCase();
      kind = shape && shape === text(symbols.shop).toLowerCase() ? "weld-shop"
        : shape && shape === text(symbols.field).toLowerCase() ? "weld-field" : "weld-unknown";
    } else { dropped.push(`${label}: نوع نامعلوم`); continue; }
    const key = `${KINDS[kind].cls}|${no}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind, no, x: place(Number(raw.x)), y: place(Number(raw.y)), src: "model" });
  }
  return { items: withIds(items), dropped };
}

/**
 * The spool and support marks the no-model reader found (tools/iso-read.py:
 * an oval is a spool number, a hexagon a support number — the shape is its
 * evidence, the text inside was read by OCR). `tags` is [{ kind, no, at: [x, y] }];
 * anything not a spool or support, with no number or no place, is left out.
 */
export function fromReaderTags(tags) {
  const items = [], seen = new Set();
  for (const t of Array.isArray(tags) ? tags : []) {
    const no = text(t?.no);
    const x = Number(t?.at?.[0]), y = Number(t?.at?.[1]);
    if ((t?.kind !== "spool" && t?.kind !== "support") || !no || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    const key = `${t.kind}|${no}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: t.kind, no, x: place(x), y: place(y), src: "reader" });
  }
  return withIds(items);
}

/** Give every mark an id that is unique in the list and keeps the ones it already has. */
export function withIds(items) {
  const used = new Set(items.map((m) => m.id).filter(Boolean));
  let n = 0;
  return items.map((m) => {
    if (m.id) return m;
    while (used.has(`m${++n}`));
    used.add(`m${n}`);
    return { ...m, id: `m${n}` };
  });
}

/** What the payload keeps: only well-formed marks, ids filled. */
export function normalize(items) {
  const out = [];
  for (const m of Array.isArray(items) ? items : []) { const c = clean(m, "hand"); if (c) out.push(c); }
  return withIds(out);
}

/** The next free number for a kind's class: one past the largest numeric number in use, "1" when none. */
export function nextNo(items, kind) {
  const cls = KINDS[kind]?.cls;
  let max = 0;
  for (const m of items) if (KINDS[m.kind]?.cls === cls && /^\d+$/.test(m.no)) max = Math.max(max, Number(m.no));
  return String(max + 1);
}

export function addMark(items, { kind, no, x, y }) {
  if (!(kind in KINDS)) throw new Error(`نوع نشانه ناشناخته: ${kind}`);
  return withIds([...items, { kind, no: text(no) || nextNo(items, kind), x: place(x), y: place(y), src: "hand" }]);
}

/** Change one mark; a moved or edited mark is the person's now, whatever put it there. */
export function updateMark(items, id, patch) {
  return items.map((m) => {
    if (m.id !== id) return m;
    const next = { ...m, src: "hand" };
    if (patch.kind !== undefined && patch.kind in KINDS) next.kind = patch.kind;
    if (patch.no !== undefined) next.no = text(patch.no);
    if (patch.x !== undefined) next.x = place(Number(patch.x));
    if (patch.y !== undefined) next.y = place(Number(patch.y));
    return next;
  });
}

export const removeMark = (items, id) => items.filter((m) => m.id !== id);

/**
 * What the sheet still has to be given: the register's welds (Shop or Field
 * as the engine decided) and the model's spools that no mark stands for.
 * Welds are matched by number, so a printed number the model read and
 * the register's own number of that weld are one weld, not two.
 */
export function unplaced(register, spoolIds, items) {
  const has = (cls, no) => items.some((m) => KINDS[m.kind].cls === cls && m.no === text(no));
  const out = [];
  for (const w of register || []) {
    if (!has("weld", w.no)) out.push({ kind: w.loc === "Field" ? "weld-field" : w.loc === "Shop" ? "weld-shop" : "weld-unknown", no: text(w.no) });
  }
  for (const s of spoolIds || []) {
    if (s != null && !has("spool", s)) out.push({ kind: "spool", no: text(s) });
  }
  return out;
}

/** Problems a person should see before relying on the sheet: the same number twice in a class. */
export function problems(items) {
  const seen = new Map(), out = [];
  for (const m of items) {
    if (!m.no) { out.push(`یک ${KINDS[m.kind].label} شماره ندارد`); continue; }
    const k = `${KINDS[m.kind].cls}|${m.no}`;
    if (seen.has(k)) out.push(`${KINDS[m.kind].label} «${m.no}» دو بار روی نقشه هست`);
    seen.set(k, true);
  }
  return out;
}
