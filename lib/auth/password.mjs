/**
 * Password hashing and verification.
 *
 * scrypt from node:crypto — no new dependency, and deliberately not a fast
 * hash. The cost parameters are stored WITH each hash so they can be raised
 * later without invalidating everyone's password: an old hash still names
 * the parameters it was made under, and verification uses those.
 *
 * Pure functions over strings. No database, no request, no session — which
 * is what lets the comparison below be tested directly.
 */
import { randomBytes, scrypt as _scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);

/** Today's cost. Raise N first; it is the parameter that actually costs an attacker. */
export const DEFAULT_PARAMS = { N: 16384, r: 8, p: 1, keyLen: 32 };

export async function hashPassword(password, params = DEFAULT_PARAMS) {
  assertUsable(password);
  const { N, r, p, keyLen } = params;
  const salt = randomBytes(16);
  // maxmem must be raised in step with N: the default 32 MB is below what
  // N=16384, r=8 needs, and scrypt throws rather than quietly using less.
  const key = await scrypt(password, salt, keyLen, { N, r, p, maxmem: 256 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

/**
 * Verify a password against a stored hash.
 *
 * Returns false for a malformed or unknown-algorithm hash rather than
 * throwing: a corrupt row must fail the login, not the login endpoint — a
 * throw here would be a 500 that tells an attacker the account exists.
 */
export async function verifyPassword(password, stored) {
  if (typeof password !== "string" || typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, N, r, p, saltB64, keyB64] = parts;
  try {
    const salt = Buffer.from(saltB64, "base64");
    const expected = Buffer.from(keyB64, "base64");
    const key = await scrypt(password, salt, expected.length, {
      N: Number(N), r: Number(r), p: Number(p), maxmem: 256 * 1024 * 1024 });
    // Length is checked first because timingSafeEqual throws on a mismatch,
    // and a throw here would be an oracle for the hash length.
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** Should this hash be replaced next time the password is used correctly? */
export function needsRehash(stored, params = DEFAULT_PARAMS) {
  const parts = String(stored || "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < params.N;
}

/**
 * The rules a password has to meet.
 *
 * Length is the only requirement that reliably buys anything; composition
 * rules mostly produce "Passw0rd!" and a sticky note. A minimum of 10 and a
 * refusal of the handful of passwords that actually get tried first is a
 * better trade than four character classes.
 */
/**
 * Every entry here is at least 10 characters, on purpose.
 *
 * The length check runs first, so a shorter one — "password", "admin123" —
 * could never reach this set. Listing them anyway would be code that cannot
 * execute, and someone would eventually raise the minimum length and never
 * notice the list had stopped matching.
 */
const COMMON = new Set([
  "1234567890", "qwertyuiop", "password12", "password123", "passw0rd123",
  "iloveyou12", "welcome123", "letmein123", "admin12345", "qwerty12345",
  "1q2w3e4r5t", "aaaaaaaaaa", "0123456789",
]);

export function passwordProblem(password) {
  if (typeof password !== "string" || !password) return "رمز عبور لازم است.";
  if (password.length < 10) return "رمز عبور باید دست‌کم ۱۰ نویسه باشد.";
  if (password.length > 200) return "رمز عبور بیش از حد بلند است.";
  if (COMMON.has(password.toLowerCase())) return "این رمز عبور بسیار رایج است.";
  return null;
}

function assertUsable(password) {
  const problem = passwordProblem(password);
  if (problem) throw Object.assign(new Error(problem), { status: 400, code: "WEAK_PASSWORD" });
}
