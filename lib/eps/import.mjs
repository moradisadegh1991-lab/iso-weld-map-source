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
 *   An EPS sheet (the platform's own template, or its tree exported to Excel)
 *     one row per WBS node or activity, each naming its parent's code in the
 *     column before its own: a row is a node when its Type says so, or —
 *     without a Type column — when another row names it as parent. W.F is the
 *     row's share of its parent, as the platform keeps it.
 *
 * Anything the file does not carry stays empty and is listed in `problems`.
 */
import { COST_FIELDS } from "./costs.mjs";

const r4 = (v) => Math.round(v * 10000) / 10000;
// W.F keeps ten decimals, as the database does (owner's requirements 2026-10-22, item 9)
const r10 = (v) => Math.round(v * 1e10) / 1e10;
const share = (part, whole) => (part != null && whole != null && Number(whole) > 0 ? r10((Number(part) / Number(whole)) * 100) : null);
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
      wf: n.stepWeight == null ? null : r10(n.stepWeight * 100), volume: num(n.qty),
      progress: n.progress == null ? null : Math.max(0, Math.min(100, r4(n.progress * 100))) });
  }
  if (!activities.length) problems.push("هیچ گامی (ستون CC) در فایل نبود.");
  return { nodes, activities, relations: [], problems };
}

// ── an EPS sheet ─────────────────────────────────────────────────────────

/**
 * The columns of an EPS sheet, found by their header (English or Persian; the
 * tree's own export uses these words). `type` and the dates are optional.
 */
const SHEET_COLS = {
  type: [/^(type|kind|row\s*type)$/i, /^نوع/],                    // i18n: a Persian header a file may carry
  parent: [/^parent(\s*code)?$/i, /^کد\s*(والد|پدر|بالادست)/],     // i18n: a Persian header a file may carry
  code: [/^(code|wbs|id)$/i, /^کد$/, /^activity\s*id$/i],          // i18n: a Persian header a file may carry — «Activity ID» only when there is no Code
  name: [/^(name|title|description|activity(\s*name)?)$/i, /^(نام|عنوان|شرح)/],   // i18n: a Persian header a file may carry
  wf: [/^w\.?\s*f\.?(\s*%)?$/i, /^(weight|وزن)/i],               // i18n: a Persian header a file may carry
  unit: [/^(unit|uom)$/i, /^واحد/],                                   // i18n: a Persian header a file may carry
  volume: [/^(volume|qty|quantity)(\s*plan(ned)?)?$/i, /^(حجم|مقدار)/],   // i18n: a Persian header a file may carry
  plan_start: [/^(plan(ned)?\s*start|start)$/i, /^شروع(\s*برنامه)?$/],   // i18n: a Persian header a file may carry
  plan_end: [/^(plan(ned)?\s*(end|finish)|end|finish)$/i, /^پایان(\s*برنامه)?$/],   // i18n: a Persian header a file may carry
  actual_start: [/^actual\s*start$/i, /^شروع\s*واقعی/],              // i18n: a Persian header a file may carry
  actual_end: [/^actual\s*(end|finish)$/i, /^پایان\s*واقعی/],        // i18n: a Persian header a file may carry
  // the activity table's own fields (owner's requirements 2026-10-26, item 1): an activity's, a node leaves them
  act_type: [/^activity\s*type$/i, /^نوع\s*فعالیت/],                 // i18n: a Persian header a file may carry
  activity_no: [/^activity\s*(id|no\.?)$/i],
  wf_rate: [/^wf\s*rate$/i],
  volume_actual: [/^(volume|qty|quantity)\s*actual$/i, /^حجم\s*واقعی/],   // i18n: a Persian header a file may carry
  description: [/^(description|remarks?)$/i, /^توضیح/],               // i18n: a Persian header a file may carry
  ...Object.fromEntries(COST_FIELDS.map((f) => [f.col, [new RegExp(`^${f.head.replace(/[()*$%.]/g, (c) => `\\${c}`).replace(/\s+/g, "\\s*")}$`, "i"), new RegExp(`^${f.col}$`, "i")]])),
};
/** The activity table's fields an EPS sheet may carry, after the tree's own columns (item 1). */
export const SHEET_ACT_HEAD = ["Activity type", "Activity ID", "WF rate", "Volume actual", "Description", ...COST_FIELDS.map((f) => f.head)];
export const SHEET_HEAD = ["Type", "Parent code", "Code", "Name", "W.F", "Unit", "Volume", "Plan start", "Plan end", "Actual start", "Actual end", ...SHEET_ACT_HEAD];
const norm = (h) => String(h ?? "").replace(/\s+/g, " ").trim().toLowerCase();

/** A date cell: a Date, an Excel serial day, or yyyy-mm-dd; anything else is not a date (null). */
export function sheetDate(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? undefined : v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
  const m = String(v).trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (m && Number(m[1]) > 1900) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  return undefined;
}

/**
 * From the rows of an EPS sheet (arrays, the header row among the first ten).
 * `custom`: the project's own columns of the activities table ({ id, label }),
 * read from a column headed with the label — an activity's value, as typed.
 */
