/**
 * Database backup and restore — review finding R2 (2026-09-26).
 *
 * The database holds what cannot be re-created: signed weld registers, MC
 * certificates, RFSU signatures, inspection results, ledgers made
 * append-only on purpose. A backup that has never been read back is a hope,
 * not a backup, so every backup here is VERIFIED before it is reported
 * written, and the manifest beside it says what it holds.
 *
 *   PostgreSQL (DATABASE_URL)  pg_dump, custom format, taken inside an
 *     exported REPEATABLE READ snapshot — the row counts in the manifest are
 *     counted in that same snapshot, so they are the dump's counts exactly,
 *     even while the platform keeps writing. Verified with pg_restore --list;
 *     `verify` additionally restores into a scratch database and compares.
 *   PGlite (PGLITE_DIR)  the data directory as a gzipped tarball
 *     (dumpDataDir). PGlite is one process: the running server holds the
 *     directory, so a backup refuses while it is open. Verified by loading
 *     the tarball into memory and counting again.
 *
 * Row counts run with row_security OFF: a role that row level security
 * would filter must fail loudly, never report a table as empty. pg_dump
 * itself refuses the same way.
 *
 * Restore goes into an EMPTY target only — a new database or a new
 * directory. Overwriting the live database is the step a tired operator gets
 * wrong at 2 a.m.; pointing the platform at the restored copy is a separate,
 * deliberate change of DATABASE_URL / PGLITE_DIR.
 */
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

export const FORMAT = 1;
const STAMP = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const NAME = /^epc-(pg|pglite)-(\d{8}T\d{6}Z)\.(dump|tar\.gz)$/;

// ── backup ───────────────────────────────────────────────────────────────

/**
 * Write a verified backup into `dir` and return its manifest.
 * @param {object} o
 * @param {string} [o.url]      DATABASE_URL — PostgreSQL
 * @param {string} [o.dataDir]  PGLITE_DIR — PGlite (used when no url)
 */
export async function backup({ url = null, dataDir = null, dir = "backups", keep = null, now = STAMP() }) {
  await mkdir(dir, { recursive: true });
  const m = url ? await backupPg({ url, dir, now }) : await backupPglite({ dataDir: dataDir || ".pglite", dir, now });
  await writeFile(manifestPath(m.file), JSON.stringify(m, null, 2) + "\n");
  const removed = keep ? await prune({ dir, keep }) : [];
  return { ...m, removed };
}

/** Beside the data directory: the pid of the server holding it (lib/server/db.mjs). */
export const serverLockPath = (dataDir) =>
  path.join(path.dirname(path.resolve(dataDir)), `.${path.basename(path.resolve(dataDir))}.server.pid`);

/** The pid of a live server holding this PGlite directory, or null. */
export async function pgliteHolder(dataDir) {
  const pid = Number((await readFile(serverLockPath(dataDir), "utf8").catch(() => "")).trim());
  if (!(pid > 0) || pid === process.pid) return null;
  try { process.kill(pid, 0); return pid; } catch (e) { return e.code === "EPERM" ? pid : null; }
}

async function backupPglite({ dataDir, dir, now }) {
  const holder = await pgliteHolder(dataDir);
  if (holder) {
    throw bad(`پایگاه دادهٔ ${dataDir} در دست سرور است (pid ${holder}). PGlite یک‌پردازه‌ای است؛ اول سرور را متوقف کنید، بعد پشتیبان بگیرید.`);
  }
  if (!(await exists(path.join(dataDir, "PG_VERSION")))) throw bad(`در ${dataDir} پایگاه داده‌ای نیست.`);
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create({ dataDir });
  let counts, migration, blob;
  try {
    counts = await countRows((sql) => pg.query(sql));
    migration = await lastMigration((sql) => pg.query(sql));
    blob = await pg.dumpDataDir("gzip");
  } finally { await pg.close(); }
  const file = path.join(dir, `epc-pglite-${now}.tar.gz`);
  const bytes = Buffer.from(await blob.arrayBuffer());
  await writeFile(file, bytes);
  const m = { format: FORMAT, driver: "pglite", file, createdAt: new Date().toISOString(), source: dataDir,
    bytes: bytes.length, sha256: sha(bytes), migration, tables: Object.keys(counts).length, rows: counts };
  // Read it back before calling it a backup.
  const again = await pgliteCounts(await readFile(file));
  const diff = compare(counts, again);
  if (diff.length) throw bad(`پشتیبان خوانده شد ولی با پایگاه نمی‌خواند: ${diff.join("، ")}`);
  return { ...m, verified: "loaded back into memory; every table's row count matches" };
}

