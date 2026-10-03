/**
 * A weld register from the joint numbers PRINTED on an isometric.
 *
 * Many designers number every joint on the sheet and draw each number in a
 * frame whose shape says where it is welded — on the drawings that taught
 * this module, a circle for the shop and a square for the field. Where a
 * sheet does that, the designer has already made the register; re-deriving
 * welds from the geometry can only disagree with it. And the geometry engine
 * knows butt welds only: on those drawings two joints in three were socket
 * welds, threaded joints and branch olets on small bore.
 *
 * The split stays as everywhere else:
 *
 *   the MODEL reports what is printed at each marker — the number, the
 *   frame's shape and outline, text printed beside it, the size callout of
 *   its leg, whether its leader ends on a branch fitting, and the spool mark;
 *   it never says shop or field.
 *
 *   THIS FILE decides, by rule:
 *     Shop/Field   from the project's declared symbol convention
 *                  (project.weld_symbol_shop / _field, migration 057);
 *                  undeclared → blank, never assumed.
 *     joint type   THD when "THD" is printed beside it, BR when "BR" is;
 *                  OLET when it joins a
 *                  branch fitting to the run; otherwise from the sheet's own
 *                  BOM at that size: only butt-weld items → BW, only
 *                  socket-weld items → SW, anything mixed — or no pipe of
 *                  that size on the sheet — → blank. A
 *                  threaded cap beside socket welds is "mixed" unless the
 *                  project declares that its drawings print THD at every
 *                  threaded joint (project.weld_thd_labelled) — then an
 *                  unlabelled joint there is SW.
 *     excluded     a dashed frame is a joint drawn for reference that
 *                  belongs to the neighbouring sheet.
 *
 * Every blank stays blank and is listed: the result opens in the weld-list
 * form (components/WeldListEntry.jsx) for a person to complete, and
 * lib/register/weld-list.mjs refuses to save it while any weld lacks a
 * location, a type, a size or (in the shop) a spool.
 */

export const SHAPES = ["circle", "square", "diamond", "hexagon", "other"];

const cell = (v) => String(v ?? "").trim();

/** What a BOM description says about how an item's ends are joined. */
export function endTypes(description) {
  const s = ` ${String(description || "").toUpperCase()} `;
  const out = new Set();
  if (/[\s,(](BW|BE|BEV(ELLED)?|BUTT[\s-]?WELD(ING)?)[\s,)]/.test(s)) out.add("BW");
  if (/[\s,(](SW|PE|SOCKET[\s-]?WELD(ING)?)[\s,)]/.test(s)) out.add("SW");
  if (/[\s,(](NPT|THD|THRD|SCRD|TOE|TBE|THREADED)[\s,)]/.test(s)) out.add("THD");
  return out;
}

/**
 * A branch fitting (half coupling, any -olet) is welded to the run by its
 * own joint, an OLET; the end type its description gives belongs to its
 * branch, the smaller size only.
 */
const BRANCH_FITTING = /COUPLING|OLET\b|SOCKOLET|WELDOLET|THREDOLET|NIPOLET|SWEEPOLET|LATROLET|ELBOLET/i;

/**
 * The joint types the sheet's own BOM allows at one size, or null when it
 * does not say. A joint joins pipe to a fitting: with no pipe of that size
 * on this sheet, the other side of the joint is on another sheet (a branch
 * end of a reducing tee running into the next drawing), and this BOM cannot
 * say how it is joined.
 */
function bomTypesAt(bom, nps) {
  const all = new Set();
  let pipe = false;
  for (const b of bom || []) {
    const sizes = sizesOf(b.diam ?? b.size);
    const at = BRANCH_FITTING.test(b.description || "") && sizes.length > 1 ? [Math.min(...sizes)] : sizes;
    if (!at.includes(nps)) continue;
    if (/^PIPE\b/i.test(cell(b.group)) || /^PIPE\b/i.test(cell(b.description))) pipe = true;
    for (const t of endTypes(b.description)) all.add(t);
  }
  return pipe && all.size ? all : null;
}

/** "2", 2, "2 x 3/4", "3/4" → [2] / [2, 0.75] / [0.75]. */
export function sizesOf(v) {
  if (typeof v === "number") return Number.isFinite(v) ? [v] : [];
  return cell(v).split(/\s*[xX×]\s*/).map(parseSize).filter((n) => n > 0);
}

