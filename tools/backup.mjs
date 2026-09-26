#!/usr/bin/env node
/**
 * Back up and restore the platform's database (lib/db/backup.mjs).
 *
 *   npm run db:backup                         a verified backup into ./backups (BACKUP_DIR)
 *   npm run db:backup -- --keep 14            … and keep only the newest 14
 *   npm run db:backup -- list                 what is there
 *   npm run db:backup -- verify <file>        the file is the one its manifest describes
 *   npm run db:restore -- <file> <target>     into an EMPTY target, then prove it by row counts
 *        target: a new directory (PGlite backup) or a new database's URL (PostgreSQL backup)
 *
 * The database is the one the app uses: DATABASE_URL if set, else PGLITE_DIR.
 * With PGlite, stop the server first — it holds the directory.
 */
import "./env.mjs";
import * as B from "../lib/db/backup.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return null; const v = args[i + 1]; args.splice(i, 2); return v; };
const keep = flag("--keep");
const dir = flag("--dir") || process.env.BACKUP_DIR || "backups";
const [cmd = "backup", ...rest] = args;
const fa = (n) => Number(n).toLocaleString("fa-IR");

try {
  if (cmd === "backup") {
    const m = await B.backup({ url: process.env.DATABASE_URL || null, dataDir: process.env.PGLITE_DIR || ".pglite", dir,
      keep: keep ? Number(keep) : null });
    const rows = Object.values(m.rows).reduce((a, b) => a + b, 0);
    console.log(`✓ پشتیبان: ${m.file}`);
    console.log(`  ${m.driver} · ${fa(m.tables)} جدول · ${fa(rows)} ردیف · ${fa(Math.round(m.bytes / 1024))} KB · migration ${m.migration}`);
    console.log(`  وارسی: ${m.verified}`);
    if (m.removed.length) console.log(`  حذف طبق نگه‌داری: ${m.removed.join("، ")}`);
  } else if (cmd === "list") {
    const all = await B.list(dir);
    if (!all.length) console.log(`در ${dir} پشتیبانی نیست.`);
    for (const b of all) console.log(`${b.file}  ${fa(Math.round(b.bytes / 1024))} KB  ${b.manifest ? `${fa(b.rows)} ردیف` : "بدون مانیفست!"}`);
  } else if (cmd === "verify") {
    const { manifest: m } = await B.inspect(rest[0]);
    console.log(`✓ ${rest[0]} همان است که مانیفستش می‌گوید (${m.driver}، ${fa(m.tables)} جدول، ساخته‌شده ${m.createdAt}).`);
    console.log("  برای اثبات کامل، آن را در یک مقصد خالی بازیابی کنید: npm run db:restore -- <file> <target>");
  } else if (cmd === "restore") {
    const [file, into] = rest;
    const r = await B.restore({ file, into });
    console.log(`✓ بازیابی در ${r.into}: ${fa(r.tables)} جدول، ${fa(r.rows)} ردیف — همه با مانیفست یکی است.`);
    console.log("  برای استفاده، DATABASE_URL یا PGLITE_DIR را به این مقصد تغییر دهید و سرور را دوباره اجرا کنید.");
  } else {
    console.error("usage: npm run db:backup [-- --keep N | list | verify <file>] · npm run db:restore -- <file> <target>");
    process.exit(2);
  }
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}
