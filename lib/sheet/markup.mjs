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
  const ax = Number(m.ax), ay = Number(m.ay);
  const lead = m.ax != null && m.ay != null && Number.isFinite(ax) && Number.isFinite(ay) ? { ax: place(ax), ay: place(ay) } : {};
  return { id: text(m.id), kind: m.kind, no: text(m.no), x: place(x), y: place(y), ...lead, src: m.src || src };
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
    // a weld's leader ends on the pipe at its weld point: kept when the model saw where, never guessed
    const tx = Number(raw.tx), ty = Number(raw.ty);
    const lead = kind.startsWith("weld") && raw.tx != null && raw.ty != null && Number.isFinite(tx) && Number.isFinite(ty)
      ? { ax: place(tx), ay: place(ty) } : {};
    items.push({ kind, no, x: place(Number(raw.x)), y: place(Number(raw.y)), ...lead, src: "model" });
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

/**
 * Where the ENGINE's welds are on the sheet, from where the model saw each
 * node DRAWN (node.px / node.py, fractions of the sheet; NODES_PROMPT).
 *
 * The engine decides every weld and where it is on the route (model.welds:
 * its node and its 3D point); the drawing is not to scale, so the weld is put
 * on the drawn pipe the same fraction of the way from its node towards the
 * neighbour it lies towards — on the line, never off it. Its frame is set a
 * little to one side of the pipe and joined to the weld point by a leader,
 * as a designer marks a sheet. Shop/Field is the register's; a weld whose
 * node was not seen on the sheet is left out (it stays in the list to place
 * by hand), never put somewhere.
 *
 * @param model   buildModel() result (welds, register, nodes, pts, edges)
 * @param nodes   the extraction's nodes, carrying px/py
 * @param aspect  sheet width / height, so "to one side" is square on the page
 * @returns {{items: object[], missing: string[]}}
 */
export function fromEngine(model, nodes, aspect = Math.SQRT2) {
  const items = [], missing = [];
  if (!model || model.error || !Array.isArray(model.welds)) return { items, missing };
  const byId = new Map((nodes || []).map((n) => [n?.id, n]));
  const pix = (i) => {
    const n = byId.get(model.nodes?.[i]?.id);
    const x = Number(n?.px), y = Number(n?.py);
    return n && n.px != null && n.py != null && Number.isFinite(x) && Number.isFinite(y) ? { x: clamp01(x), y: clamp01(y) } : null;
  };
  const loc = new Map((model.register || []).map((r) => [r.no, r.loc]));
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
  const len = (v) => Math.hypot(v.x, v.y, v.z || 0);
  let k = 0;
  for (const w of model.welds) {
    if (w.tag !== "weld" || w.no == null) continue;
    const p0 = w.node != null ? pix(w.node) : null;
    if (!p0) { missing.push(String(w.no)); continue; }
    // the neighbour the weld lies towards, and how far along (in the model; the sheet is not to scale)
    let anchor = p0, dir = null;
    const v = w.at && model.pts?.[w.node] ? sub(w.at, model.pts[w.node]) : null;
    const nbrs = (model.edges || []).flatMap((e) => (e.a === w.node ? [e.b] : e.b === w.node ? [e.a] : []));
    let best = null;
    for (const j of nbrs) {
      const p1 = pix(j);
      if (!p1 || !model.pts?.[j]) continue;
      const u = sub(model.pts[j], model.pts[w.node]);
      const cos = v && len(v) > 1 ? (v.x * u.x + v.y * u.y + (v.z || 0) * (u.z || 0)) / (len(v) * len(u) || 1) : 0;
      if (!best || cos > best.cos) best = { cos, p1, t: v && len(u) ? Math.min(1, len(v) / len(u)) : 0 };
    }
    if (best) {
      const t = best.cos > 0.5 ? best.t : 0;
      anchor = { x: p0.x + (best.p1.x - p0.x) * t, y: p0.y + (best.p1.y - p0.y) * t };
      dir = { x: (best.p1.x - p0.x) * aspect, y: best.p1.y - p0.y };
    }
    // to one side of the drawn pipe, alternating, a little further out every third weld
    let nx = 0.7071, ny = -0.7071;
    if (dir && Math.hypot(dir.x, dir.y) > 1e-6) { const l = Math.hypot(dir.x, dir.y); nx = -dir.y / l; ny = dir.x / l; }
    const side = k % 2 ? -1 : 1, reach = 0.035 + 0.012 * (k % 3);
    k++;
    const fx = anchor.x + (side * nx * reach) / aspect, fy = anchor.y + side * ny * reach;
    const l = loc.get(w.no);
    items.push({ kind: l === "Field" ? "weld-field" : l === "Shop" ? "weld-shop" : "weld-unknown", no: String(w.no),
      x: place(fx), y: place(fy), ax: place(anchor.x), ay: place(anchor.y), src: "engine" });
  }
  // two welds at one fitting would put their frames on top of each other: push apart until each can be read
  const GAP = 0.055;   // about one frame wide on a sheet shown at its usual size
  for (let round = 0; round < 30; round++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      let dx = (b.x - a.x) * aspect, dy = b.y - a.y;
      const d = Math.hypot(dx, dy);
      if (d >= GAP) continue;
      if (d < 1e-6) { dx = 1; dy = 0; } else { dx /= d; dy /= d; }
      const push = (GAP - Math.max(d, 1e-6)) / 2;
      a.x = place(a.x - (dx * push) / aspect); a.y = place(a.y - dy * push);
      b.x = place(b.x + (dx * push) / aspect); b.y = place(b.y + dy * push);
      moved = true;
    }
    if (!moved) break;
  }
  return { items: withIds(items), missing };
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
    // null takes the leader away: a weld point that is not known is not drawn
    if (patch.ax === null || patch.ay === null) { delete next.ax; delete next.ay; }
    else {
      if (patch.ax !== undefined) next.ax = place(Number(patch.ax));
      if (patch.ay !== undefined) next.ay = place(Number(patch.ay));
    }
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
