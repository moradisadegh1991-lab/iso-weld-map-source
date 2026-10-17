/**
 * A plan from a file, as a version of the contract's EPS — one WBS, not a
 * second schedule kept beside it. Pure: lib/db/repos/eps-import.mjs writes.
 *
 * Two sources, each read as it is laid out:
 *
 *   MS Project (MSPDI XML, lib/controls/mspdi.mjs)
 *     summary tasks → WBS nodes, the tasks under them → activities, the
 *     links between activities → relations (a link to or from a summary
 *     task is reported, not invented into an activity link). The task's
 *     scheduled start and finish are the plan; its actual dates the actual.
 *     W.F only from a custom field named WF: a node's share is its WF over
 *     its parent's, so the shares are the file's own, never spread evenly.
 *
 *   PMS workbook (lib/controls/pms.mjs)
 *     groups → WBS nodes (the workbook's top row is the version itself),
 *     steps → activities of their element, with the step weight as W.F,
 *     the quantity as the volume, and the progress the workbook states at
 *     its data date — kept as stated until site reports take over.
 *
 * Anything the file does not carry stays empty and is listed in `problems`.
 */

const r4 = (v) => Math.round(v * 10000) / 10000;
const share = (part, whole) => (part != null && whole != null && Number(whole) > 0 ? r4((Number(part) / Number(whole)) * 100) : null);
const num = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));

/** A key unique in its list: the code as given, or with a suffix when it repeats. */
function uniq(used, code) {
  let c = String(code || "").trim() || "X", k = 2;
  while (used.has(c)) c = `${code}-${k++}`;
  used.add(c);
  return c;
}

/** From a parsed MS Project schedule ({ tasks, links, fields }). */
export function fromSchedule(s) {
  const problems = [];
  const wf = (t) => num(t.custom?.WF);
  const hasWf = (s.fields || []).includes("WF");
  if (!hasWf) problems.push("فایل ستون WF ندارد؛ W.F گره‌ها و فعالیت‌ها خالی ماند — در WBS وارد کنید.");
  const byUid = new Map(s.tasks.map((t) => [t.uid, t]));
  const root = s.tasks.find((t) => t.level === 0) || null;
  const nodes = [], activities = [], relations = [];
  const nodeCodes = new Set();
  const nodeKey = new Map();               // summary uid → node key
  let general = null;                      // a node for tasks that sit directly under the project
  const dates = (t) => ({ plan_start: t.start, plan_end: t.finish, actual_start: t.actStart, actual_end: t.actFinish });
  let seq = 0;
  for (const t of s.tasks) {
    if (t === root || !t.summary) continue;
    const parent = t.parentUid != null && t.parentUid !== root?.uid ? byUid.get(t.parentUid) : null;
    const key = `n${t.uid}`;
    nodeKey.set(t.uid, key);
    nodes.push({ key, parentKey: parent ? `n${parent.uid}` : null, code: uniq(nodeCodes, t.wbs || t.outline || t.uid), name: t.name || "—",
      wf: hasWf ? share(wf(t), parent ? wf(parent) : root ? wf(root) : null) : null, seq: ++seq, ...dates(t) });
  }
  const actCodes = new Map();
  const actKey = new Map();
  for (const t of s.tasks) {
    if (t === root || t.summary) continue;
    const parent = t.parentUid != null ? byUid.get(t.parentUid) : null;
    let nk = parent && parent !== root ? nodeKey.get(parent.uid) : null;
    if (!nk) {
      if (!general) {
        general = { key: "n-general", parentKey: null, code: uniq(nodeCodes, "0"), name: root?.name ? `${root.name} — سطح اول` : "فعالیت‌های سطح اول", seq: 0,
          wf: null, plan_start: null, plan_end: null, actual_start: null, actual_end: null, _wf: 0 };
        nodes.unshift(general);
      }
      nk = general.key;
      if (hasWf) general._wf += wf(t) || 0;
    }
    const used = actCodes.get(nk) || actCodes.set(nk, new Set()).get(nk);
    const key = `a${t.uid}`;
    actKey.set(t.uid, key);
    const whole = nk === general?.key ? null : wf(parent);
    activities.push({ key, nodeKey: nk, code: uniq(used, t.wbs || t.outline || t.uid), name: t.name || "—", seq: activities.length + 1,
      wf: hasWf ? (nk === general?.key ? wf(t) : share(wf(t), whole)) : null, progress: num(t.pct), ...dates(t) });
  }
  if (general && hasWf) {
    // the tasks directly under the project: their node's share is theirs together, each one's its part of that
    general.wf = share(general._wf, wf(root));
    for (const a of activities) if (a.nodeKey === general.key && a.wf != null) a.wf = share(a.wf, general._wf);
  }
  if (general) delete general._wf;
  let summaryLinks = 0;
  for (const l of s.links || []) {
    const p = actKey.get(l.predUid), q = actKey.get(l.succUid);
    if (!p || !q) { summaryLinks++; continue; }
    relations.push({ predKey: p, succKey: q, type: l.type || "FS", lag: Math.round(l.lagDays || 0) });
  }
  if (summaryLinks) problems.push(`${summaryLinks} رابطه به یا از یک تسک خلاصه (Summary) بود و وارد نشد؛ رابطه فقط بین فعالیت‌هاست.`);
  return { nodes, activities, relations, problems };
}

