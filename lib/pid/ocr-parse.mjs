/**
 * What a P&ID sheet prints, from the text an OCR pass found on it.
 *
 * The drawings this was written against (K110 ethane cracking, Kavian
 * Olefin) are AutoCAD sheets whose text was exploded into strokes: there is
 * no text layer, only positioned strings an OCR read (tools/pid-ocr.py).
 * This file is the deterministic half. It READS — tag formats, the line
 * numbering the project's own legend sheet declares, the ISA 5.1 letters —
 * and every value it cannot read stays null. It never infers a size from
 * a neighbour's, a service from a tag letter, or a class from a fluid.
 *
 * Line number, from the legend (K110-30-PID-0021-00-01):
 *
 *     4"  MP 1 40 001 A - EA01 - H
 *     |   |  | |  |   |   |      └ insulation code
 *     |   |  | |  |   |   └ piping class (pressure rating, material, serial)
 *     |   |  | |  |   └ A main line · P partial tracing · J jacket · T tracing
 *     |   |  | |  └ serial
 *     |   |  | └ section
 *     |   |  └ plant
 *     |   └ fluid
 *     └ nominal size, inches
 *
 * Instrument: ISA letters in the upper half of the bubble, the loop number
 * (plant, section, serial: 110912) in the lower. Equipment: 30-E1129 /
 * 30-D-1109 (unit 30). An off-page box prints the target sheet as
 * 21-10-15/1 — drawing serial 0021, section 10, sheet 15.
 */
import { parseTag } from "../instrumentation/isa.mjs";

/** The frame the thresholds below were measured in: an A3 sheet in points. */
const REF_W = 1191;

