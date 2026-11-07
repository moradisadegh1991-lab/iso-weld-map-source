/**
 * What the SAVED state of a drawing revision says about deleting a mark — shown before the person confirms.
 * It reads what the server already holds (GET /api/iso-equipment, GET /api/bom-allocations) and mirrors, in words, the
 * refusals the save will make (installed / tested equipment, installed allocation lines, an approved revision). It is advice:
 * the server stays the authority and still refuses (409) whatever this says; a mark that exists only in the draft has no
 * saved state and is never blocked here.
 *
 * Matching is by the persistent identity (the mark's uid), the legacy handle only for rows saved before identities existed.
 */
import { markRef, KINDS, equipmentWelds } from "../sheet/markup.mjs";

const HELD = new Set(["installed", "tested"]);
const same = (m, ref) => ref != null && ref !== "" && (ref === m?.uid || ref === m?.id);

/**
 * @param {object} mark
 * @param {{ equipment?: object[], lines?: object[], locked?: boolean }} saved
 * @returns {{ blocked: boolean, warn: boolean, reasons: string[] }}
 */
export function protectionFor(mark, { equipment = [], lines = [], locked = false, items = [] } = {}) {
  const reasons = [];
  let blocked = false, warn = false;
  const no = String(mark?.no ?? "").trim() || "؟";
  const eq = equipment.find((e) => same(mark, e.markId) || same(mark, e.legacyId));
  if (eq) {
    if (HELD.has(eq.status)) { blocked = true; reasons.push(`تجهیز ${no} در دفتر ذخیره‌شده «${eq.status === "tested" ? "تست‌شده" : "نصب‌شده"}» است؛ حذف نمی‌شود. راه مجاز: وضعیتش را در فرم تجهیز به «برنامه‌ریزی‌شده» برگردانید و ذخیره کنید، سپس حذف کنید.`); }
    for (const a of eq.accessories || []) {
      if (HELD.has(a.status)) { blocked = true; reasons.push(`متعلق PT ${a.pt} از تجهیز ${no} ${a.status === "tested" ? "تست‌شده" : "نصب‌شده"} است؛ ابتدا وضعیت متعلق را در تب تجهیزات به «برنامه‌ریزی‌شده / تحویل‌شده» برگردانید.`); }
    }
  }
  for (const l of lines) {
    if (!(same(mark, l.ownerRef) )) continue;
    if (l.status === "installed") { blocked = true; reasons.push(`PT ${l.pt}: ${l.qty} ${l.unit || ""} برای ${no} نصب‌شده ثبت شده؛ حذف نمی‌شود. راه مجاز: در دفتر تخصیص BOM همین رویژن «برگرداندن» (return) را بزنید، بعد حذف کنید.`); }
    else if (l.status === "reserved") { warn = true; reasons.push(`PT ${l.pt}: ${l.qty} ${l.unit || ""} برای ${no} رزرو است؛ با ذخیرهٔ رجیستر آزاد می‌شود.`); }
  }
  // a weld an equipment still names (in the draft, or in the saved links) cannot be deleted: the link would be dangling. The way out is the
  // equipment's form (remove the weld from its list), which is a visible, reviewed change.
  if (KINDS[mark?.kind]?.cls === "weld") {
    const ref = String(markRef(mark)).toLowerCase();
    for (const e of items.filter((x) => KINDS[x.kind]?.cls === "equipment")) {
      if (equipmentWelds(e, items).joined.some((j) => j.uid.toLowerCase() === ref)) {
        blocked = true; reasons.push(`تجهیز ${String(e.no ?? "").trim() || "؟"} هنوز به سرجوش ${no} وصل است؛ حذف نمی‌شود. راه مجاز: در فرم همان تجهیز این سرجوش را از «سرجوش‌های متصل» بردارید و ذخیره کنید، بعد حذف کنید.`);
      }
    }
  }
  if (locked && (blocked || warn || eq)) { blocked = true; reasons.unshift("رجیستر تأیید شده؛ نشان‌ها در همین رویژن تغییر نمی‌کنند. راه مجاز: رویژن جدید نقشه را ثبت کنید."); }
  return { blocked, warn, reasons };
}

/** A `protect(ref)` for the components, bound to the items and the saved state. */
export const protector = (items, saved) => (ref) => {
  const m = (items || []).find((x) => same(x, ref) || markRef(x) === ref);
  return m ? protectionFor(m, { ...saved, items: items || [] }) : { blocked: false, warn: false, reasons: [] };
};