function parseSize(t) {
  const s = cell(t).replace(/["”]|NS|NPS|IN(CH)?/gi, "").trim();
  const m = s.match(/^(\d+)(?:[\s.-]+(\d+)\/(\d+))?$|^(\d+)\/(\d+)$|^(\d*\.\d+)$/);
  if (!m) return Number(s) || 0;
  if (m[4]) return Number(m[4]) / Number(m[5]);
  if (m[6]) return Number(m[6]);
  return Number(m[1]) + (m[2] ? Number(m[2]) / Number(m[3]) : 0);
}

/**
 * @param {{meta?: object, bom?: Array, weldMarks: {marks: Array}}} payload
 * @param {{shop?: string|null, field?: string|null, thdLabelled?: boolean}} legend  the project's convention
 * @returns {{weldList: Array, excluded: Array<{no, why}>, problems: string[], notes: string[]}}
 */
export function weldListFromMarks(payload, legend = {}) {
  const marks = Array.isArray(payload?.weldMarks?.marks) ? payload.weldMarks.marks : [];
  const shop = legend.shop || null, field = legend.field || null;
  const declared = Boolean(shop && field && shop !== field);
  const problems = [];
  const notes = [];
  const excluded = [];

  const solid = [];
  for (const m of marks) {
    const no = cell(m.no);
    if (!no) { problems.push("یک نشانگر جوش بدون شماره خوانده شد."); continue; }
    if (cell(m.outline).toLowerCase() === "dashed") { excluded.push({ no, why: "قاب خط‌چین — جوش برگ مجاور" }); continue; }
    // A frame printed with 0 is a drafting slip, not a joint (a contractor's
    // register writes 000 for "no joint" the same way); a person looks.
    if (/^0+$/.test(no)) { excluded.push({ no, why: "شمارهٔ 0 شمارهٔ جوش نیست — نقشه بررسی شود" }); problems.push(`قابی با شمارهٔ «${no}» چاپ شده — شمارهٔ جوش نیست؛ کنار گذاشته شد، نقشه بررسی شود.`); continue; }
    solid.push({ ...m, no });
  }

  const seen = new Set();
  for (const m of solid) {
    const k = m.no.toUpperCase();
    if (seen.has(k)) problems.push(`شمارهٔ جوش ${m.no} دو بار خوانده شد.`);
    seen.add(k);
  }

  if (!declared) {
    problems.push("نماد جوش کارگاهی و سایتی این پروژه ثبت نشده (پروژه › مشخصات › «نماد جوش روی ایزومتریک») — محل هیچ جوشی تعیین نشد.");
  }

  const weldList = solid.map((m) => {
    const shape = cell(m.shape).toLowerCase();
    const label = cell(m.label).toUpperCase();
    let loc = "";
    if (declared) loc = shape === shop ? "Shop" : shape === field ? "Field" : "";
    // A field-fit weld is printed as such; it never sits in a shop frame.
    if (/\bFFW\b/.test(label)) {
      if (loc === "Shop") { problems.push(`جوش ${m.no}: «FFW» کنار قاب کارگاهی چاپ شده — محل تعیین نشد.`); loc = ""; }
      else if (declared) loc = "Field";
    }
    if (declared && !loc && !/\bFFW\b/.test(label)) problems.push(`جوش ${m.no}: قاب «${shape || "?"}» نه نماد کارگاهی است نه سایتی.`);

    const nps = sizesOf(m.nps);
    const size = nps.length ? Math.min(...nps) : null;
    let kind = "";
    if (/\b(THD|THRD|NPT|SCRD)\b/.test(label)) kind = "THD";
    // "BR" printed beside the frame: the designer marked a branch weld.
    else if (/\bBR\b/.test(label)) kind = "BR";
    else if (m.branch === true) kind = "OLET";
    else if (size) {
      const t = bomTypesAt(payload?.bom, size);
      // Where the project declares that its drawings print THD at every
      // threaded joint, an unlabelled joint is not threaded.
      if (t && legend.thdLabelled) t.delete("THD");
      if (t && t.size === 1) kind = [...t][0];
    }

    return {
      no: m.no,
      spool: loc === "Shop" ? cell(m.spool) : "",
      loc,
      kind,
      nps: size ? String(size) : "",
      ref: /\bFFW\b/.test(label) ? "FFW" : "",
    };
  });

  const blank = (f) => weldList.filter((w) => !w[f]).map((w) => w.no);
  const say = (list, what) => list.length && notes.push(`${what}: ${list.join("، ")}`);
  if (declared) say(blank("loc"), "محل نامعلوم");
  say(blank("kind"), "نوع جوش را BOM همین برگ معلوم نمی‌کند (چند نوع اتصال در آن سایز) — تکمیل شود");
  say(blank("nps"), "قطر کنار جوش خوانده نشد");
  say(weldList.filter((w) => w.loc === "Shop" && !w.spool).map((w) => w.no), "جوش کارگاهی بدون علامت اسپول");

  // Numbers missing from the run printed on this sheet — they may be on
  // another sheet, or the model may have missed them; a person looks.
  // Only plain numbers make the run: 4-1, a joint added in a revision, is
  // not joint 41.
  const plain = (no) => (/^\D*\d+$/.test(no) ? Number(no.replace(/\D+/g, "")) : NaN);
  const nums = solid.map((m) => plain(m.no)).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const others = new Set(excluded.map((e) => plain(e.no)));
  const gaps = [];
  for (let n = nums[0]; nums.length && n < nums[nums.length - 1]; n++) if (!nums.includes(n) && !others.has(n)) gaps.push(n);
  say(gaps, "شماره‌هایی در میانهٔ ردیف این برگ خوانده نشد");
  say(excluded.map((e) => e.no), "جوش‌های برگ مجاور (قاب خط‌چین) کنار گذاشته شد");

  return { weldList, excluded, problems, notes };
}
