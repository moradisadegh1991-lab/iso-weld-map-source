import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { makeRedactionBundle } from "../lib/client/redaction-bundle.mjs";
import { imageBundleDigest, issueImageReceipt, verifyImageReceipt } from "../lib/server/iso-redaction-receipt.mjs";
const labels = ["FULL SHEET", "TOP-LEFT TILE", "TOP-RIGHT TILE", "BOTTOM-LEFT TILE", "BOTTOM-RIGHT TILE"];
// Marker-only JPEG-shaped bytes are sufficient for integrity tests, not an image validity claim.
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString("base64");
const images = () => labels.map((label) => ({ label, mediaType: "image/jpeg", data: jpeg }));
const env = { SESSION_SECRET: "receipt-test-secret-longer-than-32-characters" };
const ctx = { projectId: "project-a", userId: "user-a", credential: "session-a", env, now: 1_000_000 };

test("server and browser digest exactly the same ordered label, MIME and bytes", async () => {
  const list = images(), browser = await makeRedactionBundle(list, webcrypto);
  assert.equal(imageBundleDigest(list), browser.sha256);
  const sealed = issueImageReceipt({ ...ctx, images: list, claimedDigest: browser.sha256 });
  assert.equal(sealed.digest, browser.sha256); assert(!sealed.receipt.includes("session-a"));
  assert.equal(verifyImageReceipt({ ...ctx, images: list, receipt: sealed.receipt }), true);
});

test("receipt refuses changed bytes, order, labels, project, user, session, secret and expiry", async () => {
  const list = images(), claimedDigest = (await makeRedactionBundle(list, webcrypto)).sha256;
  const { receipt, expiresAt } = issueImageReceipt({ ...ctx, images: list, claimedDigest });
  const changed = images(); changed[1].data = Buffer.from([0xff, 0xd8, 0x00, 0xff, 0xd9]).toString("base64");
  for (const args of [
    { images: changed }, { images: [...list].reverse() }, { images: list.slice(0, 3) },
    { images: list.map((x, i) => i ? x : { ...x, label: "OTHER" }) }, { projectId: "project-b" }, { userId: "user-b" },
    { credential: "session-b" }, { env: { SESSION_SECRET: "a-different-secret-longer-than-32-characters" } },
    { now: expiresAt }, { now: ctx.now - 1 }, { receipt: receipt.slice(0, -1) + (receipt.endsWith("A") ? "B" : "A") },
  ]) assert.equal(verifyImageReceipt({ ...ctx, images: list, receipt, ...args }), false);
  assert.equal(verifyImageReceipt({ ...ctx, images: list, receipt, now: expiresAt - 1 }), true);
});

test("invalid or incomplete input, forged client digest and absent key fail closed", async () => {
  const list = images(), claimedDigest = (await makeRedactionBundle(list, webcrypto)).sha256;
  assert.throws(() => issueImageReceipt({ ...ctx, images: list, claimedDigest: "0".repeat(64) }), /BUNDLE_MISMATCH/);
  assert.throws(() => issueImageReceipt({ ...ctx, images: list, claimedDigest, env: {} }), /RECEIPT_KEY_UNAVAILABLE/);
  assert.throws(() => issueImageReceipt({ ...ctx, images: list, claimedDigest, credential: "" }), /RECEIPT_SESSION_INVALID/);
  assert.throws(() => imageBundleDigest(list.slice(0, 3)), /INCOMPLETE_BUNDLE/);
  assert.throws(() => imageBundleDigest(list.map((v, i) => i ? v : { ...v, hidden: "not-bound" })), /INVALID_BUNDLE/);
  assert.throws(() => imageBundleDigest(list.map((v, i) => i ? v : { ...v, data: "YWJj" })), /INVALID_BUNDLE/);
  assert.equal(verifyImageReceipt({ ...ctx, images: list, receipt: "not-a-receipt" }), false);
});
