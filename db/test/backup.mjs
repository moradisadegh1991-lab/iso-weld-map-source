#!/usr/bin/env node
/**
 * Backups (review R2): a backup is verified before it is called one, a
 * restore goes only into an empty target and proves itself by row counts,
 * a tampered or unexplained file is refused, and a PGlite directory held by a
 * live server is not copied from under it.
 *
 * The PostgreSQL half runs when BACKUP_TEST_DATABASE_URL names a server this
 * test may create and drop databases on (pg_dump / pg_restore on PATH):
 *   BACKUP_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:5433/postgres
 */
import { test, run, assert, equal, throws } from "./harness.mjs";
import { mkdtemp, readdir, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "backup-test-"));
const { createClient } = await import("../../lib/db/client.mjs");
const { migrate } = await import("../../lib/db/migrate.mjs");
const B = await import("../../lib/db/backup.mjs");
// The newest migration, read from the directory — not written here, or every new migration breaks this test.
const LATEST = (await readdir(new URL("../migrations/", import.meta.url))).filter((f) => f.endsWith(".sql")).sort().at(-1).replace(/\.sql$/, "");

const src = path.join(root, "live");
const out = path.join(root, "backups");
{
  const db = await createClient({ url: null, dataDir: src });
  await migrate(db);
  await db.query("INSERT INTO project (code, name) VALUES ('BK1','One'), ('BK2','Two')");
  await db.close();
}
let first;

test("a PGlite backup is read back and counted before it is reported", async () => {
  first = await B.backup({ dataDir: src, dir: out, now: "20260926T080000Z" });
  equal([first.driver, first.rows.project, first.migration], ["pglite", 2, LATEST]);
  assert(first.tables > 50 && /matches/.test(first.verified));
  const m = JSON.parse(await readFile(`${first.file}.json`, "utf8"));
  equal([m.sha256, m.rows.project], [first.sha256, 2], "the manifest beside it says what it holds");
});

test("a directory a live server holds is not copied; a lock left by a dead one is not an obstacle", async () => {
  const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 20000)"], { stdio: "ignore" });
  try {
    await writeFile(B.serverLockPath(src), String(child.pid));
    equal(await B.pgliteHolder(src), child.pid);
    await throws(async () => B.backup({ dataDir: src, dir: out, now: "20260926T080100Z" }), `pid ${child.pid}`);
  } finally { child.kill(); }
  await new Promise((r) => child.on("exit", r));
  equal(await B.pgliteHolder(src), null, "the server is gone; its lock file is only a file");
  const again = await B.backup({ dataDir: src, dir: out, now: "20260926T080200Z" });
  equal(again.rows.project, 2);
});

test("restore goes into an empty directory, and the copy is the database — rows and row level security", async () => {
  const into = path.join(root, "restored");
  const r = await B.restore({ file: first.file, into });
  equal([r.tables, r.manifest.rows.project], [first.tables, 2]);
  const db = await createClient({ url: null, dataDir: into });
  try {
    equal((await db.query("SELECT code FROM project ORDER BY code")).rows.map((x) => x.code), ["BK1", "BK2"]);
    const { rows: [f] } = await db.query("SELECT relforcerowsecurity AS f FROM pg_class WHERE relname = 'weld'");
    equal(f.f, true, "the isolation policies came with it");
  } finally { await db.close(); }
});

test("a restore is refused onto anything but an empty target of its own kind", async () => {
  await throws(async () => B.restore({ file: first.file, into: path.join(root, "restored") }), "خالی نیست");
  await throws(async () => B.restore({ file: first.file, into: "postgresql://x@localhost/y" }), "مقصدش یک پوشه");
  await throws(async () => B.restore({ file: first.file }), "مقصد بازیابی");
});

test("a changed byte, or a file with no manifest, is refused before anything is written", async () => {
  const bad = path.join(root, "tampered.tar.gz");
  const bytes = await readFile(first.file);
  bytes[bytes.length >> 1] ^= 0xff;
  await writeFile(bad, bytes);
  await writeFile(`${bad}.json`, await readFile(`${first.file}.json`));
  await throws(async () => B.restore({ file: bad, into: path.join(root, "r-bad") }), "هش متفاوت");
  const bare = path.join(root, "bare.tar.gz");
  await writeFile(bare, await readFile(first.file));
  await throws(async () => B.restore({ file: bare, into: path.join(root, "r-bare") }), "مانیفست");
  equal((await readdir(root)).filter((n) => n.startsWith("r-")), [], "no target was created");
});

