import test from "node:test";
import assert from "node:assert/strict";
import { redactionPixels, maskImageSource, prepareMaskedSource } from "../lib/client/image-redaction.mjs";

test("masks must be explicit, finite, positive and wholly within this page", () => {
  for (const m of [[], null, [{}], [{x: 0, y: 0, width: 0, height: 1}], [{x: -0.01, y: 0, width: 0.2, height: 1}],
    [{x: 0.9, y: 0, width: 0.2, height: 0.2}], [{x: 0, y: 0, width: NaN, height: 1}], Array(101).fill({x: 0, y: 0, width: 0.1, height: 0.1})]) {
    assert.throws(() => redactionPixels(100, 100, m));
  }
  assert.throws(() => redactionPixels(0, 100, [{x: 0, y: 0, width: 1, height: 1}]));
  assert.deepEqual(redactionPixels(100, 200, [{x: 0.105, y: 0.205, width: 0.201, height: 0.1}]), [{x: 8, y: 39, width: 25, height: 24}]);
});

test("drawing is painted before tiles are made, with no original source passed to tiles", () => {
  const original = { width: 1000, height: 1000 }, ops = [], made = [];
  const previous = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = { width: 0, height: 0, getContext() { return {
      set fillStyle(v) { this.color = v; }, get fillStyle() { return this.color; },
      fillRect(...args) { ops.push({ canvas, fill: this.color, args }); },
      drawImage(source) { ops.push({ canvas, source }); },
    }; }, toDataURL() { return "data:image/jpeg;base64,eA=="; } }; made.push(canvas); return canvas;
  } };
  try {
    const result = prepareMaskedSource(original, [{x: 0.4, y: 0.4, width: 0.2, height: 0.2}]);
    assert.equal(result.images.length, 5); assert.notEqual(result.masked, original);
    assert.equal(ops[1].source, original); assert.equal(ops[2].fill, "#000");
    assert(ops.filter((o) => o.source && o.canvas !== result.masked).every((o) => o.source === result.masked));
    assert.equal(made.length, 6);
    assert.throws(() => maskImageSource(original, []));
  } finally { globalThis.document = previous; }
});
