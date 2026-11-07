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
  // an in-line item installed on the pipe (a valve, a strainer, an instrument…): a triangle
  equipment: { shape: "triangle", label: "تجهیز نصب", cls: "equipment" },
};
export const KIND_IDS = Object.keys(KINDS);

/**
 * How big a mark is on the sheet, as a fraction of the sheet's WIDTH, outer
 * edge to outer edge — measured on the owner's marked example (25-1020 sheet 1,
 * 200 dpi, 3307 px wide: weld frames 79 px, spool ovals 142 x 63 px, support
 * hexagons 106 x 82 px, frame lines 3 px, leaders 2 px). Marks are drawn at
 * this size whatever the zoom, so they sit on the sheet as the designer's own.
 */
export const SHEET_SIZE = {
  weld: { w: 0.024, h: 0.024 },
  spool: { w: 0.043, h: 0.019 },
  support: { w: 0.032, h: 0.025 },
  equipment: { w: 0.03, h: 0.026 },
  stroke: 0.0009,
  leader: 0.0006,
};

/**
 * What a mark records beside its number. A weld: where it is joined and how,
 * at what size, schedule and material, in which spool, under which WPS. A
 * spool: its size, material, length. A support: its type and size. All free
 * text a person can edit; what the engine or the sheet's BOM said fills them,
 * and what nobody said stays blank.
 */
export const ATTRS = {
  weld: [["c1", "قطعهٔ ۱ (BOM)", ""], ["c2", "قطعهٔ ۲ (BOM)", ""], ["type", "نوع اتصال", "BW"], ["size", "قطر", "1\""], ["schedule", "Sch / ضخامت", "40S"], ["material", "جنس", "A312-TP304"],
    ["spool", "اسپول", "SP-1"], ["wps", "WPS", ""], ["ref", "اتصال به (Tie-in)", ""], ["note", "توضیح", ""]],
  spool: [["size", "قطر", ""], ["material", "جنس", ""], ["lengthMm", "طول (mm)", ""], ["note", "توضیح", ""]],
  support: [["type", "نوع", "FS133"], ["size", "قطر", ""], ["note", "توضیح", ""]],
  // an installed item: its type and tag, the BOM row it is, the spool it is in, the welds it joins
  // (their numbers, comma separated), its accessories ("PT×qty, PT×qty": gasket, bolts, nuts — rows of
  // the same BOM) and how far its installation is
  equipment: [["type", "نوع", "Gate Valve"], ["tag", "تگ", "GV-001"], ["c1", "ردیف BOM تجهیز", ""], ["spool", "اسپول", "SP-1"],
    ["welds", "سرجوش‌های متصل", ""], ["acc", "متعلقات (PT×تعداد)", ""], ["status", "وضعیت نصب", ""], ["note", "توضیح", ""]],
};
export const EQUIPMENT_STATUS = [["planned", "برنامه‌ریزی‌شده"], ["delivered", "تحویل‌شده"], ["installed", "نصب‌شده"], ["tested", "تست‌شده"]];

/** The welds an equipment joins, as written ("1, 4 ,W-7") → ["1", "4", "W-7"], no repeats. */
/** The welds an equipment joins as the page holds them — persistent identities (uids), comma separated: ONLY valid UUIDs, no repeats. */
export const weldRefsOf = (v) => [...new Set(text(v).split(/[,،;\s]+/).map((x) => x.trim().toLowerCase()).filter((x) => UID_TEXT.test(x)))];
const UID_TEXT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const weldsOf = (v) => [...new Set(text(v).split(/[,،;\s]+/).map((x) => x.trim()).filter(Boolean))];
/**
 * The welds an equipment joins, resolved by IDENTITY. `attrs.weldRefs` (uids) is authoritative: each names a weld of `items` or is `dangling`
 * (the weld is gone). An equipment with no refs yet (legacy) names welds by printed number: a number links only if it names exactly ONE weld;
 * a number that names several (`ambiguous`) or none (`missing`) is reported and linked to nothing. The printed number is display only.
 * @returns {{ joined: Array<{ uid: string, no: string }>, dangling: string[], unresolved: Array<{ no: string, reason: "ambiguous"|"missing" }>, legacy: boolean }}
 */
