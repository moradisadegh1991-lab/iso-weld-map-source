/**
 * Tiles: what a member narrowed to tiles may open, enforced on the server.
 *
 * The menu and launchpad hide what a member's tiles do not include
 * (lib/platform/navigation.mjs); that alone is a convenience. This is the
 * boundary: a narrowed member's request reaches an API route only when one of
 * their tiles calls it (TILE_APIS, read from the pages' source by
 * lib/platform/tile-scan.mjs), or it is common to every signed-in person.
 * A project admin and a developer are never narrowed.
 */
import { ALL_TABS, ALWAYS_TILES, narrowed, tileAllowed, formTabs } from "./navigation.mjs";
import { TILE_APIS } from "./tile-apis.mjs";

/** Routes every signed-in person needs whatever their tiles: who they are, their password, their projects. */
export const COMMON_APIS = ["/api/auth", "/api/projects"];

/** The page whose source a tile's API calls are read from: a form's tile reads the one form page, a log tab the one log page. */
export function scanKey(href) {
  if (/^\/forms\/[^/]+$/.test(href)) return "/forms/[code]";
  if (/^\/log\/[a-z]+$/.test(href)) return "/log/[section]";
  return href;
}

/** Every page whose API calls are read: the menu's tabs, the forms' one page, and the pages everyone keeps. */
export function scannedPages() {
  return [...new Set([...ALL_TABS.map((t) => scanKey(t.href)), "/forms/[code]", ...ALWAYS_TILES])].sort();
}

/** The API routes a narrowed member's tiles call. */
export function apisFor(m, tabs = ALL_TABS) {
  const hrefs = new Set([...m.tiles, ...ALWAYS_TILES.filter((h) => h !== "/")]);
  // a section's log comes with a tile of that section
  for (const t of tabs) if (t.log && tileAllowed(m, t.href)) hrefs.add(t.href);
  return new Set([...hrefs].flatMap((h) => TILE_APIS[scanKey(h)] || []));
}

/** May this member call this API path? */
export function apiAllowed(m, pathname) {
  if (!narrowed(m)) return true;
  const p = String(pathname || "");
  const hit = (a) => p === a || p.startsWith(`${a}/`);
  if (COMMON_APIS.some(hit)) return true;
  return [...apisFor(m)].some(hit);
}

/** Refuse a narrowed member's request outside their tiles — called for every request that names a project. */
export function assertTiles(request, membership) {
  if (!narrowed(membership)) return;
  let path = "";
  try { path = new URL(request.url).pathname; } catch { return; }
  if (!apiAllowed(membership, path)) {
    throw Object.assign(new Error("این بخش در تایل‌های دسترسی شما نیست؛ از مدیر پروژه بخواهید تایل آن را به شما بدهد."), { status: 403, code: "OUT_OF_TILES" });
  }
}

/** A form's own tile: a narrowed member reaches a form's reports only with its tile. */
export function formAllowed(m, code) {
  return tileAllowed(m, `/forms/${code}`);
}

/**
 * The tiles an admin can give, grouped as the menu is: every tab but the
 * logs (which come with their section) and the pages everyone keeps, and
 * each of the project's handover forms.
 */
export function tileCatalog(SECTIONS, forms = []) {
  return SECTIONS.map((g) => ({
    group: g.group,
    sections: g.items.map((s) => ({
      key: s.key, title: s.title, icon: s.icon,
      tiles: [...s.tabs, ...(s.key === "handover" ? formTabs(forms) : [])]
        .filter((t) => !t.log && !ALWAYS_TILES.includes(t.href)).map((t) => ({ href: t.href, title: t.title, area: t.area || null, form: !!t.form })),
    })).filter((s) => s.tiles.length),
  })).filter((g) => g.sections.length);
}

/** A tile list as given: known pages and existing forms only. */
export function cleanTiles(list, forms = []) {
  const known = new Set([...ALL_TABS.filter((t) => !t.log).map((t) => t.href), ...formTabs(forms).map((t) => t.href)]);
  const tiles = [...new Set((Array.isArray(list) ? list : []).map(String))];
  const unknown = tiles.filter((t) => !known.has(t));
  return { tiles: tiles.filter((t) => known.has(t)), unknown };
}
