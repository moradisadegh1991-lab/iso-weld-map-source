/**
 * The disclaimer that travels with every output.
 *
 * The register this tool produces is a DRAFT. It leaves here on a spreadsheet
 * that gets emailed, an SVG that gets printed and pinned up in the shop, a
 * CSV that gets imported somewhere else — and at every one of those hops it
 * stops looking like software output and starts looking like an approved
 * document. So the text goes ON the artefact, not next to the download button.
 *
 * One source, so the wording cannot drift between the spreadsheet, the
 * drawing and the screen.
 */

export const DISCLAIMER_FA = [
  "پیش‌نویس — پیش از ساخت باید توسط مهندس پایپینگ در برابر آخرین رویژن نقشه،",
  "Piping Class پروژه و Fabrication Philosophy پیمانکار بازبینی و تأیید شود.",
  "درصد NDT از ASME B31.3 §341.4 و Piping Class پروژه می‌آید؛ کلاس حاکم است.",
].join(" ");

export const DISCLAIMER_EN = [
  "DRAFT — to be reviewed and approved by a piping engineer against the latest",
  "drawing revision, the project piping class and the contractor's fabrication",
  "philosophy before fabrication.",
].join(" ");

/**
 * The line stamped on a signed artefact.
 *
 * An approved register says who approved it and against which bytes, because
 * "approved" with no signatory and no hash is a word, not a record.
 */
export function approvalLine(approval) {
  if (!approval?.approvedAt) return "تأییدنشده — این خروجی هنوز امضای مهندس ندارد.";
  return `تأییدشده توسط ${approval.approvedBy || "—"} در ${String(approval.approvedAt).slice(0, 10)}` +
    (approval.sha256 ? ` · اثر انگشت ${String(approval.sha256).slice(0, 12)}` : "");
}

/** Rows to append to any spreadsheet we produce. */
export function disclaimerRows(approval = null) {
  return [[], ["DISCLAIMER"], [DISCLAIMER_FA], [DISCLAIMER_EN], [approvalLine(approval)]];
}
