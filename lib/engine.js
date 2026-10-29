import { takeOut, od, isWeldedJoint, bodyHalfLength, INLINE_BODY, BOLTED, boltedPair } from "./standards";
import { reconcileWithBom } from "./bom";
import { DISCLAIMER_FA, DISCLAIMER_EN, approvalLine } from "./disclaimer.mjs";

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const toVec = (n, o) => ({ x: n.E - o.E, y: n.EL - o.EL, z: n.N - o.N });
/** An olet's height off the run, as printed (faceToFace); 0 when not printed — never a table guess (MSS SP-97 keys on sizes and class). */
const oletHeight = (n) => { const h = Number(n?.faceToFace); return Number.isFinite(h) && h > 0 ? h : 0; };
/** Distance from a point to a segment. */
const toSegment = (p, a, b) => {
  const ab = sub(b, a), l2 = ab.x * ab.x + ab.y * ab.y + ab.z * ab.z;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.y - a.y) * ab.y + (p.z - a.z) * ab.z) / l2)) : 0;
  return len(sub(p, add(a, ab, t)));
};

/**
 * Route is a GRAPH, not a chain: a tee has three incident edges, so a linear
 * node list cannot describe it. `edges` is optional — without it the nodes are
 * chained in order, which reproduces the v1 behaviour.
 */
/**
 * The NDT a weld carries until its piping class is known (see the note on
 * `register` below). One rule for a register built from geometry and one
 * typed from a weld list, so the two never disagree about the same weld.
 */
export const provisionalNdt = (loc) => (loc === "Field" ? "RT 100%" : "RT 5% random");

