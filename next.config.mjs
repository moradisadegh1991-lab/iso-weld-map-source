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
 * way the tests already do. (Next 15 moved the key out of `experimental`.)
 */
const nextConfig = {
  reactStrictMode: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],

  /**
   * The image optimizer is off. The platform serves no <Image>, but Next
   * mounts /_next/image regardless, and that endpoint is where the worst
   * advisories against Next have landed (remote code execution with AVIF,
   * cache confusion, unbounded disk cache, DoS — review R1, 2026-09-26). An
   * endpoint nothing uses is attack surface and nothing else; with this set
   * Next does not optimise anything, whatever a request asks for.
   */
  images: { unoptimized: true },

  /**
   * No `X-Powered-By: Next.js`: the version on the wire is a lookup key into
   * the advisory database for whoever is scanning.
   */
  poweredByHeader: false,

  experimental: {
    /**
     * Android (Termux) has no native SWC binary. Next 15 already treats it as
     * an unsupported platform and loads the WebAssembly build first; this
     * flag and tools/swc-wasm-preload.cjs are kept so that holds at every
     * call site of loadBindings, as it had to be forced in 14.2. On a
     * platform with a native binary Next logs one warning and ignores it.
     */
    useWasmBinary: true,
  },
};
export default nextConfig;
