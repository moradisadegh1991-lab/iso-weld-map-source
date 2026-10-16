/**
 * The same environment the app sees, for the scripts run beside it.
 *
 * Next.js loads .env.local itself, so the server picks up ANTHROPIC_API_KEY
 * and AUTH_MODE without anyone thinking about it. Plain `node` does not.
 * Without this the doctor reports "احراز هویت پیکربندی نشده" while the app
 * running next to it is perfectly configured — and whoever reads that goes
 * looking for a problem that does not exist.
 *
 * Deliberately NOT imported by tools/register.mjs, which the tests and the
 * eval harness load. A DATABASE_URL in .env.local outranks the temporary
 * data directory each suite creates for itself, so loading it there would
 * point `npm run db:test` at whatever real database the developer happens to
 * have configured — and the suites write, migrate and seed. Tests stay
 * hermetic by construction; only the operational scripts read the file.
 *
 * Values already in process.env win, so `PGLITE_DIR=… npm run doctor` still
 * overrides the file.
 */
// @next/env is CommonJS, and Node cannot detect its named exports, so the
// default import is destructured rather than imported by name.
import nextEnv from "@next/env";
const { loadEnvConfig } = nextEnv;

loadEnvConfig(process.cwd(), /* dev */ true, { info() {}, error: console.error });
