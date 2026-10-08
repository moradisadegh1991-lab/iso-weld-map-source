/**
 * A read P&ID set (tools/pid-registers.mjs) into a project: the unit, its
 * process sections, the drawing register with its printed revisions, the
 * equipment, lines and instruments.
 *
 * Everything loaded is what the sheets PRINT. Where a sheet prints nothing
 * the platform needs — which equipment an instrument serves, an
 * instrument's range, an equipment's commissioning subsystem — nothing is
 * filled in, and the missing-information register (lib/db/repos/
 * assumptions.mjs) shows the gap with its owner.
 *
 * A process section (10 cracking furnaces, 20 hot section…) is the
 * breakdown the drawings themselves print, on every sheet and in every
 * number. It is filed as a subsystem so the tags can be found by it; it is
 * NOT a commissioning subsystem, and the name says so. Which section a tag
 * is in is read by the numbering the legend sheets declare:
 *   equipment   30 E 1301 AB   the digit after the plant's own is the
 *                              section's first (3 → section 30)
 *   instrument  TDRC 1 4 0001  plant, the section's first digit, serial
 *   line        MP 1 40 001 A  plant, the section, serial
 *
 * Call inside `withProject`.
 */
import { createUnit } from "../db/repos/projects.mjs";
import { upsertSubsystem, lineForRegister } from "../db/repos/spine.mjs";
import { importEquipmentList } from "../db/repos/equipment.mjs";
import { importInstrumentIndex } from "../db/repos/instrumentation.mjs";
import { upsertMdr, issueRevision } from "../db/repos/doc-control.mjs";
import { classifyKind } from "../equipment/parse.mjs";
import { FLUIDS } from "./legend-k110.mjs";

/** 30-E-1301AB → "30"; null when the number does not follow the legend. */
export const equipmentSection = (tag) => (String(tag).match(/^\d{2}-[A-Z]{1,3}-\d(\d)\d{2}[A-Z]{0,2}$/) || [])[1]?.concat("0") ?? null;
/** 140001A1 → "40". */
export const instrumentSection = (number) => (String(number).match(/^\d(\d)\d{4}/) || [])[1]?.concat("0") ?? null;

/** The revision purposes the platform knows, from what the block prints. */
export function purposeOf(printed) {
  const t = String(printed || "").toUpperCase().replace(/\./g, "");  // I.F.C is IFC
  if (/AS\s?BUILT|TSR/.test(t)) return "AB";
  if (/\bIFC\b|FOR\s?CONSTRUCTION/.test(t)) return "IFC";
  if (/FOR\s?APPROVAL|\bIFA\b/.test(t)) return "IFA";
  if (/FOR\s?REVIEW|\bIFR\b/.test(t)) return "IFR";
  return null;
}

/**
 * @param {{drawings, equipment, lines, instruments}} reg  tools/pid-registers.mjs output
 * @param {{unit: {code, name}, sections: Object<string,string>, docTitles?: Object<string,string>, originator?: string}} opts
 */
export async function loadPidSet(db, { projectId, userId = null }, reg, opts) {
  const report = { sections: 0, drawings: 0, revisions: 0, revisionsNotIssued: [], equipment: null, lines: 0, instruments: null };
  const unit = await createUnit(db, { projectId, code: opts.unit.code, name: opts.unit.name });

  const subsystemCode = (section) => `${opts.unit.code}-${section}`;
  const sectionIds = new Map();
  for (const [section, name] of Object.entries(opts.sections)) {
    if (section === "00") continue;
    const s = await upsertSubsystem(db, { projectId, code: subsystemCode(section), systemCode: section, unitId: unit.id,
      name: `بخش ${section} — ${name} (بخش فرایندی طبق نقشه، نه زیرسیستم راه‌اندازی)` });
    sectionIds.set(section, s.id);
    report.sections++;
  }

  // ── drawings: the register, each printed revision issued as printed ──
  for (const d of reg.drawings) {
    if (!d.ownerNo) continue;
    const title = opts.docTitles?.[d.ownerNo] || d.title || d.ownerNo;
    const mdr = await upsertMdr(db, { projectId, docNo: d.ownerNo, title, discipline: "process", docType: "P&ID",
      originator: opts.originator || null, subsystemId: sectionIds.get(d.section) || null });
    report.drawings++;
    // the block lists the newest first
    const pending = [];
    for (const r of [...d.revisions].reverse()) {
      const purpose = purposeOf(r.purpose);
      if (!purpose || !r.rev || !r.isoDate) {
        pending.push(`rev ${r.rev ?? "?"} ${r.date} «${r.purpose ?? ""}»`);
        report.revisionsNotIssued.push({ docNo: d.ownerNo, rev: r.rev, date: r.date, printed: r.purpose });
        continue;
      }
      const note = [`چاپ‌شده: «${r.purpose}»`, pending.length ? `پیش از آن روی جدول: ${pending.join("؛ ")}` : null]
        .filter(Boolean).join(" · ");
      pending.length = 0;
      try {
        await issueRevision(db, { projectId, mdrId: mdr.id, revision: r.rev, purpose, issuedOn: r.isoDate, note, userId });
        report.revisions++;
      } catch (e) {
        report.revisionsNotIssued.push({ docNo: d.ownerNo, rev: r.rev, date: r.date, printed: r.purpose, why: e.message });
      }
    }
  }

  // ── equipment ──
  const tags = reg.equipment.filter((e) => e.tag.startsWith(`${opts.unit.code}-`)).map((e) => {
    const sec = equipmentSection(e.tag);
    // the kind is read from the service printed in the data box, else from
    // the type the tag's own letter names in the legend (E heat exchangers,
    // P pumps, F furnaces…) — the project's rule, not a guess from a word
    const type = [e.typeName, e.data?.TYPE].filter(Boolean).join(" · ") || null;
    const { kind, why } = classifyKind(e.service, type);
    return { tagNo: e.tag, description: e.service || (e.typeName ? `${e.typeName} (نوع از حرف تگ طبق لجند)` : null), type, kind, kindReason: why,
      subsystem: sec && sectionIds.has(sec) ? subsystemCode(sec) : null, system: sec || null };
  });
  report.equipment = await importEquipmentList(db, { projectId, tags, userId });

  // ── lines ──
  for (const l of reg.lines) {
    const line = await lineForRegister(db, { projectId, lineNo: l.lineNo, pipingClass: l.pipingClass, unitCode: opts.unit.code });
    await db.query(
      `UPDATE line SET service = COALESCE(service, $2), insulation = COALESCE(insulation, $3),
              subsystem_id = COALESCE(subsystem_id, $4) WHERE id = $1`,
      [line.id, FLUIDS[l.fluid] ? `${l.fluid} — ${FLUIDS[l.fluid]}` : l.fluid, l.insulation.length === 1 ? l.insulation[0] : null, sectionIds.get(l.section) || null]);
    report.lines++;
  }

  // ── instruments ──
  const tsv = ["Tag\tType", ...reg.instruments.map((i) => `${i.tag}\t${i.letters}`)].join("\n");
  report.instruments = await importInstrumentIndex(db, { projectId, text: tsv });
  for (const i of reg.instruments) {
    const sec = instrumentSection(i.number);
    if (!sectionIds.has(sec)) continue;
    await db.query("UPDATE instrument SET subsystem_id = COALESCE(subsystem_id, $3) WHERE project_id = $1 AND tag_no = $2",
      [projectId, i.tag, sectionIds.get(sec)]);
  }
  return report;
}