async function backupPg({ url, dir, now }) {
  await needBinary("pg_dump");
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const file = path.join(dir, `epc-pg-${now}.dump`);
  let counts, migration;
  try {
    // One snapshot for the dump and the counts: the manifest describes the
    // file exactly, however busy the database is meanwhile.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const { rows: [{ s }] } = await client.query("SELECT pg_export_snapshot() AS s");
    const dumping = run("pg_dump", ["--format=custom", "--no-owner", `--snapshot=${s}`, `--file=${file}`, `--dbname=${url}`]);
    counts = await countRows((sql) => client.query(sql));
    migration = await lastMigration((sql) => client.query(sql));
    await dumping;
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    await rm(file, { force: true });
    throw e;
  } finally { await client.end(); }
  const bytes = await readFile(file);
  const listing = await run("pg_restore", ["--list", file]);
  const missing = Object.keys(counts).filter((t) => !new RegExp(`TABLE DATA public ${t} `).test(listing));
  if (missing.length) throw bad(`فایل پشتیبان داده‌های این جدول‌ها را ندارد: ${missing.join("، ")}`);
  return { format: FORMAT, driver: "pg", file, createdAt: new Date().toISOString(), source: redact(url),
    bytes: bytes.length, sha256: sha(bytes), migration, tables: Object.keys(counts).length, rows: counts,
    verified: "pg_restore read the archive; every table's data is in it" };
}

// ── verify and restore ───────────────────────────────────────────────────

/** Read a backup's manifest and check the file is the one it describes. */
export async function inspect(file) {
  const m = JSON.parse(await readFile(manifestPath(file), "utf8").catch(() => {
    throw bad(`مانیفست ${path.basename(manifestPath(file))} کنار فایل نیست؛ پشتیبانِ بی‌مانیفست بازیابی نمی‌شود.`);
  }));
  const bytes = await readFile(file);
  if (sha(bytes) !== m.sha256) throw bad(`فایل ${path.basename(file)} با مانیفستش نمی‌خواند (هش متفاوت): خراب یا دست‌کاری شده است.`);
  return { manifest: m, bytes };
}

/**
 * Restore into an EMPTY target and prove it: every table's row count equals
 * the manifest's. `into` is a PGlite directory, or a database URL.
 */
