/**
 * Content-addressed blob storage for drawings.
 *
 * A drawing is stored under the SHA-256 of its bytes, which buys three things
 * at once:
 *
 *   - uploading the same sheet twice costs nothing and, more importantly,
 *     re-extracts nothing (a re-extraction is a model call and a review queue
 *     entry, not just CPU);
 *   - a register can be pinned to the exact bytes it was computed from, so
 *     "which file was this approved against" has an answer years later;
 *   - a file cannot be swapped underneath an approval without the hash
 *     changing, which is what makes the approval mean anything.
 *
 * Two drivers behind one interface. The local one works now; the S3 one is
 * the same code path against MinIO, which is what the reference architecture
 * specifies for the real deployment.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Two-level fan-out keeps directory listings usable at scale. */
const keyFor = (digest, ext = "") => `${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}${ext}`;

export function createLocalStore({ root = ".storage" } = {}) {
  const abs = (key) => path.join(root, key);

  return {
    driver: "local",

    /** @returns {Promise<{digest: string, uri: string, size: number, deduplicated: boolean}>} */
    async put(buf, { ext = "" } = {}) {
      const digest = sha256(buf);
      const key = keyFor(digest, ext);
      const file = abs(key);
      const existing = await stat(file).catch(() => null);
      if (existing) {
        return { digest, uri: `local://${key}`, size: existing.size, deduplicated: true };
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, buf);
      return { digest, uri: `local://${key}`, size: buf.length, deduplicated: false };
    },

    async get(uri) {
      return readFile(abs(stripScheme(uri, "local")));
    },

    async has(uri) {
      return !!(await stat(abs(stripScheme(uri, "local"))).catch(() => null));
    },
  };
}

/**
 * MinIO / S3 driver. Deliberately not wired to a live bucket here: the
 * reference deployment runs MinIO inside the plant network, so this is the
 * seam it plugs into rather than something testable from a laptop.
 */
export function createS3Store({ client, bucket }) {
  if (!client || !bucket) throw new Error("createS3Store needs a client and a bucket");
  return {
    driver: "s3",
    async put(buf, { ext = "", contentType } = {}) {
      const digest = sha256(buf);
      const key = keyFor(digest, ext);
      const head = await client.headObject({ Bucket: bucket, Key: key }).catch(() => null);
      if (head) return { digest, uri: `s3://${bucket}/${key}`, size: head.ContentLength, deduplicated: true };
      await client.putObject({ Bucket: bucket, Key: key, Body: buf, ContentType: contentType });
      return { digest, uri: `s3://${bucket}/${key}`, size: buf.length, deduplicated: false };
    },
    async get(uri) {
      const key = stripScheme(uri, "s3").replace(`${bucket}/`, "");
      const res = await client.getObject({ Bucket: bucket, Key: key });
      return Buffer.from(await res.Body.transformToByteArray());
    },
    async has(uri) {
      const key = stripScheme(uri, "s3").replace(`${bucket}/`, "");
      return !!(await client.headObject({ Bucket: bucket, Key: key }).catch(() => null));
    },
  };
}

function stripScheme(uri, scheme) {
  const prefix = `${scheme}://`;
  if (!String(uri).startsWith(prefix)) throw new Error(`not a ${scheme} uri: ${uri}`);
  return String(uri).slice(prefix.length);
}
