/**
 * The columns of a design-quantities file (the MTO / bulk report of PDMS or
 * E3D), found by their header names — app/contracts/design reads with these,
 * and lib/import-templates.mjs writes a template they match.
 */
const S = "[\\s_.\\-]*";
export const DESIGN_PATTERNS = {
  code: [new RegExp(`\\b(item${S}code|commodity${S}code|code|ident|item)\\b`, "i"), /کد/],   // i18n: a Persian header a file may carry
  description: [/\b(description|desc|name)\b/i, /شرح/],   // i18n: a Persian header a file may carry
  unit: [/\b(unit|uom)\b/i, /واحد/],   // i18n: a Persian header a file may carry
  qty: [/\b(qty|quantity|total|amount)\b/i, /مقدار|تعداد/],   // i18n: a Persian header a file may carry
  wbs: [/\bwbs\b/i, /\b(cbs|control${S}account)\b/i],
  area: [/\b(area|zone|site)\b/i, /ناحیه|محدوده/],   // i18n: a Persian header a file may carry
};
