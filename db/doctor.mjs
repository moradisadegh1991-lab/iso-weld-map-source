#!/usr/bin/env node
/**
 * Where are we, and what is the next step?
 *
 * Bringing phase 1 into service is a sequence: infrastructure, then a
 * project, then the piping class, then people, then drawings. Each step
 * depends on the one before it, and the failure when you skip one is rarely
 * obvious — an empty project list, a qualification check that reports
 * everything as unverifiable, a register with no NDT requirement.
 *
 * This reads the actual state and says which step is next, so nobody has to
 * hold the sequence in their head.
 *
 *   npm run doctor
 */
import { createClient } from "../lib/db/client.mjs";
import { createLlmClient } from "../lib/llm/index.mjs";
import { access, constants } from "node:fs/promises";

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { g: "\x1b[32m", y: "\x1b[33m", r: "\x1b[31m", d: "\x1b[2m", b: "\x1b[1m", o: "\x1b[0m" }
  : { g: "", y: "", r: "", d: "", b: "", o: "" };

const MARK = { ok: `${C.g}✓${C.o}`, warn: `${C.y}!${C.o}`, missing: `${C.r}×${C.o}` };
const steps = [];
const step = (n, title, status, detail, next = null) =>
  steps.push({ n, title, status, detail, next });

const db = await createClient({ dataDir: process.env.PGLITE_DIR || ".pglite" });
process.on("exit", () => { try { db.close(); } catch { /* already closing */ } });