/** From PMS workbook rows parsed by lib/controls/pms.mjs (parsePmsRows → nodes). */
export function fromPms(pmsNodes) {
  const problems = [];
  const bySeq = new Map(pmsNodes.map((n) => [n.seq, n]));
  const top = pmsNodes.find((n) => n.parent == null && n.kind === "group");
  const kids = new Map();
  for (const n of pmsNodes) if (n.parent != null) (kids.get(n.parent) || kids.set(n.parent, []).get(n.parent)).push(n);
  const nodes = [], activities = [];
  const codeOf = new Map();
  const counter = new Map();
  for (const n of pmsNodes) {
    if (n.kind !== "group" || n === top) continue;
    const parent = n.parent != null ? bySeq.get(n.parent) : null;
    const pKey = parent && parent !== top ? `g${parent.seq}` : null;
    const k = counter.get(pKey) || 0;
    counter.set(pKey, k + 1);
    const code = pKey ? `${codeOf.get(pKey)}.${String(k + 1).padStart(2, "0")}` : String(k + 1).padStart(2, "0");
    codeOf.set(`g${n.seq}`, code);
    const steps = (kids.get(n.seq) || []).filter((c) => c.kind === "step");
    const units = [...new Set(steps.map((c) => c.unit).filter(Boolean))];
    nodes.push({ key: `g${n.seq}`, parentKey: pKey, code, name: n.name || "—", seq: nodes.length + 1,
      wf: share(n.wf, parent ? parent.wf : null), unit: units.length === 1 ? units[0] : null,
      volume: units.length === 1 ? num(n.qty) : null });
  }
  const used = new Map();
  for (const n of pmsNodes) {
    if (n.kind !== "step") continue;
    const nk = `g${n.parent}`;
    if (!codeOf.has(nk)) { problems.push(`ردیف ${n.row}: گام ${n.code} عنصری بالای خود ندارد و وارد نشد.`); continue; }
    const u = used.get(nk) || used.set(nk, new Set()).get(nk);
    activities.push({ key: `s${n.seq}`, nodeKey: nk, code: uniq(u, n.code), name: n.name || n.code, seq: activities.length + 1,
      wf: n.stepWeight == null ? null : r4(n.stepWeight * 100), volume: num(n.qty),
      progress: n.progress == null ? null : Math.max(0, Math.min(100, r4(n.progress * 100))) });
  }
  if (!activities.length) problems.push("هیچ گامی (ستون CC) در فایل نبود.");
  return { nodes, activities, relations: [], problems };
}