export function buildModel(data, opts = {}) {
  const spoolMaxLen = opts.spoolMaxLen ?? 12000;
  const maxPipeLength = opts.maxPipeLength ?? 12000;
  const WELD_TOL = 2; // mm — two welds at the same point are the same weld

  let rawNodes = (data?.nodes || [])
    .filter((n) => n && n.E != null && n.N != null && n.EL != null)
    .map((n, i) => ({ ...n, id: n.id ?? `N${i + 1}` }));
  if (rawNodes.length < 2) return { error: "حداقل دو گره لازم است (دو سر خط)." };

  const defaultNps = Number(data?.meta?.nps) || Number(rawNodes[0]?.nps) || 0;
  const pup = Number(data?.meta?.pupLength) || 0;

  let rawEdges = Array.isArray(data?.edges) && data.edges.length
    ? data.edges.map((e) => ({ from: e.from, to: e.to, nps: Number(e.nps) || defaultNps }))
    : rawNodes.slice(0, -1).map((n, i) => ({
        from: n.id, to: rawNodes[i + 1].id, nps: Number(rawNodes[i + 1]?.nps) || defaultNps }));

  /* Nothing gets drawn that the bill of material does not buy. */
  const rec = reconcileWithBom(rawNodes, rawEdges, data?.bom, opts.strictBom !== false);
  const nodes = rec.nodes.map((n) => ({ ...n }));
  const ghosted = new Set(rec.ghosted);
  if (nodes.length < 2) {
    return { error: "بعد از تطبیق با MTO کمتر از دو گره باقی ماند — استخراج هندسه قابل اتکا نیست." };
  }

  // An olet (weldolet, sockolet …) sits ON the run pipe: the run goes through it
  // unbroken, so its two collinear run legs are one pipe, joined here into one
  // edge; the olet keeps its branch leg and remembers the run's size, which
  // decides where its branch weld sits (on the run's outside, OD/2 from the
  // centreline). Owner's report 2026-10-29.
  let recEdges = rec.edges;
  {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const vec = (a, b) => unit(toVec(byId.get(b), byId.get(a)));
    for (const n of nodes.filter((x) => x.type === "olet")) {
      const inc = recEdges.filter((e) => e.from === n.id || e.to === n.id);
      const far = (e) => (e.from === n.id ? e.to : e.from);
      let pair = null;
      for (let i = 0; i < inc.length && !pair; i++) for (let j = i + 1; j < inc.length && !pair; j++) {
        const u = vec(n.id, far(inc[i])), v = vec(n.id, far(inc[j]));
        if (byId.get(far(inc[i])) && byId.get(far(inc[j])) && u.x * v.x + u.y * v.y + u.z * v.z < -0.99) pair = [inc[i], inc[j]];
      }
      if (pair) {
        n.runNps = Math.max(Number(pair[0].nps) || 0, Number(pair[1].nps) || 0) || defaultNps;
        recEdges = [...recEdges.filter((e) => !pair.includes(e)), { from: far(pair[0]), to: far(pair[1]), nps: n.runNps }];
      } else {
        n.runNps = Math.max(defaultNps, ...inc.map((e) => Number(e.nps) || 0));
      }
    }
  }

  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = recEdges
    .map((e) => ({ a: idx.get(e.from), b: idx.get(e.to), nps: Number(e.nps) || defaultNps }))
    .filter((e) => e.a != null && e.b != null && e.a !== e.b);
  if (!edges.length) return { error: "هیچ یالی بین گره‌ها تعریف نشده است." };

  const pts = nodes.map((n) => toVec(n, nodes[0]));
  const adj = nodes.map(() => []);
  edges.forEach((e, i) => { adj[e.a].push(i); adj[e.b].push(i); });

  // governing size at each node = largest incident edge
  const nodeNps = nodes.map((_, i) => adj[i].reduce((m, ei) => Math.max(m, edges[ei].nps), 0) || defaultNps);

  // ── traversal: longest endpoint-to-endpoint path first, then branches ──
  const ends = nodes.map((_, i) => i).filter((i) => adj[i].length === 1);
  const bfs = (src) => {
    const dist = new Array(nodes.length).fill(-1), prev = new Array(nodes.length).fill(-1);
    dist[src] = 0;
    const q = [src];
    while (q.length) {
      const u = q.shift();
      adj[u].forEach((ei) => {
        const v = edges[ei].a === u ? edges[ei].b : edges[ei].a;
        if (dist[v] < 0) { dist[v] = dist[u] + len(sub(pts[v], pts[u])); prev[v] = ei; q.push(v); }
      });
    }
    return { dist, prev };
  };
  let mainPath = [];
  if (ends.length >= 2) {
    let best = { d: -1, s: ends[0], t: ends[0] };
    ends.forEach((s) => {
      const { dist } = bfs(s);
      ends.forEach((t) => { if (t !== s && dist[t] > best.d) best = { d: dist[t], s, t }; });
    });
    const { prev } = bfs(best.s);
    let cur = best.t;
    while (prev[cur] >= 0) { mainPath.unshift(prev[cur]); const e = edges[prev[cur]]; cur = e.a === cur ? e.b : e.a; }
  }
  const order = [...mainPath, ...edges.map((_, i) => i).filter((i) => !mainPath.includes(i))];

  // ── emit welds and elements per edge ───────────────────────
  const chain = [];
  let seq = 0;
  const welds = [], elements = [];
  const fittingDone = new Set();

  const W = (at, o) => {
    // an olet whose height is not printed has its two welds on one point; they are still two welds
    const hit = o.noMerge ? null : welds.find((w) => len(sub(w.at, at)) < WELD_TOL);
    if (hit) { if (o.forced) hit.forced = true; return hit; }
    const w = { seq: seq++, tag: "weld", at, ...o };
    welds.push(w); chain.push(w); return w;
  };
  const E = (o) => { const e = { seq: seq++, tag: "el", ...o }; elements.push(e); chain.push(e); return e; };

  const to = (nodeI, edge, other) => {
    const n = nodes[nodeI];
    // a bolted joint (flange to valve, spacer, blind, another flange) takes nothing off the pipe: there is no pipe
    if (other != null && boltedPair(n.type, nodes[other]?.type, len(sub(pts[nodeI], pts[other])))) return 0;
    // an olet: its outlet weld is the run's radius plus the olet's height off the run
    if (n.type === "olet") return od(n.runNps || nodeNps[nodeI]) / 2 + oletHeight(n);
    let isBranch = false;
    if (n.type === "tee" || n.type === "reducer") {
      const dirs = adj[nodeI].map((ei) => {
        const e = edges[ei], o = e.a === nodeI ? e.b : e.a;
        return { ei, u: unit(sub(pts[o], pts[nodeI])) };
      });
      const me = dirs.find((d) => d.ei === edge.i);
      // the branch leg is the one not collinear with any other leg
      isBranch = !dirs.some((d) => d.ei !== edge.i &&
        (me.u.x * d.u.x + me.u.y * d.u.y + me.u.z * d.u.z) < -0.9);
    }
    // A dimension read off the drawing always beats a table or an estimate.
    const measured = bodyHalfLength(n);
    if (measured > 0) return measured;
    if (n.type === "valve-bw") return 0;
    return takeOut(n.type, nodeNps[nodeI], edge.nps, isBranch);
  };

  // An olet's two welds: on the run's outside (the branch weld) and at its outlet.
  const oletWelds = (ni, out, t, nps) => {
    const n = nodes[ni];
    const s = od(n.runNps || nodeNps[ni]) / 2;
    W(add(pts[ni], out, s), { kind: "BR", node: ni, role: "Olet \u2192 Run", nps, branchOf: ni });
    W(add(pts[ni], out, t), { kind: "BW", node: ni, role: "Olet \u2192 Pipe", nps, noMerge: oletHeight(n) === 0 });
    E({ kind: "fitting", type: "olet", node: ni, ghost: ghosted.has(n.id), a: add(pts[ni], out, s), v: pts[ni], b: add(pts[ni], out, t), nps });
  };
  let boltedLen = 0;

  order.forEach((ei) => {
    const e = { ...edges[ei], i: ei };
    const A = e.a, B = e.b;
    const dir = unit(sub(pts[B], pts[A]));
    const span = len(sub(pts[B], pts[A]));
    // a bolted joint: the item's body between the flange faces — no weld, no pipe, no spool of its own
    if (boltedPair(nodes[A].type, nodes[B].type, span)) {
      boltedLen += span;
      const t = BOLTED.has(nodes[A].type) ? nodes[A].type : BOLTED.has(nodes[B].type) ? nodes[B].type : "flange-wn";
      if (span > 1) E({ kind: "fitting", type: t, node: BOLTED.has(nodes[A].type) ? A : B, bolted: true, a: pts[A], b: pts[B], v: add(pts[A], dir, span / 2), nps: e.nps });
      return;
    }
    const toA = to(A, e, B), toB = to(B, e, A);
    const effA = toA > 0 && pup > 0 && nodes[A].type !== "olet" ? toA + pup : toA;
    const effB = toB > 0 && pup > 0 && nodes[B].type !== "olet" ? toB + pup : toB;
    const start = add(pts[A], dir, effA);
    const end = add(pts[B], dir, -effB);
    const straight = span - effA - effB;

    // --- A end ---
    if (nodes[A].type === "olet") oletWelds(A, dir, toA, e.nps);
    else if (toA === 0) {
      if (isWeldedJoint(nodes[A].type)) {
        W(pts[A], { kind: nodes[A].type === "tie-in" ? "Tie-in" : "BW", node: A,
          forced: nodes[A].type === "tie-in", role: nodes[A].ref || nodes[A].type, nps: e.nps });
      }
    } else {
      W(add(pts[A], dir, toA), { kind: "BW", node: A, nps: e.nps,
        role: pup > 0 ? "Fitting \u2192 Pup" : "Fitting \u2192 Pipe" });
      if (pup > 0) {
        E({ kind: "pup", a: add(pts[A], dir, toA), b: start, length: pup, nps: e.nps, node: A });
        W(start, { kind: "BW", node: A, role: "Pup \u2192 Pipe", nps: e.nps });
      }
    }

    // --- straight run, split into transportable pieces ---
    if (straight > 1) {
      const pieces = Math.max(1, Math.ceil(straight / maxPipeLength));
      for (let k = 0; k < pieces; k++) {
        const p0 = add(start, dir, (straight * k) / pieces);
        const p1 = add(start, dir, (straight * (k + 1)) / pieces);
        E({ kind: "pipe", a: p0, b: p1, length: straight / pieces, nps: e.nps });
        if (k < pieces - 1) W(p1, { kind: "BW", role: "Girth", nps: e.nps });
      }
    }

    // --- B end ---
    if (nodes[B].type === "olet") oletWelds(B, { x: -dir.x, y: -dir.y, z: -dir.z }, toB, e.nps);
    else if (toB === 0) {
      if (isWeldedJoint(nodes[B].type)) {
        W(pts[B], { kind: nodes[B].type === "tie-in" ? "Tie-in" : "BW", node: B,
          forced: nodes[B].type === "tie-in", role: nodes[B].ref || nodes[B].type, nps: e.nps });
      }
    } else {
      if (pup > 0) {
        W(end, { kind: "BW", node: B, role: "Pipe \u2192 Pup", nps: e.nps });
        E({ kind: "pup", a: end, b: add(pts[B], dir, -toB), length: pup, nps: e.nps, node: B });
      }
      W(add(pts[B], dir, -toB), { kind: "BW", node: B, nps: e.nps,
        role: pup > 0 ? "Pup \u2192 Fitting" : "Pipe \u2192 Fitting" });
    }

    // --- fitting body, drawn once per node ---
    [A, B].forEach((ni) => {
      if (fittingDone.has(ni) || nodes[ni].type === "olet") return;
      const t = to(ni, e, ni === A ? B : A);
      if (t === 0) return;
      const legs = adj[ni].map((k) => {
        const ee = edges[k], o = ee.a === ni ? ee.b : ee.a;
        return { u: unit(sub(pts[o], pts[ni])), t: to(ni, { ...ee, i: k }, o), nps: ee.nps };
      });
      if (legs.length < 2) return;
      fittingDone.add(ni);
      for (let i = 0; i < legs.length; i++) {
        for (let j = i + 1; j < legs.length; j++) {
          const dot = legs[i].u.x * legs[j].u.x + legs[i].u.y * legs[j].u.y + legs[i].u.z * legs[j].u.z;
          // A collinear pair is a tee's straight-through run, drawn separately
          // below — unless the node IS an in-line body (reducer, BW valve), in
          // which case the collinear pair is exactly what needs drawing.
          if (dot < -0.9 && !INLINE_BODY.has(nodes[ni].type)) continue;
          E({ kind: "fitting", type: nodes[ni].type, node: ni, ghost: ghosted.has(nodes[ni].id),
            a: add(pts[ni], legs[i].u, legs[i].t), v: pts[ni],
            b: add(pts[ni], legs[j].u, legs[j].t),
            nps: Math.min(legs[i].nps, legs[j].nps) });
        }
      }
      if (nodes[ni].type === "tee") {
        // the straight-through run body
        const run = legs.filter((l, i) => legs.some((m, j) =>
          j !== i && (l.u.x * m.u.x + l.u.y * m.u.y + l.u.z * m.u.z) < -0.9));
        if (run.length === 2) {
          E({ kind: "fitting", type: "tee", node: ni, ghost: ghosted.has(nodes[ni].id),
            a: add(pts[ni], run[0].u, run[0].t), v: pts[ni],
            b: add(pts[ni], run[1].u, run[1].t), nps: Math.max(run[0].nps, run[1].nps) });
        }
      }
    });
  });

  welds.sort((a, b) => a.seq - b.seq);
  welds.forEach((w, i) => { w.no = `W-${String(i + 1).padStart(2, "0")}`; w.loc = w.forced ? "Field" : "Shop"; });

  // A spool must be transportable. Walk the route and cut a field closure the
  // moment the accumulated spool would exceed the transport limit. This is the
  // only rule needed — it subsumes "long runs get their own spool".
  {
    // a bolted body (valve, spacer, blind) is not part of any spool, so it neither carries nor breaks one
    const seqEls = elements.filter((e) => !e.bolted).sort((a, b) => a.seq - b.seq);
    const lenOf = (e) => (e.length != null ? e.length : len(sub(e.a, e.b)));
    const weldAt = (p) => welds.find((q) => len(sub(q.at, p)) < WELD_TOL);

    // A spool boundary must fall on a joint you can actually cut: one where a
    // straight pipe meets something. Cutting between a pup and its own fitting
    // would leave a 150 mm stub to be welded up in the field — never done.
    const cuttable = (i) => {
      const prev = seqEls[i - 1], cur = seqEls[i];
      if (!prev || !cur) return false;
      return prev.kind === "pipe" || cur.kind === "pipe";
    };

    // A fitting body can be emitted in either direction, so match on EITHER end
    // and remember which end we entered through — that is where a cut would go.
    const entry = new Array(seqEls.length).fill(null);
    let acc = 0, runStart = 0, prevEnd = null;
    for (let i = 0; i < seqEls.length; i++) {
      const e = seqEls[i];
      const l = lenOf(e);
      let contiguous = false, exit = e.b;
      if (prevEnd) {
        if (len(sub(e.a, prevEnd)) < WELD_TOL) { contiguous = true; entry[i] = e.a; exit = e.b; }
        else if (len(sub(e.b, prevEnd)) < WELD_TOL) { contiguous = true; entry[i] = e.b; exit = e.a; }
      }
      if (!entry[i]) entry[i] = e.a;

      if (!contiguous) { acc = 0; runStart = i; }
      else if (acc + l > spoolMaxLen) {
        let k = i;
        while (k > runStart && !cuttable(k)) k--;      // back off to a real joint
        const w = weldAt(entry[k]);
        if (w) { w.loc = "Field"; if (!w.forced && w.kind === "BW") w.kind = "Closure"; }
        acc = 0;
        for (let j = k; j < i; j++) acc += lenOf(seqEls[j]);
        runStart = k;
      }
      acc += l;
      prevEnd = exit;
    }
  }

  // ── spools = element groups connected through SHOP welds only ──
  const parent = elements.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (i, j) => { const a = find(i), b = find(j); if (a !== b) parent[a] = b; };
  const shopPts = welds.filter((w) => w.loc === "Shop").map((w) => w.at);
  shopPts.forEach((p) => {
    const touching = elements
      .map((el, i) => ({ i, el }))
      .filter(({ el }) => !el.bolted && (len(sub(el.a, p)) < WELD_TOL || len(sub(el.b, p)) < WELD_TOL));
    for (let k = 1; k < touching.length; k++) union(touching[0].i, touching[k].i);
  });
  // an olet's branch weld sits on the run pipe's outside, not on an end of it: the olet joins the run pipe it is welded to
  welds.filter((w) => w.loc === "Shop" && w.branchOf != null).forEach((w) => {
    const run = elements.findIndex((el) => el.kind === "pipe" && toSegment(pts[w.branchOf], el.a, el.b) < 1);
    const body = elements.findIndex((el) => el.kind === "fitting" && el.type === "olet" && el.node === w.branchOf);
    if (run >= 0 && body >= 0) union(run, body);
  });
  const roots = [...new Set(elements.filter((el) => !el.bolted).map((el) => find(elements.indexOf(el))))];
  const spoolName = new Map();
  roots
    .map((r) => ({ r, first: Math.min(...elements.filter((_, i) => find(i) === r).map((e) => e.seq)) }))
    .sort((a, b) => a.first - b.first)
    .forEach((x, i) => spoolName.set(x.r, `SP-${String(i + 1).padStart(2, "0")}`));
  elements.forEach((el, i) => { el.spool = el.bolted ? null : spoolName.get(find(i)); });
  welds.forEach((w) => {
    const near = elements.find((el) => !el.bolted && (len(sub(el.a, w.at)) < WELD_TOL || len(sub(el.b, w.at)) < WELD_TOL));
    w.spool = near ? near.spool : "SP-01";
  });

  // ── quantities, per diameter ───────────────────────────────
  const bySize = {};
  elements.forEach((e) => {
    if (e.kind === "fitting") return;
    const k = String(e.nps);
    bySize[k] = bySize[k] || { pipe: 0, pup: 0 };
    bySize[k][e.kind] += e.length;
  });
  const pipeLen = Object.values(bySize).reduce((a, v) => a + v.pipe, 0);
  const pupLen = Object.values(bySize).reduce((a, v) => a + v.pup, 0);
  let toSum = 0;
  edges.forEach((e, i) => {
    const ed = { ...e, i };
    toSum += to(e.a, ed, e.b) + to(e.b, ed, e.a);
  });
  // the bodies bolted between flange faces are on the centreline too
  const clCalc = pipeLen + pupLen + toSum + boltedLen;

  // ── validation ─────────────────────────────────────────────
  const checks = [...rec.checks];
  const bomRows = (data.bom || []).filter((b) => /pipe/i.test(`${b.group || ""} ${b.description || ""}`));
  Object.keys(bySize).sort((a, b) => Number(b) - Number(a)).forEach((size) => {
    const calc = bySize[size].pipe + bySize[size].pup;
    const stated = bomRows
      .filter((b) => String(b.diam) === size)
      .reduce((a, b) => a + (parseFloat(b.qty) || 0), 0) * 1000;
    if (!stated) {
      checks.push({ label: `لوله ${size}" در برابر MTO`, status: "skip", detail: `محاسبه ${Math.round(calc)} mm · ردیف MTO برای این قطر پیدا نشد` });
      return;
    }
    const d = Math.abs(calc - stated);
    checks.push({
      label: `لوله ${size}" در برابر MTO`,
      status: d <= Math.max(250, stated * 0.02) ? "ok" : "warn",
      fromPipeLength: true,
      detail: `محاسبه ${(calc / 1000).toFixed(2)} m · نقشه ${(stated / 1000).toFixed(2)} m · اختلاف ${(d / 1000).toFixed(2)} m`,
    });
  });

  // ── CUT PIPE LENGTH, the check the drawing hands you ────────────────
  //
  // An isometric prints the cut length of every pipe piece. That table is a
  // far sharper instrument than the MTO: the MTO quantity is rounded and
  // usually carries extra for field adjustment, so it absorbed a 125 mm error
  // at 28" without complaining. The cut length is the number the shop saws
  // to, and it either matches or it does not.
  const stated = (data.cutLengths || [])
    .map((c) => ({ piece: c.piece ?? c.pieceNo ?? "?",
                   len: Number(c.lengthMm ?? c.cutLength ?? c.length),
                   nps: Number(c.nps ?? c.diam ?? defaultNps) }))
    .filter((c) => Number.isFinite(c.len) && c.len > 0);

  if (stated.length) {
    const computed = elements
      .filter((e) => e.kind === "pipe" || e.kind === "pup")
      .map((e) => ({ len: e.length, nps: Number(e.nps) || defaultNps, used: false }));

    const unmatched = [];
    for (const c of stated) {
      // Root gaps are excluded from the drawing's dimensions, so a few
      // millimetres of slack is correct rather than generous.
      const tol = Math.max(5, c.len * 0.005);
      const hit = computed.find((x) => !x.used && x.nps === c.nps && Math.abs(x.len - c.len) <= tol);
      if (hit) hit.used = true;
      else unmatched.push(c);
    }
    const spare = computed.filter((x) => !x.used);

    checks.push({
      label: "CUT PIPE LENGTH در برابر محاسبه",
      status: unmatched.length || spare.length ? "warn" : "ok",
      fromPipeLength: true,
      detail: unmatched.length || spare.length
        ? [
            unmatched.length
              ? `نقشه دارد ولی محاسبه ندارد: ${unmatched.map((c) => `<${c.piece}> ${c.len} mm`).join("، ")}`
              : null,
            spare.length
              ? `محاسبه دارد ولی نقشه ندارد: ${spare.map((x) => `${Math.round(x.len)} mm`).join("، ")}`
              : null,
          ].filter(Boolean).join(" · ")
        : `${stated.length} قطعه منطبق: ${stated.map((c) => `<${c.piece}> ${c.len} mm`).join("، ")}`,
    });
  }

  const clStated = data.meta?.clLengthM ? Number(data.meta.clLengthM) * 1000 : null;
  if (clStated) {
    const d = Math.abs(clCalc - clStated);
    checks.push({
      label: "CL Length در برابر title block",
      status: d <= Math.max(300, clStated * 0.02) ? "ok" : "warn",
      detail: `محاسبه ${(clCalc / 1000).toFixed(2)} m · نقشه ${(clStated / 1000).toFixed(2)} m · اختلاف ${(d / 1000).toFixed(2)} m`,
    });
  } else {
    checks.push({ label: "CL Length", status: "skip", detail: "از نقشه خوانده نشد" });
  }

  const tieIns = nodes.filter((n) => n.type === "tie-in");
  checks.push({
    label: "توپولوژی مسیر", status: "ok",
    detail: `${nodes.length} گره · ${edges.length} یال · ${tieIns.length} tie-in · ` +
      `${adj.some((a) => a.length >= 3) ? "شاخه‌دار" : "خطی"} · ` +
      `قطرها: ${[...new Set(edges.map((e) => e.nps))].sort((a, b) => b - a).join('", ')}"`,
  });

  // A butt-weld valve with no face-to-face length has no body, so both of its
  // welds collapse onto one point and the register silently under-counts. Say so.
  const blindValves = nodes.filter((n) => n.type === "valve-bw" && bodyHalfLength(n) === 0);
  if (blindValves.length) {
    checks.push({
      label: "طول face-to-face شیر BW",
      status: "warn",
      detail: `${blindValves.length} شیر BW (${blindValves.map((n) => n.id).join("، ")}) ` +
        `ابعاد face-to-face ندارد — هر کدام به‌جای دو جوش یک جوش تولید کرده است. ` +
        `ابعاد را از نقشه در فیلد faceToFace وارد کنید (ASME B16.10).`,
    });
  }

  // An olet's height off the run is not in any table the drawing names
  // (MSS SP-97 keys on run and branch size and class), so it is read or it is
  // unknown. Unknown: both welds are there, on one point, and the branch pipe
  // is long by the height — said out loud rather than guessed.
  const lowOlets = nodes.filter((n) => n.type === "olet" && oletHeight(n) === 0);
  if (lowOlets.length) {
    checks.push({
      label: "ارتفاع olet",
      status: "warn",
      detail: `${lowOlets.length} اولت (${lowOlets.map((n) => n.id).join("، ")}) ارتفاع چاپ‌شده ندارد — ` +
        `دو جوشش (روی لولهٔ اصلی و سر خروجی) روی یک نقطه نشسته و لولهٔ شاخه به‌اندازهٔ ارتفاع اولت بلندتر حساب شده است. ` +
        `ارتفاع را از نقشه در فیلد faceToFace وارد کنید.`,
    });
  }

  // A weld-neck flange has a hub: the weld sits at the end of it, not at the
  // face the drawing dimensions to. With no dimension the weld lands on the
  // node and the pipe beside it is long by roughly the hub length — an error
  // of ~100 mm in a cut length, and invisible unless it is said out loud.
  const blindFlanges = nodes.filter((n) => n.type === "flange-wn" && bodyHalfLength(n) === 0);
  if (blindFlanges.length) {
    checks.push({
      label: "طول hub فلنج WN",
      status: "warn",
      detail: `${blindFlanges.length} فلنج WN (${blindFlanges.map((n) => n.id).join("، ")}) ` +
        `ابعاد ندارد — جوششان دقیقاً روی گره نشسته و طول لولهٔ مجاور به‌اندازهٔ hub ` +
        `بلندتر حساب شده است. ابعاد را در فیلد faceToFace وارد کنید (B16.5).`,
    });
  }

  // A spool that cannot be transported is not a spool. The cut algorithm can
  // only break at an element boundary, so a single pipe run longer than the
  // limit — which happens whenever maxPipeLength exceeds spoolMaxLen — comes
  // out as one oversized piece and nothing notices.
  {
    const lenBySpool = new Map();
    elements.forEach((e) => {
      if (e.kind === "fitting") return;
      const l = e.length != null ? e.length : len(sub(e.a, e.b));
      lenBySpool.set(e.spool, (lenBySpool.get(e.spool) || 0) + l);
    });
    const oversize = [...lenBySpool.entries()].filter(([, l]) => l > spoolMaxLen + 1);
    if (oversize.length) {
      checks.push({
        label: "اسپول بلندتر از سقف حمل",
        status: "warn",
        detail: oversize.map(([id, l]) =>
          `${id}: ${(l / 1000).toFixed(2)} m`).join(" · ") +
          ` — سقف ${(spoolMaxLen / 1000).toFixed(1)} m. ` +
          `برش فقط روی مرز المان‌ها ممکن است، پس یک ران لوله‌ای بلندتر از سقف ` +
          `به‌صورت یک تکه درمی‌آید. maxPipeLength را از spoolMaxLen بزرگ‌تر نگذارید.`,
      });
    }
  }

  const sheetNote = String(data.meta?.sheet || "");
  if (/\/\s*[2-9]/.test(sheetNote) || /SHT|SHEET/i.test(tieIns.map((t) => t.ref || "").join(" "))) {
    checks.push({
      label: "نقشه چندبرگی", status: "warn",
      detail: `شیت ${sheetNote || "?"} — اگر MTO مجموع کل خط باشد، مقایسه با هندسه این برگ به‌تنهایی معنا ندارد. برگ‌های دیگر را هم وارد کنید.`,
    });
  }

  // ── a pass computed from incomplete geometry is not a pass ──────────
  //
  // This is the trap the first live extraction walked into. The MTO listed a
  // weld-neck flange the model had not placed, so the flange's hub was never
  // subtracted and its length stayed inside the pipe. The pipe-versus-MTO
  // comparison then read 3.34 m against 3.30 m — 0.04 m apart, comfortably
  // inside tolerance, reported "ok". Had the flange been there the computed
  // pipe would have been 3.21 m and the same check would have shown 0.09 m.
  //
  // So the wrong model produced the CLEANER number, and a warning about the
  // missing flange sat beside three passes that outvoted it.
  //
  // Only the comparisons whose computed side is pipe length are affected: a
  // missing in-line component's body is absorbed into the pipe beside it.
  // The centreline length is measured node to node and does not move, so it
  // is deliberately left alone rather than blanket-flagged.
  const short = checks.filter((c) => c.shortBy > 0);
  if (short.length) {
    const what = short.map((c) => `${c.shortType} ×${c.shortBy}`).join("، ");
    for (const c of checks) {
      if (!c.fromPipeLength) continue;
      c.status = "warn";
      c.detail += ` — ولی هندسه ${what} کم دارد، پس این مقایسه قابل اتکا نیست:`
        + ` طول آن قطعه داخل لوله مانده است.`;
    }
  }

  // Buried or above ground, against the project's recorded grade. The grade
  // comes from the project's siting spec and is never assumed: a grade of
  // EL 100 000 guessed where the project uses 0.00 would call every pipe
  // rack in the plant buried. With no grade given the answer is null — no
  // verdict — and the totals say "unknown" rather than "0 buried".
  // reporting.fact_weld makes the same comparison on the stored register.
  const grade = finiteOrNull(opts.gradeElevationMm);

  const register = welds.map((w) => ({
    no: w.no, spool: w.spool, loc: w.loc, kind: w.kind, role: w.role || "\u2014",
    el: Math.round(nodes[0].EL + w.at.y),
    buried: grade === null ? null : nodes[0].EL + w.at.y < grade,
    // PROVISIONAL. The governing requirement comes from B31.3 §341.4 and the
    // project's piping class — see lib/ndt/ — and is written back over this
    // value once a class is known. B31.3 itself draws no distinction between
    // a shop and a field weld for examination; "field welds get 100%" is a
    // common project rule, not a code rule, and belongs in the class.
    ndt: provisionalNdt(w.loc),
    size: `${w.nps || defaultNps}" ${data.meta?.schedule || ""}`.trim(),
    nps: w.nps || defaultNps,
    at: w.at,
  }));

  return {
    nps: defaultNps, pup, origin: nodes[0], nodes, pts, edges, elements, welds, register, checks,
    spoolIds: [...new Set(elements.map((e) => e.spool).filter(Boolean))],
    bomDropped: rec.dropped, bomGhosted: rec.ghosted,
    diameter: od(defaultNps),
    odOf: (n) => od(Number(n) || defaultNps),
    bySize,
    totals: {
      pipeLen, pupLen, clCalc, welds: register.length,
      field: register.filter((w) => w.loc === "Field").length,
      shop: register.filter((w) => w.loc === "Shop").length,
      girth: register.filter((w) => w.role === "Girth").length,
      buried: grade === null ? null : register.filter((w) => w.buried).length,
      aboveGround: grade === null ? null : register.filter((w) => w.buried === false).length,
    },
    gradeElevationMm: grade,
  };
}

/** A number, or null for anything that is not one — including "" and null, which Number() turns into 0. */
function finiteOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function registerCsv(model, meta, approval = null) {
  const head = ["Weld No", "Spool", "Shop/Field", "Type", "Joint", "Size", "EL (mm)",
    "NDT", "WPS No", "Welder ID", "NDT Report No", "Status"];
  const rows = model.register.map((w) =>
    [w.no, w.spool, w.loc, w.kind, `"${w.role}"`, `"${w.size}"`, w.el, w.ndt, "", "", "", ""]);
  return "\uFEFF" + [
    `Drawing,${meta?.drawingNo || ""},Rev,${meta?.rev || ""},Sheet,${meta?.sheet || ""},Class,${meta?.pipingClass || ""}`,
    "", head.join(","), ...rows.map((r) => r.join(",")),
    // The warning travels with the file: a CSV gets imported somewhere else
    // and arrives there looking like an approved document.
    "", `"${DISCLAIMER_FA}"`, `"${DISCLAIMER_EN}"`, `"${approvalLine(approval)}"`,
  ].join("\n");
}