export async function restore({ file, into }) {
  if (!into) throw bad("مقصد بازیابی را بدهید: یک پوشهٔ خالی (PGlite) یا آدرس یک پایگاه دادهٔ خالی (PostgreSQL).");
  const { manifest: m, bytes } = await inspect(file);
  let counts;
  if (m.driver === "pglite") {
    if (/^postgres(ql)?:/.test(into)) throw bad("این پشتیبان PGlite است؛ مقصدش یک پوشه است.");
    if ((await exists(into)) && (await readdir(into)).length) throw bad(`پوشهٔ ${into} خالی نیست؛ بازیابی فقط در مقصد خالی انجام می‌شود.`);
    const { PGlite } = await import("@electric-sql/pglite");
    await mkdir(into, { recursive: true });
    const pg = await PGlite.create({ dataDir: into, loadDataDir: new Blob([bytes]) });
    try { counts = await countRows((sql) => pg.query(sql)); } finally { await pg.close(); }
  } else {
    if (!/^postgres(ql)?:/.test(into)) throw bad("این پشتیبان PostgreSQL است؛ مقصدش آدرس یک پایگاه داده است.");
    await needBinary("pg_restore");
    const { default: pg } = await import("pg");
    const c = new pg.Client({ connectionString: into });
    await c.connect();
    try {
      const { rows: [{ n }] } = await c.query(
        "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public'");
      if (n) throw bad(`پایگاه مقصد خالی نیست (${n} جدول)؛ بازیابی فقط در پایگاه خالی انجام می‌شود.`);
      // Roles are cluster-wide, not in the dump. The grants and policies in
      // it name them, and a grant to a missing role fails the restore.
      await c.query(`DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_rw') THEN CREATE ROLE app_rw NOLOGIN; END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_report') THEN CREATE ROLE app_report NOLOGIN; END IF;
      END $$`);
      await run("pg_restore", ["--no-owner", "--exit-on-error", "--single-transaction", `--dbname=${into}`, file]);
      counts = await countRows((sql) => c.query(sql));
    } finally { await c.end(); }
  }
  const diff = compare(m.rows, counts);
  if (diff.length) throw bad(`بازیابی انجام شد ولی با مانیفست نمی‌خواند: ${diff.join("، ")}`);
  return { manifest: m, into: /^postgres/.test(into) ? redact(into) : into, tables: Object.keys(counts).length,
    rows: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** The backups in a directory, newest first. */
export async function list(dir = "backups") {
  const names = (await readdir(dir).catch(() => [])).filter((n) => NAME.test(n)).sort().reverse();
  return Promise.all(names.map(async (n) => {
    const file = path.join(dir, n);
    const m = JSON.parse(await readFile(manifestPath(file), "utf8").catch(() => "null"));
    return { file, bytes: (await stat(file)).size, manifest: !!m, createdAt: m?.createdAt || null, rows: m ? Object.values(m.rows).reduce((a, b) => a + b, 0) : null };
  }));
}

/** Keep the newest `keep` backups of each driver; remove the rest with their manifests. */
export async function prune({ dir, keep }) {
  if (!(Number.isInteger(keep) && keep >= 1)) throw bad("تعداد نگه‌داری باید عدد صحیح مثبت باشد.");
  const names = (await readdir(dir)).filter((n) => NAME.test(n)).sort().reverse();
  const removed = [];
  for (const driver of ["pg", "pglite"]) {
    for (const n of names.filter((x) => x.startsWith(`epc-${driver}-`)).slice(keep)) {
      await unlink(path.join(dir, n));
      await unlink(manifestPath(path.join(dir, n))).catch(() => {});
      removed.push(n);
    }
  }
  return removed;
}

// ── internals ────────────────────────────────────────────────────────────

async function countRows(q) {
  await q("SET row_security = off");
  const { rows } = await q(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`);
  const out = {};
  for (const { table_name: t } of rows) {
    out[t] = Number((await q(`SELECT count(*) AS n FROM public."${t.replace(/"/g, '""')}"`)).rows[0].n);
  }
  return out;
}

async function lastMigration(q) {
  const { rows } = await q("SELECT max(version) AS v FROM schema_migrations").catch(() => ({ rows: [{ v: null }] }));
  return rows[0]?.v ?? null;
}

async function pgliteCounts(bytes) {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = await PGlite.create({ loadDataDir: new Blob([bytes]) });
  try { return await countRows((sql) => pg.query(sql)); } finally { await pg.close(); }
}

function compare(a, b) {
  const tables = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
  return tables.filter((t) => a[t] !== b[t]).map((t) => `${t}: ${a[t] ?? "—"} ≠ ${b[t] ?? "—"}`);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve(out) : reject(bad(`${cmd}: ${redactAll(err.trim()) || `خروج با کد ${code}`}`))));
  });
}

async function needBinary(cmd) {
  await run(cmd, ["--version"]).catch(() => {
    throw bad(`${cmd} پیدا نشد. ابزارهای کلاینت PostgreSQL را نصب کنید (Termux: pkg install postgresql؛ Debian/Ubuntu: apt install postgresql-client) — نسخه‌اش باید هم‌اندازه یا تازه‌تر از سرور باشد.`);
  });
}

const manifestPath = (file) => `${file}.json`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const exists = (p) => stat(p).then(() => true, () => false);
/** A connection string without its password, for a manifest or a message. */
export const redact = (url) => String(url).replace(/(\/\/[^:/@]+:)[^@]*@/, "$1***@");
const redactAll = (s) => s.replace(/postgres(ql)?:\/\/[^\s'"]+/g, (u) => redact(u));
const bad = (m) => Object.assign(new Error(m), { status: 400, code: "BACKUP" });
