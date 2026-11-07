/**
 * Revision comparison and the carry-forward plan (pure; docs/audit/phase-8-revision-lifecycle.md).
 *
 *   diffRevisions({ from, to, mappings }) → { changes, summary }
 *     from / to  { payload, ledger?, equipment? }   the SOURCE (older) and TARGET (newer) revision as saved
 *     mappings   [{ cls, fromUid, toUid }]          identity mappings already established (revision_carry_map)
 *
 * IDENTITY — in this order and no other:
 *   1. an explicit stored mapping (source uid → target uid)      → `mapped`
 *   2. otherwise NOTHING is matched. When the printed number is the same and unique on both sides the pair is only a `candidate`
 *      (a proposal: it becomes a match when a person confirms it, which stores a mapping); several on either side → `ambiguous`;
 *      nothing on the other side → `removed` / `added`.
 *   The printed number is never an identity and geometry is never used to match. A uid can never be the same in two revisions
 *   (migration 105), so a mapping is the only link there is.
 *
 * CARRY — only descriptive fields, only into EMPTY fields of the target, never a status (installed / tested / planned…), an allocation,
 * a history or an approval. A PT reference moves only when that PT is in the target BOM; one whose row changed needs the person's explicit
 * choice; an equipment's weld links move only through mappings. Everything else is listed with the reason it did not move.
 */
import { KINDS, accessoriesOf, accessoriesText, plainNo, bomSnapshot, weldRefsOf, equipmentWelds, isPlaced } from "../sheet/markup.mjs";
import { effectiveItems } from "../sheet/weld-projection.mjs";
import { isUid } from "../sheet/mark-identity.mjs";

const text = (v) => String(v ?? "").trim();
const cls = (m) => KINDS[m?.kind]?.cls;
const keyOf = (m) => (isUid(m?.uid) ? m.uid.toLowerCase() : text(m?.id));
const CLASSES = ["weld", "spool", "support", "equipment"];
const CAT = { weld: "weld", spool: "spool", support: "support", equipment: "equipment" };
const LABEL = { weld: "سرجوش", spool: "اسپول", support: "ساپورت", equipment: "تجهیز", cut: "قطعهٔ برش" };

/** What each class may bring along. (`status`, `no`, `kind`/location, size of a weld, geometry are the target revision's own.) */
export const CARRY_FIELDS = {
  weld: ["c1", "c2", "spool", "schedule", "material", "wps", "ref", "note"],
  spool: ["size", "material", "lengthMm", "note"],
  support: ["type", "size", "note"],
  equipment: ["tag", "type", "c1", "acc", "spool", "weldRefs", "note"],
};
/** Compared and shown but never carried. */
const SHOWN_ONLY = { weld: ["type", "size"], spool: [], support: [], equipment: ["status"] };
const FIELD_LABEL = { c1: "قطعهٔ ۱ (PT)", c2: "قطعهٔ ۲ (PT)", spool: "اسپول", schedule: "Sch", material: "جنس", wps: "WPS", ref: "Tie-in", note: "توضیح", size: "قطر", type: "نوع", tag: "تگ", acc: "متعلقات", weldRefs: "سرجوش‌های متصل", lengthMm: "طول", status: "وضعیت نصب", no: "شماره", loc: "محل جوش" };
const PT_FIELDS = new Set(["c1", "c2"]);
/** Cut pieces (Phase 9): descriptive fields and the three references (carried only as the TARGET revision's own uid, through explicit mappings). */
export const CUT_CARRY_FIELDS = ["ns", "material", "schedule", "angle", "note", "from", "to", "spool"];
CARRY_FIELDS.cut = CUT_CARRY_FIELDS;
const CUT_REF = { from: ["fromUid", "weld"], to: ["toUid", "weld"], spool: ["spoolUid", "spool"] };

const bomMap = (bom) => new Map((Array.isArray(bom) ? bom : []).filter((b) => b && b.pt != null && text(b.pt)).map((b) => [text(b.pt), b]));
const numKey = (m) => (cls(m) === "weld" ? plainNo(m.no) : text(m.no));
const near = (a, b) => (a == null && b == null) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 0.002);

function view(m, bom, extra = {}) {
  const a = m.attrs || {};
  const out = { no: text(m.no), loc: m.kind === "weld-shop" ? "Shop" : m.kind === "weld-field" ? "Field" : cls(m) === "weld" ? "؟" : "", ...a };
  if (cls(m) === "equipment") out.acc = accessoriesText(accessoriesOf(a.acc));
  return { ...out, ...extra };
}

