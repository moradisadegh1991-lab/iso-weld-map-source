/**
 * The print layout of a report type: paper, the three sections of the page,
 * the header's columns and the footer's signature boxes. A layout is data
 * (JSON) — checked here, drawn by the print page, never trusted as it came.
 *
 *   page     size A4 / A3 / Letter, portrait or landscape
 *   heights  header and footer in mm; the body is what is left
 *   header   three columns: logos | text cells | logos. Each logo column
 *            holds several logos side by side, centred, together filling
 *            90% of the column's width. The centre column is split into
 *            cells, each with its own height, text, font, size, weight and
 *            alignment; {report_no} {report_date} {title} {project} {stage}
 *            {version} are filled from the report.
 *   footer   the signature boxes, by stage then group: row 1 the stage,
 *            row 2 the group, row 3 the signature, name and date stacked.
 *            Each element can be shown or hidden, ordered, aligned, and
 *            given a font, size and weight. Landscape: every box in one row,
 *            the third row taking the rest of the footer's height. Portrait:
 *            the boxes share the page's width (and wrap past `perRow`).
 */

export const PAPER = { A4: [210, 297], A3: [297, 420], Letter: [215.9, 279.4] };
export const ORIENTATION = { portrait: "عمودی", landscape: "افقی" };
export const FONTS = ["inherit", "Vazirmatn", "Tahoma", "B Nazanin", "B Titr", "B Yekan", "Arial", "Times New Roman"];
export const ALIGN = { right: "راست", center: "وسط", left: "چپ" };
export const FOOTER_ELEMENTS = {
  stage: "عنوان مرحله", group: "نام گروه", groupTitle: "عنوان / شرح گروه", user: "نام امضاکننده", signature: "تصویر امضا", date: "تاریخ امضا",
};
export const PLACEHOLDERS = { report_no: "شمارهٔ گزارش", report_date: "تاریخ گزارش", title: "عنوان", project: "نام پروژه", stage: "مرحلهٔ فعلی", version: "نسخه" };
export const MIN_BODY_MM = 40;

const el = (order, extra = {}) => ({ show: true, order, align: "center", font: "inherit", size: 9, bold: false, ...extra });
export const DEFAULT_LAYOUT = {
  page: { size: "A4", orientation: "portrait" },
  heights: { header: 32, footer: 45 },
  header: {
    left: { logos: [] }, right: { logos: [] },
    center: { cells: [
      { text: "{project}", font: "inherit", size: 12, bold: true, align: "center", height: 12 },
      { text: "گزارش روزانهٔ کارگاه — {report_no}", font: "inherit", size: 11, bold: false, align: "center", height: 10 },
      { text: "تاریخ: {report_date} · نسخه {version}", font: "inherit", size: 9, bold: false, align: "center", height: 10 },
    ] },
  },
  footer: {
    align: "right", perRow: 4,
    elements: { stage: el(1, { bold: true }), group: el(2), groupTitle: el(3, { show: false, size: 8 }), signature: el(4),
      user: el(5), date: el(6, { size: 8 }) },
  },
};

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const clampInt = (v, lo, hi, d) => { const n = Math.round(num(v, d)); return Math.min(hi, Math.max(lo, n)); };

