/**
 * The identity of a mark on a sheet (pure; no database, runs in the browser and on the server).
 *
 * A mark has four things people call "its id", and they are not the same:
 *
 *   uid   the PERSISTENT identity: a UUID, born with the mark, never changed — not by moving it, editing it, renumbering it,
 *         normalising or serialising it, re-extracting the sheet or correcting the register. Equipment, accessories and
 *         BOM allocations refer to a mark by this (and only by this, once the mark has one).
 *   id    the LEGACY handle: "m1", "m2"… handed out in list order. The page uses it as the key of a row and for selection.
 *         It is NOT stable (a re-extraction numbers the list again) and nothing operational may rest on it.
 *   no    the number the sheet prints ("W-01", "SP-3"). People edit it; it is not an identity.
 *   the drawing revision (document) the mark belongs to. A uid is registered to ONE document and never shared across revisions:
 *         a new revision's marks are new marks (operational ownership is per revision).
 *
 * `reconcileMarks` decides, when a sheet is read again, which new mark is which saved mark. It matches on what an
 * engineer would: the class of the mark and its printed number, then its attributes — never its position alone. Where that
 * does not give one clear answer it says so (`ambiguous`) and gives the new mark a NEW identity rather than lend an old one.
 */
import { KINDS, plainNo } from "./markup.mjs";

const text = (v) => String(v ?? "").trim();
export const UID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUid = (v) => typeof v === "string" && UID_RE.test(v);

/** A new persistent identity. */
export function newUid() {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** What operational records refer to a mark by: its uid, or — for a mark that has none yet — its legacy id. */
export const ownerKey = (m) => (isUid(m?.uid) ? m.uid : text(m?.id));

/** The class a mark's kind belongs to: weld / spool / support / equipment. */
export const markClass = (m) => KINDS[m?.kind]?.cls || null;

/** Give every mark without a valid uid a new one; a uid already used earlier in the list is not given twice. */
export function ensureUids(items) {
  const seen = new Set();
  return (items || []).map((m) => {
    if (isUid(m?.uid) && !seen.has(m.uid)) { seen.add(m.uid); return m; }
    let uid = newUid();
    while (seen.has(uid)) uid = newUid();
    seen.add(uid);
    return { ...m, uid };
  });
}

const sig = (m) => [m.kind, text(m.attrs?.size), text(m.attrs?.type), text(m.attrs?.spool)].join("|");
const sizeConflict = (a, b) => text(a.attrs?.size) && text(b.attrs?.size) && text(a.attrs.size) !== text(b.attrs.size);
const keyOf = (m) => `${markClass(m)}|${plainNo(m.no)}`;

/**
 * Which new mark is which saved mark.
 *
 * @param {object[]} o.previous    the marks saved before (with or without uids)
 * @param {object[]} o.incoming    the marks now
 * @param {(legacyId: string) => string} o.legacyUid  the uid a saved mark WITHOUT one has had since migration 105 (deterministic)
 * @returns {{ items: object[], report: { kept: number, matched: object[], created: object[], removed: object[], ambiguous: object[] } }}
 *   items: the incoming marks, every one with a uid.
 *     · a mark whose uid is a saved mark's keeps it (it carries its identity);
 *     · a mark from the engine (or with no uid) that is the saved mark of the same class and number — uniquely, with no
 *       conflicting size, or told apart by kind/size/type/spool — takes that mark's uid (`matched`);
 *     · any other mark with no uid gets a new one (`created`);
 *     · where several saved marks could be it, or it could be several, nothing is lent: new uids (`ambiguous` names both sides).
 *   removed: saved marks nothing now claims. Their uids are NOT given to anything else.
 */
export function reconcileMarks({ previous = [], incoming = [], legacyUid }) {
  const prev = (previous || []).filter((m) => m && markClass(m)).map((m) => ({ ...m, uid: isUid(m.uid) ? m.uid : (text(m.id) ? legacyUid(text(m.id)) : null) })).filter((m) => m.uid);
  const prevByUid = new Map(prev.map((m) => [m.uid, m]));
  const report = { kept: 0, matched: [], created: [], removed: [], ambiguous: [] };
  const seen = new Set();
  const out = (incoming || []).map((m) => ({ ...m }));

  // 1. a uid that is a saved mark's identity is that mark (once: a second mark carrying it is a copy and gets its own)
  const open = [];
  out.forEach((m, i) => {
    if (isUid(m.uid) && prevByUid.has(m.uid) && !seen.has(m.uid)) { seen.add(m.uid); report.kept += 1; return; }
    const fromEngine = m.src === "engine" || m.src === "model";
    // a hand-made mark with a uid nobody knows is a new mark that has already been given its identity (a copy, a typed row)
    if (isUid(m.uid) && !seen.has(m.uid) && !prevByUid.has(m.uid) && !fromEngine) { seen.add(m.uid); report.created.push({ no: text(m.no), uid: m.uid }); return; }
    delete m.uid;
    open.push(i);
  });

  // 2. the rest are matched against the saved marks nobody claimed
  const unclaimed = prev.filter((p) => !seen.has(p.uid));
  const byKeyPrev = new Map(), byKeyNew = new Map();
  for (const p of unclaimed) { const k = keyOf(p); (byKeyPrev.get(k) || byKeyPrev.set(k, []).get(k)).push(p); }
  for (const i of open) { const k = keyOf(out[i]); (byKeyNew.get(k) || byKeyNew.set(k, []).get(k)).push(i); }
  const taken = new Set();
  const take = (i, p) => { out[i].uid = p.uid; taken.add(p.uid); seen.add(p.uid); report.matched.push({ no: text(out[i].no), uid: p.uid, from: text(p.no) }); };
  for (const [k, idxs] of byKeyNew) {
    const ps = byKeyPrev.get(k) || [];
    if (!ps.length) continue;
    if (ps.length === 1 && idxs.length === 1 && !sizeConflict(ps[0], out[idxs[0]])) { take(idxs[0], ps[0]); continue; }
    // several on one side: only an exact, one-to-one attribute match is trusted
    const left = [];
    for (const i of idxs) {
      const same = ps.filter((p) => !taken.has(p.uid) && sig(p) === sig(out[i]));
      const rivals = idxs.filter((j) => j !== i && sig(out[j]) === sig(out[i]));
      if (same.length === 1 && !rivals.length) take(i, same[0]); else left.push(i);
    }
    if (left.length) report.ambiguous.push({ key: k, no: text(out[left[0]].no), incoming: left.map((i) => ({ id: text(out[i].id), no: text(out[i].no) })),
      previous: ps.filter((p) => !taken.has(p.uid)).map((p) => ({ uid: p.uid, no: text(p.no) })) });
  }

  // 3. whatever is still without an identity is new
  const ambiguousIdx = new Set(report.ambiguous.flatMap((a) => a.incoming.map((x) => x.id)));
  for (const i of open) {
    if (out[i].uid) continue;
    let uid = newUid();
    while (seen.has(uid)) uid = newUid();
    seen.add(uid); out[i].uid = uid;
    if (!ambiguousIdx.has(text(out[i].id)) || !text(out[i].id)) report.created.push({ no: text(out[i].no), uid });
    else report.created.push({ no: text(out[i].no), uid, ambiguous: true });
  }
  report.removed = prev.filter((p) => !seen.has(p.uid)).map((p) => ({ uid: p.uid, no: text(p.no), kind: p.kind }));
  return { items: out, report };
}
