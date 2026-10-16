/**
 * PMS — the progress measurement system: a weighted breakdown whose leaves
 * are rule-of-credit steps (Material Handling 5 %, Installation 50 % …).
 *
 * Read from the contractor's PMS workbook as it is laid out:
 *
 *   B…G   the breakdown level the row belongs to (project, plant, furnace,
 *         discipline, section, element) — the column the name sits in IS
 *         the level
 *   H     step code (CC) — a row with a code is a step of the element above
 *   I     step description · J unit · K step weight inside its element
 *   L     W.F, the row's share of the whole project
 *   M     quantity (kg, No.) · V/W/X quantity done last/this/total
 *   Y/Z/AA progress last/this/total, 0…1
 *
 * The engine re-derives what the workbook states and says where the two
 * disagree, instead of trusting either: weights that do not add up to their
 * parent, steps whose weights inside an element are not 100 %, a stated
 * roll-up that the steps do not give, a "total" that is not last + this.
 * The workbook's own top-level figure is kept beside the computed one.
 */

const LEVEL_COLS = ["B", "C", "D", "E", "F", "G"];
const EPS_W = 1e-6;
const EPS_P = 5e-4;

const str = (v) => (v == null ? "" : String(v).trim());
const nnum = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

/**
 * rows: objects keyed by column letter (SheetJS sheet_to_json with
 * header:"A"), with __rowNum__. Returns { title, nodes, stated }.
 *
 * nodes, in sheet order: { seq, row, kind: "group"|"step", level, parent
 * (seq), name, code, unit, stepWeight, wf, qty, doneQty, progress,
 * progressLast, progressThis }.
 */
export function parsePmsRows(rows) {
  const nodes = [];
  const stack = []; // open groups by level
  let title = null, stated = null;
  for (const r of rows) {
    const rowNo = (r.__rowNum__ ?? 0) + 1;
    if (str(r.A).toLowerCase() === "coding" || str(r.I) === "PMS") continue; // the two header rows
    const code = str(r.H);
    const levelIdx = LEVEL_COLS.findIndex((c) => typeof r[c] === "string" && r[c].trim());
    const common = {
      seq: nodes.length, row: rowNo, wf: nnum(r.L), qty: nnum(r.M), doneQty: nnum(r.X),
      progress: nnum(r.AA), progressLast: nnum(r.Y), progressThis: nnum(r.Z),
    };
    if (code) {
      const element = stack.filter(Boolean).at(-1);
      if (!element) continue;
      nodes.push({ ...common, kind: "step", level: element.level + 1, parent: element.seq,
        code, name: str(r.I), unit: str(r.J) && str(r.J) !== "-" ? str(r.J) : null, stepWeight: nnum(r.K) });
    } else if (levelIdx >= 0) {
      const level = levelIdx;
      stack.length = level; // close deeper groups
      const parent = stack.filter(Boolean).at(-1) || null;
      const node = { ...common, kind: "group", level, parent: parent ? parent.seq : null,
        code: null, name: str(r[LEVEL_COLS[levelIdx]]), unit: null, stepWeight: null };
      nodes.push(node);
      stack[level] = node;
      if (level === 0 && title == null) { title = node.name; stated = node.progress; }
    }
  }
  return { title, nodes, stated };
}

export const childrenOf = (nodes) => {
  const kids = new Map(nodes.map((n) => [n.seq, []]));
  for (const n of nodes) if (n.parent != null) kids.get(n.parent).push(n);
  return kids;
};

/** An element is a group whose children are steps. */
export const isElement = (n, kids) => n.kind === "group" && kids.get(n.seq).some((c) => c.kind === "step");

/**
 * Roll progress up the tree from the steps, weighting by W.F.
 * `stepProgress(step)` gives a step's fraction (0…1) — the workbook's own
 * figure, or a later site report. A group with no weight under it has no
 * computed progress (null): there is nothing to weigh.
 */
export function rollup(nodes, stepProgress = (s) => s.progress ?? 0) {
  const kids = childrenOf(nodes);
  const out = new Map();
  const visit = (n) => {
    if (n.kind === "step") {
      const p = stepProgress(n);
      out.set(n.seq, { progress: p, weight: n.wf || 0 });
      return out.get(n.seq);
    }
    let w = 0, e = 0;
    for (const c of kids.get(n.seq)) { const r = visit(c); w += r.weight; e += r.weight * (r.progress ?? 0); }
    const r = { progress: w > 0 ? e / w : null, weight: w };
    out.set(n.seq, r);
    return r;
  };
  for (const n of nodes) if (n.parent == null) visit(n);
  return out;
}