/** The page's size in mm, as oriented. */
export function pageSize(layout) {
  const [w, h] = PAPER[layout.page.size] || PAPER.A4;
  return layout.page.orientation === "landscape" ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Normalise a layout and list what is wrong with it.
 * `logoIds` — the logos this project has; a layout may only use those.
 * @returns {{ layout, problems: string[] }}
 */
export function checkLayout(input = {}, { logoIds = [] } = {}) {
  const p = [];
  const i = input || {};
  const page = { size: PAPER[i.page?.size] ? i.page.size : "A4", orientation: ORIENTATION[i.page?.orientation] ? i.page.orientation : "portrait" };
  if (i.page?.size && !PAPER[i.page.size]) p.push(`اندازهٔ کاغذ «${i.page.size}» شناخته نشد.`);
  const heights = { header: num(i.heights?.header, DEFAULT_LAYOUT.heights.header), footer: num(i.heights?.footer, DEFAULT_LAYOUT.heights.footer) };
  const { height } = pageSize({ page });
  for (const [k, l] of [["header", "سربرگ"], ["footer", "پاورقی"]]) {
    if (heights[k] < 10) p.push(`ارتفاع ${l} کمتر از ۱۰ میلی‌متر است.`);
  }
  if (height - heights.header - heights.footer < MIN_BODY_MM) {
    p.push(`سربرگ و پاورقی برای متن جایی نمی‌گذارند: دست‌کم ${MIN_BODY_MM} میلی‌متر برای متن لازم است (کاغذ ${height} میلی‌متر).`);
  }
  const known = new Set(logoIds);
  const logos = (side) => {
    const ids = [...new Set((i.header?.[side]?.logos || []).filter(Boolean))];
    const bad = ids.filter((x) => !known.has(x));
    if (bad.length) p.push(`لوگویی که در این پروژه نیست در ستون ${side === "right" ? "راست" : "چپ"} آمده است.`);
    return ids.filter((x) => known.has(x));
  };
  const text = (c, k) => ({
    font: FONTS.includes(c?.font) ? c.font : "inherit", size: clampInt(c?.size, 6, 28, 10), bold: !!c?.bold,
    align: ALIGN[c?.align] ? c.align : "center", ...k,
  });
  const cells = (i.header?.center?.cells || DEFAULT_LAYOUT.header.center.cells).map((c) =>
    text(c, { text: String(c?.text ?? "").slice(0, 300), height: Math.max(4, num(c?.height, 8)) }));
  if (!cells.length) p.push("ستون میانی سربرگ دست‌کم یک خانه لازم دارد.");
  const cellSum = cells.reduce((s, c) => s + c.height, 0);
  if (cellSum > heights.header + 0.01) p.push(`جمع ارتفاع خانه‌های سربرگ (${cellSum} mm) از ارتفاع سربرگ (${heights.header} mm) بیشتر است.`);

  const elements = {};
  for (const [k, def] of Object.entries(DEFAULT_LAYOUT.footer.elements)) {
    const e = i.footer?.elements?.[k] || {};
    elements[k] = text({ ...def, ...e }, { show: e.show === undefined ? def.show : !!e.show, order: clampInt(e.order, 1, 99, def.order) });
  }
  if (!Object.values(elements).some((e) => e.show)) p.push("کادر امضا دست‌کم یک جزء نمایش‌داده‌شده لازم دارد.");
  const footer = { align: i.footer?.align === "left" ? "left" : "right", perRow: clampInt(i.footer?.perRow, 1, 12, 4), elements };
  return { layout: { page, heights, header: { left: { logos: logos("left") }, right: { logos: logos("right") }, center: { cells } }, footer }, problems: p };
}

/** The footer's elements in the order they are drawn, hidden ones left out. */
export function footerOrder(layout) {
  return Object.entries(layout.footer.elements).filter(([, e]) => e.show).sort((a, b) => a[1].order - b[1].order).map(([k, e]) => ({ key: k, ...e }));
}

/** How the boxes are laid out on this page: one row in landscape; rows of `perRow` sharing the width in portrait. */
export function footerRows(layout, boxCount) {
  if (!boxCount) return [];
  const per = layout.page.orientation === "landscape" ? boxCount : Math.min(layout.footer.perRow, boxCount);
  const rows = [];
  for (let k = 0; k < boxCount; k += per) rows.push(Array.from({ length: Math.min(per, boxCount - k) }, (_, j) => k + j));
  return rows;
}

/** A header cell's text with the report's values put in. An unknown {name} stays as typed. */
export function fill(text, values) {
  return String(text ?? "").replace(/\{(\w+)\}/g, (m, k) => (k in PLACEHOLDERS && values[k] != null ? String(values[k]) : m));
}
