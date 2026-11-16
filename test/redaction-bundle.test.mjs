import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { hasCompleteTileGrid, makeRedactionBundle } from "../lib/client/redaction-bundle.mjs";
const full = { label: "FULL SHEET", mediaType: "image/jpeg", data: "YQ==" };
const tile = { label: "TOP-LEFT TILE", mediaType: "image/jpeg", data: "Yg==" };
test("hash binds each image's bytes, label and order; input mutations cannot change the snapshot", async () => {
  const originals = [{ ...full }, { ...tile }], first = await makeRedactionBundle(originals, webcrypto);
  assert.match(first.sha256, /^[0-9a-f]{64}$/); originals[0].data = "Yw==";
  assert.equal(first.images[0].data, "YQ=="); assert(Object.isFrozen(first.images[0]) && Object.isFrozen(first.images));
  assert.notEqual((await makeRedactionBundle(originals, webcrypto)).sha256, first.sha256);
  assert.notEqual((await makeRedactionBundle([tile, full], webcrypto)).sha256, first.sha256);
  assert.notEqual((await makeRedactionBundle([{ ...full, label: "OTHER" }, tile], webcrypto)).sha256, first.sha256);
  assert.equal((await makeRedactionBundle([full, tile], webcrypto)).sha256, first.sha256);
});
test("invalid payloads and missing cryptography fail closed", async () => {
  for (const images of [[], Array(11).fill(full), [{ ...full, data: "not-base64!" }], [{ ...full, mediaType: "image/png" }], [{ ...full, label: "name@example.com" }], [{ ...full, data: "A".repeat(3_400_004) }]])
    await assert.rejects(makeRedactionBundle(images, webcrypto));
  await assert.rejects(makeRedactionBundle([full], {}));
});

test("coverage warning accepts a complete 2×2 fallback as well as a full 3×3 grid", () => {
  const make = (labels) => labels.map((label) => ({ label }));
  const two = ["FULL SHEET", "TOP-LEFT TILE", "TOP-RIGHT TILE", "BOTTOM-LEFT TILE", "BOTTOM-RIGHT TILE"];
  const three = ["FULL SHEET", "TOP-LEFT TILE", "TOP-CENTRE TILE", "TOP-RIGHT TILE", "MIDDLE-LEFT TILE", "MIDDLE-CENTRE TILE", "MIDDLE-RIGHT TILE", "BOTTOM-LEFT TILE", "BOTTOM-CENTRE TILE", "BOTTOM-RIGHT TILE"];
  assert.equal(hasCompleteTileGrid(make(two)), true); assert.equal(hasCompleteTileGrid(make(three)), true);
  assert.equal(hasCompleteTileGrid(make(three.slice(0, 3))), false); assert.equal(hasCompleteTileGrid(make([...two.slice(0, 4), two[3]])), false);
});
