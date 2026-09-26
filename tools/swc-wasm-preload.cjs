/**
 * Force Next's WebAssembly compiler on Android. A no-op everywhere else.
 *
 * WHY A PRELOAD AND NOT THE CONFIG FLAG
 *
 * next.config.mjs's experimental.useWasmBinary reaches exactly one call site
 * (build/webpack-config.js, and only when building the CLIENT config). Every
 * other caller of loadBindings() passes no argument at all, so useWasmBinary
 * defaults to false there — and whichever call happens FIRST wins, because
 * loadBindings caches its result in a module-level `pendingBindings`. On
 * Android the first caller was not the one carrying the flag, so Next went
 * looking for a native android-arm64 binary that has never been published and
 * exited before any of this mattered.
 *
 * The one condition that forces the WASM path at EVERY call site, regardless
 * of arguments, is this, from build/swc/index.js:
 *
 *   const isWebContainer = process.versions.webcontainer;
 *   const shouldLoadWasmFallbackFirst =
 *     !disableWasmFallback && unsupportedPlatform && useWasmBinary || isWebContainer;
 *
 * `webcontainer` appears nowhere else in Next — it is read only there — so
 * setting it changes the compiler choice and nothing whatsoever besides.
 *
 * Guarded by platform so it cannot touch a machine that has a native binary:
 * Node reports "android" under Termux, which is also where Next's own error
 * message gets the "android/arm64" it prints.
 */
if (process.platform === "android") {
  process.versions.webcontainer = "1";
}
