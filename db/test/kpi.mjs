#!/usr/bin/env node
/**
 * The owner's decisions on furnace F-110 (lib/controls/f10.mjs) and the
 * in-platform KPIs (lib/db/repos/kpi.mjs): decisions land in the register
 * as approved and are applied once; a KPI with nothing under it is "not
 * recorded", never zero; and the figures are the module's own.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";
import { readFile } from "node:fs/promises";

process.env.PGLITE_DIR = await scratchDir("kpi-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const pms = await import("../../lib/db/repos/pms.mjs");
const hse = await import("../../lib/db/repos/hse.mjs");
const { listAssumptions, proposeAssumption } = await import("../../lib/db/repos/assumptions.mjs");
const { applyF10Decisions } = await import("../../lib/controls/f10.mjs");
const { projectKpis } = await import("../../lib/db/repos/kpi.mjs");

const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|kpi" });
const empty = await projects.createProject(db, { code: "EMPTY", name: "E", ownerUserId: me.id });
const f10 = await projects.createProject(db, { code: "F10K", name: "F", ownerUserId: me.id });
const inP = (p, fn) => withProject(db, p.id, fn);
const K = (r, section, label) => r.sections.find((s) => s.key === section).kpis.find((k) => k.label === label);

test("a project with nothing recorded shows every KPI as not recorded, not as zero", async () => {
  const r = await inP(empty, (tx) => projectKpis(tx, { projectId: empty.id, today: "2026-10-10" }));
  const values = r.sections.flatMap((s) => s.kpis.map((k) => [k.label, k.value]));
  const nonNull = values.filter(([, v]) => v !== null);
  equal(nonNull, [], `these show a value with no data: ${JSON.stringify(nonNull)}`);
  assert(values.length >= 25, `${values.length} KPIs`);
});

test("the owner's decisions: data date today, the plan is OLF1's (approved), E-1110 approved and linked — once", async () => {
  const xml = await readFile("data/f10/F10.xml"), xls = await readFile("data/f10/pms.xlsx");
  await inP(f10, async (tx) => {
    await pms.importSchedule(tx, { projectId: f10.id, userId: me.id, sourceName: "F10.xml", content: xml });
    await pms.importPms(tx, { projectId: f10.id, userId: me.id, sourceName: "pms.xlsx", content: xls, linkWithin: "OLF1" });
    await proposeAssumption(tx, { projectId: f10.id, userId: me.id, category: "برنامه‌ریزی", description: "plan is OLF1", value: "OLF1" });
  });
  const done = await inP(f10, (tx) => applyF10Decisions(tx, { projectId: f10.id, userId: me.id, dataDate: "2026-10-10" }));
  equal(done.length, 4, done.join(" | "));
  const v = await inP(f10, (tx) => pms.pmsView(tx, { projectId: f10.id }));
  equal(v.pms.import.data_date, "2026-10-10");
  const a = await inP(f10, (tx) => listAssumptions(tx, { projectId: f10.id }));
  equal(a.map((x) => [x.value, x.status]).sort(), [["E-1110", "approved"], ["OLF1", "approved"]]);
  const el = v.pms.nodes.find((n) => /Secondary TLE \(E-1120\)/.test(n.name));
  const link = v.pms.elements.find((e) => e.seq === el.seq);
  equal([v.tasks.find((t) => t.uid === link.uid).name, link.by], ["Secondary TLE (E-1110)", "person"]);
  equal(v.pms.elements.filter((e) => e.uid != null).length, 43, "42 certain links + the decided one");
  equal(await inP(f10, (tx) => applyF10Decisions(tx, { projectId: f10.id, userId: me.id, dataDate: "2026-10-11" })), [],
    "a second run changes nothing — not even the data date");
});

test("the KPIs for F10 are the PMS page's own figures", async () => {
  const r = await inP(f10, (tx) => projectKpis(tx, { projectId: f10.id, today: "2026-10-10" }));
  equal(K(r, "progress", "پیشرفت فیزیکی (PMS)").value, 63.03);
  equal(K(r, "progress", "جابه‌جایی پایان پروژه").value, 154);
  equal(K(r, "progress", "برنامهٔ مبنا تا تاریخ داده").value, 100, "the baseline ended in 2022");
  const actual = K(r, "progress", "واقعی همان آیتم‌ها");
  assert(actual.value > 0 && actual.value < 100 && actual.tone === "bad", JSON.stringify(actual));
  assert(K(r, "progress", "فعالیت‌های عقب از مبنا").value > 0);
});

test("HSE rates are the HSE module's: LTIF per million hours, days since the last LTI", async () => {
  await inP(f10, async (tx) => {
    await hse.recordManhours(tx, { projectId: f10.id, workDate: "2026-09-01", hours: 400000, userId: me.id });
    await hse.reportIncident(tx, { projectId: f10.id, occurredAt: "2026-09-20T10:00:00Z", description: "x", injured: true,
      fatal: false, daysAway: 3, treatment: "medical", userId: me.id });
  });
  const r = await inP(f10, (tx) => projectKpis(tx, { projectId: f10.id, today: "2026-10-10" }));
  equal([K(r, "hse", "نفرساعت ثبت‌شده").value, K(r, "hse", "LTIF").value, K(r, "hse", "روز بدون LTI").value], [400000, 2.5, 20]);
});

await run();
