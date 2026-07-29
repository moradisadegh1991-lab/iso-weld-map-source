import { takeOut, od } from "./standards";
import { reconcileWithBom } from "./bom";

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
const toVec = (n, o) => ({ x: n.E - o.E, y: n.EL - o.EL, z: n.N - o.N });

/**
 * Route is a GRAPH, not a chain: a tee has three incident edges, so a linear
 * node list cannot describe it. `edges` is optional — without it the nodes are
 * chained in order, which reproduces the v1 behaviour.
 */
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
  const nodes = rec.nodes;
  const ghosted = new Set(rec.ghosted);
  if (nodes.length < 2) {
    return { error: "بعد از تطبیق با MTO کمتر از دو گره باقی ماند — استخراج هندسه قابل اتکا نیست." };
  }

  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const edges = rec.edges
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
    const hit = welds.find((w) => len(sub(w.at, at)) < WELD_TOL);
    if (hit) { if (o.forced) hit.forced = true; return hit; }
    const w = { seq: seq++, tag: "weld", at, ...o };
    welds.push(w); chain.push(w); return w;
  };
  const E = (o) => { const e = { seq: seq++, tag: "el", ...o }; elements.push(e); chain.push(e); return e; };

  const to = (nodeI, edge, other) => {
    const n = nodes[nodeI];
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
    return takeOut(n.type, nodeNps[nodeI], edge.nps, isBranch);
  };

  order.forEach((ei) => {
    const e = { ...edges[ei], i: ei };
    const A = e.a, B = e.b;
    const dir = unit(sub(pts[B], pts[A]));
    const span = len(sub(pts[B], pts[A]));
    const toA = to(A, e, B), toB = to(B, e, A);
    const effA = toA > 0 && pup > 0 ? toA + pup : toA;
    const effB = toB > 0 && pup > 0 ? toB + pup : toB;
    const start = add(pts[A], dir, effA);
    const end = add(pts[B], dir, -effB);
    const straight = span - effA - effB;

    // --- A end ---
    if (toA === 0) {
      W(pts[A], { kind: nodes[A].type === "tie-in" ? "Tie-in" : "BW", node: A,
        forced: nodes[A].type === "tie-in", role: nodes[A].ref || nodes[A].type, nps: e.nps });
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
    if (toB === 0) {
      W(pts[B], { kind: nodes[B].type === "tie-in" ? "Tie-in" : "BW", node: B,
        forced: nodes[B].type === "tie-in", role: nodes[B].ref || nodes[B].type, nps: e.nps });
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
      if (fittingDone.has(ni)) return;
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
          if (dot < -0.9 && nodes[ni].type !== "reducer") continue; // straight-through run of a tee
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
    const seqEls = elements.slice().sort((a, b) => a.seq - b.seq);
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
      .filter(({ el }) => len(sub(el.a, p)) < WELD_TOL || len(sub(el.b, p)) < WELD_TOL);
    for (let k = 1; k < touching.length; k++) union(touching[0].i, touching[k].i);
  });
  const roots = [...new Set(elements.map((_, i) => find(i)))];
  const spoolName = new Map();
  roots
    .map((r) => ({ r, first: Math.min(...elements.filter((_, i) => find(i) === r).map((e) => e.seq)) }))
    .sort((a, b) => a.first - b.first)
    .forEach((x, i) => spoolName.set(x.r, `SP-${String(i + 1).padStart(2, "0")}`));
  elements.forEach((el, i) => { el.spool = spoolName.get(find(i)); });
  welds.forEach((w) => {
    const near = elements.find((el) => len(sub(el.a, w.at)) < WELD_TOL || len(sub(el.b, w.at)) < WELD_TOL);
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
  const clCalc = pipeLen + pupLen + toSum;

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
      detail: `محاسبه ${(calc / 1000).toFixed(2)} m · نقشه ${(stated / 1000).toFixed(2)} m · اختلاف ${(d / 1000).toFixed(2)} m`,
    });
  });

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

  const sheetNote = String(data.meta?.sheet || "");
  if (/\/\s*[2-9]/.test(sheetNote) || /SHT|SHEET/i.test(tieIns.map((t) => t.ref || "").join(" "))) {
    checks.push({
      label: "نقشه چندبرگی", status: "warn",
      detail: `شیت ${sheetNote || "?"} — اگر MTO مجموع کل خط باشد، مقایسه با هندسه این برگ به‌تنهایی معنا ندارد. برگ‌های دیگر را هم وارد کنید.`,
    });
  }

  const register = welds.map((w) => ({
    no: w.no, spool: w.spool, loc: w.loc, kind: w.kind, role: w.role || "\u2014",
    el: Math.round(nodes[0].EL + w.at.y),
    ndt: w.loc === "Field" ? "RT 100%" : "RT 5% random",
    size: `${w.nps || defaultNps}" ${data.meta?.schedule || ""}`.trim(),
    nps: w.nps || defaultNps,
    at: w.at,
  }));

  return {
    nps: defaultNps, pup, origin: nodes[0], nodes, pts, edges, elements, welds, register, checks,
    spoolIds: [...new Set(elements.map((e) => e.spool))],
    bomDropped: rec.dropped, bomGhosted: rec.ghosted,
    diameter: od(defaultNps),
    odOf: (n) => od(Number(n) || defaultNps),
    bySize,
    totals: {
      pipeLen, pupLen, clCalc, welds: register.length,
      field: register.filter((w) => w.loc === "Field").length,
      shop: register.filter((w) => w.loc === "Shop").length,
      girth: register.filter((w) => w.role === "Girth").length,
    },
  };
}

export function registerCsv(model, meta) {
  const head = ["Weld No", "Spool", "Shop/Field", "Type", "Joint", "Size", "EL (mm)",
    "NDT", "WPS No", "Welder ID", "NDT Report No", "Status"];
  const rows = model.register.map((w) =>
    [w.no, w.spool, w.loc, w.kind, `"${w.role}"`, `"${w.size}"`, w.el, w.ndt, "", "", "", ""]);
  return "\uFEFF" + [
    `Drawing,${meta?.drawingNo || ""},Rev,${meta?.rev || ""},Sheet,${meta?.sheet || ""},Class,${meta?.pipingClass || ""}`,
    "", head.join(","), ...rows.map((r) => r.join(",")),
  ].join("\n");
}