const norm = (t) => String(t || "").replace(/[”“″'`*²]/g, '"').replace(/\s+/g, " ").trim();
const cx = (it) => (it.b[0] + it.b[2]) / 2;
const cy = (it) => (it.b[1] + it.b[3]) / 2;
const w = (it) => it.b[2] - it.b[0];
const h = (it) => it.b[3] - it.b[1];

function iou(a, b) {
  const x0 = Math.max(a.b[0], b.b[0]), y0 = Math.max(a.b[1], b.b[1]);
  const x1 = Math.min(a.b[2], b.b[2]), y1 = Math.min(a.b[3], b.b[3]);
  const i = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  const u = w(a) * h(a) + w(b) * h(b) - i;
  return u > 0 ? i / u : 0;
}

/**
 * The OCR reads the page in overlapping tiles, and some strokes are drawn
 * twice: the same string can come back two or three times at nearly the
 * same place. Keep one — the most confident — of each.
 */
export function dedupe(items) {
  const out = [];
  for (const it of [...items].sort((a, b) => b.c - a.c)) {
    const t = norm(it.t).replace(/\s/g, "");
    const k = out.findIndex((o) => iou(o, it) > 0.35 && (norm(o.t).replace(/\s/g, "") === t
      || norm(o.t).includes(norm(it.t)) || norm(it.t).includes(norm(o.t))));
    if (k < 0) out.push({ ...it, t: norm(it.t) });
    // the longer reading of the same place says more ("4" DS110110A-DA10-H"
    // over "DS110110A"), even when the OCR was surer of the short one
    else if (norm(it.t).length > out[k].t.length && norm(it.t).includes(out[k].t)) out[k] = { ...it, t: norm(it.t) };
  }
  return out;
}

// ── equipment ────────────────────────────────────────────────────────────
// Unit, a letter code, four digits, an optional train suffix. The unit is
// two digits; a sheet references other units' equipment too (60- utilities).
// Printed «30-E1129», «30-D-1109» or, on many sheets, with spaces:
// «30 E 1422 A», «30 P 1403 A/B» (two pumps, A and B).
const EQUIP = /(?<![\d.\/-])(\d{2})[-\s]?([A-Z]{1,3})[-\s]?(\d{4})(?:\s?([A-Z](?:\/[A-Z])*)(?![A-Z])|([A-Z]{2})(?![A-Z]))?(?![\d])/g;
const NOT_EQUIP_CODE = new Set(["PID", "NM", "PFD"]);

export function equipmentTags(text) {
  const out = [];
  for (const m of String(text).toUpperCase().matchAll(EQUIP)) {
    const [, unit, code, num, letters, pair] = m;
    if (NOT_EQUIP_CODE.has(code)) continue;
    const sufs = pair ? [pair] : letters ? letters.split("/") : [""];
    for (const suf of sufs) out.push({ tag: `${unit}-${code}-${num}${suf}`, printed: m[0].trim() });
  }
  return out;
}

// ── lines ────────────────────────────────────────────────────────────────
// The size is often glued to the fluid by the OCR ("3DS110111A"): the fluid
// starts after anything but a letter, not at a word boundary.
const LINE = /(?:(\d{1,2}(?:[.\s-]?\d\/\d)?|\d\/\d)\s*"?\s*-?\s*)?(?<![A-Z])([A-Z]{1,3})\s?(\d)(\d{2})(\d{3})([APJT])-([A-Z]{1,2}\d{2}[A-Z]?)(?:-([A-Z]{1,2})(?![A-Z]))?/g;

/** Inches from "6", "3/4", "1 1/2", "1.1/2", "1-1/2"; null if not a size. */
export function inches(s) {
  const t = String(s || "").trim();
  let m = t.match(/^(\d{1,2})[\s.-](\d)\/(\d)$/);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = t.match(/^(\d)\/(\d)$/);
  if (m) return Number(m[1]) / Number(m[2]);
  m = t.match(/^(\d{1,2})$/);
  return m ? Number(m[1]) : null;
}

export function lineNumbers(text) {
  const out = [];
  for (const m of norm(text).toUpperCase().matchAll(LINE)) {
    const [, size, fluid, plant, section, serial, kind, cls, ins] = m;
    out.push({
      lineNo: `${fluid}${plant}${section}${serial}${kind}`,
      size: size ? inches(size) : null,
      fluid, plant, section, serial,
      kind: { A: "main", P: "partial tracing", J: "jacket", T: "tracing" }[kind],
      pipingClass: cls,
      insulation: ins || null,
      printed: m[0].trim(),
    });
  }
  return out;
}

// ── off-page references ──────────────────────────────────────────────────
const REF_FULL = /K110-?30-?PID-?(\d{4})-?(\d{2})-?(\d{2})\s?\/\s?(\d)/g;
// the box prints a grid zone (D2) beside the number; the OCR often glues them: D221-10-14/1
const REF_BOX = /(?:(?<![\d-])|(?<=\b[A-Z]\d))(\d{2})-(\d{2})-(\d{2})\s?\/\s?(\d)(?!\d)/g;

export function sheetRefs(text) {
  const t = norm(text).toUpperCase();
  const out = new Set();
  for (const m of t.matchAll(REF_FULL)) out.add(`K110-30-PID-${m[1]}-${m[2]}-${m[3]}`);
  if (!/K110/.test(t)) for (const m of t.matchAll(REF_BOX)) out.add(`K110-30-PID-00${m[1]}-${m[2]}-${m[3]}`);
  return [...out];
}

// ── instruments ──────────────────────────────────────────────────────────
const LETTERS = /^[A-Z]{1,5}$/;
const NUMBER = /^\d{5,6}[A-Z]?$/;
/** Bubble edges read as letters between merged bubbles. */
const SEPARATORS = /[^A-Z]/g;

/** "FICVFICVFIC/FIC" printed over k bubbles in a row → k letter groups. */
export function splitLetters(text, k) {
  const s = String(text).toUpperCase().replace(SEPARATORS, "|");
  const parts = s.split("|").filter(Boolean);
  if (parts.length === k) return parts;
  const n = s.length;
  if ((n - (k - 1)) % k === 0) {
    const L = (n - (k - 1)) / k;
    return Array.from({ length: k }, (_, i) => s.slice(i * (L + 1), i * (L + 1) + L));
  }
  if (n % k === 0) {
    const L = n / k;
    return Array.from({ length: k }, (_, i) => s.slice(i * L, i * L + L));
  }
  return null;
}

/** "110212110312" over two bubbles → ["110212", "110312"]. */
export function splitNumbers(text, digits = 6) {
  const s = String(text).replace(/[^\d]/g, "");
  if (s.length <= digits || s.length % digits) return null;
  return s.match(new RegExp(`\\d{${digits}}`, "g"));
}

/**
 * Bubbles: a letters string directly above a number string, centred on it.
 * `scale` maps this page's points onto the A3 frame the gaps were set in.
 */
export function instruments(items, scale = 1) {
  const out = [];
  const used = new Set();
  const lettersAt = items.filter((it) => /^[A-Z/|]{1,24}$/.test(it.t.replace(/\s/g, "")));
  const numbersAt = items.filter((it) => /^[\d\s/个|]{5,}[A-Z]?$/.test(it.t));
  for (const n of numbersAt) {
    const digits = n.t.replace(/[^\dA-Z]/g, "");
    const above = lettersAt
      .filter((l) => !used.has(l) && n.b[1] - l.b[3] > -4 * scale && n.b[1] - l.b[3] < 9 * scale
        && Math.min(l.b[2], n.b[2]) - Math.max(l.b[0], n.b[0]) > 0.4 * Math.min(w(l), w(n)))
      .sort((a, b) => Math.abs(cx(a) - cx(n)) - Math.abs(cx(b) - cx(n)))[0];
    if (!above) continue;
    const letters = above.t.replace(/\s/g, "");
    let pairs = null;
    if (NUMBER.test(digits) && LETTERS.test(letters)) pairs = [[letters, digits, false]];
    else {
      const nums = splitNumbers(digits);
      const lets = nums ? splitLetters(letters, nums.length) : null;
      if (nums && lets) pairs = nums.map((x, i) => [lets[i], x, true]);
    }
    if (!pairs) continue;
    for (const [L, N, split] of pairs) {
      const p = parseTag(`${L}-${N}`);
      if (!p) continue;
      out.push({ tag: `${L}-${N}`, letters: L, number: N, category: p.category, loop: p.loop, split,
        at: [Math.round(cx(above)), Math.round(cy(above))] });
    }
    used.add(above);
  }
  return out;
}

/**
 * Instruments from the bubbles found in the sheet's geometry
 * (tools/pid-bubbles.py): each bubble's inside was read on its own, letters
 * above, number below. OCR confusions are undone only where the position
 * fixes the meaning — an O among the digits is a 0, a 0 among the letters an
 * O. A number that is not six digits is kept as printed and named: on these
 * sheets that is a drafting slip (TE 1109953 beside TI 110953), not ours to
 * correct.
 */
export function instrumentsFromBubbles(bubbles = []) {
  const out = [];
  const problems = [];
  for (const b of bubbles) {
    const lines = (b.lines || []).map(([t]) => String(t).toUpperCase().replace(/\s+/g, ""));
    if (lines.length < 2) continue;
    // in the letters line a digit is a letter the OCR mistook: T1 is TI, 0 is O
    const letters = lines[0].replace(/0/g, "O").replace(/1/g, "I").replace(/5/g, "S").replace(/[^A-Z]/g, "");
    const m = lines.slice(1).join("").replace(/[OQ]/g, "0").replace(/[IL|]/g, "1").match(/^(\d{4,8})([A-Z]{0,2})$/);
    if (!letters || !m) continue;
    const [, digits, suffix] = m;
    const p = parseTag(`${letters}-${digits.slice(0, 6)}`);
    if (!p) continue;
    const tag = `${letters}-${digits}${suffix}`;
    if (digits.length !== 6) problems.push(`${tag}: شمارهٔ حلقه ${digits.length} رقمی چاپ شده، نه ۶ رقمی — نقشه بررسی شود`);
    out.push({ tag, letters, number: digits + suffix, category: p.category, loop: `${p.loop.split("-")[0]}-${digits}${suffix}`,
      at: [b.x, b.y], sixDigits: digits.length === 6 });
  }
  return { instruments: out, problems };
}

// ── data boxes under equipment ───────────────────────────────────────────
const BOX_LABEL = /^(ITEM N|SERVICE|TYPE|DESIGN|OPER|AREA|INSULATION|CAPACITY|POWER|SIZE|DIMENSION|MATERIAL|DUTY|HEAD|FLOW|MOTOR|DIFF|NPSH|SHELL|TUBE|VOLUME|DIAM|LENGTH|T\.?T|HEIGHT|NO\.? OF|DRIVER|SPEED|RATED)/i;

/**
 * The small tables printed under a sheet's equipment: ITEM N° and the rows
 * beneath it, each a label and the value to its right in the same row.
 */
export function dataBoxes(items, scale = 1) {
  const heads = items.filter((it) => /^ITEM N/i.test(it.t));
  const boxes = [];
  for (const hd of heads) {
    const right = 125 * scale;
    const row = (lab) => items
      .filter((v) => v !== lab && v.b[0] > lab.b[2] - 1 && v.b[0] < hd.b[0] + right
        && Math.abs(cy(v) - cy(lab)) < 3.5 * scale && !BOX_LABEL.test(v.t))
      .sort((a, b) => a.b[0] - b.b[0]).map((v) => v.t).join(" ").trim();
    const tagText = row(hd);
    const tag = equipmentTags(tagText)[0]?.tag || null;
    const fields = {};
    const labels = items
      .filter((l) => l !== hd && Math.abs(l.b[0] - hd.b[0]) < 6 * scale && l.b[1] > hd.b[1] && l.b[1] < hd.b[1] + 80 * scale
        && BOX_LABEL.test(l.t))
      .sort((a, b) => a.b[1] - b.b[1]);
    for (const l of labels) {
      if (/^ITEM N/i.test(l.t)) break;
      const k = l.t.replace(/\s+/g, " ").replace(/[.:]+$/, "").toUpperCase();
      const v = row(l);
      if (v && !(k in fields)) fields[k] = v;
    }
    boxes.push({ tag, printedTag: tagText || null, fields });
  }
  return boxes;
}

// ── title block ──────────────────────────────────────────────────────────
export function titleBlock(items, W, H) {
  const tb = items.filter((it) => it.b[0] > W * 0.74 && it.b[1] > H * 0.72);
  const text = (it) => it.t.toUpperCase().replace(/\s/g, "");
  const owner = tb.map((it) => text(it).match(/K110-?30-?PID-?(\d{4})-?(\d{2})-?(\d{2})\/?(\d)?/)).filter(Boolean)
    .map((m) => ({ no: `K110-30-PID-${m[1]}-${m[2]}-${m[3]}`, serial: m[1], section: m[2], sheet: m[3], issue: m[4] || null }));
  const contractor = tb.map((it) => text(it).match(/N227-?30-?PID-?(\d{4})-?(\d{2})-?(\d{2})\/?(\d)?/)).filter(Boolean)
    .map((m) => `N227-30-PID-${m[1]}-${m[2]}-${m[3]}`);
  // the revision block grows upward from the title block: on a sheet with
  // many revisions its top rows sit higher than the title block itself
  const rb = items.filter((it) => it.b[0] > W * 0.74 && it.b[1] > H * 0.6);
  const sc = W / REF_W;
  // the purpose column ends where the «Drawn by» column of the same block begins
  const drawn = rb.filter((it) => /^Drawn/i.test(it.t.trim())).sort((a, b) => b.b[1] - a.b[1])[0];
  const revs = [];
  for (const d of rb.filter((it) => /^\d{2}\/\d{2}\/\d{2}$/.test(it.t.trim()))) {
    const mark = rb.filter((r) => r.b[2] <= d.b[0] + 1 && d.b[0] - r.b[2] < 25 * sc && Math.abs(cy(r) - cy(d)) < 4 * sc && /^[0-9A-Z]$/.test(r.t.trim()))
      .sort((a, b) => b.b[2] - a.b[2])[0];
    // the purpose column, every word of it on this row ("ISSUED", "FOR", "DESIGN")
    const end = drawn ? drawn.b[0] - 1 : d.b[2] + 90 * sc;
    const words = rb.filter((r) => r.b[0] >= d.b[2] - 2 && r.b[0] < end && Math.abs(cy(r) - cy(d)) < 4 * sc
      && !/^[.·+\s]+$/.test(r.t)).sort((a, b) => a.b[0] - b.b[0]);
    const purpose = words.map((r) => r.t.trim()).join(" ").replace(/\s+/g, " ").trim() || null;
    revs.push({ rev: mark ? mark.t.trim() : null, date: d.t.trim(), purpose, y: d.b[1] });
  }
  revs.sort((a, b) => a.y - b.y);
  const label = tb.find((it) => /DRAWING\s?TITLE/i.test(it.t));
  const end = tb.find((it) => /^CONTRACTOR$/i.test(it.t.trim()) && label && it.b[1] > label.b[1]);
  const title = label ? tb.filter((it) => it.b[1] >= label.b[1] - 2 && (!end || it.b[1] < end.b[1] - 1)
    && it.b[0] > W * 0.76 && it.b[0] < W * 0.945 && !/STATUS|SHEET N|DRAWING\s?TITLE/i.test(it.t))
    .sort((a, b) => a.b[1] - b.b[1] || a.b[0] - b.b[0]).map((it) => it.t) : [];
  const section = (title.join(" ").match(/SECTION\s?(\d{2})/i) || [])[1] || null;
  return {
    ownerNo: owner.at(-1)?.no || null,
    issue: owner.at(-1)?.issue || null,
    contractorNo: contractor.at(-1) || null,
    section: section || owner.at(-1)?.section || null,
    title,
    revisions: revs.map(({ y, ...r }) => r),
    asBuilt: items.some((it) => /^AS\s?BUILT$/i.test(it.t.trim())),
  };
}

/** Everything one sheet prints, read from its OCR. */
export function parseSheet({ page, w: W, h: H, items: raw }, bubbles = null) {
  const scale = W / REF_W;
  const items = dedupe(raw.filter((it) => it.c >= 0.5));
  const tb = titleBlock(items, W, H);
  const inTitle = (it) => it.b[0] > W * 0.74 && it.b[1] > H * 0.72;
  const body = items.filter((it) => !inTitle(it));

  // Two readings of the same place are the same label. When one says more
  // («30 S 1401 A/B» over «30S 1401», «30P1201A/B» over «30 P1201A») the
  // longer one is kept, as dedupe does. When they say different things (an
  // underlined «30 C 1701 B» read «30C1701I» and «30C1701F») the suffix is
  // not known, and neither is filed from that place.
  const base = (t) => t.match(/^\d{2}-[A-Z]{1,3}-\d{4}/)[0];
  const readings = body.map((it) => ({ it, tags: equipmentTags(it.t) })).filter((r) => r.tags.length);
  const within = (a, b) => a.every((t) => b.includes(t) || b.some((u) => u !== t && u.startsWith(t)));
  const equipment = new Map(), equipmentProblems = [];
  for (const r of readings) {
    const rivals = readings.filter((o) => o !== r && iou(o.it, r.it) > 0.35);
    for (const e of r.tags) {
      const mine = r.tags.filter((t) => base(t.tag) === base(e.tag)).map((t) => t.tag);
      let shorter = false, clash = null;
      for (const o of rivals) {
        const theirs = o.tags.filter((t) => base(t.tag) === base(e.tag)).map((t) => t.tag);
        if (!theirs.length || theirs.join() === mine.join()) continue;
        if (within(mine, theirs)) shorter = true;
        else if (!within(theirs, mine)) clash = o;
      }
      if (clash) {
        const say = `«${r.it.t}» / «${clash.it.t}»: دو خوانش از یک جای نقشه تگ‌های متفاوت ساختند — ثبت نشد`;
        if (!equipmentProblems.some((p) => p.includes(clash.it.t) && p.includes(r.it.t))) equipmentProblems.push(say);
        continue;
      }
      if (shorter) continue;
      const cur = equipment.get(e.tag) || { tag: e.tag, printed: new Set() };
      cur.printed.add(e.printed);
      equipment.set(e.tag, cur);
    }
  }
  const listed = new Set();
  const head = items.find((it) => /EQUIPMENT\s?NUMBERS/i.test(it.t));
  if (head) for (const it of items) if (it.b[1] > head.b[3] && it.b[1] < head.b[3] + 60 * scale
    && Math.abs(cx(it) - cx(head)) < 60 * scale) for (const e of equipmentTags(it.t)) listed.add(e.tag);

  const lines = [];
  for (const it of body) for (const l of lineNumbers(it.t)) {
    if (l.size == null) {
      // the size is often its own string just left of the number
      const left = body.filter((s) => s !== it && /^\d{1,2}(?:[.\s-]?\d\/\d)?"$|^\d\/\d"$/.test(s.t)
        && Math.abs(cy(s) - cy(it)) < 3 * scale && it.b[0] - s.b[2] > -2 && it.b[0] - s.b[2] < 8 * scale)[0];
      if (left) l.size = inches(left.t.replace(/"/g, ""));
    }
    lines.push(l);
  }

  const refs = new Set();
  for (const it of items) for (const r of sheetRefs(it.t)) if (r !== tb.ownerNo) refs.add(r);

  return {
    page,
    ...tb,
    equipment: [...equipment.values()].map((e) => ({ tag: e.tag, printed: [...e.printed], listed: listed.has(e.tag) })),
    equipmentProblems,
    dataBoxes: dataBoxes(items, scale),
    lines,
    ...(bubbles ? (({ instruments: i, problems }) => ({ instruments: i, instrumentProblems: problems }))(instrumentsFromBubbles(bubbles)) : { instruments: instruments(body, scale) }),
    refs: [...refs],
  };
}
