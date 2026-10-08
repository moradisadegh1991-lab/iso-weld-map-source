/**
 * A P&ID set, read: the drawing register, equipment list, line list and
 * instrument index printed on its sheets.
 *
 *   python3 -I tools/pid-ocr.py   <set.pdf> <ocr dir> all          (page text)
 *   python3 -I tools/pid-bubbles.py <set.pdf> <bubble dir> all     (instrument bubbles)
 *   node tools/pid-registers.mjs <ocr dir> <bubble dir> <out.json> [--xlsx out.xlsx]
 *
 * Every row says which sheets printed it. Nothing here is decided — what a
 * sheet does not print stays empty, and a value two sheets print
 * differently is kept as both and named, for an engineer.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseSheet } from "../lib/pid/ocr-parse.mjs";
import { FLUIDS, INSULATION, EQUIPMENT_TYPES, equipmentType, legendFluid, inchMarkFluid } from "../lib/pid/legend-k110.mjs";

const add = (map, key, make) => { if (!map.has(key)) map.set(key, make()); return map.get(key); };

/** dd/mm/yy as printed in the revision block → ISO date, or null. */
export function isoDate(s) {
  const m = String(s || "").match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  if (+mo < 1 || +mo > 12 || +d < 1 || +d > 31) return null;
  return `20${y}-${mo}-${d}`;
}

export async function readSet(ocrDir, bubbleDir) {
  const pages = (await readdir(ocrDir)).filter((f) => /^p\d+\.json$/.test(f)).sort();
  const sheets = [];
  for (const f of pages) {
    const ocr = JSON.parse(await readFile(path.join(ocrDir, f), "utf8"));
    let bubbles = null;
    try { bubbles = JSON.parse(await readFile(path.join(bubbleDir, f.replace(/^p/, "b")), "utf8")).bubbles; } catch { /* not read yet */ }
    sheets.push(parseSheet(ocr, bubbles));
  }
  return sheets;
}

/**
 * Titles a person read off the title blocks, «page<TAB>number<TAB>title»:
 * the OCR joins the words the drawing spaces. A number written with «?» was
 * not legible in the block and is not checked.
 */
export function readTitles(text) {
  const out = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const [page, no, title] = line.split("\t");
    if (!/^\d+$/.test(page || "")) continue;
    out.set(Number(page), { no: (no || "").trim(), title: (title || "").trim() });
  }
  return out;
}