test("a restore that does not match its manifest's counts is reported, not trusted", async () => {
  const f = path.join(root, "edited.tar.gz");
  await writeFile(f, await readFile(first.file));
  const m = JSON.parse(await readFile(`${first.file}.json`, "utf8"));
  m.rows.project = 3;   // the file is intact; the manifest now claims a row it never had
  await writeFile(`${f}.json`, JSON.stringify(m));
  await throws(async () => B.restore({ file: f, into: path.join(root, "restored-edited") }), "project: 3 ≠ 2");
});

test("retention keeps the newest N of each kind, with their manifests", async () => {
  await B.backup({ dataDir: src, dir: out, now: "20260926T080300Z" });
  const before = (await B.list(out)).map((b) => path.basename(b.file));
  equal(before.length, 3);
  const removed = await B.prune({ dir: out, keep: 2 });
  equal(removed, ["epc-pglite-20260926T080000Z.tar.gz"], "the oldest goes");
  equal((await readdir(out)).sort(), [
    "epc-pglite-20260926T080200Z.tar.gz", "epc-pglite-20260926T080200Z.tar.gz.json",
    "epc-pglite-20260926T080300Z.tar.gz", "epc-pglite-20260926T080300Z.tar.gz.json"]);
  await throws(async () => B.prune({ dir: out, keep: 0 }), "عدد صحیح مثبت");
});

test("a password never reaches a manifest or a message", async () => {
  equal(B.redact("postgresql://epc:s3cret-pass@db.local:5432/epc"), "postgresql://epc:***@db.local:5432/epc");
  equal(B.redact("postgresql://epc@db.local/epc"), "postgresql://epc@db.local/epc");
});

// ── PostgreSQL ───────────────────────────────────────────────────────────
const PG = process.env.BACKUP_TEST_DATABASE_URL;
if (!PG) {
  test("PostgreSQL (skipped — set BACKUP_TEST_DATABASE_URL to a server this test may create databases on)", async () => {});
} else {
  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: PG });
  await admin.connect();
  const name = (s) => `bk_${s}_${process.pid}`;
  // A password in every URL (trust auth ignores it): it must never reach a manifest.
  const urlOf = (db) => { const u = new URL(PG); u.pathname = `/${db}`; u.password = "not-a-real-secret"; return u.toString(); };
  for (const d of ["src", "dst", "full"]) { await admin.query(`DROP DATABASE IF EXISTS ${name(d)}`); await admin.query(`CREATE DATABASE ${name(d)}`); }
  {
    const db = await createClient({ url: urlOf(name("src")) });
    await migrate(db);
    await db.query("INSERT INTO project (code, name) VALUES ('PG1','One'), ('PG2','Two'), ('PG3','Three')");
    await db.close();
  }
  let dump;
  test("PostgreSQL: pg_dump inside one snapshot; the counts are the file's, even while the platform writes", async () => {
    // Writes keep landing throughout the backup. The manifest must still
    // describe the FILE exactly — the restore below counts it.
    const writer = new pg.Client({ connectionString: urlOf(name("src")) });
    await writer.connect();
    let busy = true, n = 0;
    const writing = (async () => { while (busy) { await writer.query("INSERT INTO project (code, name) VALUES ($1, 'w')", [`W${n++}`]); } })();
    try {
      dump = await B.backup({ url: urlOf(name("src")), dir: out, now: "20260926T090000Z" });
    } finally { busy = false; await writing; await writer.end(); }
    assert(n > 5, `writes went on during the backup (${n})`);
    equal([dump.driver, dump.migration], ["pg", LATEST]);
    assert(dump.rows.project >= 3, "the three rows before it, and whatever the snapshot saw");
    assert(!dump.source.includes("not-a-real-secret") && (await readFile(`${dump.file}.json`, "utf8")).indexOf("not-a-real-secret") < 0,
      "no password in the manifest");
  });
  test("PostgreSQL: restored into an empty database, counted, and refused onto a full one", async () => {
    const r = await B.restore({ file: dump.file, into: urlOf(name("dst")) });
    const db = await createClient({ url: urlOf(name("dst")) });
    try {
      equal((await db.query("SELECT count(*)::int AS n FROM project")).rows[0].n, r.manifest.rows.project,
        "the restored file holds exactly what the manifest counted");
      const { rows } = await db.query("SELECT has_table_privilege('app_rw', 'weld', 'INSERT') AS rw, has_table_privilege('app_report', 'weld', 'INSERT') AS rep");
      equal([rows[0].rw, rows[0].rep], [true, false], "the grants came with it");
    } finally { await db.close(); }
    await throws(async () => B.restore({ file: dump.file, into: urlOf(name("src")) }), "خالی نیست");
  });
  test("PostgreSQL: cleanup", async () => {
    for (const d of ["src", "dst", "full"]) await admin.query(`DROP DATABASE IF EXISTS ${name(d)} WITH (FORCE)`);
    await admin.end();
  });
}

await run();
await rm(root, { recursive: true, force: true });
