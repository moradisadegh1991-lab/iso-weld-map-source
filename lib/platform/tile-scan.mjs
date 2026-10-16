/**
 * Which API routes each page (tile) calls — read from the source, not
 * written by hand, so a page that starts calling a new route cannot be
 * forgotten in the server's tile check (lib/platform/tiles.mjs).
 *
 * For a page at `/x/y` it reads every script in app/x/y — and in folders
 * under it that are not pages of their own (a print view, say) — and every
 * component or client module those scripts import, transitively, collecting
 * the "/api/…" paths written in them. A path built at run time keeps its
 * written prefix (`/api/runs/${id}` → /api/runs).
 *
 * Node only (reads files). `npm run tiles:map` writes lib/platform/
 * tile-apis.mjs; db/test/tiles.mjs fails when that file is out of date.
 */
import fs from "node:fs";
import path from "node:path";

const API = /["'`](\/api\/[A-Za-z0-9_\-/.]*)/g;
const IMPORT = /(?:import|from)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g;
const EXTS = ["", ".jsx", ".js", ".mjs", "/index.jsx", "/index.js", "/index.mjs"];

function resolve(from, spec) {
  const base = path.resolve(path.dirname(from), spec);
  for (const e of EXTS) { const f = base + e; if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  return null;
}

/** API paths a set of files reaches, following relative imports into the browser's code (app/, components/, lib/client/). */
function apisOf(files, root) {
  const seen = new Set(), out = new Set();
  const stack = [...files];
  const browser = (f) => [path.join(root, "app"), path.join(root, "components"), path.join(root, "lib", "client")].some((d) => f.startsWith(d + path.sep));
  while (stack.length) {
    const f = stack.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    const src = fs.readFileSync(f, "utf8");
    for (const m of src.matchAll(API)) out.add(m[1].replace(/\/+$/, "").replace(/\.$/, ""));
    for (const m of src.matchAll(IMPORT)) {
      const g = resolve(f, m[1]);
      if (g && browser(g) && !g.includes(`${path.sep}api${path.sep}`)) stack.push(g);
    }
  }
  return [...out].filter((a) => a !== "/api").sort();
}

/**
 * hrefs: the pages (tiles), e.g. "/piping", "/forms/[code]". Returns
 * { [href]: [api paths] }. A folder that is itself one of `hrefs` belongs to
 * that page, not to the page above it.
 */
export function scanTileApis(hrefs, root = process.cwd()) {
  const dirOf = (h) => path.join(root, "app", ...h.split("/").filter(Boolean));
  const own = new Set(hrefs.map(dirOf));
  const out = {};
  for (const h of hrefs) {
    const dir = dirOf(h);
    if (!fs.existsSync(dir)) { out[h] = []; continue; }
    const files = [];
    if (h === "/") { out[h] = apisOf([path.join(root, "app", "page.jsx")], root); continue; }      // the home page alone, not every page under app/
    const walk = (d, top) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!own.has(p) && e.name !== "api") walk(p, false); }
        else if (/\.(jsx?|mjs)$/.test(e.name)) files.push(p);
      }
      return top;
    };
    walk(dir, true);
    out[h] = apisOf(files, root);
  }
  return out;
}