export function registers(sheets, titles = new Map()) {
  // the legend set (0021-00-xx), not the machinery packages' typicals (0041-00-xx)
  const legend = (s) => /-0021-00-/.test(s.ownerNo || "");
  const where = (s) => s.ownerNo ? `${s.ownerNo.replace(/^K110-30-PID-/, "")}` : `p${s.page}`;
  const equipment = new Map(), lines = new Map(), instruments = new Map();
  const problems = [];

  const list = (set) => [...set].sort();
  for (const s of sheets) {
    if (!s.ownerNo) problems.push(`صفحهٔ ${s.page}: شمارهٔ نقشه در جدول عنوان خوانده نشد`);
    for (const p of s.instrumentProblems || []) problems.push(`${where(s)}: ${p}`);
    for (const p of s.equipmentProblems || []) problems.push(`${where(s)}: ${p}`);
    if (legend(s)) continue;
    for (const e of s.equipment) {
      // a tag whose type letters the legend does not list is not filed as equipment
      if (!equipmentType(e.tag)) { problems.push(`${where(s)}: «${e.printed.join("، ")}» شکل تگ تجهیز دارد ولی حرف نوعش در لجند نیست — کنار گذاشته شد`); continue; }
      const r = add(equipment, e.tag, () => ({ tag: e.tag, printed: new Set(), sheets: new Set(), listedOn: new Set(), data: {} }));
      e.printed.forEach((p) => r.printed.add(p));
      r.sheets.add(where(s));
      if (e.listed) r.listedOn.add(where(s));
    }
    for (const b of s.dataBoxes) {
      if (!b.tag || !equipmentType(b.tag)) continue;
      const r = add(equipment, b.tag, () => ({ tag: b.tag, printed: new Set(), sheets: new Set(), listedOn: new Set(), data: {} }));
      for (const [k, v] of Object.entries(b.fields)) {
        if (!r.data[k]) r.data[k] = v;
        else if (r.data[k] !== v && !String(r.data[k]).includes(v)) r.data[k] = `${r.data[k]} | ${v}`;
      }
    }
    for (const raw of s.lines) {
      let l = raw;
      const inch = !FLUIDS[raw.fluid] && inchMarkFluid(raw.fluid);
      const fixed = !inch && !FLUIDS[raw.fluid] && legendFluid(raw.fluid);
      if (inch) {
        // the inch mark was misread, so the fraction before it is not trusted either: size unknown
        l = { ...raw, fluid: inch, size: null, lineNo: inch + raw.lineNo.slice(raw.fluid.length) };
        problems.push(`${where(s)}: «${raw.printed}» — X پیش از کد سیال علامت اینچ (") است؛ ${l.lineNo} ثبت شد و سایز از این خواندن گرفته نشد`);
      } else if (fixed) {
        l = { ...raw, fluid: fixed, lineNo: fixed + raw.lineNo.slice(raw.fluid.length) };
        problems.push(`${where(s)}: «${raw.printed}» — کد سیال ${raw.fluid} در لجند نیست؛ تنها کد نزدیک ${fixed} است و ${l.lineNo} ثبت شد (اصلاح خطای خواندن)`);
      }
      const r = add(lines, l.lineNo, () => ({ lineNo: l.lineNo, fluid: l.fluid, plant: l.plant, section: l.section,
        serial: l.serial, kind: l.kind, classes: new Set(), insulation: new Set(), sizes: new Set(), sheets: new Set(), printed: new Set() }));
      r.classes.add(l.pipingClass);
      if (l.insulation) r.insulation.add(l.insulation);
      if (l.size != null) r.sizes.add(l.size);
      r.sheets.add(where(s));
      r.printed.add(l.printed);
    }
    for (const i of s.instruments) {
      const r = add(instruments, i.tag, () => ({ ...i, sheets: new Set() }));
      r.sheets.add(where(s));
    }
  }

  // A code the legend lacks that is the tail of exactly one legend-coded line
  // with the same number and class (W130003A beside CW130003A, both DA01):
  // the OCR dropped the first letter of a vertical string. Merged into that
  // line, which another sheet printed whole.
  for (const l of [...lines.values()]) {
    if (FLUIDS[l.fluid]) continue;
    const tail = l.lineNo.slice(l.fluid.length);
    const whole = [...lines.values()].filter((o) => o !== l && FLUIDS[o.fluid] && o.fluid.endsWith(l.fluid)
      && o.lineNo.slice(o.fluid.length) === tail && [...l.classes].every((c) => o.classes.has(c)));
    if (whole.length !== 1) continue;
    const [o] = whole;
    for (const k of ["insulation", "sizes", "sheets", "printed"]) l[k].forEach((v) => o[k].add(v));
    lines.delete(l.lineNo);
    problems.push(`خط ${l.lineNo} (${list(l.sheets).join("، ")}): حرف اول جا افتاده — همان ${o.lineNo} است که برگ دیگری کامل چاپ کرده؛ در آن ادغام شد`);
  }

  // A base printed bare where the set also prints its trains («30C1701»
  // beside 30-C-1701A/B) is the label with its suffix lost, or the trains
  // named together — not an asset of its own. Not filed; named.
  for (const e of [...equipment.values()]) {
    const trains = [...equipment.keys()].filter((t) => t !== e.tag && t.startsWith(e.tag) && /^[A-Z]$/.test(t.slice(e.tag.length)));
    if (!trains.length) continue;
    equipment.delete(e.tag);
    problems.push(`«${list(e.printed).join("، ")}» (${list(e.sheets).join("، ")}): بدون حرف ردیف چاپ/خوانده شد ولی ${trains.sort().join("، ")} وجود دارند — جدا ثبت نشد`);
  }

  const eq = [...equipment.values()].sort((a, b) => a.tag.localeCompare(b.tag)).map((e) => ({
    tag: e.tag, printed: list(e.printed), sheets: list(e.sheets), listedOn: list(e.listedOn), data: e.data,
    service: e.data.SERVICE || null, type: equipmentType(e.tag), typeName: EQUIPMENT_TYPES[equipmentType(e.tag)],
  }));
  const ln = [...lines.values()].sort((a, b) => a.lineNo.localeCompare(b.lineNo)).map((l) => {
    if (!FLUIDS[l.fluid]) problems.push(`خط ${l.lineNo}: کد سیال «${l.fluid}» در لجند نیست (شاید خطای خواندن)`);
    for (const c of l.insulation) if (!INSULATION[c]) problems.push(`خط ${l.lineNo}: کد عایق «${c}» در لجند نیست`);
    if (l.classes.size > 1) problems.push(`خط ${l.lineNo}: کلاس لوله در برگ‌ها متفاوت خوانده شد (${list(l.classes).join("، ")})`);
    return { lineNo: l.lineNo, fluid: l.fluid, fluidName: FLUIDS[l.fluid] || null, plant: l.plant, section: l.section, serial: l.serial, kind: l.kind,
      pipingClass: l.classes.size === 1 ? [...l.classes][0] : null, classes: list(l.classes), insulation: list(l.insulation),
      insulationName: list(l.insulation).map((c) => INSULATION[c] || "?").join(" | "),
      sizes: [...l.sizes].sort((a, b) => a - b), sheets: list(l.sheets), printed: list(l.printed) };
  });
  const ins = [...instruments.values()].sort((a, b) => a.tag.localeCompare(b.tag)).map(({ at, ...i }) => ({ ...i, sheets: list(i.sheets) }));

  const drawings = sheets.map((s) => {
    const eye = titles.get(s.page);
    let ownerNo = s.ownerNo;
    if (eye?.no && !eye.no.includes("?")) {
      const want = `K110-30-PID-${/^\d{4}-/.test(eye.no) ? eye.no : `0021-${eye.no}`}`;
      if (!ownerNo) { ownerNo = want; problems.push(`صفحهٔ ${s.page}: شمارهٔ نقشه را OCR نخواند؛ از خواندن شخص (${want})`); }
      else if (ownerNo !== want) problems.push(`صفحهٔ ${s.page}: OCR شمارهٔ ${ownerNo} خواند، شخص ${want} — نقشه بررسی شود`);
    }
    return {
    page: s.page, ownerNo, issue: s.issue, contractorNo: s.contractorNo, section: s.section || (ownerNo || "").split("-")[4] || null,
    title: eye?.title || s.title.join(" / "), titleSource: eye?.title ? "person" : "ocr", asBuilt: s.asBuilt,
    revisions: s.revisions.map((r) => ({ ...r, isoDate: isoDate(r.date) })),
    counts: { equipment: s.equipment.length, lines: s.lines.length, instruments: s.instruments.length, refs: s.refs.length },
    refs: s.refs,
  };
  });
  const seen = new Map();
  for (const d of drawings) if (d.ownerNo) {
    if (seen.has(d.ownerNo)) problems.push(`شمارهٔ نقشهٔ ${d.ownerNo} روی صفحه‌های ${seen.get(d.ownerNo)} و ${d.page} هر دو خوانده شد`);
    else seen.set(d.ownerNo, d.page);
  }
  return { drawings, equipment: eq, lines: ln, instruments: ins, problems };
}

