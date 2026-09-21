/**
 * Migration runner.
 *
 * Applies db/migrations/*.sql in filename order, each in its own transaction,
 * and records what it applied. It refuses to run when a migration that was
 * already applied has since been edited: on a project where the register is
 * evidence, a schema that silently drifted from its own history is worse than
 * a failed deploy.
 */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), "..", "..", "db", "migrations");

const sha256 = (s) => createHash("sha256").update(s).digest("hex");

export async function migrate(db, { dir = MIGRATIONS_DIR, log = () => {} } = {}) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     text PRIMARY KEY,
      checksum    char(64) NOT NULL,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )`);

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await db.query("SELECT version, checksum FROM schema_migrations");
  const applied = new Map(rows.map((r) => [r.version, r.checksum]));

  const ran = [];
  for (const file of files) {
    const version = path.basename(file, ".sql");
    const sql = await readFile(path.join(dir, file), "utf8");
    const checksum = sha256(sql);

    if (applied.has(version)) {
      if (applied.get(version) !== checksum) {
        throw new Error(
          `migration ${version} has changed since it was applied ` +
          `(recorded ${applied.get(version).slice(0, 12)}, file ${checksum.slice(0, 12)}). ` +
          `Add a new migration instead of editing a released one.`);
      }
      continue;
    }

    await db.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query(
        "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
        [version, checksum]);
    });
    log(`applied ${version}`);
    ran.push(version);
  }
  return ran;
}
