/**
 * The content store this server uses, chosen by the environment.
 *
 *   STORAGE_DRIVER=local (default)   STORAGE_ROOT, default .storage
 *   STORAGE_DRIVER=s3                MinIO or any S3:
 *     S3_ENDPOINT            http://minio:9000
 *     S3_BUCKET              epc-files
 *     S3_ACCESS_KEY_ID       S3_SECRET_ACCESS_KEY
 *     S3_REGION              default us-east-1 (MinIO ignores it; the signature needs one)
 *     S3_PUBLIC_ENDPOINT     the address browsers reach the bucket at, for
 *                            direct upload of large drawings; default S3_ENDPOINT
 *
 * A misconfigured S3 store is an error when first used — never a silent
 * fall back to the local disk, where files would land on one server of
 * several and be missing from the others.
 */
import { createLocalStore, createS3Store } from "./content-store.mjs";

let cached = null;

export function storageConfig(env = process.env) {
  const driver = (env.STORAGE_DRIVER || "local").toLowerCase();
  if (driver === "local") return { driver, root: env.STORAGE_ROOT || ".storage" };
  if (driver !== "s3") throw new Error(`STORAGE_DRIVER must be local or s3, not ${driver}`);
  const missing = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
  return { driver, endpoint: env.S3_ENDPOINT, publicEndpoint: env.S3_PUBLIC_ENDPOINT || env.S3_ENDPOINT, bucket: env.S3_BUCKET, region: env.S3_REGION || "us-east-1",
    accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY };
}

/** An S3 client for a config (path-style: MinIO serves buckets under the path). */
export async function s3Client(cfg, { endpoint = cfg.endpoint } = {}) {
  const { S3 } = await import("@aws-sdk/client-s3");
  return new S3({ endpoint, region: cfg.region, forcePathStyle: true,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    // Checksums only where this code asks for one (the SHA-256 on upload).
    requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
}

export async function createStore(env = process.env) {
  const cfg = storageConfig(env);
  if (cfg.driver === "local") return createLocalStore({ root: cfg.root });
  const client = await s3Client(cfg);
  const signer = cfg.publicEndpoint === cfg.endpoint ? client : await s3Client(cfg, { endpoint: cfg.publicEndpoint });
  return createS3Store({ client, bucket: cfg.bucket, signer });
}

/** The store for this process, made once per configuration. */
export async function getStore() {
  const key = JSON.stringify(storageConfig());
  if (!cached || cached.key !== key) cached = { key, store: createStore() };
  return cached.store;
}
