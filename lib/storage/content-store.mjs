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
 * Two drivers behind one interface: a directory on this server, or a MinIO
 * (any S3) bucket — what the reference architecture specifies for a real
 * deployment, and what more than one application server needs. Which one
 * is lib/storage/index.mjs's to decide, from the environment.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import path from "node:path";

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Two-level fan-out keeps directory listings usable at scale. */
export const keyFor = (digest, ext = "") => `${digest.slice(0, 2)}/${digest.slice(2, 4)}/${digest}${ext}`;

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
      const key = stripScheme(uri, "local");
      const buf = await readFile(abs(key));
      verify(key, buf);
      return buf;
    },

    async has(uri) {
      return !!(await stat(abs(stripScheme(uri, "local"))).catch(() => null));
    },
  };
}

/**
 * MinIO / S3 driver.
 *
 * Objects are kept under the same key the local driver uses — the digest,
 * fanned out — so moving a store from disk to a bucket is a copy, and a
 * `local://` URI already written into the database (and those tables are
 * append-only; the URI is never rewritten) still names the object: the
 * key is the digest, not the machine.
 *
 * The bucket checks the bytes on the way in (the SHA-256 is sent with
 * them, and MinIO refuses an upload that does not match it), and this
 * driver checks them on the way out: what comes back is what was kept,
 * or an error — never a quietly different file.
 *
 * `client` is an S3 client from @aws-sdk/client-s3 (the aggregated `S3`
 * class). "Not found" is the only answer read as "not there"; a refused
 * credential or a dead endpoint is an error, not an empty bucket.
 *
 * `signer` is the client whose endpoint a BROWSER can reach, for presigned
 * uploads — often not the address the server itself uses (http://minio:9000
 * inside the network, https://files.example.ir outside). Defaults to `client`.
 */
export function createS3Store({ client, bucket, signer = client }) {
  if (!client || !bucket) throw new Error("createS3Store needs a client and a bucket");
  const keyOf = (uri) => {
    const u = String(uri);
    if (u.startsWith("local://")) return stripScheme(u, "local");
    const rest = stripScheme(u, "s3");
    if (!rest.startsWith(`${bucket}/`)) throw new Error(`object is in another bucket: ${uri}`);
    return rest.slice(bucket.length + 1);
  };
  const head = (key) => client.headObject({ Bucket: bucket, Key: key }).catch((e) => {
    if (isNotFound(e)) return null;
    throw e;
  });
  return {
    driver: "s3",
    bucket,
    async put(buf, { ext = "", contentType } = {}) {
      const digest = sha256(buf);
      const key = keyFor(digest, ext);
      const have = await head(key);
      if (have) return { digest, uri: `s3://${bucket}/${key}`, size: have.ContentLength, deduplicated: true };
      await client.putObject({ Bucket: bucket, Key: key, Body: buf, ContentType: contentType,
        ChecksumSHA256: Buffer.from(digest, "hex").toString("base64") });
      return { digest, uri: `s3://${bucket}/${key}`, size: buf.length, deduplicated: false };
    },
    async get(uri) {
      const key = keyOf(uri);
      const res = await client.getObject({ Bucket: bucket, Key: key });
      const buf = Buffer.from(await res.Body.transformToByteArray());
      verify(key, buf);
      return buf;
    },
    async has(uri) {
      return !!(await head(keyOf(uri)));
    },
    /**
     * A URL the browser PUTs a large file to, straight into the bucket.
     *
     * The key is the digest the uploader claims — and the SHA-256 is part
     * of the signature, so MinIO refuses any bytes that do not hash to it:
     * the claim is checked by the bucket before anything is kept. Signed for
     * the exact size too. A file already in the bucket needs no upload.
     */
    async presignPut({ digest, ext = "", contentType = "application/octet-stream", size, expiresIn = 900 }) {
      if (!/^[0-9a-f]{64}$/.test(String(digest))) throw new Error("presignPut needs a SHA-256 digest");
      if (!(Number.isInteger(size) && size > 0)) throw new Error("presignPut needs the size in bytes");
      const key = keyFor(digest, ext);
      const uri = `s3://${bucket}/${key}`;
      if (await head(key)) return { exists: true, uri };
      const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
        import("@aws-sdk/client-s3"), import("@aws-sdk/s3-request-presigner")]);
      const checksum = Buffer.from(digest, "hex").toString("base64");
      const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType, ContentLength: size, ChecksumSHA256: checksum });
      // The checksum stays a header the browser must send (not a query
      // parameter), so it is part of what MinIO checks against the body.
      const url = await getSignedUrl(signer, cmd, { expiresIn, unhoistableHeaders: new Set(["x-amz-checksum-sha256"]) });
      return { exists: false, uri, url, method: "PUT",
        headers: { "Content-Type": contentType, "x-amz-checksum-sha256": checksum } };
    },

    /**
     * What the bucket holds under a URI: its size, and the SHA-256 it
     * checked on the way in. Null when there is nothing there.
     */
    async stat(uri) {
      const h = await client.headObject({ Bucket: bucket, Key: keyOf(uri), ChecksumMode: "ENABLED" }).catch((e) => {
        if (isNotFound(e)) return null;
        throw e;
      });
      if (!h) return null;
      return { size: h.ContentLength, sha256: h.ChecksumSHA256 ? Buffer.from(h.ChecksumSHA256, "base64").toString("hex") : null };
    },

    /** The keys under a prefix, for copying and checking. */
    async *keys(prefix = "") {
      let token;
      do {
        const r = await client.listObjectsV2({ Bucket: bucket, Prefix: prefix, ContinuationToken: token });
        for (const o of r.Contents || []) yield o.Key;
        token = r.IsTruncated ? r.NextContinuationToken : undefined;
      } while (token);
    },
  };
}

/** Bytes that do not hash to the name they are kept under are not returned. */
function verify(key, buf) {
  const want = path.posix.basename(key).split(".")[0];
  if (/^[0-9a-f]{64}$/.test(want) && sha256(buf) !== want) {
    throw Object.assign(new Error(`stored object does not match its hash: ${key}`), { code: "CONTENT_MISMATCH" });
  }
}

const isNotFound = (e) => e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;

function stripScheme(uri, scheme) {
  const prefix = `${scheme}://`;
  if (!String(uri).startsWith(prefix)) throw new Error(`not a ${scheme} uri: ${uri}`);
  return String(uri).slice(prefix.length);
}