export function equipmentWelds(equipment, items) {
  const welds = (items || []).filter((m) => KINDS[m?.kind]?.cls === "weld");
  const key = (m) => (isUidText(m?.uid) ? m.uid.toLowerCase() : text(m?.id));
  const a = equipment?.attrs || {};
  const refs = weldRefsOf(a.weldRefs);
  if (refs.length) {
    const by = new Map(welds.map((w) => [key(w), w]));
    return { joined: refs.filter((u) => by.has(u)).map((u) => ({ uid: u, no: text(by.get(u).no) })), dangling: refs.filter((u) => !by.has(u)), unresolved: [], legacy: false };
  }
  const joined = [], unresolved = [];
  for (const n of weldsOf(a.welds)) {
    const c = welds.filter((w) => plainNo(w.no) === plainNo(n));
    if (c.length === 1) joined.push({ uid: key(c[0]), no: text(c[0].no) });
    else unresolved.push({ no: n, reason: c.length ? "ambiguous" : "missing" });
  }
  return { joined, dangling: [], unresolved, legacy: true };
}

/** Its accessories, as written ("10×1, 11x10") → [{ pt, qty }]; a part that is not PT×quantity is dropped, a PT written twice adds. */
export function accessoriesOf(v) {
  const m = new Map();
  for (const part of text(v).split(/[,،;]+/)) {
    const g = part.trim().match(/^(\d{1,3})\s*[×xX*]\s*(\d+(?:\.\d+)?)$/);
    if (!g || !(Number(g[2]) > 0)) continue;
    m.set(g[1], (m.get(g[1]) || 0) + Number(g[2]));
  }
  return [...m].map(([pt, qty]) => ({ pt, qty }));
}
export const accessoriesText = (list) => (list || []).map((a) => `${a.pt}×${a.qty}`).join(", ");
/**
 * Kept with a weld but not a column of its own: what each of its two BOM
 * components was when a person picked it (its PT row's description and size,
 * "description | size"), so a BOM row changed later is reported, not silently
 * taken as what the weld joins (componentChecks).
 */