function compareFields(klass, f, t, mapTo) {
  const out = [];
  const keys = ["no", ...(klass === "weld" ? ["loc"] : []), ...CARRY_FIELDS[klass].filter((k) => k !== "weldRefs"), ...SHOWN_ONLY[klass]];
  for (const k of new Set(keys)) {
    // a spool whose printed NUMBER changed but whose relationship (by uid, through the mapping) did not is a renumbering, not a relationship change
    if (k === "spool" && isUid(f.spoolUid) && isUid(t.spoolUid) && mapTo(f.spoolUid) === String(t.spoolUid).toLowerCase()) continue;
    if (text(f[k]) !== text(t[k])) out.push({ field: k, label: FIELD_LABEL[k] || k, from: text(f[k]) || null, to: text(t[k]) || null });
  }
  if (klass === "equipment") {
    const a = weldRefsOf(f.weldRefs).map((u) => mapTo(u) || `?${u}`).sort().join(","), b = weldRefsOf(t.weldRefs).sort().join(",");
    if (a !== b) out.push({ field: "weldRefs", label: FIELD_LABEL.weldRefs, from: weldRefsOf(f.weldRefs).join(", ") || null, to: weldRefsOf(t.weldRefs).join(", ") || null });
  }
  return out;
}

/** The fields of one pair that can move, and why the others cannot. */
function carryPlan(klass, f, t, toBom, fromBom, { mapTo, toWeldUids, toSpools, toSpoolUids }) {
  const ready = [], blocked = [];
  for (const k of CARRY_FIELDS[klass]) {
    if (k === "weldRefs") {
      const refs = weldRefsOf(f.weldRefs);
      if (!refs.length) continue;
      if (weldRefsOf(t.weldRefs).length) { blocked.push({ field: k, reason: "TARGET_HAS_VALUE" }); continue; }
      const mapped = refs.map(mapTo).filter((u) => u && toWeldUids.has(u));
      const lost = refs.filter((u) => !(mapTo(u) && toWeldUids.has(mapTo(u))));
      if (mapped.length) ready.push({ field: k, from: refs.join(", "), value: [...new Set(mapped)].join(","), note: lost.length ? `${lost.length} پیوند بدون معادل صریح منتقل نمی‌شود` : null });
      else blocked.push({ field: k, reason: "NO_MAPPED_WELD", detail: `${lost.length} پیوند` });
      if (mapped.length && lost.length) blocked.push({ field: k, reason: "PARTIAL_LINKS", detail: `${lost.length} پیوند بدون معادل` });
      continue;
    }
    const v = text(f[k]);
    if (!v) continue;
    if (k === "spool" && isUid(t.spoolUid)) { blocked.push({ field: k, reason: "TARGET_HAS_VALUE", from: v, to: text(t.spool) || String(t.spoolUid) }); continue; }
    if (text(t[k])) { if (text(t[k]) !== v) blocked.push({ field: k, reason: "TARGET_HAS_VALUE", from: v, to: text(t[k]) }); continue; }
    if (k === "spool" && isUid(f.spoolUid)) {
      // the spool is carried as the TARGET revision's own spool, through an explicit source→target mapping — a source uid is never copied across
      const m = mapTo(f.spoolUid);
      if (!m) blocked.push({ field: k, reason: "NO_MAPPED_SPOOL", from: v });
      else if (!toSpoolUids.has(m)) blocked.push({ field: k, reason: "SPOOL_NOT_IN_TARGET", from: v });
      else ready.push({ field: k, from: v, value: m });
      continue;
    }
    if (PT_FIELDS.has(k)) {
      const row = toBom.get(v);
      if (!row) { blocked.push({ field: k, reason: "PT_NOT_IN_TARGET", from: v }); continue; }
      const was = fromBom.get(v);
      if (was && bomSnapshot(was) !== bomSnapshot(row)) ready.push({ field: k, from: v, value: v, state: "needs_decision", note: "ردیف BOM در نسخهٔ جدید فرق دارد؛ انتخاب صریح لازم است" });
      else ready.push({ field: k, from: v, value: v });
      continue;
    }
    if (k === "acc") {
      const acc = accessoriesOf(v), good = acc.filter((x) => toBom.has(text(x.pt))), bad = acc.filter((x) => !toBom.has(text(x.pt)));
      if (good.length) ready.push({ field: k, from: v, value: accessoriesText(good), note: bad.length ? `PT ${bad.map((x) => x.pt).join("، ")} در نسخهٔ جدید نیست و منتقل نمی‌شود` : null,
        state: good.some((x) => { const w = fromBom.get(text(x.pt)), n = toBom.get(text(x.pt)); return w && bomSnapshot(w) !== bomSnapshot(n); }) ? "needs_decision" : undefined });
      if (bad.length) blocked.push({ field: k, reason: "PT_NOT_IN_TARGET", from: bad.map((x) => x.pt).join(", ") });
      continue;
    }
    if (k === "spool") { if (toSpools.size && !toSpools.has(v)) { blocked.push({ field: k, reason: "SPOOL_NOT_IN_TARGET", from: v }); continue; } }
    ready.push({ field: k, from: v, value: v });
  }
  return { ready: ready.map((r) => ({ state: "ready", ...r })), blocked };
}

