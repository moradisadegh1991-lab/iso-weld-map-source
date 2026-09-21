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
  },
};
export default nextConfig;
