#!/usr/bin/env node
/**
 * The daily site report (lib/reports/daily.mjs, lib/db/repos/daily-report.mjs):
 * people, machines and materials kept apart in their own units; numbers
 * checked; and what the project already holds for a day — timesheets,
 * finished or claimed steps, HSE — offered with its source, nothing invented.
 */
import { test, run, assert, equal, throws, scratchDir } from "./harness.mjs";

process.env.PGLITE_DIR = await scratchDir("daily-db-");
const { getDb } = await import("../../lib/server/db.mjs");
const { withProject } = await import("../../lib/db/scope.mjs");
const projects = await import("../../lib/db/repos/projects.mjs");
const contractors = await import("../../lib/db/repos/contractors.mjs");
const hr = await import("../../lib/db/repos/hr.mjs");
const hse = await import("../../lib/db/repos/hse.mjs");
const eq = await import("../../lib/db/repos/equipment.mjs");
const act = await import("../../lib/db/repos/activities.mjs");
const { dailyPrefill } = await import("../../lib/db/repos/daily-report.mjs");
const { checkDaily, dailyTotals } = await import("../../lib/reports/daily.mjs");

const db = await getDb();
const me = await projects.ensureUser(db, { subject: "kc|daily" });
const proj = await projects.createProject(db, { code: "DLY", name: "D", ownerUserId: me.id });
const P = proj.id;
const day = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
const other = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

test("people, machines and materials stay in their own lists and units; a material without a unit is refused", async () => {
  const { content, problems } = checkDaily({
    weather: { condition: "clear", tempMin: "24", tempMax: "41", humidity: "38" },
    manpower: [{ role: "جوشکار آرگون", discipline: "پایپینگ", present: "12", leave: "1" }, { role: "", present: 3 }],
    equipment: [{ name: "جرثقیل ۵۰ تن", working: 2, idle: 1 }],
    materials: [{ name: "الکترود E7018", unit: "کیلوگرم", qty: "40" }, { name: "آب آشامیدنی", qty: 180000 }],
    stoppages: [{ reason: "باد شدید", hours: 3 }],
  });
  equal(content.manpower.length, 1, "a row without a role is not a person");
  assert(problems.some((p) => /سمت در ردیف 2/.test(p)));
  assert(problems.some((p) => /واحد «آب آشامیدنی»/.test(p)), "a quantity with no unit means nothing, so it is refused");
  const t = dailyTotals(content);
  equal([t.people, t.onLeave, t.machinesWorking, t.machinesIdle, t.stoppageHours], [12, 1, 2, 1, 3],
    "people count people; machines count machines; the 40 kg of electrodes is in neither");
});

test("numbers are checked: no negative or fractional heads, temperatures in range and in order, humidity a percentage", async () => {
  const { problems } = checkDaily({
    weather: { tempMin: 30, tempMax: 20, humidity: 140 },
    manpower: [{ role: "فیتر", present: -2 }, { role: "کمک فیتر", present: 2.5 }],
    stoppages: [{ reason: "قطع برق", hours: 30 }],
  });
  for (const re of [/حداقل دما از حداکثر/, /رطوبت/, /تعداد حاضر در ردیف 1/, /تعداد حاضر در ردیف 2/, /ساعت توقف/]) {
    assert(problems.some((p) => re.test(p)), `expected a problem matching ${re}`);
  }
  equal(checkDaily({}).problems, [], "an empty day is a valid report: nothing recorded, not zero");
  equal(checkDaily({}).content.manpower, []);
});

test("what the project holds for the day is offered with its source: timesheets, finished and claimed steps, HSE", async () => {
  await withProject(db, P, async () => {
    const c = await contractors.upsertContractor(db, { projectId: P, code: "C-MEC", name: "Mech", disciplines: ["piping"] });
    const a = await hr.upsertPersonnel(db, { projectId: P, idNo: "1001", fullName: "علی", contractorId: c.id, position: "جوشکار", department: "پایپینگ" });
    const b = await hr.upsertPersonnel(db, { projectId: P, idNo: "1002", fullName: "رضا", contractorId: c.id, position: "جوشکار", department: "پایپینگ" });
    const f = await hr.upsertPersonnel(db, { projectId: P, idNo: "1003", fullName: "مهدی", contractorId: c.id, position: "فیتر", department: "پایپینگ" });
    await hr.recordTimesheet(db, { projectId: P, personId: a.id, workDate: day, hours: 8 });
    await hr.recordTimesheet(db, { projectId: P, personId: b.id, workDate: day, hours: 10 });
    await hr.recordTimesheet(db, { projectId: P, personId: f.id, workDate: other, hours: 8 });   // another day: not offered
    const { tag } = await eq.addEquipmentTag(db, { projectId: P, tagNo: "P-7001", kind: "rotating" });
    await act.recordActivity(db, { projectId: P, tagId: tag.id, code: "foundation", doneAt: day, userId: me.id });
    await hse.recordObservation(db, { projectId: P, observedOn: day, kind: "unsafe_act", severity: "low", description: "بدون عینک",
      action: "تذکر و تحویل عینک", dueOn: day, userId: me.id });
    await hse.recordObservation(db, { projectId: P, observedOn: other, kind: "good_practice", description: "نظم کارگاه", userId: me.id });

    const pf = await dailyPrefill(db, { projectId: P, date: day });
    equal(pf.manpower.map((r) => [r.employer, r.role, r.present, r.hours, r.source]), [["C-MEC", "جوشکار", 2, 18, "hr"]]);
    equal(pf.work.map((w) => [w.state, w.source, /P-7001/.test(w.description)]), [["done", "platform", true]]);
    equal([pf.hse.incidents, pf.hse.observations, pf.hse.source], [0, 1, "platform"]);
    const empty = await dailyPrefill(db, { projectId: P, date: new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10) });
    equal([empty.manpower.length, empty.work.length], [0, 0], "a day with nothing recorded offers nothing — not zeros made up");
    await throws(() => dailyPrefill(db, { projectId: P, date: "" }), "تاریخ لازم است");
  });
});

await run();
