/**
 * Compare two independent readings of the same sheet.
 *
 * A model that reads a number wrong reads it wrong with total confidence, so
 * one reading cannot grade itself. Two readings (a different model, or the
 * same one run again) disagree exactly where the print is hard to read, and
 * that is where a person should look. Pure data in, plain strings out: this
 * decides nothing about which reading is right, it only names the number.
 *
 * Nodes are matched by position, not by id: two readings number the same
 * fittings differently.
 */
const TOL_MM = 2;
const MAX_ISSUES = 12;

const pos = (n) => `(${Math.round(n.E)}, ${Math.round(n.N)}, ${Math.round(n.EL)})`;
const finite = (n) => n && [n.E, n.N, n.EL].every((v) => typeof v === "number" && isFinite(v));
const dist = (a, b) => Math.hypot(a.E - b.E, a.N - b.N, a.EL - b.EL);
const word = (n) => `${n.type || "?"}${n.ref ? " " + n.ref : ""}`;

function compareNodes(a, b, issues) {
  const A = (a || []).filter(finite), B = (b || []).filter(finite);
  if (!A.length || !B.length) return;
  const taken = new Set();
  const pairs = [];
  for (const n of A) {
    let best = -1, bd = Infinity;
    B.forEach((m, j) => {
      if (taken.has(j)) return;
      const d = dist(n, m);
      if (d < bd) { bd = d; best = j; }
    });
    if (best >= 0 && bd <= TOL_MM) { taken.add(best); pairs.push([n, B[best]]); }
  }
  // two readings that share almost nothing do not share a frame (a different
  // origin, a sheet read from another corner): one line says so, not fifty
  if (pairs.length < 0.3 * Math.max(A.length, B.length)) {
    issues.push(`مختصات دو خوانش هم‌چارچوب نیست (${pairs.length} گره از ${Math.max(A.length, B.length)} روی هم افتاد)`);
    return;
  }
  for (const [n, m] of pairs) {
    if (n.type !== m.type) issues.push(`گره ${pos(n)}: خوانش اول ${n.type}، خوانش دوم ${m.type}`);
  }
  const matchedA = new Set(pairs.map(([n]) => n));
  for (const n of A) if (!matchedA.has(n)) issues.push(`گره ${word(n)} ${pos(n)} فقط در خوانش اول است`);
  B.forEach((m, j) => { if (!taken.has(j)) issues.push(`گره ${word(m)} ${pos(m)} فقط در خوانش دوم است`); });
}

function compareBom(a, b, issues) {
  const key = (r) => String(r.pt ?? r.stockCode ?? r.description ?? "").trim();
  const mapOf = (rows) => new Map((rows || []).filter((r) => key(r)).map((r) => [key(r), r]));
  const A = mapOf(a), B = mapOf(b);
  if (!A.size || !B.size) return;
  for (const [k, r] of A) {
    const m = B.get(k);
    if (!m) { issues.push(`BOM ردیف ${k} فقط در خوانش اول است`); continue; }
    if (Number(r.qty) !== Number(m.qty)) issues.push(`BOM ردیف ${k}: مقدار ${r.qty} در خوانش اول، ${m.qty} در دوم`);
    if (Number(r.diam) !== Number(m.diam)) issues.push(`BOM ردیف ${k}: سایز ${r.diam}" در خوانش اول، ${m.diam}" در دوم`);
  }
  for (const k of B.keys()) if (!A.has(k)) issues.push(`BOM ردیف ${k} فقط در خوانش دوم است`);
}

function compareCuts(a, b, issues) {
  const mapOf = (rows) => new Map((rows || []).filter((r) => r && r.piece != null).map((r) => [String(r.piece), r]));
  const A = mapOf(a), B = mapOf(b);
  for (const [k, r] of A) {
    const m = B.get(k);
    if (m && Math.abs(Number(r.lengthMm) - Number(m.lengthMm)) > 1) {
      issues.push(`طول برش ${k}: ${r.lengthMm} mm در خوانش اول، ${m.lengthMm} mm در دوم`);
    }
  }
}

/**
 * @param first   {nodes, bom, cutLengths} from the first reading
 * @param second  the same shape from the second reading
 * @returns {{agree: boolean, issues: string[]}}
 */
export function compareReads(first, second) {
  const issues = [];
  compareNodes(first?.nodes, second?.nodes, issues);
  compareBom(first?.bom, second?.bom, issues);
  compareCuts(first?.cutLengths, second?.cutLengths, issues);
  const extra = issues.length - MAX_ISSUES;
  if (extra > 0) { issues.length = MAX_ISSUES; issues.push(`و ${extra} مورد دیگر`); }
  return { agree: issues.length === 0, issues };
}
