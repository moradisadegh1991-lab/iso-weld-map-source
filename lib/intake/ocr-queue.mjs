/**
 * The OCR queue: one document at a time, in this server process. OCR is
 * the slowest thing the platform does (seconds to minutes per sheet), and a
 * small server should not run several at once.
 *
 * The queue lives in memory: a server restart empties it. A run recorded as
 * 'queued' whose document is no longer here shows as stopped on the page,
 * and a person queues it again — nothing is read silently later.
 */
import { outsideScope } from "../db/scope.mjs";

const waiting = [];
const active = new Set();
let running = false;

/** job: async () => void; key: the revision id. A key already queued is not queued twice. */
export function enqueue(key, job) {
  if (active.has(key)) return false;
  active.add(key);
  waiting.push({ key, job });
  // The queue is filled from inside a request's project scope; it must not
  // run its jobs as part of that scope (they take their own, later).
  if (!running) { running = true; outsideScope(drain); }
  return true;
}

async function drain() {
  running = true;
  while (waiting.length) {
    const { key, job } = waiting.shift();
    try { await job(); } catch (e) { console.error(`[ocr] ${key}: ${e.message || e}`); }
    active.delete(key);
  }
  running = false;
}

/** Revisions queued or being read now. */
export function ocrActive() {
  return new Set(active);
}

/** Resolves when the queue is empty (tests, shutdown). */
export async function ocrIdle() {
  while (running || waiting.length) await new Promise((r) => setTimeout(r, 50));
}
