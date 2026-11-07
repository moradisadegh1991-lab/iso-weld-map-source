/**
 * The authoritative dependency check of a spool (pure; docs/audit/phase-10-equipment-spool.md).
 *
 * A spool is a mark of the sheet (`sheetMarkup.items`, kind "spool"); "deleting" it is a save that no longer carries its mark. Everything that
 * names a spool does so BY IDENTITY (`spoolUid`): a typed weld row, a sheet weld mark, a cut piece, an equipment mark. The server runs this on the
 * state it is about to store, inside the save's transaction (lib/db/repos/register-persistence.mjs), so the UI's preview is advice and this is the rule:
 *
 *   a spool whose mark is gone while anything still names its uid REFUSES the save (409 SPOOL_IN_USE, the dependents listed). Nothing is detached,
 *   cleared or re-pointed on the person's behalf: the references are moved or removed first, explicitly, then the spool can go.
 *
 * Equipment that is installed or tested is said as such in the list (its own protection, lib/db/repos/iso-equipment.mjs, stays in force).
 */
import { KINDS } from "../sheet/markup.mjs";
import { isUid } from "../sheet/mark-identity.mjs";

const text = (v) => String(v ?? "").trim();
const lc = (u) => String(u).toLowerCase();
const cls = (m) => KINDS[m?.kind]?.cls;
const FIXED = new Set(["installed", "tested"]);

/** @returns {{ spool, dependents: Array<{ type, uid, no, via, status? , locked? }>, count, locked }} */
export function spoolDependencies(payload, spoolUid) {
  const items = Array.isArray(payload?.sheetMarkup?.items) ? payload.sheetMarkup.items : [];
  const has = (v) => isUid(v) && isUid(spoolUid) && lc(v) === lc(spoolUid);
  const sp = items.find((m) => m.kind === "spool" && isUid(m.uid) && has(m.uid)) || null;
  const out = [], seen = new Set();
  const add = (d) => { const k = `${d.type}:${d.uid || d.no}:${d.via}`; if (!seen.has(k)) { seen.add(k); out.push(d); } };
  for (const r of Array.isArray(payload?.weldList) ? payload.weldList : []) if (has(r?.spoolUid)) add({ type: "weld", uid: isUid(r.uid) ? r.uid : null, no: text(r.no), via: "weldList" });
  for (const m of items) {
    if (cls(m) === "weld" && has(m.attrs?.spoolUid)) add({ type: "weld", uid: isUid(m.uid) ? m.uid : null, no: text(m.no), via: "sheetMarkup" });
    if (cls(m) === "equipment" && has(m.attrs?.spoolUid)) { const st = text(m.attrs?.status) || "planned"; add({ type: "equipment", uid: isUid(m.uid) ? m.uid : null, no: text(m.no), tag: text(m.attrs?.tag), status: st, locked: FIXED.has(st), via: "sheetMarkup" }); }
  }
  for (const c of Array.isArray(payload?.cutLengths) ? payload.cutLengths : []) if (has(c?.spoolUid)) add({ type: "cut", uid: isUid(c.uid) ? c.uid : null, no: text(c.piece), via: "cutLengths" });
  return { spool: sp ? { uid: sp.uid, no: text(sp.no) } : null, dependents: out, count: out.length, locked: out.some((d) => d.locked) };
}

/** The spools the previous marks had and the next marks no longer carry, by identity. */
export function removedSpools(previousItems = [], nextItems = []) {
  const next = new Set((nextItems || []).filter((m) => m?.kind === "spool" && isUid(m.uid)).map((m) => lc(m.uid)));
  return (previousItems || []).filter((m) => m?.kind === "spool" && isUid(m.uid) && !next.has(lc(m.uid))).map((m) => ({ uid: m.uid, no: text(m.no) }));
}

/** Throws 409 SPOOL_IN_USE (structured) when a removed spool is still named. */
export function assertSpoolsRemovable({ previousItems = [], payload }) {
  const gone = removedSpools(previousItems, payload?.sheetMarkup?.items || []);
  const blocked = [];
  for (const s of gone) { const d = spoolDependencies(payload, s.uid); if (d.count) blocked.push({ spool: s, dependents: d.dependents, locked: d.locked }); }
  if (!blocked.length) return;
  const first = blocked[0], n = first.dependents.length;
  const err = new Error(`اسپول ${first.spool.no || first.spool.uid.slice(0, 8)} حذف نمی‌شود: ${n} مورد هنوز به آن اشاره دارد (${first.dependents.slice(0, 4).map((d) => `${{ weld: "سرجوش", equipment: "تجهیز", cut: "قطعهٔ برش" }[d.type]} ${d.no || "؟"}`).join("، ")}${n > 4 ? "، …" : ""}). ابتدا آن‌ها را به اسپول دیگری منتقل یا ارتباطشان را صریحاً بردارید؛ هیچ چیز خودکار جدا نمی‌شود.`);
  throw Object.assign(err, { status: 409, code: "SPOOL_IN_USE", details: { spools: blocked } });
}
