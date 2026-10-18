/**
 * An Excel template for every import (owner's requirements of 2026-10-18,
 * items 8 and 16): the columns each importer reads, with example rows, and a
 * second sheet saying what each column is.
 *
 * A template is only worth giving out if its own importer reads it, so each
 * one is fed through that importer in db/test/import-templates.mjs — the
 * header row is spelled the way the parser matches, never a guess at it.
 *
 * Pure data; `downloadTemplate` (browser) writes the workbook.
 */
import { SHEET_HEAD } from "./eps/import.mjs";

const guide = (rows) => [["Column / ستون", "Required / الزامی", "What it is / شرح"], ...rows];   // i18n: a bilingual sheet inside the file

export const TEMPLATES = {
  // An EPS version: the WBS and its activities, as the activities page exports its tree.
  eps: {
    file: "eps-wbs-template.xlsx",
    sheets: [{ name: "WBS", rows: [SHEET_HEAD,
      ["WBS", "", "01", "Piping", 100, "", "", "2026-11-01", "2027-03-31", "", ""],
      ["WBS", "01", "01.01", "Spool erection", 60, "m", 1200, "2026-11-01", "2027-02-28", "", ""],
      ["Activity", "01.01", "A-010", "Erect spools — area 1", 60, "m", 700, "2026-11-01", "2027-01-15", "", ""],
      ["Activity", "01.01", "A-020", "Erect spools — area 2", 40, "m", 500, "2026-12-01", "2027-02-28", "", ""],
      ["WBS", "01", "01.02", "Pipe supports", 40, "No.", 300, "2027-01-01", "2027-03-31", "", ""],
      ["Activity", "01.02", "A-030", "Install supports", 100, "No.", 300, "2027-01-01", "2027-03-31", "", ""],
    ] }],
    guide: guide([
      ["Type", "—", "WBS = a node of the breakdown, Activity = work under a node. / WBS گره، Activity فعالیت. Without it: a row another row names as parent is a node."],
      ["Parent code", "Activity: yes", "The code of the node above; empty = top level. / کد گرهٔ بالادست؛ خالی = سطح اول."],
      ["Code", "yes", "Unique for nodes; an activity's code is unique under its node. / کد یکتا."],
      ["Name", "yes", "The node's or activity's name. / نام."],
      ["W.F", "—", "Share of its parent, in % (siblings add to 100). / سهم از والد به درصد."],
      ["Unit, Volume", "—", "Unit of measure and planned volume. / واحد و حجم برنامه."],
      ["Plan start … Actual end", "—", "Gregorian dates, yyyy-mm-dd or an Excel date. / تاریخ میلادی."],
    ]),
  },

  // The contractor's PMS workbook: read by column position, as the contractor lays it out (lib/controls/pms.mjs).
  pms: {
    file: "pms-template.xlsx",
    sheets: [{ name: "PMS", rows: [
      ["Coding", "Level 1 — project", "Level 2", "Level 3", "Level 4", "Level 5", "Level 6 — element", "CC", "Description", "Unit", "Step weight", "W.F",
        "Qty", null, null, null, null, null, null, null, null, "Qty last", "Qty this", "Qty total", "Progress last", "Progress this", "Progress total"],
      [null, "Sample project", null, null, null, null, null, null, null, null, null, 1],
      [null, null, "Piping", null, null, null, null, null, null, null, null, 1],
      [null, null, null, "Spool fabrication", null, null, null, null, null, null, null, 0.6, 100],
      [null, null, null, null, null, null, null, "CC01", "Material handling", "m", 0.05, 0.03, 100],
      [null, null, null, null, null, null, null, "CC02", "Installation", "m", 0.95, 0.57, 100],
      [null, null, null, "Pipe supports", null, null, null, null, null, null, null, 0.4, 300],
      [null, null, null, null, null, null, null, "CC01", "Installation", "No.", 1, 0.4, 300],
    ] }],
    guide: guide([
      ["B … G", "yes", "The level a group belongs to: the column its name sits in IS the level. / ستونی که نام در آن است سطح را می‌گوید."],
      ["H (CC)", "steps", "Step code: a row with a code is a step of the element above. / کد گام."],
      ["I, J", "steps", "Step description and unit. / شرح و واحد گام."],
      ["K", "steps", "Step weight inside its element, 0…1 (an element's steps add to 1). / وزن گام در عنصر."],
      ["L (W.F)", "yes", "The row's share of the whole project, 0…1. / سهم از کل پروژه."],
      ["M", "—", "Quantity. / مقدار."],
      ["V … AA", "—", "Quantity and progress last / this / total (progress 0…1). / مقدار و پیشرفت."],
    ]),
  },

  // Design quantities (MTO / BOQ) of a contract — matched by header (app/contracts/design).
  design: {
    file: "design-quantities-template.xlsx",
    sheets: [{ name: "Quantities", rows: [
      ["Item code", "Description", "Unit", "Qty", "WBS", "Area"],
      ["PP-0101", "Pipe 6\" SCH40 A106-B", "m", 240, "01.01", "Area 1"],
      ["PP-0102", "Elbow 90 LR 6\" A234-WPB", "No.", 36, "01.01", "Area 1"],
    ] }],
    guide: guide([
      ["Item code", "yes", "The item's code. / کد قلم."], ["Description", "yes", "شرح."], ["Unit", "yes", "واحد."], ["Qty", "yes", "مقدار."],
      ["WBS", "—", "A control account (WBS node code) of the contract. / حساب کنترل."], ["Area", "—", "ناحیه."],
    ]),
  },

  // An equipment list (lib/equipment/parse.mjs).
  equipment: {
    file: "equipment-list-template.xlsx",
    sheets: [{ name: "Equipment", rows: [
      ["Tag No", "Description", "Type", "Subsystem", "Unit", "P&ID", "Weight", "Vendor"],
      ["P-7001A", "DM water pump", "Centrifugal pump", "SS-70-01", "70", "70-PID-001", 850, ""],
      ["TK-7001", "DM water tank", "Tank", "SS-70-01", "70", "70-PID-001", 12000, ""],
    ] }],
    guide: guide([
      ["Tag No", "yes", "شماره تگ."], ["Description", "yes", "Service — the description decides the equipment's chain. / شرح سرویس."],
      ["Type", "—", "نوع."], ["Subsystem", "—", "زیرسیستم."], ["Unit", "—", "واحد."], ["P&ID", "—", "P&ID."], ["Weight", "—", "kg."], ["Vendor", "—", "سازنده."],
    ]),
  },

  // A contractor's weld register, the reference a drawing's reading is compared with (lib/truth/parse.mjs).
  truth: {
    file: "weld-register-template.xlsx",
    sheets: [{ name: "Register", rows: [
      ["ISO No", "Sheet", "Rev", "Weld No", "Shop/Field", "Weld Type", "NPS", "Spool No", "NDT"],
      ["25-1002", 1, 0, "W-01", "S", "BW", 6, "SP-01", "RT"],
      ["25-1002", 1, 0, "W-02", "F", "BW", 6, "", "RT"],
    ] }],
    guide: guide([
      ["ISO No, Sheet, Rev", "—", "Only this drawing's rows are compared when present. / شماره نقشه، برگ و ویرایش."],
      ["Weld No", "yes", "شماره جوش."], ["Shop/Field", "yes", "S / F."], ["Weld Type", "—", "BW, SW, …"], ["NPS", "—", "inch."],
      ["Spool No", "—", "اسپول."], ["NDT", "—", "RT, UT, …"],
    ]),
  },

  // A weld list typed for a drawing (lib/register/weld-list.mjs).
  weldList: {
    file: "weld-list-template.xlsx",
    sheets: [{ name: "Weld list", rows: [
      ["Weld No", "Spool No", "Shop/Field", "Weld Type", "NPS", "Tie-in Ref"],
      ["W-01", "", "Field", "Tie-in", 3, "P-7001 discharge N2"], ["W-02", "SP-01", "Shop", "BW", 3, ""],
    ] }],
    guide: guide([
      ["Weld No", "yes", "شماره جوش."], ["Spool No", "—", "اسپول."], ["Shop/Field", "yes", "کارگاه / محل."],
      ["Weld Type", "—", "BW, SW, Tie-in …"], ["NPS", "—", "inch."], ["Tie-in Ref", "—", "Where a field weld connects. / مرجع اتصال."],
    ]),
  },

  // The owner's MESC catalogue: code, description, unit (lib/warehouse/mesc.mjs).
  mesc: {
    file: "mesc-catalogue-template.xlsx",
    sheets: [{ name: "MESC", rows: [
      ["Code", "Description", "UOM"],
      ["76", "PIPES", ""],
      ["7612", "CARBON STEEL PIPES", ""],
      ["76.12.01.010.1", "PIPE CS SMLS 6IN SCH40 A106-B", "M"],
    ] }],
    guide: guide([
      ["Code", "yes", "2, 4 or 6 digits = a group title; 10 digits = an item. / کد ۲، ۴ یا ۶ رقمی عنوان گروه، ۱۰ رقمی کالا."],
      ["Description", "yes", "شرح."], ["UOM", "—", "واحد."],
    ]),
  },
};

/** Write a template's workbook in the browser. */
export async function downloadTemplate(key) {
  const t = TEMPLATES[key];
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of t.sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(s.rows), s.name);
  if (t.guide) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(t.guide), "Guide");
  XLSX.writeFile(wb, t.file);
}