// (+ `spoolUid`: the spool a weld / an equipment belongs to, by identity — not a form field of its own; the form's spool selector writes it, the printed `spool` is its label)
export const ATTR_SNAPSHOTS = { weld: ["c1s", "c2s", "spoolUid"], equipment: ["c1s", "weldRefs", "spoolUid"] };
const ATTR_KEYS = Object.fromEntries(Object.entries(ATTRS).map(([cls, a]) => [cls, [...a.map(([k]) => k), ...(ATTR_SNAPSHOTS[cls] || [])]]));
function cleanAttrs(kind, attrs) {
  const keys = ATTR_KEYS[KINDS[kind]?.cls] || [];
  const out = {};
  for (const k of keys) { const v = text(attrs?.[k]); if (v) out[k] = v; }
  return out;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const place = (v) => Math.round(clamp01(v) * 10000) / 10000;
const text = (v) => String(v ?? "").trim();

/**
 * A weld's number as the sheet shows it: the number alone ("W-01" → "1",
 * "SW-12" → "12", "4-1" stays), so a frame takes as little room on the drawing
 * as the designer's own. Anything that is not a prefix and a number is kept as typed.
 */
export function plainNo(no) {
  const t = text(no);
  const m = t.match(/^(?:[A-Za-z]+[-\s]*)?0*(\d+(?:-\d+)?)$/);
  return m ? m[1] : t;
}

/**
 * How selection, menus and tables REFER to a mark: its persistent identity (`uid`) if it has one, else its legacy list handle
 * (`id`). A reference is never the printed number. `isMark` resolves a reference — a uid, or a legacy handle for a mark with no
 * uid and for older callers — so every mutator below takes either.
 */
export const markRef = (m) => (isUidText(m?.uid) ? m.uid : text(m?.id));
export const isMark = (m, ref) => ref != null && ref !== "" && (m?.uid === ref || m?.id === ref);
export const findMark = (items, ref) => (items || []).find((m) => isMark(m, ref)) || null;

/** A mark with a place on the sheet. The others are rows a person has not yet joined to the drawing. */
export const isPlaced = (m) => Number.isFinite(m?.x) && Number.isFinite(m?.y);

/** A persistent identity (mark-identity.mjs UID_RE, repeated here: that module imports this one). */
const isUidText = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
function freshUid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** A mark with a well-formed kind, number and place, or null. */
function clean(m, src) {
  if (!m || !(m.kind in KINDS)) return null;
  // a mark with no place is a row of the table not yet joined to the drawing (and has no leader either)
  const x = m.x == null ? NaN : Number(m.x), y = m.y == null ? NaN : Number(m.y);
  const placed = Number.isFinite(x) && Number.isFinite(y);
  const ax = Number(m.ax), ay = Number(m.ay);
  const lead = placed && m.ax != null && m.ay != null && Number.isFinite(ax) && Number.isFinite(ay) ? { ax: place(ax), ay: place(ay) } : {};
  const attrs = cleanAttrs(m.kind, m.attrs);
  return { id: text(m.id), ...(isUidText(m.uid) ? { uid: m.uid } : {}), kind: m.kind, no: text(m.no), ...(placed ? { x: place(x), y: place(y) } : {}), ...lead,
    ...(Object.keys(attrs).length ? { attrs } : {}), src: m.src || src };
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
export function fromEngine(model, nodes, aspect = Math.SQRT2, bom = []) {
  const items = [], missing = [];
  if (!model || model.error || !Array.isArray(model.welds)) return { items, missing };
  const byId = new Map((nodes || []).map((n) => [n?.id, n]));
  const pix = (i) => {
    const n = byId.get(model.nodes?.[i]?.id);
    const x = Number(n?.px), y = Number(n?.py);
    return n && n.px != null && n.py != null && Number.isFinite(x) && Number.isFinite(y) ? { x: clamp01(x), y: clamp01(y) } : null;
  };
  const loc = new Map((model.register || []).map((r) => [r.no, r.loc]));
  const reg = new Map((model.register || []).map((r) => [r.no, r]));
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: (a.z || 0) - (b.z || 0) });
  const len = (v) => Math.hypot(v.x, v.y, v.z || 0);
  let k = 0;
  for (const w of model.welds) {
    if (w.tag !== "weld" || w.no == null) continue;
    const p0 = w.node != null ? pix(w.node) : null;
    const l0 = loc.get(w.no);
    const r0 = reg.get(w.no) || {};
    if (!p0) {
      // its node was not seen on the sheet: a row of the table, not joined to the drawing — never put somewhere
      missing.push(plainNo(w.no));
      const a0 = cleanAttrs("weld-shop", { type: r0.kind, size: r0.nps != null ? `${r0.nps}"` : "",
        schedule: scheduleOf(r0.size, r0.nps), material: materialAt(bom, r0.nps), spool: r0.spool });
      items.push({ kind: l0 === "Field" ? "weld-field" : l0 === "Shop" ? "weld-shop" : "weld-unknown", no: plainNo(w.no),
        ...(Object.keys(a0).length ? { attrs: a0 } : {}), src: "engine" });
      continue;
    }
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
    const r = reg.get(w.no) || {};
    const attrs = cleanAttrs("weld-shop", { type: r.kind, size: r.nps != null ? `${r.nps}"` : "",
      schedule: scheduleOf(r.size, r.nps), material: materialAt(bom, r.nps), spool: r.spool });
    items.push({ kind: l === "Field" ? "weld-field" : l === "Shop" ? "weld-shop" : "weld-unknown", no: plainNo(w.no),
      x: place(fx), y: place(fy), ax: place(anchor.x), ay: place(anchor.y), ...(Object.keys(attrs).length ? { attrs } : {}), src: "engine" });
  }
  // the spools the engine made, as rows to join to their ovals on the drawing
  for (const sp of model.spoolIds || []) if (sp != null) items.push({ kind: "spool", no: text(sp), src: "engine" });
  // two welds at one fitting would put their frames on top of each other: push apart until each can be read
  const GAP = 0.055;   // about one frame wide on a sheet shown at its usual size
  for (let round = 0; round < 30; round++) {
    let moved = false;
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (!isPlaced(a) || !isPlaced(b)) continue;
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

/**
 * Give every mark an id that is unique in the list and keeps the ones it already has — and a persistent identity (`uid`,
 * lib/sheet/mark-identity.mjs): one it already has is kept, a mark without one is born with one, a uid used earlier in the
 * list is not given twice (the second mark is a copy and gets its own).
 */
export function withIds(items) {
  const used = new Set(items.map((m) => m.id).filter(Boolean));
  const uids = new Set();
  let n = 0;
  return items.map((m) => {
    let out = m;
    if (!m.id) {
      while (used.has(`m${++n}`));
      used.add(`m${n}`);
      out = { ...m, id: `m${n}` };
    }
    if (!isUidText(out.uid) || uids.has(out.uid)) {
      let u = freshUid();
      while (uids.has(u)) u = freshUid();
      out = { ...out, uid: u };
    }
    uids.add(out.uid);
    return out;
  });
}

/** What the payload keeps: only well-formed marks, ids filled. */
export function normalize(items) {
  const out = [];
  for (const m of Array.isArray(items) ? items : []) { const c = clean(m, "hand"); if (c) out.push(c); }
  return withIds(out);
}

/**
 * The next free number for a kind's class, written the way the sheet writes
 * that class: one past the largest number in use with its prefix ("SP-3" →
 * "SP-4", "SW-2" → "SW-3", "12" → "13"); the prefix the most marks of the
 * class use wins, plain numbers when it is a tie or there are none ("1").
 */
export function nextNo(items, kind) {
  const cls = KINDS[kind]?.cls;
  const byPrefix = new Map();      // prefix → { n: marks, max }
  for (const m of items) {
    if (KINDS[m.kind]?.cls !== cls) continue;
    const t = text(m.no).match(/^(.*?)(\d+)$/);
    if (!t) continue;
    const g = byPrefix.get(t[1]) || { n: 0, max: 0 };
    g.n += 1; g.max = Math.max(g.max, Number(t[2]));
    byPrefix.set(t[1], g);
  }
  let best = "", top = byPrefix.get("") || { n: 0, max: 0 };
  for (const [p, g] of byPrefix) if (g.n > top.n) { best = p; top = g; }
  return `${best}${top.max + 1}`;
}

/** A new mark. With a place it is on the sheet; without, it is a row of the table to be joined to the drawing. */
export function addMark(items, { kind, no, x, y, ax, ay }) {
  if (!(kind in KINDS)) throw new Error(`نوع نشانه ناشناخته: ${kind}`);
  const at = x == null || y == null ? {} : { x: place(x), y: place(y) };
  const lead = at.x != null && ax != null && ay != null ? { ax: place(ax), ay: place(ay) } : {};
  return withIds([...items, { kind, no: text(no) || nextNo(items, kind), ...at, ...lead, src: "hand" }]);
}

/**
 * Where a frame goes beside a weld point: to one side of it, as the designer
 * puts one, on the first of eight directions (the side given first) where it
 * does not land on another frame. `prefer` is a unit vector (x scaled by the
 * sheet's aspect); the default is up and to the right.
 */
export function frameSpot(anchor, others, aspect = Math.SQRT2, prefer = { x: 0.7071, y: -0.7071 }) {
  const GAP = 0.055;
  const base = Math.atan2(prefer.y, prefer.x);
  for (const reach of [0.05, 0.075, 0.1]) {
    for (let k = 0; k < 8; k++) {
      const a = base + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * (Math.PI / 4);
      const fx = clamp01(anchor.x + (Math.cos(a) * reach) / aspect), fy = clamp01(anchor.y + Math.sin(a) * reach);
      const clear = others.every((o) => !isPlaced(o) || Math.hypot((o.x - fx) * aspect, o.y - fy) >= GAP);
      if (clear) return { x: fx, y: fy };
    }
  }
  return { x: clamp01(anchor.x + 0.05 / aspect), y: clamp01(anchor.y - 0.05) };
}

/**
 * Join a mark to the drawing at a weld point: the leader's end is the point
 * clicked, the frame stands beside it (or, for a mark already on the sheet,
 * keeps its offset from the point it had). The same for a weld, a spool and
 * a support, whoever made the mark.
 */
export function placeAt(items, id, point, aspect = Math.SQRT2) {
  const target = findMark(items, id);
  if (!target) return items;
  const a = { x: clamp01(point.x), y: clamp01(point.y) };
  let frame;
  if (isPlaced(target) && target.ax != null && target.ay != null) {
    frame = { x: clamp01(target.x + (a.x - target.ax)), y: clamp01(target.y + (a.y - target.ay)) };
  } else {
    frame = frameSpot(a, items.filter((m) => !isMark(m, id)), aspect);
  }
  return items.map((m) => (isMark(m, id) ? { ...m, x: place(frame.x), y: place(frame.y), ax: place(a.x), ay: place(a.y), src: "hand" } : m));
}

/** Take a mark off the drawing: it stays a row of the table, not joined to the sheet. */
export function unplace(items, id) {
  return items.map((m) => {
    if (!isMark(m, id)) return m;
    const { x, y, ax, ay, ...rest } = m;
    return rest;
  });
}

/** Change one mark; a moved or edited mark is the person's now, whatever put it there. */
export function updateMark(items, id, patch) {
  return items.map((m) => {
    if (!isMark(m, id)) return m;
    const next = { ...m, src: "hand" };
    if (patch.kind !== undefined && patch.kind in KINDS) next.kind = patch.kind;
    if (patch.no !== undefined) next.no = text(patch.no);
    if (patch.x !== undefined) next.x = place(Number(patch.x));
    if (patch.y !== undefined) next.y = place(Number(patch.y));
    if (patch.attrs !== undefined) {
      const a = cleanAttrs(next.kind, { ...(next.attrs || {}), ...patch.attrs });
      if (Object.keys(a).length) next.attrs = a; else delete next.attrs;
    }
    // null takes the leader away: a weld point that is not known is not drawn
    if (patch.ax === null || patch.ay === null) { delete next.ax; delete next.ay; }
    else {
      if (patch.ax !== undefined) next.ax = place(Number(patch.ax));
      if (patch.ay !== undefined) next.ay = place(Number(patch.ay));
    }
    return next;
  });
}

export const removeMark = (items, id) => items.filter((m) => !isMark(m, id));

/**
 * A copy of a mark with everything it records (its attributes, BOM
 * components, spool, WPS…), a new id and the next free number of its class,
 * put a little below and to the side of the original so a person can drag it
 * where it belongs. A mark not on the drawing is copied as a row only.
 */
/** Attributes that record what has HAPPENED to an item, not what it is: never copied to a duplicate. */
export const OPERATIONAL_ATTRS = new Set(["status", "weldRefs", "welds"]);   // (the welds an equipment joins are a relationship of THAT item: a copy joins none until someone says so)

export function duplicateMark(items, id, aspect = Math.SQRT2) {
  const m = findMark(items, id);
  if (!m) return { items, id: null, key: null };
  const d = 0.03;
  const at = isPlaced(m) ? { x: place(m.x + d / aspect), y: place(m.y + d) } : {};
  const lead = isPlaced(m) && m.ax != null && m.ay != null ? { ax: place(m.ax + d / aspect), ay: place(m.ay + d) } : {};
  const { id: _old, uid: _uid, x, y, ax, ay, no, ...rest } = m;   // a copy is a new mark: new id, new persistent identity
  // What a copy takes is the ENGINEERING description. Where the item stands in its life (installed, tested) belongs to the original
  // alone: the copy starts planned. Allocation lines and accessory statuses are keyed by identity on the server, so none follow.
  const attrs = m.attrs ? Object.fromEntries(Object.entries(m.attrs).filter(([k]) => !OPERATIONAL_ATTRS.has(k))) : null;
  const next = withIds([...items, { ...rest, no: nextNo(items, m.kind), ...at, ...lead, ...(attrs ? { attrs } : {}), src: "hand" }]);
  const made = next[next.length - 1];
  return { items: next, id: made.id, key: markRef(made) };
}

/**
 * What else on the sheet names this mark, said before it is deleted: the
 * welds a spool holds (they keep naming it), and the welds that give a weld
 * as their Tie-in reference. Nothing is deleted with it.
 */
export function dependents(items, id, cuts = []) {
  const m = findMark(items, id);
  if (!m || !text(m.no)) return [];
  const no = text(m.no), cls = KINDS[m.kind]?.cls;
  const welds = items.filter((x) => !isMark(x, id) && KINDS[x.kind]?.cls === "weld");
  if (cls === "spool") {
    const uid = text(m.uid).toLowerCase(), cutList = Array.isArray(cuts) ? cuts : [];
    // by identity first; a weld/piece with no spool uid is counted by its printed number (a legacy reference)
    const ofWeld = (w) => (text(w.attrs?.spoolUid) ? uid && text(w.attrs.spoolUid).toLowerCase() === uid : text(w.attrs?.spool) === no);
    const ofCut = (c) => (text(c.spoolUid) ? uid && text(c.spoolUid).toLowerCase() === uid : text(c.spool) === no);
    const equip = items.filter((x) => !isMark(x, id) && KINDS[x.kind]?.cls === "equipment");
    const lines = [...welds.filter(ofWeld).map((w) => `سرجوش ${w.no || "؟"} در اسپول ${no}`),
      ...equip.filter(ofWeld).map((e) => `تجهیز ${e.no || "؟"}${e.attrs?.tag ? ` (${e.attrs.tag})` : ""} در اسپول ${no}${["installed", "tested"].includes(text(e.attrs?.status)) ? " — نصب/تست‌شده" : ""}`),
      ...cutList.filter(ofCut).map((c) => `قطعهٔ برش <${text(c.piece) || "؟"}> به اسپول ${no} می‌رود`)];
    // the preview is advice; the SERVER refuses the save while any of these still names the spool (409 SPOOL_IN_USE)
    return lines.length ? [...lines, "سرور تا جابه‌جایی یا برداشتن این ارتباط‌ها ذخیرهٔ حذف را رد می‌کند و چیزی را خودکار جدا نمی‌کند"] : lines;
  }
  if (cls === "weld") {
    const wuid = text(m.uid).toLowerCase();
    const cutDeps = (Array.isArray(cuts) ? cuts : []).filter((c) => wuid && [c.fromUid, c.toUid].some((u) => text(u).toLowerCase() === wuid)).map((c) => `قطعهٔ برش <${text(c.piece) || "؟"}> به این سرجوش می‌رسد`);
    return [...cutDeps, ...welds.filter((w) => text(w.attrs?.ref) && plainNo(w.attrs.ref) === plainNo(no)).map((w) => `سرجوش ${w.no || "؟"} به ${no} ارجاع داده (Tie-in)`),
      ...items.filter((x) => KINDS[x.kind]?.cls === "equipment" && equipmentWelds(x, items).joined.some((j) => isMark(m, j.uid))).map((e) => `تجهیز ${e.no || "؟"} به این سرجوش وصل است`)];
  }
  if (cls === "equipment" && accessoriesOf(m.attrs?.acc).length) return [`تجهیز ${no} متعلقات دارد (${accessoriesText(accessoriesOf(m.attrs.acc))}) که رزروشان با حذف آزاد می‌شود`];
  return [];
}

/** A BOM row as a weld keeps it when picked: "description | size". */
export const bomSnapshot = (row) => (row ? `${text(row.description)} | ${text(row.diam ?? row.size)}` : "");

/** Sizes a size text names ('4"', '2 x 3/4', '1.1/2'), as numbers. */
function sizes(v) {
  return text(v).split(/\s*[xX×]\s*/).map((t) => {
    const s = t.replace(/["”]|NS|NPS|IN(CH)?/gi, "").trim();
    const m = s.match(/^(\d+)(?:[\s.-]+(\d+)\/(\d+))?$|^(\d+)\/(\d+)$|^(\d*\.\d+)$/);
    if (!m) return Number(s) || 0;
    if (m[4]) return Number(m[4]) / Number(m[5]);
    if (m[6]) return Number(m[6]);
    return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
  }).filter((n) => n > 0);
}
/** Sizes a size text names, as numbers ('2 x 3/4' → [2, 0.75]). */
export const sizesOf = (v) => sizes(v);
const isPipeRow = (b) => /^PIPE\b/i.test(text(b?.group)) || /^PIPE\b/i.test(text(b?.description));

/**
 * What a person should check about each weld's two BOM components, as
 * warnings — nothing is corrected or inferred (the joint type stays theirs):
 *   a component that is not a PT row of this sheet's BOM;
 *   the same PT on both sides, unless it is pipe or the BOM counts two or more of it;
 *   the weld's size not among a component's sizes;
 *   a BOM row changed since it was picked (description or size).
 */
export function componentChecks(items, bom = []) {
  const byPt = new Map((bom || []).filter((b) => b && b.pt != null && text(b.pt)).map((b) => [text(b.pt), b]));
  const out = [];
  for (const w of items.filter((m) => KINDS[m.kind]?.cls === "weld")) {
    const a = w.attrs || {}, at = `سرجوش ${w.no || "؟"}`;
    const c1 = text(a.c1), c2 = text(a.c2);
    if (!c1 && !c2) continue;
    for (const [k, pt] of [["c1", c1], ["c2", c2]]) {
      if (!pt) continue;
      const row = byPt.get(pt);
      const n = k === "c1" ? "۱" : "۲";
      if (!row) { out.push(`${at}: قطعهٔ ${n} (PT ${pt}) در BOM این برگ نیست`); continue; }
      const snap = text(a[`${k}s`]);
      if (snap && snap !== bomSnapshot(row)) out.push(`${at}: ردیف PT ${pt} در BOM از وقتی انتخاب شد عوض شده («${snap}» → «${bomSnapshot(row)}»)`);
      const ws = sizes(a.size);
      if (ws.length && sizes(row.diam ?? row.size).length && !ws.some((s) => sizes(row.diam ?? row.size).includes(s)))
        out.push(`${at}: قطر جوش (${a.size}) با قطر قطعهٔ ${n} (PT ${pt}: ${text(row.diam ?? row.size)}) نمی‌خواند`);
    }
    // one BOM line on both sides is two pieces of it: pipe, or a fitting the BOM counts more than once
    if (c1 && c2 && c1 === c2 && byPt.has(c1) && !isPipeRow(byPt.get(c1)) && Number(byPt.get(c1).qty) < 2)
      out.push(`${at}: هر دو قطعه PT ${c1} است ولی BOM از آن ${byPt.get(c1).qty ?? "؟"} عدد دارد — بررسی کنید`);
  }
  return out;
}

/** The marks that are rows of the table only: not joined to the drawing. */
export const notOnSheet = (items) => items.filter((m) => !isPlaced(m));

/**
 * The engine's row for a weld mark, by number (the mark shows "1", the
 * register has "W-01"): its Shop/Field, joint type, level and NDT, which a
 * person does not edit on the sheet.
 */
export function engineRow(model, no) {
  if (!model || model.error) return null;
  return (model.register || []).find((r) => plainNo(r.no) === text(no)) || null;
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

/** The schedule part of the engine's size text ('36" SCH 10' → 'SCH 10'), or "". */
export function scheduleOf(size, nps) {
  const t = text(size);
  const m = t.match(/\b(SCH\.?\s*[0-9A-Z]+|STD|XS|XXS|\d+(?:\.\d+)?\s*mm)\b/i);
  return m ? m[1].toUpperCase().replace(/\s+/g, " ") : "";
}

const GRADE = /\b(?:SA|A|API)[- ]?(?:5L[- ]?(?:GR\.?\s?)?[A-Z0-9]+|\d{2,4}(?:[- ](?:GR\.?\s?)?[A-Z]{0,3}\d{1,4}[A-Z]?|-?(?:TP|WP|F|GR)\d+[A-Z]?|[- ](?:GR\.?\s?)?[A-C]\b)?)\b/i;
/**
 * The pipe material the sheet's own BOM gives at one size: the grade read
 * from the PIPE rows of that size (A312-TP304, A106-B, API 5L-B), when they
 * all say the same. Two different grades, or none read, is "" — not a guess.
 */
/** The grade a BOM description names (A106-B, API 5L-B…), or "" — never a guess. */
export const gradeOf = (desc) => { const m = text(desc).match(GRADE); return m ? m[0].toUpperCase().replace(/\s+/g, " ") : ""; };

export function materialAt(bom, nps) {
  if (nps == null) return "";
  const found = new Set();
  for (const b of bom || []) {
    const isPipe = /^PIPE\b/i.test(text(b.group)) || /^PIPE\b/i.test(text(b.description));
    if (!isPipe || Number(b.diam) !== Number(nps)) continue;
    const m = text(b.description).match(GRADE);
    if (m) found.add(m[0].toUpperCase().replace(/\s+/g, " "));
    else return "";
  }
  return found.size === 1 ? [...found][0] : "";
}

/**
 * What a person should check about each installed item, as warnings — nothing
 * is corrected: its BOM row is not in this sheet's BOM; it joins no weld, or a
 * weld number that is not on the sheet; its spool is not on the sheet; an
 * accessory that is not a BOM row.
 */
export function equipmentChecks(items, bom = []) {
  const pts = new Set((bom || []).filter((b) => b && b.pt != null).map((b) => text(b.pt)));
  const spools = new Set(items.filter((m) => m.kind === "spool").map((m) => text(m.no)));
  const out = [];
  for (const e of items.filter((m) => KINDS[m.kind]?.cls === "equipment")) {
    const a = e.attrs || {}, at = `تجهیز ${e.no || "؟"}`;
    if (!text(a.c1)) out.push(`${at}: ردیف BOM آن انتخاب نشده`);
    else if (!pts.has(text(a.c1))) out.push(`${at}: PT ${text(a.c1)} در BOM این برگ نیست`);
    const ew = equipmentWelds(e, items);
    if (!ew.joined.length && !ew.unresolved.length && !ew.dangling.length) out.push(`${at}: به هیچ سرجوشی وصل نیست`);
    for (const u of ew.dangling) out.push(`${at}: سرجوشِ وصل‌شده (${u.slice(0, 8)}) روی این برگ نیست`);
    for (const x of ew.unresolved) out.push(x.reason === "ambiguous"
      ? `${at}: «${x.no}» نام چند سرجوش است؛ سرجوش درست را در فرم تجهیز انتخاب کنید (به هیچ‌کدام وصل نشد)`
      : `${at}: سرجوش ${x.no} روی این برگ نیست`);
    if (text(a.spool) && !spools.has(text(a.spool))) out.push(`${at}: اسپول ${text(a.spool)} روی این برگ نیست`);
    for (const x of accessoriesOf(a.acc)) if (!pts.has(x.pt)) out.push(`${at}: متعلقِ PT ${x.pt} در BOM این برگ نیست`);
    if (text(a.acc) && accessoriesOf(a.acc).length === 0) out.push(`${at}: متعلقات را به صورت «PT×تعداد، PT×تعداد» بنویسید`);
  }
  return out;
}

/**
 * The rules a sheet's spools and supports answer to, as problems a person
 * should see — not fixed by anyone but them:
 *   a shop weld is made in a spool, so it names one;
 *   a spool a weld names has its oval on the sheet, and an oval on the sheet
 *     has at least one weld in it;
 *   a support has its type.
 * Duplicate numbers are reported by problems().
 */
export function rules(items, weldList = null) {
  const out = [];
  // the welds: the sheet's weld marks, or — where the welds are kept as a list beside the sheet (the
  // weld-list form) — those rows, read the same way ({ no, loc: Shop|Field, spool })
  const welds = weldList
    ? weldList.map((r) => ({ no: text(r.no), kind: /^shop$/i.test(text(r.loc)) ? "weld-shop" : /^field$/i.test(text(r.loc)) ? "weld-field" : "weld-unknown",
        attrs: { spool: text(r.spool) } })).filter((w) => w.no)
    : items.filter((m) => KINDS[m.kind]?.cls === "weld");
  // a spool is "on the sheet" when its oval is joined to the drawing; a row of the table alone is not
  const spools = new Set(items.filter((m) => m.kind === "spool" && isPlaced(m)).map((m) => m.no));
  const named = new Set();
  for (const w of welds) {
    const sp = text(w.attrs?.spool);
    if (sp) named.add(sp);
    if (w.kind === "weld-shop" && !sp) out.push(`سرجوش کارگاهی ${w.no || "؟"} اسپول ندارد — جوش کارگاهی داخل یک اسپول زده می‌شود`);
  }
  for (const sp of named) if (!spools.has(sp)) out.push(`اسپول ${sp} را سرجوشی نام برده ولی بیضی‌اش روی نقشه نیست`);
  for (const sp of spools) if (sp && !named.has(sp)) out.push(`اسپول ${sp} روی نقشه هست ولی هیچ سرجوشی در آن نیست`);
  for (const s of items.filter((m) => m.kind === "support")) if (!text(s.attrs?.type)) out.push(`ساپورت ${s.no || "؟"} نوعش مشخص نیست`);
  return out;
}
