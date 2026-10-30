#!/usr/bin/env node
/**
 * `npm run doctor`, step 3 (authentication). A public server signs people in
 * with a password and a signed session cookie: no AUTH_MODE, no OIDC. The
 * doctor used to report that as "not configured — the server rejects every
 * request" and to advise AUTH_MODE=dev, which is wrong (the server answers 401
 * with the login form) and unsafe to follow on a public server. It now says
 * what is actually missing: SESSION_SECRET, or a first account.
 */
import { test, run, assert } from "./harness.mjs";
import { execFile } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

async function doctor(extra) {
  const dir = await mkdtemp(path.join(tmpdir(), "doctor-"));
  const env = { ...process.env, NO_COLOR: "1", PGLITE_DIR: dir };
  for (const k of ["AUTH_MODE", "OIDC_ISSUER", "SESSION_SECRET", "DATABASE_URL"]) delete env[k];
  const { stdout } = await exec("node", ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./tools/register.mjs", "db/doctor.mjs"],
    { env: { ...env, ...extra }, maxBuffer: 1 << 22 }).catch((e) => ({ stdout: e.stdout || "" }));
  // the step's own line, and the "next step" lines the doctor prints after the list
  const lines = stdout.split("\n");
  const at = lines.findIndex((l) => /احراز هویت/.test(l));
  return [lines[at], ...lines.slice(lines.findIndex((l) => /گام بعدی/.test(l)))].join("\n");
}

test("no SESSION_SECRET: it says so, and never advises AUTH_MODE=dev", async () => {
  const out = await doctor({});
  assert(/×/.test(out) && /SESSION_SECRET/.test(out), out);
  assert(!/AUTH_MODE=dev/.test(out), "the doctor must not advise AUTH_MODE=dev: " + out);
  assert(!/هر درخواست را رد می/.test(out), "a password-login server does not reject every request");
});

test("a short SESSION_SECRET is no better than none", async () => {
  assert(/×/.test(await doctor({ SESSION_SECRET: "too-short" })));
});

test("a good SESSION_SECRET and no account yet: ready, and the next step is the first developer", async () => {
  const out = await doctor({ SESSION_SECRET: "x".repeat(40) });
  assert(/!/.test(out) && /auth:developer/.test(out), out);
  assert(!/AUTH_MODE=dev/.test(out), out);
});

test("OIDC counts as configured", async () => {
  assert(/✓/.test(await doctor({ OIDC_ISSUER: "https://id.example.com" })));
});

await run();