export function fromSheet(rows, { custom = [] } = {}) {
  const problems = [];
  const cell = (v) => (v == null ? "" : String(v).trim());
  const hi = rows.slice(0, 10).findIndex((r) => (r || []).some((h) => SHEET_COLS.code.some((rx) => rx.test(cell(h)))));
  if (hi < 0) return { nodes: [], activities: [], relations: [], problems: ["ستون «Code» (کد) در ده ردیف اول پیدا نشد."] };
  const head = rows[hi].map(cell);
  const taken = new Set();
  const col = {};
  // each heading answers one field only: the fields in turn, each by its patterns in order (a Code column before an
  // «Activity ID» one, which is then the activity's ID; Name before Description)
  for (const [k, rxs] of Object.entries(SHEET_COLS)) {
    col[k] = -1;
    for (const rx of rxs) { col[k] = head.findIndex((h, i) => h && !taken.has(i) && rx.test(h)); if (col[k] >= 0) break; }
    if (col[k] >= 0) taken.add(col[k]);
  }
  const customAt = custom.map((f) => ({ ...f, at: head.findIndex((h, i) => h && !taken.has(i) && norm(h) === norm(f.label)) })).filter((f) => f.at >= 0);
  if (col.name < 0) problems.push("ستون «Name» (نام) پیدا نشد؛ کد به‌جای نام نشست.");
  const get = (r, k) => (col[k] >= 0 ? r[col[k]] : null);
  const lines = [];
  rows.slice(hi + 1).forEach((r, i) => {
    const code = cell(get(r || [], "code"));
    if (!code) return;
    lines.push({ row: hi + i + 2, r, code, parent: cell(get(r, "parent")), type: cell(get(r, "type")).toLowerCase() });
  });
  const parents = new Set(lines.map((l) => l.parent).filter(Boolean));
  const isNode = (l) => (col.type >= 0 && l.type ? /^(wbs|node|group|گره|بسته|سطح)/i.test(l.type) : parents.has(l.code));
  const dates = (l) => {
    const out = {};
    for (const k of ["plan_start", "plan_end", "actual_start", "actual_end"]) {
      const d = sheetDate(get(l.r, k));
      if (d === undefined) problems.push(`ردیف ${l.row}: «${cell(get(l.r, k))}» تاریخ میلادی (yyyy-mm-dd) نیست؛ خالی ماند.`);
      out[k] = d || null;
    }
    return out;
  };
  // the activity table's fields of a line: text as typed, figures as numbers — a figure that is not one is left empty and named
  const figure = (l, k, what, { min = null } = {}) => {
    const raw = get(l.r, k);
    if (raw == null || cell(raw) === "") return null;
    const v = num(typeof raw === "string" ? raw.replace(/[٬,]/g, "") : raw);
    if (v == null) { problems.push(`ردیف ${l.row}: «${cell(raw)}» در ستون ${what} عدد نیست؛ خالی ماند.`); return null; }
    if (min != null && v < min) { problems.push(`ردیف ${l.row}: ${what} منفی نمی‌شود؛ خالی ماند.`); return null; }
    return v;
  };
  const actFields = (l) => {
    const f = { act_type: cell(get(l.r, "act_type")) || null, activity_no: cell(get(l.r, "activity_no")) || null,
      wf_rate: figure(l, "wf_rate", "WF rate"), description: cell(get(l.r, "description")) || null };
    if (col.volume_actual >= 0) f.volume_actual = figure(l, "volume_actual", "Volume actual", { min: 0 });
    for (const c of COST_FIELDS) f[c.col] = figure(l, c.col, c.head, { min: c.cost ? 0 : null });
    return f;
  };
  const customOf = (l) => Object.fromEntries(customAt.map((f) => [f.id, l.r[f.at]]).filter(([, v]) => v != null && cell(v instanceof Date ? v.toISOString().slice(0, 10) : v) !== "")
    .map(([id, v]) => [id, v instanceof Date ? v.toISOString().slice(0, 10) : cell(v)]));
  const nodes = [], activities = [];
  const nodeKey = new Map();
  for (const l of lines.filter(isNode)) {
    if (nodeKey.has(l.code)) { problems.push(`ردیف ${l.row}: کد گرهٔ ${l.code} تکراری است و وارد نشد.`); continue; }
    nodeKey.set(l.code, `n${l.row}`);
  }
  for (const l of lines.filter(isNode)) {
    if (nodeKey.get(l.code) !== `n${l.row}`) continue;
    let pKey = l.parent ? nodeKey.get(l.parent) : null;
    if (l.parent && !pKey) problems.push(`ردیف ${l.row}: والد ${l.parent} گره‌ای در فایل نیست؛ ${l.code} در سطح اول نشست.`);
    if (l.parent === l.code) pKey = null;
    nodes.push({ key: `n${l.row}`, parentKey: pKey || null, code: l.code, name: cell(get(l.r, "name")) || l.code, seq: nodes.length + 1,
      wf: num(get(l.r, "wf")), unit: cell(get(l.r, "unit")) || null, volume: num(get(l.r, "volume")), ...dates(l) });
  }
  // a node whose parents loop back to it has no place in a tree
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  for (const n of nodes) {
    const seen = new Set([n.key]);
    for (let p = n.parentKey; p; p = byKey.get(p)?.parentKey) {
      if (seen.has(p)) { problems.push(`گره ${n.code} زیر خودش افتاده است؛ در سطح اول نشست.`); n.parentKey = null; break; }
      seen.add(p);
    }
  }
  const used = new Map();
  for (const l of lines.filter((x) => !isNode(x))) {
    const nk = l.parent ? nodeKey.get(l.parent) : null;
    if (!nk) { problems.push(`ردیف ${l.row}: فعالیت ${l.code} گرهٔ والدی در فایل ندارد (ستون Parent code) و وارد نشد.`); continue; }
    const u = used.get(nk) || used.set(nk, new Set()).get(nk);
    activities.push({ key: `a${l.row}`, nodeKey: nk, code: uniq(u, l.code), name: cell(get(l.r, "name")) || l.code, seq: activities.length + 1,
      wf: num(get(l.r, "wf")), volume: num(get(l.r, "volume")), progress: null, ...dates(l), fields: actFields(l), custom: customOf(l) });
  }
  if (!nodes.length) problems.push("هیچ گرهٔ WBS در فایل نبود.");
  return { nodes, activities, relations: [], problems };
}