async function writeXlsx(file, r) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  const sheet = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), name);
  sheet("Drawings", r.drawings.map((d) => ({
    Page: d.page + 1, "Owner Dwg No": d.ownerNo, Issue: d.issue, "Contractor Dwg No": d.contractorNo, Section: d.section,
    Title: d.title, "As built": d.asBuilt ? "yes" : "",
    "Last rev": d.revisions.at(0)?.rev ?? "", "Last rev date": d.revisions.at(0)?.isoDate ?? d.revisions.at(0)?.date ?? "",
    "Last rev purpose": d.revisions.at(0)?.purpose ?? "",
    Equipment: d.counts.equipment, Lines: d.counts.lines, Instruments: d.counts.instruments, "Connected sheets": d.refs.join(", "),
  })));
  sheet("Equipment", r.equipment.map((e) => ({
    Tag: e.tag, "As printed": e.printed.join(", "), "Type (legend)": e.typeName ?? "", Service: e.service ?? "",
    ...Object.fromEntries(Object.entries(e.data).filter(([k]) => k !== "SERVICE")),
    "Listed on (EQUIPMENT NUMBERS)": e.listedOn.join(", "), "Shown on": e.sheets.join(", "),
  })));
  sheet("Lines", r.lines.map((l) => ({
    "Line No": l.lineNo, Fluid: l.fluid, "Fluid (legend)": l.fluidName ?? "not in legend", Section: l.section, Serial: l.serial, Kind: l.kind,
    "Piping class": l.pipingClass ?? l.classes.join(" | "), Insulation: l.insulation.join(", "), "Insulation (legend)": l.insulationName,
    "Sizes (in)": l.sizes.join(", "), Sheets: l.sheets.join(", "), "As printed": l.printed.slice(0, 3).join(" ; "),
  })));
  sheet("Instruments", r.instruments.map((i) => ({
    Tag: i.tag, Letters: i.letters, Number: i.number, Category: i.category, Loop: i.loop,
    "Six-digit": i.sixDigits === false ? "no — check drawing" : "yes", Sheets: i.sheets.join(", "),
  })));
  sheet("Problems", r.problems.map((p) => ({ Problem: p })));
  await writeFile(file, XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

async function main() {
  const args = process.argv.slice(2);
  const i = args.indexOf("--xlsx");
  const xlsx = i >= 0 ? args.splice(i, 2)[1] : null;
  const t = args.indexOf("--titles");
  const titles = t >= 0 ? readTitles(await readFile(args.splice(t, 2)[1], "utf8")) : new Map();
  const [ocrDir, bubbleDir, out] = args;
  if (!ocrDir || !bubbleDir || !out) {
    console.error("usage: node tools/pid-registers.mjs <ocr dir> <bubble dir> <out.json> [--xlsx out.xlsx]");
    process.exit(2);
  }
  const r = registers(await readSet(ocrDir, bubbleDir), titles);
  await writeFile(out, JSON.stringify(r, null, 1));
  if (xlsx) await writeXlsx(xlsx, r);
  console.log(`${r.drawings.length} sheets · ${r.equipment.length} equipment · ${r.lines.length} lines · ${r.instruments.length} instruments · ${r.problems.length} problems`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