{
  // ── 1 · database ───────────────────────────────────────────────────────
  const { rows: [v] } = await db.query("SELECT version()");
  const engine = String(v.version).split(",")[0];
  const durable = db.driver === "pg" || !!process.env.PGLITE_DIR;
  step(1, "پایگاه داده", db.driver === "pg" ? "ok" : durable ? "warn" : "warn",
    `${db.driver} · ${engine}` +
    (db.driver === "pglite"
      ? ` · ${C.d}توسعه؛ برای تولید DATABASE_URL را به یک Postgres واقعی بدهید${C.o}`
      : ""),
    db.driver === "pglite" ? "DATABASE_URL=postgres://user:pass@host:5432/isoweld" : null);

  // ── 2 · migrations ─────────────────────────────────────────────────────
  const applied = await db.query(
    "SELECT version FROM schema_migrations ORDER BY version").catch(() => ({ rows: [] }));
  const { readdir } = await import("node:fs/promises");
  const onDisk = (await readdir("db/migrations")).filter((f) => f.endsWith(".sql")).length;
  step(2, "Migration ها", applied.rows.length === onDisk ? "ok" : "missing",
    `${applied.rows.length} از ${onDisk} اعمال شده`,
    applied.rows.length === onDisk ? null : "npm run db:migrate");

  // ── 3 · authentication ─────────────────────────────────────────────────
  const dev = process.env.AUTH_MODE === "dev";
  step(3, "احراز هویت", dev ? "warn" : process.env.OIDC_ISSUER ? "ok" : "missing",
    dev ? `${C.y}حالت dev — توکن همان نام کاربر است. فقط برای لپ‌تاپ.${C.o}`
        : process.env.OIDC_ISSUER ? `OIDC: ${process.env.OIDC_ISSUER}`
        : "پیکربندی نشده — سرور هر درخواست را رد می‌کند",
    dev || process.env.OIDC_ISSUER ? null : "AUTH_MODE=dev  (یا verifier واقعی)");

  // ── 4 · model provider ─────────────────────────────────────────────────
  let llm = null;
  try { llm = createLlmClient(); } catch { /* unknown provider */ }
  step(4, "ارائه‌دهندهٔ مدل", llm?.configured ? "ok" : "warn",
    llm ? `${llm.id} · ${llm.defaultModel}${llm.configured ? "" : ` · ${C.d}پیکربندی نشده${C.o}`}`
        : "LLM_PROVIDER شناخته نشد",
    llm?.configured ? null
      : llm?.id === "anthropic" ? "ANTHROPIC_API_KEY=…" : "LLM_BASE_URL=http://vllm:8000/v1");

  // ── 5 · blob storage ───────────────────────────────────────────────────
  const root = process.env.STORAGE_ROOT || ".storage";
  const writable = await access(root, constants.W_OK).then(() => true).catch(() => false);
  step(5, "ذخیره‌سازی نقشه", "ok",
    `${root}${writable ? "" : ` · ${C.d}هنوز ساخته نشده، در اولین آپلود ساخته می‌شود${C.o}`}`);

  // ── 6 onwards · the project itself ─────────────────────────────────────
  //
  // Queried as the migration user rather than through withProject: this is an
  // operator diagnostic, it is told which project each count belongs to, and
  // dropping into app_rw before the migrations have created that role is how
  // the first version of this failed.
  const migrated = applied.rows.length === onDisk && onDisk > 0;
  const projects = migrated
    ? (await db.query("SELECT id, code, name FROM project ORDER BY code")).rows
    : [];

  if (!migrated) {
    report();
    process.exit(0);
  }

  step(6, "پروژه", projects.length ? "ok" : "missing",
    projects.length ? projects.map((p) => p.code).join("، ") : "هیچ پروژه‌ای تعریف نشده",
    projects.length ? null : "AUTH_MODE=dev npm run db:seed   (یا POST /api/projects)");

  for (const p of projects) {
    {
      const one = async (sql) => Number((await db.query(sql, [p.id])).rows[0].c);

      const classes = await one("SELECT count(*) c FROM piping_class WHERE project_id = $1");
      const sizes = await one("SELECT count(*) c FROM piping_class_size WHERE project_id = $1");
      step(7, `Piping Class — ${p.code}`, classes ? (sizes ? "ok" : "warn") : "missing",
        classes ? `${classes} کلاس · ${sizes} ردیف سایز` : "تعریف نشده",
        classes && sizes ? null
          : !classes ? "POST /api/piping-classes"
          : "PUT /api/piping-classes/[id]/sizes — بدون جدول سایز، ضخامت دیواره نامعلوم می‌ماند");

      const welders = await one("SELECT count(*) c FROM welder WHERE project_id = $1");
      const quals = await one(
        "SELECT count(*) c FROM welder_qualification WHERE project_id = $1 AND revoked_at IS NULL");
      step(8, `جوشکارها — ${p.code}`, welders ? (quals ? "ok" : "warn") : "missing",
        `${welders} جوشکار · ${quals} صلاحیت معتبر`,
        welders && quals ? null : "POST /api/welders و سپس /qualifications");

      const docs = await one("SELECT count(*) c FROM document WHERE project_id = $1");
      const runs = await one(
        "SELECT count(*) c FROM extraction_run WHERE project_id = $1 AND engine_error IS NULL");
      const approved = await one(
        "SELECT count(*) c FROM extraction_run WHERE project_id = $1 AND status = 'approved'");
      step(9, `نقشه‌ها — ${p.code}`, docs ? "ok" : "missing",
        `${docs} سند · ${runs} اجرای سالم · ${approved} تأییدشده`,
        docs ? null : "نقشه را در UI آپلود کنید");

      const welds = await one("SELECT count(*) c FROM weld WHERE project_id = $1");
      const done = await one("SELECT count(*) c FROM weld_execution WHERE project_id = $1");
      const ndt = await one("SELECT count(*) c FROM ndt_record WHERE project_id = $1");
      step(10, `اجرا و بازرسی — ${p.code}`, welds ? (done ? "ok" : "warn") : "missing",
        `${welds} جوش · ${done} تخصیص‌یافته · ${ndt} رکورد NDT`,
        welds && !done ? "POST /api/welds/[uid]/assign" : null);

      const gap = await one(`SELECT count(*) c FROM weld w
        WHERE w.project_id = $1
          AND EXISTS (SELECT 1 FROM weld_execution e
                       WHERE e.weld_uid = w.weld_uid AND e.project_id = w.project_id)
          AND NOT EXISTS (SELECT 1 FROM ndt_record n
                           WHERE n.weld_uid = w.weld_uid AND n.project_id = w.project_id)`);
      if (gap) {
        step(11, `شکاف تحویل — ${p.code}`, "warn",
          `${gap} جوش جوش‌خورده ولی بازرسی‌نشده — هرکدام یک ITR که در dossier نخواهد بود`,
          `GET /api/reports/repair-rates?projectId=${p.id}`);
      }
    }
  }

  report();
}

/** ── report ─────────────────────────────────────────────────────────── */
function report() {
  console.log(`\n${C.b}وضعیت راه‌اندازی فاز ۱${C.o}\n`);
  for (const s of steps) {
    console.log(`  ${MARK[s.status]} ${String(s.n).padStart(2)} · ${s.title.padEnd(26)} ${s.detail}`);
  }

  const blocked = steps.filter((s) => s.next);
  if (!blocked.length) {
    console.log(`\n${C.g}${C.b}همه‌چیز سر جایش است.${C.o}`);
  } else {
    const first = blocked[0];
    console.log(`\n${C.b}گام بعدی — ${first.n} · ${first.title}${C.o}`);
    console.log(`  ${first.next}`);
    if (blocked.length > 1) {
      console.log(`\n${C.d}پس از آن:${C.o}`);
      for (const s of blocked.slice(1)) console.log(`  ${C.d}${s.n} · ${s.title} → ${s.next}${C.o}`);
    }
  }
  console.log();
}
