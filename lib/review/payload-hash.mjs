import { createHash } from "node:crypto";

/**
 * A fingerprint of a stored run payload, for detecting a stale edit: `GET /api/runs/[id]` and every correction hand it out, a correction that
 * names the one it was made against (`baseHash`) is refused (409 STALE_RUN) if the run has been changed since. The stored payload is jsonb, so the
 * same content always serialises the same way.
 */
export const payloadHash = (payload) => createHash("sha256").update(JSON.stringify(payload ?? null)).digest("hex").slice(0, 32);
