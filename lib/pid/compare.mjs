/**
 * Comparison of two P&ID revisions (pure), by persistent identity and EXPLICIT mappings — the Phase 8 rules:
 *   · a stored mapping (target-side: `to.mappings`, fromUid → toUid) pairs two items; nothing else does;
 *   · the same tag, unique on both sides, is only a CANDIDATE (a proposal a person confirms); several → ambiguous;
 *   · a source revision's uid is never written into the target; nothing is overwritten (this function only reads);
 *   · what has no counterpart is added / removed; unresolved mappings are listed, not hidden.
 */
import { buildGraph } from "./graph.mjs";

const text = (v) => String(v ?? "").trim();
const ATTRS = { line: ["size", "pipingClass", "fluid", "insulation", "trace", "service"], equipment: [], instrument: ["letters", "loop"], valve: ["size"], inline: ["size"], connector: ["targetSheet"] };
const key = (i) => text(i.tag || i.attrs?.lineNo || (i.cls === "connector" ? i.attrs?.targetSheet : ""));

export function comparePid({ from, to, mappings = null }) {
  const map = (Array.isArray(mappings) ? mappings : to.mappings || []).filter((m) => m?.fromUid && m?.toUid);
  const f2t = new Map(map.map((m) => [m.fromUid, m.toUid])), t2f = new Map(map.map((m) => [m.toUid, m.fromUid]));
  const fi = new Map((from.items || []).map((i) => [i.uid, i])), ti = new Map((to.items || []).map((i) => [i.uid, i]));
  const changes = [], pairs = [];
  const push = (c) => changes.push({ review: c.kind === "candidate" || c.kind === "ambiguous", ...c });
  for (const [fu, tu] of f2t) if (fi.has(fu) && ti.has(tu) && fi.get(fu).cls === ti.get(tu).cls) pairs.push({ f: fi.get(fu), t: ti.get(tu), how: "mapped" });
  const usedF = new Set(pairs.map((p) => p.f.uid)), usedT = new Set(pairs.map((p) => p.t.uid));
  for (const cls of new Set([...(from.items || []), ...(to.items || [])].map((i) => i.cls))) {
    const F = (from.items || []).filter((i) => i.cls === cls && !usedF.has(i.uid)), T = (to.items || []).filter((i) => i.cls === cls && !usedT.has(i.uid));
    const grp = (list) => { const g = new Map(); for (const i of list) { const k = key(i); g.set(k, [...(g.get(k) || []), i]); } return g; };
    const gF = grp(F), gT = grp(T);
    for (const [k, fs] of gF) {
      const ts = gT.get(k) || [];
      if (k && fs.length === 1 && ts.length === 1) { pairs.push({ f: fs[0], t: ts[0], how: "candidate" }); usedF.add(fs[0].uid); usedT.add(ts[0].uid); }
      else if (ts.length) {
        for (const x of fs) usedF.add(x.uid); for (const x of ts) usedT.add(x.uid);
        push({ kind: "ambiguous", cls, tag: k || null, fromUids: fs.map((x) => x.uid), toUids: ts.map((x) => x.uid), reason: `${fs.length} قدیمی و ${ts.length} جدید با این مرجع؛ تطبیق خودکار نمی‌شود` });
      }
    }
  }
  for (const { f, t, how } of pairs) {
    const fields = [];
    if (key(f) !== key(t)) fields.push({ field: "tag", from: key(f) || null, to: key(t) || null });
    if (f.symbol !== t.symbol) fields.push({ field: "symbol", from: f.symbol, to: t.symbol });
    for (const a of ATTRS[f.cls] || []) if (text(f.attrs?.[a]) !== text(t.attrs?.[a])) fields.push({ field: a, from: f.attrs?.[a] ?? null, to: t.attrs?.[a] ?? null });
    const kind = how === "candidate" ? "candidate" : fields.some((x) => x.field === "tag") ? "renumbered" : fields.length ? "changed" : "unchanged";
    push({ kind, cls: f.cls, fromUid: f.uid, toUid: t.uid, tag: key(t) || key(f), fields, how });
  }
  for (const i of from.items || []) if (!usedF.has(i.uid)) push({ kind: "removed", cls: i.cls, fromUid: i.uid, tag: key(i), fields: [] });
  for (const i of to.items || []) if (!usedT.has(i.uid)) push({ kind: "added", cls: i.cls, toUid: i.uid, tag: key(i), fields: [] });

  // connectivity of explicitly paired items: the neighbours of one, seen through the mapping, against the neighbours of the other
  const gf = buildGraph(from), gt = buildGraph(to);
  const paired = pairs.filter((p) => p.how === "mapped");
  for (const { f, t } of paired) {
    const a = new Set((gf.adjacency.get(f.uid) || []).map((u) => f2t.get(u) || `?${u}`)), b = new Set(gt.adjacency.get(t.uid) || []);
    const lost = [...a].filter((x) => !b.has(x)), gained = [...b].filter((x) => !a.has(x));
    if (lost.length || gained.length) push({ kind: "connectivity", cls: f.cls, fromUid: f.uid, toUid: t.uid, tag: key(t) || key(f), fields: [], lost: lost.map((x) => (x.startsWith("?") ? { unmappedFrom: x.slice(1) } : { toUid: x })), gained });
  }
  // off-page: the stated targets, as sets
  const off = (d) => new Set((d.items || []).filter((i) => i.cls === "connector").map((i) => text(i.attrs?.targetSheet)).filter(Boolean));
  const of = off(from), ot = off(to);
  for (const r of of) if (!ot.has(r)) push({ kind: "offpage-removed", cls: "connector", tag: r, fields: [] });
  for (const r of ot) if (!of.has(r)) push({ kind: "offpage-added", cls: "connector", tag: r, fields: [] });

  const summary = {}; for (const c of changes) summary[c.kind] = (summary[c.kind] || 0) + 1;
  return { changes, summary, unresolved: changes.filter((c) => c.kind === "candidate" || c.kind === "ambiguous") };
}

/** Record ONE explicit mapping on the target draft (target-side), refused if it would pair an already-paired or a different-class item. Pure. */
export function confirmMapping(toDraft, fromDraft, { fromUid, toUid, by, at = new Date().toISOString() }) {
  const f = (fromDraft.items || []).find((i) => i.uid === fromUid), t = (toDraft.items || []).find((i) => i.uid === toUid);
  const err = (code, message) => Object.assign(new Error(message), { status: 409, code });
  if (!f || !t) throw err("NOT_FOUND", "یکی از دو مورد در رویژن‌ها نیست");
  if (f.cls !== t.cls) throw err("INVALID_MAPPING", "دو مورد از یک کلاس نیستند");
  if ((toDraft.mappings || []).some((m) => m.fromUid === fromUid || m.toUid === toUid)) throw err("INVALID_MAPPING", "یکی از این دو قبلاً نگاشت شده است");
  if (!by) throw Object.assign(new Error("the person who confirms is required"), { status: 400, code: "INVALID_INPUT" });
  return { ...toDraft, mappings: [...(toDraft.mappings || []), { fromUid, toUid, by, at }] };
}
