/**
 * The BOM tab's table logic (pure): search, filter, sort, row checks and the saved ledger per row.
 * Nothing here writes anything — the rows are edited through components/BomForm.jsx and saved with the register
 * (app/api/runs: `bom` absent = unchanged, `[]` = explicit clear, array = replace), where the server enforces the locks.
 */
const text = (v) => String(v ?? "").trim();
const num = (v) => (v === "" || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

export const BOM_COLUMNS = ["pt", "group", "description", "diam", "stockCode", "qty", "qtyUnit"];
export const BOM_FILTERS = ["all", "issues", "reserved", "installed", "unused"];

/** The saved ledger (GET /api/bom-allocations) as a Map pt → { reserved, installed, returned, left }. Empty when there is none. */
export function ledgerByPt(availability) {
  const m = new Map();
  // reserved / installed as the server splits them: the welds' ends (weldReserved / weldInstalled) and everything else (reserved / installed)
  for (const r of availability?.rows || []) m.set(String(r.pt), { ...r, reservedAll: (r.reserved || 0) + (r.weldReserved || 0), installedAll: (r.installed || 0) + (r.weldInstalled || 0) });
  return m;
}

/** Problems of one row against its siblings: missing/duplicate PT, no description, a quantity that is not a number ≥ 0. */
export function rowIssues(row, rows = []) {
  const out = [];
  const pt = text(row?.pt);
  if (!pt) out.push("PT ندارد");
  else if (rows.filter((r) => text(r?.pt) === pt).length > 1) out.push(`PT ${pt} تکراری است`);
  if (!text(row?.description)) out.push("شرح ندارد");
  const q = row?.qty;
  if (q === "" || q == null) out.push("تعداد خوانده نشده");
  else if (num(q) == null || num(q) < 0) out.push("تعداد عدد ≥ ۰ نیست");
  return out;
}

/** Rows with their live usage (lib/register/bom-allocation.mjs `usage`), saved ledger and issues attached. */
export function decorate(rows, { live, ledger } = {}) {
  return (rows || []).map((row, index) => {
    const pt = String(row?.pt ?? "");
    const saved = ledger?.get(pt) || null;
    const u = live?.get(pt) || null;
    return { row, index, issues: rowIssues(row, rows), live: u, saved,
      holds: (saved ? (saved.reservedAll ?? saved.reserved ?? 0) + (saved.installedAll ?? saved.installed ?? 0) : 0) };
  });
}

/**
 * @param {object[]} decorated  decorate() output
 * @param {{ query?: string, filter?: string, sort?: { key: string, dir?: "asc"|"desc" } }} o
 */
export function view(decorated, { query = "", filter = "all", sort = null } = {}) {
  const q = text(query).toLowerCase();
  let list = decorated.filter((d) => {
    if (q && !BOM_COLUMNS.some((k) => String(d.row?.[k] ?? "").toLowerCase().includes(q))) return false;
    if (filter === "issues") return d.issues.length > 0;
    if (filter === "reserved") return (d.saved?.reservedAll ?? d.saved?.reserved ?? 0) > 0 || (d.live?.used || 0) > 0;
    if (filter === "installed") return (d.saved?.installedAll ?? d.saved?.installed ?? 0) > 0;
    if (filter === "unused") return !(d.holds > 0) && !(d.live?.used > 0);
    return true;
  });
  if (sort?.key) {
    const dir = sort.dir === "desc" ? -1 : 1, k = sort.key;
    const val = (d) => (k === "pt" || k === "qty" ? num(d.row?.[k]) : text(d.row?.[k]).toLowerCase());
    list = [...list].sort((a, b) => {
      const x = val(a), y = val(b);
      if (x == null && y == null) return a.index - b.index;
      if (x == null) return 1;
      if (y == null) return -1;
      return (x < y ? -1 : x > y ? 1 : a.index - b.index) * dir;
    });
  }
  return list;
}

/**
 * What the screen may say before a row goes: a row someone holds (reserved/installed in the saved ledger) is not removed
 * from the draft silently. The server remains the authority (409 BOM_IN_USE / the installed-line checks on save); this only
 * tells the person early. `locked` = approved revision (a signed BOM changes by a new revision).
 */
export function deleteCheck(d, { locked = false } = {}) {
  if (locked) return { ok: false, code: "BOM_LOCKED", message: "BOM این رویژن همراه رجیستر تأییدشده قفل است؛ رویژن جدید ثبت کنید." };
  const s = d?.saved;
  if ((s?.installedAll ?? s?.installed) > 0) return { ok: false, code: "BOM_INSTALLED", message: `PT ${d.row.pt}: ${s.installedAll ?? s.installed} نصب‌شده دارد؛ حذف نمی‌شود، ابتدا برگردانده شود.` };
  if ((s?.reservedAll ?? s?.reserved) > 0) return { ok: true, warn: true, message: `PT ${d.row.pt}: ${s.reservedAll ?? s.reserved} رزرو دارد؛ با ذخیرهٔ رجیستر رزرو آزاد/تنظیم می‌شود.` };
  return { ok: true };
}
