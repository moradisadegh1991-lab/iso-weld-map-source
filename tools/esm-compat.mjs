/**
 * Lets plain Node run the engine modules in `lib/` without a bundler.
 *
 * Two gaps have to be closed, both created by the fact that `lib/*.js` is
 * written for the Next.js compiler rather than for Node:
 *
 *   1. Imports are extensionless (`from "./standards"`). Node's ESM resolver
 *      requires the extension, so we try the obvious candidates.
 *   2. The package has no `"type": "module"`, so Node would read `.js` as
 *      CommonJS and reject the `import` statements. We force ESM, but only
 *      for files inside `lib/` — nothing else in the repo is touched.
 *
 * Doing it here instead of changing package.json keeps the Next build
 * byte-for-byte unaffected.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const LIB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "lib") + path.sep;
const CANDIDATES = [".js", ".mjs", "/index.js"];

export async function resolve(specifier, context, next) {
  const extensionless = specifier.startsWith(".") && !path.extname(specifier);
  if (extensionless && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of CANDIDATES) {
      const candidate = new URL(base.href + ext);
      if (existsSync(fileURLToPath(candidate))) return next(candidate.href, context);
    }
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.startsWith("file:")) {
    const file = fileURLToPath(url);
    if (file.startsWith(LIB_DIR) && file.endsWith(".js")) {
      return next(url, { ...context, format: "module" });
    }
  }
  return next(url, context);
}
