#!/usr/bin/env node
/**
 * The file store, from the command line.
 *
 *   npm run storage -- setup     create the bucket if it is missing, then
 *                                write, read back and compare one object
 *   npm run storage -- migrate   copy every file under STORAGE_ROOT into the
 *                                bucket, each checked against its hash
 *   npm run storage -- verify    every file the database names — drawings,
 *                                documents, punch photos — present, and
 *                                hashing to what the database says
 *
 * Migrate copies; it deletes nothing, and it rewrites no URI: the database
 * keeps `local://…`, and the S3 driver reads that as the same key in the
 * bucket. Run it again after the switch and it copies only what is new.
 */
import "./env.mjs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { storageConfig, s3Client, createStore } from "../lib/storage/index.mjs";
import { sha256 } from "../lib/storage/content-store.mjs";

const cmd = process.argv[2];
const cfg = storageConfig();

if (cmd === "setup") {
  if (cfg.driver !== "s3") fail("setup is for STORAGE_DRIVER=s3; the local store needs none");
  const client = await s3Client(cfg);
  const exists = await client.headBucket({ Bucket: cfg.bucket }).then(() => true, (e) => {
    if (e?.$metadata?.httpStatusCode === 404) return false;
    throw e;
  });
  if (!exists) { await client.createBucket({ Bucket: cfg.bucket }); console.log(`bucket ${cfg.bucket} created`); }
  else console.log(`bucket ${cfg.bucket} exists`);
  const store = await createStore();
  const probe = Buffer.from(`epc storage probe ${new Date().toISOString().slice(0, 10)}`);
  const put = await store.put(probe, { ext: ".txt", contentType: "text/plain" });
  const back = await store.get(put.uri);
  if (!back.equals(probe)) fail("the object read back is not the one written");
  console.log(`write → read → compare: ok (${put.uri})`);
} else if (cmd === "migrate") {
  if (cfg.driver !== "s3") fail("migrate copies INTO a bucket: set STORAGE_DRIVER=s3 and the S3_* variables");
  const root = process.env.STORAGE_ROOT || ".storage";
  const store = await createStore();
  let copied = 0, present = 0, bad = 0;
  for await (const file of walk(root)) {
    const key = path.relative(root, file).split(path.sep).join("/");
    const buf = await readFile(file);
    const name = path.posix.basename(key).split(".")[0];
    if (!/^[0-9a-f]{64}$/.test(name)) { console.error(`  not a stored file (no hash in its name), skipped: ${key}`); continue; }
    if (sha256(buf) !== name) { bad++; console.error(`  does not match its hash, not copied: ${key}`); continue; }
    if (await store.has(`local://${key}`)) { present++; continue; }
    const r = await store.put(buf, { ext: path.posix.extname(key) });
    if (r.uri !== `s3://${cfg.bucket}/${key}`) { bad++; console.error(`  kept under an unexpected key: ${key} → ${r.uri}`); continue; }
    copied++;
  }
  console.log(`${copied} copied · ${present} already in ${cfg.bucket}${bad ? ` · ${bad} refused` : ""}`);
  if (bad) process.exit(1);
} else if (cmd === "verify") {
  const { createClient } = await import("../lib/db/client.mjs");
  const db = await createClient({ dataDir: process.env.PGLITE_DIR || ".pglite" });
  const store = await createStore();
  // As the migration user: an operator's check across every project.
  const { rows } = await db.query(
    `SELECT 'document' AS kind, doc_no AS ref, storage_uri, file_sha256 AS sha256 FROM document WHERE storage_uri NOT LIKE 'pending://%'
     UNION ALL SELECT 'punch photo', punch_id::text, storage_uri, sha256 FROM punch_photo`);
  let ok = 0;
  const problems = [];
  for (const r of rows) {
    try {
      const buf = await store.get(r.storage_uri);
      if (sha256(buf) !== r.sha256) problems.push(`${r.kind} ${r.ref}: bytes do not match the hash on record`);
      else ok++;
    } catch (e) {
      problems.push(`${r.kind} ${r.ref}: ${e.code === "ENOENT" || e?.name === "NoSuchKey" ? "missing" : e.message}`);
    }
  }
  console.log(`${ok} of ${rows.length} files present and intact (${cfg.driver === "s3" ? `bucket ${cfg.bucket}` : cfg.root})`);
  for (const p of problems) console.error("  " + p);
  await db.close?.();
  if (problems.length) process.exit(1);
} else {
  fail("usage: npm run storage -- setup | migrate | verify");
}

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}

function fail(msg) { console.error(msg); process.exit(2); }
