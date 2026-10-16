/**
 * The forms whose numbers the platform issues, and how a number is written.
 *
 * A form's number is its code and its next number in the project:
 * PTW-0001, NCR-0012, IR-00031. The code is the project's to change
 * (form_code); the default is here. A number that came from outside the
 * platform — the designer's transmittal, a heat number, a tag from the
 * drawings — is not in this list and is never generated.
 *
 * `table`/`column` say where a number, once issued, lives, so a number typed
 * by hand is never issued a second time. They are constants here, never
 * user input, because they are written into SQL.
 */
export const FORMS = {
  permit:      { code: "PTW", title: "مجوز کار (PTW)",           table: "hse_permit",           column: "permit_no" },
  incident:    { code: "INC", title: "رویداد HSE",               table: "hse_incident",         column: "ref_no" },
  jsa:         { code: "JSA", title: "JSA / TRA",                table: "hse_jsa",              column: "jsa_no" },
  pour:        { code: "PC",  title: "پور کارت بتن‌ریزی",          table: "concrete_pour",        column: "pour_no" },
  test_pack:   { code: "TP",  title: "پکیج تست فشار",             table: "test_package",         column: "pack_no" },
  perf_test:   { code: "PT",  title: "آزمون عملکرد",              table: "performance_test",     column: "test_no" },
  mr:          { code: "MR",  title: "درخواست خرید (MR)",         table: "material_requisition", column: "mr_no" },
  po:          { code: "PO",  title: "سفارش خرید (PO)",           table: "purchase_order",       column: "po_no" },
  shipment:    { code: "SH",  title: "محموله",                    table: "shipment",             column: "shipment_no" },
  receipt:     { code: "MRR", title: "رسید انبار",                table: "material_lot",         column: "receipt_no" },
  stock_count: { code: "STK", title: "انبارگردانی",               table: "stock_count",          column: "count_no" },
  contract:    { code: "CT",  title: "قرارداد / پیمان",           table: "contract",             column: "contract_no" },
  transmittal: { code: "TR",  title: "ترانسمیتال خروجی",           table: "transmittal",          column: "transmittal_no" },
  reply:       { code: "RT",  title: "ترانسمیتال پاسخ به طراح",     table: "doc_reply",            column: "reply_no" },
  ncr:         { code: "NCR", title: "NCR",                       table: "ncr",                  column: "ncr_no" },
  ir:          { code: "IR",  title: "درخواست بازرسی (IR)",        table: "inspection_request",   column: "ir_no", pad: 5 },
  tq:          { code: "TQ",  title: "پرسش فنی (TQ)",             table: "tech_query",           column: "tq_no" },
  site_change: { code: "FCR", title: "تغییر سایت (سایت‌ران، As-built)", table: "site_change",       column: "fcr_no" },
  work_order:  { code: "WO",  title: "دستور کار",                 table: "work_order",           column: "wo_no" },
  // A report is numbered per report type: DR-R0001 for the daily report.
  report:      { code: "R",   title: "گزارش (به ازای هر نوع گزارش)", table: "report",              column: "report_no", scoped: true },
  // A punch list is numbered per subsystem: 70-01-P001.
  punch:       { code: "P",   title: "Punch (به ازای هر ساب‌سیستم)", table: "punch_item",         column: "punch_no", pad: 3, scoped: true },
};

export const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_./-]{0,15}$/;

/** The written number: PTW-0007, or for a scoped form 70-01-P007. */
export function formatNumber(form, code, n, scope = null) {
  const f = FORMS[form];
  const digits = String(n).padStart(f.pad || 4, "0");
  return f.scoped ? `${scope}-${code}${digits}` : `${code}-${digits}`;
}
