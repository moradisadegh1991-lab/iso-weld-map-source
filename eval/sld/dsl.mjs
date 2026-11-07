/**
 * A tiny drawing DSL for the SYNTHETIC SLD cases: each call draws a symbol (or text) AND records the ground truth for it, so the sheet and its gold can never disagree.
 * Coordinates: display frame, points, origin top-left. Text widths are Helvetica estimates, used only to place words; the extracted boxes come from the PDF itself.
 */
const TW = 0.54;
export class Drawing {
  constructor(width = 600, height = 300, { rotate = 0, number = 1 } = {}) { this.page = { width, height, rotate, shapes: [] }; this.number = number; this.gold = { symbols: [], texts: [], tags: [], assoc: [], ratings: [] }; }
  get shapes() { return this.page.shapes; }
  line(x0, y0, x1, y1, lw = 1) { this.shapes.push({ k: "line", x0, y0, x1, y1, lw }); return this; }
  circle(cx, cy, r, fill = false) { this.shapes.push({ k: "circle", cx, cy, r, fill }); return this; }
  rect(x0, y0, x1, y1, fill = false) { this.shapes.push({ k: "rect", x0, y0, x1, y1, fill }); return this; }
  _sym(cls, bbox, extra = {}) { const g = { id: this.gold.symbols.length, page: this.number, cls, bbox, ...extra }; this.gold.symbols.push(g); return g; }
  /** a text word; `gold` marks whether it is part of the ground truth (it always is here) */
  text(x, y, t, size = 8) { this.shapes.push({ k: "text", x, y, t, size }); this.gold.texts.push(t); return { x, y, w: t.length * size * TW, h: size }; }
  tag(x, y, t, sym, size = 8) { this.text(x, y, t, size); this.gold.tags.push(t); if (sym) this.gold.assoc.push([t, sym.id]); }
  rating(x, y, number, unit, sym, kind, value, u, size = 7) {
    this.text(x, y, number, size); const x2 = x + number.length * size * TW + 2; this.text(x2, y, unit, size);
    if (sym) this.gold.ratings.push([sym.id, `${kind}:${JSON.stringify(value)}:${u}`]);
  }
  // ── symbols ──
  transformer(cx, cy, { tag, kv, mva } = {}) {
    this.circle(cx - 6, cy, 10).circle(cx + 6, cy, 10);
    const s = this._sym("transformer", [cx - 16, cy - 10, cx + 16, cy + 10]);
    if (tag) this.tag(cx - 14, cy - 18, tag, s);
    if (kv) this.rating(cx + 22, cy - 3, kv[0], "kV", s, kv[2] || "voltage_levels", kv[1], "kV");
    if (mva) this.rating(cx + 22, cy + 8, mva, "MVA", s, "apparent_power", Number(mva), "MVA");
    return s;
  }
  lettered(cls, letter, cx, cy, tag) { this.circle(cx, cy, 10); this.text(cx - 3, cy + 3.5, letter, 9); const s = this._sym(cls, [cx - 10, cy - 10, cx + 10, cy + 10]); if (tag) this.tag(cx - 14, cy + 22, tag, s); return s; }
  motor(cx, cy, tag) { return this.lettered("motor", "M", cx, cy, tag); }
  generator(cx, cy, tag) { return this.lettered("generator", "G", cx, cy, tag); }
  ammeter(cx, cy) { return this.lettered("ammeter", "A", cx, cy); }
  voltmeter(cx, cy) { return this.lettered("voltmeter", "V", cx, cy); }
  breaker(cx, cy, tag) { const h = 7; this.rect(cx - h, cy - h, cx + h, cy + h).line(cx - h, cy - h, cx + h, cy + h).line(cx - h, cy + h, cx + h, cy - h); this.line(cx, cy - 40, cx, cy - h).line(cx, cy + h, cx, cy + 40); const s = this._sym("circuit_breaker", [cx - h, cy - h, cx + h, cy + h]); if (tag) this.tag(cx + 12, cy - 3, tag, s); return s; }
  fuse(cx, cy) { this.rect(cx - 3, cy - 9, cx + 3, cy + 9).line(cx, cy - 40, cx, cy - 9).line(cx, cy + 9, cx, cy + 40); return this._sym("fuse", [cx - 3, cy - 9, cx + 3, cy + 9]); }
  busbar(x0, y, x1, tag) { this.line(x0, y, x1, y, 4); const s = this._sym("busbar", [x0, y - 2, x1, y + 2]); if (tag) this.tag(x0, y - 12, tag, s); return s; }
  ground(cx, cy) { this.line(cx, cy - 12, cx, cy).line(cx - 10, cy, cx + 10, cy).line(cx - 6.5, cy + 3, cx + 6.5, cy + 3).line(cx - 3, cy + 6, cx + 3, cy + 6); return this._sym("ground", [cx - 10, cy, cx + 10, cy + 6]); }
  battery(cx, cy) { [14, 8, 14, 8].forEach((w, i) => this.line(cx - w, cy + i * 4, cx + w, cy + i * 4)); return this._sym("battery", [cx - 14, cy, cx + 14, cy + 12]); }
  junction(cx, cy) { this.circle(cx, cy, 2, true); return this._sym("junction", [cx - 2, cy - 2, cx + 2, cy + 2]); }
  ct(cx, cy) { this.line(cx, cy - 30, cx, cy + 30); this.circle(cx, cy, 6); return this._sym("current_transformer", [cx - 6, cy - 6, cx + 6, cy + 6]); }
  isolator(cx, cy) { this.line(cx, cy - 30, cx, cy - 8); this.line(cx, cy - 8, cx + 10, cy + 8); this.line(cx, cy + 8, cx, cy + 30); return this._sym("isolator", [cx, cy - 8, cx + 10, cy + 8]); }
  ups(x, y) { this.rect(x, y, x + 44, y + 26); this.text(x + 12, y + 17, "UPS", 9); return this._sym("ups", [x, y, x + 44, y + 26]); }
  relay(x, y, code) { this.rect(x, y, x + 30, y + 20); this.text(x + 6, y + 14, code, 8); return this._sym("protection_relay", [x, y, x + 30, y + 20]); }
  offpage(x, y, label) { this.shapes.push({ k: "poly", pts: [[x, y], [x + 30, y], [x + 40, y + 10], [x + 30, y + 20], [x, y + 20]], closed: true }); this.text(x + 3, y + 14, label, 7); return this._sym("offpage_reference", [x, y, x + 40, y + 20]); }
  // ── things the rules must NOT name ──
  unknownSquare(cx, cy) { this.rect(cx - 7, cy - 7, cx + 7, cy + 7).line(cx, cy - 40, cx, cy - 7).line(cx, cy + 7, cx, cy + 40); return this._sym("UNKNOWN", [cx - 7, cy - 7, cx + 7, cy + 7]); }
  unknownCircle(cx, cy) { this.circle(cx, cy, 9); return this._sym("UNKNOWN", [cx - 9, cy - 9, cx + 9, cy + 9]); }
  unknownTriangle(x, y) { this.shapes.push({ k: "poly", pts: [[x, y + 14], [x + 14, y + 14], [x + 7, y]], closed: true }); return this._sym("UNKNOWN", [x, y, x + 14, y + 14]); }
  /** plain wire (a connection line) — not part of the symbol gold, but drawn so the page looks like a diagram */
  wire(x0, y0, x1, y1) { return this.line(x0, y0, x1, y1); }
}
