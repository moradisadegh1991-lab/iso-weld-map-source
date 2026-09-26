#!/usr/bin/env node
/**
 * The file store: the same contract on disk and in a MinIO bucket — kept
 * under its hash, read back only if it still hashes to it — and the direct
 * upload of a large drawing, where the bucket refuses bytes that are not
 * the ones the signature names.
 *
 * The S3 half runs against a real MinIO when one is given:
 *   S3_TEST_ENDPOINT=http://127.0.0.1:9000 S3_TEST_ACCESS_KEY_ID=… S3_TEST_SECRET_ACCESS_KEY=…
 * and says it was skipped otherwise.
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createLocalStore, sha256, keyFor } from "../../lib/storage/content-store.mjs";
import { storageConfig, createStore } from "../../lib/storage/index.mjs";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from("site photo bytes")]);
const OTHER = Buffer.from("a different file");

async function contract(store, label) {
  const a = await store.put(JPEG, { ext: ".jpg", contentType: "image/jpeg" });
  equal([a.digest, a.deduplicated, a.size], [sha256(JPEG), false, JPEG.length], label);
  assert(a.uri.endsWith(keyFor(a.digest, ".jpg")), `${label}: kept under its hash — ${a.uri}`);
  const again = await store.put(JPEG, { ext: ".jpg" });
  equal([again.uri, again.deduplicated], [a.uri, true], `${label}: the same bytes are one object`);
  assert((await store.get(a.uri)).equals(JPEG), `${label}: read back as written`);
  equal([await store.has(a.uri), await store.has(a.uri.replace(a.digest, sha256(OTHER)))], [true, false], label);
  return a;
}

test("the environment chooses the store, and a half-configured bucket is an error, not the local disk", async () => {
  equal(storageConfig({}), { driver: "local", root: ".storage" });
  equal(storageConfig({ STORAGE_ROOT: "/data/files" }).root, "/data/files");
  await throws(async () => storageConfig({ STORAGE_DRIVER: "s3", S3_ENDPOINT: "http://minio:9000" }), "S3_BUCKET");
  await throws(async () => storageConfig({ STORAGE_DRIVER: "ftp" }), "local or s3");
  const c = storageConfig({ STORAGE_DRIVER: "S3", S3_ENDPOINT: "http://minio:9000", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" });
  equal([c.driver, c.region, c.publicEndpoint], ["s3", "us-east-1", "http://minio:9000"], "browsers use the same address unless told otherwise");
  const local = await createStore({ STORAGE_ROOT: await mkdtemp(path.join(tmpdir(), "sto-")) });
  equal(local.driver, "local");
});

test("on disk: kept under its hash, and a file changed on disk is not returned", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sto-local-"));
  const store = createLocalStore({ root });
  const a = await contract(store, "local");
  await writeFile(path.join(root, keyFor(a.digest, ".jpg")), OTHER);
  const e = await throws(() => store.get(a.uri), "does not match its hash");
  equal(e.code, "CONTENT_MISMATCH");
});

const S3 = process.env.S3_TEST_ENDPOINT;
if (!S3) {
  test("MinIO (skipped — set S3_TEST_ENDPOINT, S3_TEST_ACCESS_KEY_ID, S3_TEST_SECRET_ACCESS_KEY)", async () => {});
} else {
  const bucket = `epc-test-${Date.now().toString(36)}`;
  const env = { STORAGE_DRIVER: "s3", S3_ENDPOINT: S3, S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: process.env.S3_TEST_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY: process.env.S3_TEST_SECRET_ACCESS_KEY };
  const sh = promisify(execFile);
  const tool = (cmd, extra = {}) => sh(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", "./tools/register.mjs",
    "tools/storage.mjs", cmd], { env: { ...process.env, ...env, ...extra } });
  let store, raw;

  test("MinIO: the setup creates the bucket and proves a write reads back", async () => {
    const { stdout } = await tool("setup");
    assert(/created/.test(stdout) && /compare: ok/.test(stdout), stdout);
    assert(/exists/.test((await tool("setup")).stdout), "a second setup finds it");
    store = await createStore(env);
    const { s3Client } = await import("../../lib/storage/index.mjs");
    raw = await s3Client(storageConfig(env));
  });

  test("MinIO: the same contract as the disk; a local:// URI names the same object; another bucket's does not", async () => {
    const a = await contract(store, "s3");
    assert(a.uri.startsWith(`s3://${bucket}/`), a.uri);
    const local = `local://${keyFor(a.digest, ".jpg")}`;
    assert((await store.get(local)).equals(JPEG), "a URI written before the move still reads");
    await throws(() => store.get(`s3://someone-else/${keyFor(a.digest, ".jpg")}`), "another bucket");
    await throws(() => store.get("pending://abc"), "not a s3 uri");
    const st = await store.stat(a.uri);
    equal(st, { size: JPEG.length, sha256: a.digest }, "the bucket kept the hash it checked");
    equal(await store.stat(`local://${keyFor(sha256(OTHER))}`), null);
  });

  test("MinIO: an object replaced behind the application's back is refused on read", async () => {
    const a = await store.put(Buffer.from("drawing ISO-9 rev 0"), { ext: ".pdf" });
    await raw.putObject({ Bucket: bucket, Key: a.uri.slice(`s3://${bucket}/`.length), Body: Buffer.from("drawing ISO-9 rev X") });
    const e = await throws(() => store.get(a.uri), "does not match its hash");
    equal(e.code, "CONTENT_MISMATCH");
  });

  test("MinIO: a refused credential is an error, not an empty bucket", async () => {
    const bad = await createStore({ ...env, S3_SECRET_ACCESS_KEY: "wrong-secret-0000" });
    await throws(() => bad.has(`s3://${bucket}/${keyFor(sha256(JPEG), ".jpg")}`));
    await throws(() => bad.put(OTHER));
  });

  test("MinIO: a presigned upload takes exactly the bytes it was signed for", async () => {
    const big = Buffer.alloc(4 * 1024 * 1024, 7);         // over the request-body ceiling
    const digest = sha256(big);
    const p = await store.presignPut({ digest, ext: ".pdf", contentType: "application/pdf", size: big.length });
    equal([p.exists, p.method, p.uri], [false, "PUT", `s3://${bucket}/${keyFor(digest, ".pdf")}`]);
    const forged = Buffer.from(big); forged[100] = 8;
    let r = await fetch(p.url, { method: "PUT", headers: p.headers, body: forged });
    assert(r.status >= 400, `other bytes of the same size refused (${r.status})`);
    equal(await store.stat(p.uri), null, "nothing kept");
    r = await fetch(p.url, { method: "PUT", headers: { ...p.headers, "x-amz-checksum-sha256": Buffer.from(sha256(forged), "hex").toString("base64") }, body: forged });
    assert(r.status >= 400, `a checksum swapped to match other bytes breaks the signature (${r.status})`);
    // Another size is refused on the signature, before MinIO reads and hashes a body of any length.
    r = await fetch(p.url, { method: "PUT", headers: p.headers, body: Buffer.concat([big, Buffer.alloc(1)]) });
    equal([r.status, (await r.text()).match(/<Code>(\w+)</)?.[1]], [403, "SignatureDoesNotMatch"], "the size is signed");
    r = await fetch(p.url, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: big });
    assert(r.status >= 400, `the checksum header left off (${r.status})`);
    r = await fetch(p.url, { method: "PUT", headers: p.headers, body: big });
    equal(r.status, 200, await r.text());
    equal(await store.stat(p.uri), { size: big.length, sha256: digest });
    equal((await store.presignPut({ digest, ext: ".pdf", size: big.length })).exists, true, "already there: no second upload");
    await throws(() => store.presignPut({ digest: "abc", size: 1 }), "SHA-256");
    await throws(() => store.presignPut({ digest, size: 0 }), "size");
  });

  test("MinIO: migrate copies a disk store into the bucket, checked, and again copies only what is new", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "sto-mig-"));
    const disk = createLocalStore({ root });
    const one = await disk.put(Buffer.from("iso sheet 1"), { ext: ".jpg" });
    const two = await disk.put(Buffer.from("iso sheet 2"), { ext: ".png" });
    await mkdir(path.join(root, "tmp"), { recursive: true });
    await writeFile(path.join(root, "tmp", "notes.txt"), "not a stored file");
    let out = await tool("migrate", { STORAGE_ROOT: root });
    assert(/^2 copied · 0 already/m.test(out.stdout) && /skipped: tmp\/notes.txt/.test(out.stderr), out.stdout + out.stderr);
    for (const x of [one, two]) assert((await store.get(x.uri)).equals(await disk.get(x.uri)), x.uri);
    await disk.put(Buffer.from("iso sheet 3"), { ext: ".jpg" });
    out = await tool("migrate", { STORAGE_ROOT: root });
    assert(/^1 copied · 2 already/m.test(out.stdout), out.stdout);
    await writeFile(path.join(root, keyFor(one.digest, ".jpg")), "corrupted on disk");
    await disk.put(Buffer.from("iso sheet 4"), { ext: ".jpg" });
    const failed = await tool("migrate", { STORAGE_ROOT: root }).then(() => null, (e) => e);
    assert(failed && failed.code === 1 && /does not match its hash/.test(failed.stderr), "a corrupt file is named and fails the run");
  });
}

await run();
