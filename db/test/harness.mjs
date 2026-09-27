/** A test harness small enough to read in one sitting, and with no dependency
 *  of its own — same rule as eval/. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export const tests = [];

/**
 * A fresh directory under the system temp dir for this test file's
 * database or files. When every test in the file passes it is removed; when
 * one fails it is kept and named, to look at. (Left behind, a full db:test
 * run leaves gigabytes of databases in /tmp.)
 */
const scratch = [];
export async function scratchDir(prefix) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
export const test = (name, fn) => tests.push({ name, fn });

export function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}
export function equal(actual, expected, msg) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg || "not equal"}\n    expected ${e}\n    got      ${a}`);
}
export async function throws(fn, match, msg) {
  try {
    await fn();
  } catch (e) {
    if (match && !String(e.message).includes(match) && e.code !== match) {
      throw new Error(`${msg || "wrong error"}: expected ${match}, got ${e.code || e.message}`);
    }
    return e;
  }
  throw new Error(msg || `expected a throw${match ? ` matching ${match}` : ""}`);
}

export async function run() {
  const C = process.stdout.isTTY && !process.env.NO_COLOR
    ? { r: "\x1b[31m", g: "\x1b[32m", d: "\x1b[2m", b: "\x1b[1m", o: "\x1b[0m" }
    : { r: "", g: "", d: "", b: "", o: "" };
  let failed = 0;
  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ${C.g}PASS${C.o} ${name}`);
    } catch (e) {
      failed++;
      console.log(`  ${C.r}FAIL${C.o} ${name}`);
      console.log(`       ${String(e.message).split("\n").join("\n       ")}`);
    }
  }
  console.log(`\n${failed ? C.r : C.g}${C.b}${tests.length - failed}/${tests.length} passed${C.o}`);
  if (failed) { if (scratch.length) console.log(`${C.d}kept for a look: ${scratch.join(" ")}${C.o}`); }
  else for (const dir of scratch) await rm(dir, { recursive: true, force: true }).catch(() => {});
  process.exit(failed ? 1 : 0);
}
