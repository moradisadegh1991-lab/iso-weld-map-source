/**
 * The owner's decisions on the furnace F-110 files (2026-10-10), applied to
 * a loaded F10 project. Each is recorded where the platform keeps such
 * things — the PMS data date on the import, the decisions in the assumption
 * register as approved, the tag correction as a person's link — and none
 * rewrites the files as they were handed over. Safe to run again.
 *
 *   1. The PMS is measured as of today: its data date is the day it is applied.
 *   2. The plan F10.mpp is OLF1's furnace.
 *   3. The Secondary TLE is E-1110, as the plan prints it; "E-1120" in the
 *      PMS is a slip. Its PMS element is linked to the plan's task.
 */
import { listAssumptions, proposeAssumption, decideAssumption } from "../db/repos/assumptions.mjs";
import { pmsView, setDataDate, linkElement } from "../db/repos/pms.mjs";

export const DECIDED_ON = "2026-10-10";
const REASON = `تصمیم کارفرما ${DECIDED_ON}`;

export async function applyF10Decisions(db, { projectId, userId, dataDate }) {
  const done = [];
  let v = await pmsView(db, { projectId });
  if (!v.pms) throw Object.assign(new Error("PMS این پروژه وارد نشده است."), { status: 400 });

  if (!v.pms.import.data_date) {
    await setDataDate(db, { projectId, pmsImportId: v.pms.import.id, dataDate });
    done.push(`تاریخ دادهٔ PMS: ${dataDate}`);
  }

  const list = await listAssumptions(db, { projectId });
  const olf = list.find((a) => a.value === "OLF1");
  if (olf && olf.status !== "approved") {
    await decideAssumption(db, { projectId, assumptionId: olf.id, status: "approved", reason: REASON, userId });
    done.push(`فرض ${olf.code} (برنامه = OLF1) تأیید شد`);
  }

  let tag = list.find((a) => a.value === "E-1110");
  if (!tag) {
    tag = await proposeAssumption(db, { projectId, userId, category: "شناسهٔ تجهیز",
      description: "تگ درست Secondary TLE کورهٔ F-110، E-1110 است (همان‌که برنامهٔ زمان‌بندی نوشته)؛ «E-1120» در PMS اشتباه است.",
      value: "E-1110", source: `${REASON}؛ F10.mpp: «Secondary TLE (E-1110)»، pms.xlsx: «Secondary TLE (E-1120)»`,
      owner: "مهندسی / کنترل پروژه", impact: "medium",
      risk: "اگر نادرست باشد، پیشرفت این آیتم به فعالیت اشتباهی از برنامه نسبت داده شده است." });
  }
  if (tag.status !== "approved") {
    await decideAssumption(db, { projectId, assumptionId: tag.id, status: "approved", reason: REASON, userId });
    done.push(`فرض ${tag.code} (Secondary TLE = E-1110) تأیید شد`);
  }

  v = await pmsView(db, { projectId });
  const nodes = v.pms.nodes;
  const branch = nodes.find((n) => n.kind === "group" && n.name.includes("OLF1"));
  const under = (n) => { for (let x = n; x; x = x.parent == null ? null : nodes[x.parent]) if (x.seq === branch?.seq) return true; return false; };
  const element = nodes.find((n) => n.kind === "group" && /Secondary TLE\s*\(E-1120\)/i.test(n.name) && under(n));
  const task = v.tasks.find((t) => t.is_summary && /Secondary TLE\s*\(E-1110\)/i.test(t.name));
  if (element && task) {
    const now = v.pms.elements.find((e) => e.seq === element.seq);
    if (now?.uid !== task.uid) {
      await linkElement(db, { projectId, seq: element.seq, taskUid: task.uid, userId });
      done.push(`«${element.name}» به فعالیت «${task.name}» پیوند خورد`);
    }
  }
  return done;
}