export function diffRevisions({ from = {}, to = {}, mappings = [], cutPairs = [] } = {}) {
  const fp = from.payload || {}, tp = to.payload || {};
  const fromItems = effectiveItems(fp).items, toItems = effectiveItems(tp).items;
  const fromBom = bomMap(fp.bom), toBom = bomMap(tp.bom);
  const changes = [];
  const push = (c) => { changes.push({ id: c.id, category: c.category, cls: c.cls || null, kind: c.kind, fromUid: c.fromUid || null, toUid: c.toUid || null, fromNo: c.fromNo ?? null, toNo: c.toNo ?? null,
    label: c.label, fields: c.fields || [], reason: c.reason || null, deps: c.deps || [], carry: c.carry || null, action: c.action || null, requiresReview: Boolean(c.requiresReview), candidates: c.candidates || undefined }); };

  // ── identity mapping (explicit only) ───────────────────────────────────
  const mapF2T = new Map(), mapT2F = new Map();
  for (const m of mappings) { mapF2T.set(String(m.fromUid).toLowerCase(), String(m.toUid).toLowerCase()); mapT2F.set(String(m.toUid).toLowerCase(), String(m.fromUid).toLowerCase()); }
  const toByKey = new Map(toItems.map((m) => [keyOf(m), m])), fromByKey = new Map(fromItems.map((m) => [keyOf(m), m]));
  const toWeldUids = new Set(toItems.filter((m) => cls(m) === "weld").map(keyOf));
  const toSpools = new Set(toItems.filter((m) => cls(m) === "spool").map((m) => text(m.no)));
  const toSpoolUids = new Set(toItems.filter((m) => cls(m) === "spool").map(keyOf));
  const ctx = { mapTo: (u) => mapF2T.get(String(u).toLowerCase()) || null, toWeldUids, toSpools, toSpoolUids };

  // ── metadata ───────────────────────────────────────────────────────────
  const metaKeys = new Set([...Object.keys(fp.meta || {}), ...Object.keys(tp.meta || {})]);
  for (const k of metaKeys) {
    const a = text(fp.meta?.[k]), b = text(tp.meta?.[k]);
    push({ id: `meta:${k}`, category: "metadata", kind: a === b ? "unchanged" : "modified", label: `مشخصات نقشه · ${k}`, fields: a === b ? [] : [{ field: k, label: k, from: a || null, to: b || null }],
      reason: a === b ? null : "مقدار در دو رویژن فرق دارد", action: a === b ? null : "review" });
  }
  for (const k of new Set([...Object.keys(fp.lineData || {}), ...Object.keys(tp.lineData || {})])) {
    const a = text(fp.lineData?.[k]), b = text(tp.lineData?.[k]);
    if (a !== b) push({ id: `meta:line:${k}`, category: "metadata", kind: "modified", label: `مشخصات خط · ${k}`, fields: [{ field: k, label: k, from: a || null, to: b || null }], action: "review" });
  }

  // ── marks (welds, spools, supports, equipment) ─────────────────────────
  for (const klass of CLASSES) {
    const F = fromItems.filter((m) => cls(m) === klass), T = toItems.filter((m) => cls(m) === klass);
    const usedT = new Set(), usedF = new Set(), pairs = [];
    for (const f of F) {
      const t = toByKey.get(mapF2T.get(keyOf(f)));
      if (t && cls(t) === klass) { pairs.push({ f, t, how: "mapped" }); usedF.add(keyOf(f)); usedT.add(keyOf(t)); }
    }
    const remF = F.filter((m) => !usedF.has(keyOf(m))), remT = T.filter((m) => !usedT.has(keyOf(m)));
    const groupBy = (list) => { const g = new Map(); for (const m of list) { const n = numKey(m); g.set(n, [...(g.get(n) || []), m]); } return g; };
    const gF = groupBy(remF), gT = groupBy(remT);
    for (const [n, fs] of gF) {
      const ts = gT.get(n) || [];
      if (n && fs.length === 1 && ts.length === 1) { pairs.push({ f: fs[0], t: ts[0], how: "candidate" }); usedF.add(keyOf(fs[0])); usedT.add(keyOf(ts[0])); }
      else if (ts.length && (fs.length > 1 || ts.length > 1 || !n)) {
        for (const x of fs) usedF.add(keyOf(x)); for (const x of ts) usedT.add(keyOf(x));
        push({ id: `${klass}:ambiguous:${n || "?"}`, category: CAT[klass], cls: klass, kind: "ambiguous", fromNo: n, toNo: n, label: `${LABEL[klass]} «${n || "بدون شماره"}» — تطبیق مبهم`,
          reason: `${fs.length} مورد قدیمی و ${ts.length} مورد جدید همین شمارهٔ چاپی را دارند؛ هیچ‌کدام خودکار به هم وصل نمی‌شوند`, requiresReview: true, action: "resolve",
          fields: [], candidates: { from: fs.map((x) => ({ uid: keyOf(x), no: text(x.no), view: view(x) })), to: ts.map((x) => ({ uid: keyOf(x), no: text(x.no), view: view(x) })) } });
      }
    }
    for (const { f, t, how } of pairs) {
      const fv = view(f), tv = view(t);
      if (klass === "equipment") { fv.weldRefs = weldRefsOf(f.attrs?.weldRefs).join(","); tv.weldRefs = weldRefsOf(t.attrs?.weldRefs).join(","); }
      const fields = compareFields(klass, fv, tv, ctx.mapTo);
      const plan = carryPlan(klass, fv, tv, toBom, fromBom, ctx);
      const geo = !near(f.x, t.x) || !near(f.y, t.y) ? { from: isPlaced(f) ? { x: f.x, y: f.y } : null, to: isPlaced(t) ? { x: t.x, y: t.y } : null } : null;
      const modified = fields.length > 0;
      push({ id: `${klass}:${keyOf(f)}`, category: CAT[klass], cls: klass, kind: how === "candidate" ? "candidate" : modified ? "modified" : "unchanged", fromUid: keyOf(f), toUid: keyOf(t), fromNo: text(f.no), toNo: text(t.no),
        label: `${LABEL[klass]} ${text(t.no) || text(f.no)}`, fields, requiresReview: how === "candidate", action: how === "candidate" ? "confirm" : plan.ready.length ? "carry" : modified ? "review" : null,
        reason: how === "candidate" ? "همین شمارهٔ چاپی در هر دو رویژن یکتاست؛ فقط پیشنهاد است و با تأیید صریح شما به هم وصل می‌شود" : null,
        carry: { ready: plan.ready, blocked: plan.blocked } });
      if (geo) push({ id: `geo:${klass}:${keyOf(f)}`, category: "geometry", cls: klass, kind: "modified", fromUid: keyOf(f), toUid: keyOf(t), fromNo: text(f.no), toNo: text(t.no), label: `جای ${LABEL[klass]} ${text(t.no) || text(f.no)} روی نقشه`,
        fields: [{ field: "position", label: "موقعیت", from: geo.from ? `${geo.from.x.toFixed(3)}, ${geo.from.y.toFixed(3)}` : null, to: geo.to ? `${geo.to.x.toFixed(3)}, ${geo.to.y.toFixed(3)}` : null }], action: "review", reason: "هندسه هیچ‌وقت منتقل نمی‌شود و برای تطبیق هویت استفاده نمی‌شود" });
    }
    for (const f of F) if (!usedF.has(keyOf(f))) push({ id: `${klass}:${keyOf(f)}`, category: CAT[klass], cls: klass, kind: "removed", fromUid: keyOf(f), fromNo: text(f.no), label: `${LABEL[klass]} ${text(f.no)}`,
      fields: [], reason: "در رویژن جدید معادلی ندارد", deps: dependentsOf(f, fromItems, from), requiresReview: true, action: "review" });
    for (const t of T) if (!usedT.has(keyOf(t))) push({ id: `${klass}:new:${keyOf(t)}`, category: CAT[klass], cls: klass, kind: "added", toUid: keyOf(t), toNo: text(t.no), label: `${LABEL[klass]} ${text(t.no)}`, fields: [], reason: "در رویژن قبلی معادلی ندارد" });
  }


  // ── cut pieces (Phase 9). Identity: an explicit pair (stored with the carry operation that confirmed it) — nothing else. A unique printed
  // piece number on both sides is only a CANDIDATE; several are AMBIGUOUS; a length, a position or a size never pairs anything. ─────────
  {
    const lcu = (u) => (isUid(u) ? u.toLowerCase() : null);
    const fc = Array.isArray(fp.cutLengths) ? fp.cutLengths : [], tc = Array.isArray(tp.cutLengths) ? tp.cutLengths : [];
    const ck = (c, i) => lcu(c?.uid) || `i${i}`;
    const FT = new Map(), TF = new Map();
    for (const q of cutPairs) { FT.set(String(q.fromUid).toLowerCase(), String(q.toUid).toLowerCase()); TF.set(String(q.toUid).toLowerCase(), String(q.fromUid).toLowerCase()); }
    const tcBy = new Map(tc.map((c, i) => [ck(c, i), c])), usedF = new Set(), usedT = new Set(), pairs = [];
    fc.forEach((c, i) => { const t = tcBy.get(FT.get(ck(c, i))); if (lcu(c.uid) && t) { pairs.push({ f: c, t, how: "mapped" }); usedF.add(ck(c, i)); usedT.add(ck(t, tc.indexOf(t))); } });
    const remF = fc.map((c, i) => [c, i]).filter(([c, i]) => !usedF.has(ck(c, i))), remT = tc.map((c, i) => [c, i]).filter(([c, i]) => !usedT.has(ck(c, i)));
    const grp = (list) => { const g = new Map(); for (const [c] of list) { const n = text(c.piece); g.set(n, [...(g.get(n) || []), c]); } return g; };
    const gF = grp(remF), gT = grp(remT);
    for (const [n, fs] of gF) {
      const ts = gT.get(n) || [];
      if (n && fs.length === 1 && ts.length === 1 && lcu(fs[0].uid) && lcu(ts[0].uid)) { pairs.push({ f: fs[0], t: ts[0], how: "candidate" }); usedF.add(ck(fs[0], fc.indexOf(fs[0]))); usedT.add(ck(ts[0], tc.indexOf(ts[0]))); }
      else if (ts.length) {
        for (const x of fs) usedF.add(ck(x, fc.indexOf(x))); for (const x of ts) usedT.add(ck(x, tc.indexOf(x)));
        const cv = (x) => ({ no: text(x.piece), lengthMm: x.lengthMm ?? null, ns: text(x.ns) || null });
        push({ id: `cut:ambiguous:${n || "?"}`, category: "cut", cls: "cut", kind: "ambiguous", fromNo: n, toNo: n, label: `قطعهٔ برش «${n || "بدون شماره"}» — تطبیق مبهم`,
          reason: `${fs.length} قطعهٔ قدیمی و ${ts.length} قطعهٔ جدید همین شمارهٔ چاپی را دارند (یا شناسه ندارند)؛ هیچ‌کدام خودکار به هم وصل نمی‌شوند`, requiresReview: true, action: "resolve", fields: [],
          candidates: { from: fs.map((x) => ({ uid: lcu(x.uid), no: text(x.piece), view: cv(x) })), to: ts.map((x) => ({ uid: lcu(x.uid), no: text(x.piece), view: cv(x) })) } });
      }
    }
    const mapW = (u) => mapF2T.get(String(u).toLowerCase()) || null;
    const mapOf = { weld: mapW, spool: mapW };
    const toUidSet = { weld: new Set(toItems.filter((m) => cls(m) === "weld").map(keyOf)), spool: new Set(toItems.filter((m) => cls(m) === "spool").map(keyOf)) };
    const CF = { piece: "شمارهٔ قطعه", lengthMm: "طول برش", ns: "N.S.", material: "جنس", schedule: "Sch", angle: "زاویه", note: "توضیح", from: "سرجوش ابتدا", to: "سرجوش انتها", spool: "اسپول" };
    for (const { f, t, how } of pairs) {
      const fields = [], ready = [], blocked = [];
      for (const k of ["piece", "lengthMm", "ns", "material", "schedule", "angle", "note"]) if (text(f[k]) !== text(t[k])) fields.push({ field: k, label: CF[k], from: text(f[k]) || null, to: text(t[k]) || null });
      for (const [k, [key, klass]] of Object.entries(CUT_REF)) {
        const fu = lcu(f[key]), tu = lcu(t[key]), mapped = fu ? mapOf[klass](fu) : null;
        if (fu && mapped && tu && mapped !== tu) fields.push({ field: k, label: CF[k], from: text(f[k]) || fu, to: text(t[k]) || tu, note: "نگاشت صریح، سرجوش/اسپول دیگری را نشان می‌دهد" });
        else if (fu && !tu && !mapped) fields.push({ field: k, label: CF[k], from: text(f[k]) || fu, to: null });
        else if (!fu && !tu && text(f[k]) !== text(t[k])) fields.push({ field: k, label: CF[k], from: text(f[k]) || null, to: text(t[k]) || null });
      }
      const carryable = ["ns", "material", "schedule", "angle", "note"];
      for (const k of carryable) { const v = text(f[k]); if (!v) continue; if (text(t[k])) { if (text(t[k]) !== v) blocked.push({ field: k, reason: "TARGET_HAS_VALUE", from: v, to: text(t[k]) }); } else ready.push({ field: k, from: v, value: v }); }
      for (const [k, [key, klass]] of Object.entries(CUT_REF)) {
        const fu = lcu(f[key]); if (!fu) continue;
        if (lcu(t[key])) { if (mapOf[klass](fu) !== lcu(t[key])) blocked.push({ field: k, reason: "TARGET_HAS_VALUE", from: text(f[k]) || fu, to: text(t[k]) }); continue; }
        const m = mapOf[klass](fu);
        if (!m) blocked.push({ field: k, reason: klass === "weld" ? "NO_MAPPED_WELD" : "NO_MAPPED_SPOOL", from: text(f[k]) || fu });
        else if (!toUidSet[klass].has(m)) blocked.push({ field: k, reason: klass === "weld" ? "WELD_NOT_IN_TARGET" : "SPOOL_NOT_IN_TARGET", from: text(f[k]) || fu });
        else ready.push({ field: k, from: text(f[k]) || fu, value: m });
      }
      // a piece whose two ends would be the same weld in the target is not offered
      const toEnd = (k) => lcu(t[CUT_REF[k][0]]) || ready.find((r) => r.field === k)?.value || null;
      if (toEnd("from") && toEnd("from") === toEnd("to") && ready.some((r) => r.field === "from" || r.field === "to")) {
        for (const k of ["from", "to"]) { const i = ready.findIndex((r) => r.field === k); if (i >= 0) { ready.splice(i, 1); blocked.push({ field: k, reason: "SAME_END" }); } }
      }
      const modified = fields.length > 0;
      push({ id: `cut:${ck(f, fc.indexOf(f))}`, category: "cut", cls: "cut", kind: how === "candidate" ? "candidate" : modified ? "modified" : "unchanged", fromUid: lcu(f.uid), toUid: lcu(t.uid), fromNo: text(f.piece), toNo: text(t.piece),
        label: `قطعهٔ برش ${text(t.piece) || text(f.piece)}`, fields, requiresReview: how === "candidate", action: how === "candidate" ? "confirm" : ready.length ? "carry" : modified ? "review" : null,
        reason: how === "candidate" ? "همین شمارهٔ قطعه در هر دو رویژن یکتاست؛ فقط پیشنهاد است و با تأیید صریح شما به هم وصل می‌شود" : null, carry: { ready: ready.map((r) => ({ state: "ready", ...r })), blocked } });
    }
    for (const [c, i] of remF) if (!usedF.has(ck(c, i))) push({ id: `cut:${ck(c, i)}`, category: "cut", cls: "cut", kind: "removed", fromUid: lcu(c.uid), fromNo: text(c.piece), label: `قطعهٔ برش ${text(c.piece)}`, fields: [], reason: "در رویژن جدید معادلی ندارد", requiresReview: true, action: "review" });
    for (const [c, i] of remT) if (!usedT.has(ck(c, i))) push({ id: `cut:new:${ck(c, i)}`, category: "cut", cls: "cut", kind: "added", toUid: lcu(c.uid), toNo: text(c.piece), label: `قطعهٔ برش ${text(c.piece)}`, fields: [], reason: "در رویژن قبلی معادلی ندارد" });
  }

  // ── a mapped weld whose SPOOL (by identity) changed: the relationship, not just the printed label ────────────────────────────────
  for (const c of [...changes]) {
    if ((c.cls !== "weld" && c.cls !== "equipment") || c.category === "geometry" || c.category === "identity" || !c.fromUid || !c.toUid || c.kind === "candidate" || c.kind === "ambiguous") continue;
    const f = fromByKey.get(c.fromUid), t = toByKey.get(c.toUid);
    const fs = isUid(f?.attrs?.spoolUid) ? f.attrs.spoolUid.toLowerCase() : null, ts = isUid(t?.attrs?.spoolUid) ? t.attrs.spoolUid.toLowerCase() : null;
    const mapped = fs ? mapF2T.get(fs) : null;
    if (fs && mapped && ts && mapped !== ts) push({ id: `rel:spool:${c.fromUid}`, category: "spool", cls: c.cls, kind: "modified", fromUid: c.fromUid, toUid: c.toUid, fromNo: c.fromNo, toNo: c.toNo, label: `اسپولِ ${c.cls === "equipment" ? "تجهیز" : "سرجوش"} ${c.toNo || c.fromNo} عوض شده`,
      fields: [{ field: "spoolUid", label: "اسپول (با شناسه)", from: text(f.attrs?.spool) || fs, to: text(t.attrs?.spool) || ts }], action: "review", reason: "ارتباط سرجوش با اسپول با شناسه مقایسه شد (نگاشت صریح اسپول‌ها)" });
  }

  // ── BOM (per PT) with the allocation impact ────────────────────────────
  const ledgerRows = new Map((from.ledger?.rows || []).map((r) => [String(r.pt), r]));
  const usesPt = (pt) => toItems.filter((m) => (cls(m) === "weld" && (text(m.attrs?.c1) === pt || text(m.attrs?.c2) === pt)) || (cls(m) === "equipment" && (text(m.attrs?.c1) === pt || accessoriesOf(m.attrs?.acc).some((x) => text(x.pt) === pt))));
  for (const pt of [...new Set([...fromBom.keys(), ...toBom.keys()])].sort((a, b) => Number(a) - Number(b))) {
    const a = fromBom.get(pt), b = toBom.get(pt), L = ledgerRows.get(pt);
    const held = L ? { reserved: (L.weldReserved || 0) + (L.reserved || 0), installed: (L.weldInstalled || 0) + (L.installed || 0) } : { reserved: 0, installed: 0 };
    const label = `BOM PT ${pt}`;
    if (a && !b) {
      const users = usesPt(pt);
      push({ id: `bom:${pt}`, category: "bom", kind: "removed", label, fromNo: `PT ${pt}`, fields: [{ field: "row", label: "ردیف", from: bomSnapshot(a), to: null }], requiresReview: true, action: "review",
        reason: held.reserved + held.installed ? "PT حذف شده ولی در رویژن قبلی تخصیص/نصب دارد؛ آن تاریخچه در همان رویژن می‌ماند و چیزی آزاد نمی‌شود" : "PT در رویژن جدید نیست",
        deps: users.map((m) => `${LABEL[cls(m)]} ${text(m.no)} در رویژن جدید به PT ${pt} ارجاع می‌دهد`) });
    } else if (!a && b) push({ id: `bom:${pt}`, category: "bom", kind: "added", label, toNo: `PT ${pt}`, fields: [], reason: "PT در رویژن قبلی نبود (شمارهٔ مشابه هویت مشابه نیست)" });
    else {
      const fl = [["description", "شرح"], ["qty", "تعداد"], ["qtyUnit", "واحد"], ["diam", "قطر"], ["material", "جنس"], ["group", "گروه"]].filter(([k]) => text(a[k] ?? (k === "diam" ? a.size : undefined)) !== text(b[k] ?? (k === "diam" ? b.size : undefined)))
        .map(([k, l]) => ({ field: k, label: l, from: text(a[k] ?? (k === "diam" ? a.size : undefined)) || null, to: text(b[k] ?? (k === "diam" ? b.size : undefined)) || null }));
      const notes = [];
      const q = Number(b.qty);
      if (fl.some((x) => x.field === "qty") && Number.isFinite(q) && held.reserved + held.installed > q) notes.push(`تعداد جدید (${q}) از تخصیص/نصب قبلی (${held.reserved + held.installed}) کمتر است؛ تاریخچهٔ قبلی دست‌نخورده می‌ماند و رویژن جدید تقاضای تازهٔ خودش را دارد`);
      push({ id: `bom:${pt}`, category: "bom", kind: fl.length ? "modified" : "unchanged", label, fromNo: `PT ${pt}`, toNo: `PT ${pt}`, fields: fl, deps: notes, requiresReview: fl.some((x) => ["description", "diam", "material", "qtyUnit"].includes(x.field)), action: fl.length ? "review" : null });
    }
    if (L && (held.reserved || held.installed)) push({ id: `alloc:${pt}`, category: "allocation", kind: b ? (a && !b ? "removed" : "modified") : "removed", label: `اثر تخصیص · PT ${pt}`, fromNo: `PT ${pt}`, toNo: b ? `PT ${pt}` : null,
      fields: [{ field: "held", label: "رزرو / نصب‌شده در رویژن قبلی", from: `${held.reserved} / ${held.installed}`, to: null }], reason: "تخصیص و تاریخچهٔ نصب فقط به رویژن قبلی تعلق دارد؛ با رویژن جدید منتقل، آزاد یا دوباره ثبت نمی‌شود", action: null });
  }

  // identity changes (a mapped pair whose printed number moved is worth a line of its own)
  for (const c of [...changes]) if (c.kind !== "ambiguous" && c.fromUid && c.toUid && c.fromNo !== c.toNo && c.category !== "geometry")
    push({ id: `id:${c.id}`, category: "identity", cls: c.cls, kind: "modified", fromUid: c.fromUid, toUid: c.toUid, fromNo: c.fromNo, toNo: c.toNo, label: `شمارهٔ ${LABEL[c.cls]} عوض شده`, fields: [{ field: "no", label: "شماره", from: c.fromNo, to: c.toNo }], reason: "هویت با uid و نگاشت صریح حفظ می‌شود، نه با شماره" });

  const summary = { total: changes.length, byKind: {}, byCategory: {}, requiresReview: changes.filter((c) => c.requiresReview).length, carryable: changes.filter((c) => c.carry?.ready?.length && c.kind !== "candidate").length };
  for (const c of changes) { summary.byKind[c.kind] = (summary.byKind[c.kind] || 0) + 1; summary.byCategory[c.category] = (summary.byCategory[c.category] || 0) + 1; }
  return { changes, summary };
}

