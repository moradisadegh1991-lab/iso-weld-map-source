/**
 * MESC — Material and Equipment Standard Code — as the Iranian oil, gas and
 * petrochemical companies use it (NIOC, NIGC, NPC and their subsidiaries;
 * the system descends from Shell's MESC).
 *
 * A MESC number is ten digits, hierarchical:
 *
 *   74 . 10 . 12 . 052 . 1
 *   │    │    │    │     └ final digit — kept as the catalogue prints it
 *   │    │    │    └ item ("buying description"), 3 digits
 *   │    │    └ sub-sub-group, 2 digits
 *   │    └ sub-group, 2 digits
 *   └ main group, 2 digits
 *
 * The NUMBERS and the group TITLES belong to the owner's MESC catalogue; the
 * platform holds none of its own and invents none. A code is verified only
 * against the catalogue the project imported (with its edition). With no
 * catalogue loaded a code is recorded as "not verified", never as valid.
 * What the final digit means (central / local coding) is the catalogue's
 * convention, so it is stored as printed and not interpreted here.
 *
 * One MESC number is one material: two stock items carrying the same number
 * are a duplicate in the stock master — exactly what MESC exists to stop —
 * and are refused.
 */

export const MESC_LEVELS = [
  { key: "main", digits: 2, title: "گروه اصلی" },
  { key: "sub", digits: 4, title: "زیرگروه" },
  { key: "subsub", digits: 6, title: "زیرگروه فرعی" },
];

/** Digits only, or null when the input is not a ten-digit MESC number. */
export function normalizeMesc(input) {
  if (input === null || input === undefined) return null;
  const s = String(input).replace(/[\s.\-/]/g, "");
  const fa = s.replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
  return /^\d{10}$/.test(fa) ? fa : null;
}

/** 7410120521 → 74.10.12.052.1 */
export function formatMesc(code) {
  const c = normalizeMesc(code);
  return c ? `${c.slice(0, 2)}.${c.slice(2, 4)}.${c.slice(4, 6)}.${c.slice(6, 9)}.${c.slice(9)}` : null;
}

/** The group prefixes a code sits under: { main: "74", sub: "7410", subsub: "741012" }. */
export function mescPrefixes(code) {
  const c = normalizeMesc(code);
  if (!c) return null;
  return Object.fromEntries(MESC_LEVELS.map((l) => [l.key, c.slice(0, l.digits)]));
}

/**
 * Read the owner's catalogue from CSV (comma, semicolon or tab): code,
 * description, uom. A description with the separator in it is quoted. A code of 2,
 * 4 or 6 digits is a group title; 10 digits is an item. Lines that are
 * neither are reported, not skipped silently.
 */
export function parseCatalogue(text) {
  const groups = [], items = [], problems = [];
  const lines = String(text || "").split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const cells = splitCsv(line, line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",");
    if (cells.length > 3) { problems.push(`خط ${i + 1}: بیش از سه ستون — شرحی که ویرگول دارد باید داخل "…" باشد`); return; }
    const rawCode = (cells[0] || "").trim();
    if (i === 0 && /code|کد/i.test(rawCode)) return;                  // header
    const digits = rawCode.replace(/[\s.\-/]/g, "");
    const description = (cells[1] || "").trim();
    const uom = (cells[2] || "").trim() || null;
    if (!description) { problems.push(`خط ${i + 1}: شرح ندارد`); return; }
    if (/^\d{2}$|^\d{4}$|^\d{6}$/.test(digits)) groups.push({ prefix: digits, title: description });
    else if (normalizeMesc(digits)) items.push({ code: normalizeMesc(digits), description, uom });
    else problems.push(`خط ${i + 1}: «${rawCode}» کد MESC نیست (۲، ۴، ۶ یا ۱۰ رقم)`);
  });
  const seen = new Set();
  for (const it of items) {
    if (seen.has(it.code)) problems.push(`کد ${formatMesc(it.code)} در کاتالوگ تکراری است`);
    seen.add(it.code);
  }
  return { groups, items, problems };
}

/**
 * The state of a stock item's MESC number against the imported catalogue:
 *   none        no MESC number recorded
 *   unverified  no catalogue loaded — the number cannot be checked
 *   unknown     not in the catalogue
 *   uom         in the catalogue, but the stock item counts in another unit
 *   ok          in the catalogue, same unit (or the catalogue gives none)
 */
export function mescState({ code, uom }, { catalogueLoaded, entry }) {
  if (!code) return { code: "none", text: "کد MESC ثبت نشده" };
  if (!catalogueLoaded) return { code: "unverified", text: "کاتالوگ MESC بارگذاری نشده — کد بررسی نشده" };
  if (!entry) return { code: "unknown", text: "در کاتالوگ MESC نیست" };
  if (entry.uom && uom && entry.uom.trim().toUpperCase() !== uom.trim().toUpperCase()) {
    return { code: "uom", text: `واحد کاتالوگ ${entry.uom} است، کالای انبار ${uom}` };
  }
  return { code: "ok", text: "مطابق کاتالوگ" };
}

/**
 * Catalogue entries that may fit a stock item: a code or prefix typed, or the
 * words of a description. Ranked by how many query words the entry holds —
 * a list for a person to choose from, never an automatic assignment.
 */
export function searchCatalogue(entries, query, limit = 20) {
  const q = String(query || "").trim();
  if (!q) return [];
  const digits = q.replace(/[\s.\-/]/g, "");
  if (/^\d{2,10}$/.test(digits)) return entries.filter((e) => e.code.startsWith(digits)).slice(0, limit);
  const words = q.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return [];
  return entries
    .map((e) => ({ e, n: words.filter((w) => e.description.toLowerCase().includes(w)).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n || a.e.code.localeCompare(b.e.code))
    .slice(0, limit)
    .map((x) => x.e);
}

function splitCsv(line, sep) {
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
