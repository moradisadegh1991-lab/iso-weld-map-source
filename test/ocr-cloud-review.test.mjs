import test from "node:test";
import assert from "node:assert/strict";
import { ocrReviewContext, checkedOcrReview } from "../lib/llm/ocr-cloud-review.mjs";

test("OCR context is bounded and only specified candidate fields are sent", () => {
  assert.throws(() => ocrReviewContext({ marks: Array(501).fill({}), bom: [] }));
  const data = ocrReviewContext({ marks: [{ no: "7", at: [2, 0], secret: "ignore" }], bom: [{ description: "elbow", extra: "ignore" }] });
  assert.equal(data.marks[0].at, null);
  assert.equal(JSON.stringify(data).includes("ignore"), false);
});

test("OCR review rejects invalid coordinates, incomplete results and oversized arrays", () => {
  const good = { notes: [], welds: [{ no: "7", x: 0.5, y: 0.5, reason: "inspect" }] };
  assert.deepEqual(checkedOcrReview(good), good);
  assert.equal(checkedOcrReview({ notes: [], welds: [{ ...good.welds[0], x: 2 }] }), null);
  assert.equal(checkedOcrReview({ notes: [], welds: [{ ...good.welds[0], y: null }] }), null);
  assert.equal(checkedOcrReview({ notes: [] }), null);
  assert.equal(checkedOcrReview({ notes: Array(51).fill("x"), welds: [] }), null);
});