/** What in the SOURCE revision hangs on an item that has no equivalent now (shown with a removed item). */
function dependentsOf(m, items, from) {
  const out = [], uid = keyOf(m);
  if (cls(m) === "weld") {
    for (const e of items.filter((x) => cls(x) === "equipment")) if (weldRefsOf(e.attrs?.weldRefs).includes(uid)) out.push(`تجهیز ${text(e.no)} در رویژن قبلی به آن وصل بود`);
    for (const l of from.ledger?.lines || []) if (String(l.ownerRef).toLowerCase() === uid) out.push(`تخصیص ${l.status} PT ${l.pt} در دفتر رویژن قبلی (می‌ماند)`);
  }
  if (cls(m) === "equipment") {
    const st = (from.equipment || []).find((e) => String(e.markId).toLowerCase() === uid);
    if (st && st.status !== "planned") out.push(`وضعیت «${st.status}» در دفتر رویژن قبلی (می‌ماند)`);
  }
  return out;
}

/**
 * Apply a set of per-item field choices to a COPY of the target payload.
 * @param {object} payload  the target payload
 * @param {Array<{ klass, toUid, values: {field: value} }>} edits
 */
export function applyCarry(payload, edits) {
  const p = JSON.parse(JSON.stringify(payload || {}));
  const toBom = bomMap(p.bom);
  const noOf = (uid) => { const r = (p.weldList || []).find((x) => isUid(x?.uid) && x.uid.toLowerCase() === uid) || (p.sheetMarkup?.items || []).find((m) => keyOf(m) === uid); return text(r?.no); };
  const spoolPatch = (v) => ({ spoolUid: v, spool: noOf(String(v).toLowerCase()) });
  for (const { klass, toUid, values } of edits) {
    if (klass === "cut") {
      const c = (p.cutLengths || []).find((x) => isUid(x?.uid) && x.uid.toLowerCase() === toUid);
      if (!c) continue;
      for (const [k, v] of Object.entries(values)) {
        if (CUT_REF[k]) { c[CUT_REF[k][0]] = v; c[k] = noOf(v) || c[k] || ""; } else c[k] = v;
      }
      continue;
    }
    const rowIdx = klass === "weld" && Array.isArray(p.weldList) ? p.weldList.findIndex((r) => isUid(r?.uid) && r.uid.toLowerCase() === toUid) : -1;
    const itemIdx = (p.sheetMarkup?.items || []).findIndex((m) => keyOf(m) === toUid);
    for (const [k, v] of Object.entries(values)) {
      if (k === "spool" && isUid(v)) {       // a spool carried by identity: the target's own uid + its current printed number
        if (rowIdx >= 0) Object.assign(p.weldList[rowIdx], spoolPatch(v));
        else if (itemIdx >= 0) { const it = p.sheetMarkup.items[itemIdx]; it.attrs = { ...(it.attrs || {}), ...spoolPatch(v) }; }
        continue;
      }
      const snap = PT_FIELDS.has(k) ? bomSnapshot(toBom.get(text(v))) : null;
      if (rowIdx >= 0) { p.weldList[rowIdx][k] = v; if (snap != null) p.weldList[rowIdx][`${k}s`] = snap; }
      else if (itemIdx >= 0) { const it = p.sheetMarkup.items[itemIdx]; it.attrs = { ...(it.attrs || {}), [k]: v }; if (snap != null) it.attrs[`${k}s`] = snap; }
    }
  }
  return p;
}