/** Where the workbook does not agree with itself. */
export function checkPms(nodes) {
  const kids = childrenOf(nodes);
  const problems = [];
  const add = (n, kind, detail) => problems.push({ row: n.row, seq: n.seq, name: n.name, code: n.code, kind, detail });
  const computed = rollup(nodes);
  for (const n of nodes) {
    const ch = kids.get(n.seq);
    if (n.kind === "group" && ch.length && n.wf != null) {
      const sum = ch.reduce((s, c) => s + (c.wf || 0), 0);
      if (Math.abs(sum - n.wf) > EPS_W) add(n, "weight-sum", { stated: n.wf, children: sum });
    }
    if (isElement(n, kids)) {
      const ks = ch.filter((c) => c.kind === "step" && c.stepWeight != null);
      const sumK = ks.reduce((s, c) => s + c.stepWeight, 0);
      if (ks.length && Math.abs(sumK - 1) > EPS_W) add(n, "step-weights", { sum: sumK });
    }
    if (n.kind === "step" && n.stepWeight != null && n.wf != null) {
      const parent = nodes[n.parent];
      if (parent.wf != null && Math.abs(parent.wf * n.stepWeight - n.wf) > EPS_W) {
        add(n, "step-wf", { stated: n.wf, expected: parent.wf * n.stepWeight });
      }
    }
    if (n.progress != null && (n.progress < -EPS_W || n.progress > 1 + EPS_W)) add(n, "progress-range", { progress: n.progress });
    if (n.kind === "step" && n.progress != null && n.progressLast != null && n.progressThis != null
        && Math.abs(n.progressLast + n.progressThis - n.progress) > EPS_P) {
      add(n, "total-not-last-plus-this", { last: n.progressLast, this: n.progressThis, total: n.progress });
    }
    if (n.kind === "group" && n.progress != null) {
      const c = computed.get(n.seq);
      if (c.progress != null && Math.abs(c.progress - n.progress) > EPS_P) {
        add(n, "rollup", { stated: n.progress, computed: c.progress });
      }
    }
  }
  return problems;
}

export const PROBLEM_FA = {
  "weight-sum": "وزن گروه با جمع وزن زیرمجموعه‌ها برابر نیست",
  "step-weights": "جمع وزن گام‌های این آیتم ۱۰۰٪ نیست",
  "step-wf": "W.F گام با «وزن آیتم × وزن گام» نمی‌خواند",
  "progress-range": "پیشرفت بیرون از ۰ تا ۱۰۰٪",
  "total-not-last-plus-this": "پیشرفت کل با «قبلی + این دوره» نمی‌خواند",
  rollup: "پیشرفت نوشته‌شدهٔ گروه با جمع وزنی گام‌هایش نمی‌خواند",
};

// ── the schedule link ────────────────────────────────────────────────────

const normName = (s) => str(s).toLowerCase().replace(/^\s*\d+\s*[.\-]\s*/, "").replace(/[^a-z0-9+]/g, "");
/** The section code a furnace PMS and its schedule both print: 1A, 2A1, 5A+5C. */
export const sectionCode = (s) => {
  const m = str(s).match(/^(\d[A-Z]\d?(?:\s*\+\s*\d[A-Z])?)(?=\s|$)/i);
  return m ? m[1].replace(/\s+/g, "").toUpperCase() : null;
};

/**
 * Link PMS elements to schedule summary tasks — only where it is certain:
 * the same name, or the same section code, and exactly one task has it.
 * Everything else stays unlinked for a person to link; a near-match by
 * spelling ("Primery TLE (E-110 A)" / "Primary TLE (E-110A)") is not
 * decided here, the more so as the tags differ between the two documents.
 *
 * `within(node)` limits which elements are considered (one plant's branch).
 */
export function suggestLinks(nodes, tasks, within = () => true) {
  const kids = childrenOf(nodes);
  const summaries = tasks.filter((t) => t.summary);
  const byName = new Map(), byCode = new Map();
  const push = (m, k, t) => { if (!k) return; m.set(k, [...(m.get(k) || []), t]); };
  for (const t of summaries) { push(byName, normName(t.name), t); push(byCode, sectionCode(t.name), t); }
  const links = [];
  for (const n of nodes) {
    if (!isElement(n, kids) || !within(n)) continue;
    const named = byName.get(normName(n.name)) || [];
    const coded = sectionCode(n.name) ? byCode.get(sectionCode(n.name)) || [] : [];
    const hit = named.length === 1 ? { t: named[0], by: "name" } : coded.length === 1 ? { t: coded[0], by: "code" } : null;
    links.push({ seq: n.seq, uid: hit ? hit.t.uid : null, by: hit ? hit.by : null,
      ambiguous: !hit && (named.length > 1 || coded.length > 1) });
  }
  return links;
}

// ── plan against actual ──────────────────────────────────────────────────

const DAY = 86400000;
const t0 = (d) => Date.parse(`${d}T00:00:00Z`);

/** The fraction of an activity planned done by `on`, spread evenly over its days. */
export function plannedFraction(start, finish, on) {
  if (!start || !finish) return null;
  const s = t0(start), f = t0(finish) + DAY, d = t0(on) + DAY;
  if (d <= s) return 0;
  if (d >= f) return 1;
  return (d - s) / (f - s);
}

/**
 * Plan S-curve over the linked part of the PMS: each linked element's W.F
 * spread evenly across its schedule task's baseline (or current) dates.
 * Elements with no link are left out and their weight reported, so the
 * curve never claims to cover what it does not.
 */
export function planCurve(elements, { dates, use = "baseline" }) {
  const linked = elements.filter((e) => e.task && (use === "baseline" ? e.task.blStart : e.task.start));
  const total = linked.reduce((s, e) => s + (e.wf || 0), 0);
  const pick = (t) => (use === "baseline" ? [t.blStart, t.blFinish] : [t.start, t.finish]);
  return {
    covered: total,
    points: dates.map((on) => ({
      on,
      pct: total > 0 ? (100 * linked.reduce((s, e) => s + (e.wf || 0) * plannedFraction(...pick(e.task), on), 0)) / total : null,
    })),
  };
}

/** Month ends from the first to the last date, plus the two ends. */
export function monthlyDates(from, to) {
  const out = [from];
  let d = new Date(`${from}T00:00:00Z`);
  for (;;) {
    d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 2, 0));
    const s = d.toISOString().slice(0, 10);
    if (s >= to) break;
    if (s > from) out.push(s);
  }
  out.push(to);
  return [...new Set(out)];
}
