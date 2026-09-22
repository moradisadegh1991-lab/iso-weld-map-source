/**
 * `serverExternalPackages` is not an optimisation here — it is required.
 *
 * PGlite ships a WebAssembly build whose loader resolves its own files
 * relative to `import.meta.url` and hands the result to `fs.readFile`. When
 * webpack bundles the package that resolution produces a URL object where
 * Node wants a path, and every route that touches the database fails at
 * runtime with ERR_INVALID_ARG_TYPE.
 *
 * It passed every test because the tests run PGlite in plain Node, outside
 * the bundler. Leaving these external makes Next require them at runtime, the
 * way the tests already do.
 */
const nextConfig = {
  reactStrictMode: false,
  experimental: {
    serverComponentsExternalPackages: ["@electric-sql/pglite", "pg"],

    /**
     * Without this, `next dev` crashes outright on Android (Termux).
     *
     * Next ships SWC as a native binary per platform. On a platform it does
     * not ship one for — Android is on Next's own list, `aarch64-linux-android`
     * — the intended behaviour is to load the WASM build first. In 14.2.30
     * that intent is gated behind this exact flag (read from here, in
     * build/webpack-config.js): with it left at the default `false`, Next
     * instead tries to DOWNLOAD a native android-arm64 binary from npm, which
     * does not exist (404), and that failure is not caught — the process
     * exits before ever attempting WASM. Verified by reading node_modules/
     * next/dist/build/swc/index.js: the native-fallback download at
     * tryLoadNativeWithFallback() is awaited with no try/catch around it.
     *
     * On a platform Next does ship a native binary for (this dev box, CI,
     * production), the flag is a deliberate no-op: Next's own check at line
     * ~254 of that same file logs one warning ("is not an option for
     * supported platform ... and will be ignored") and proceeds to load the
     * fast native binary exactly as before. Confirmed here — dev server
     * starts, only the warning appears, normal native SWC still loads.
     */
    useWasmBinary: true,
  },
};
export default nextConfig;
