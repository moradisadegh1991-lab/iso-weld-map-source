import { takeOut, od } from "./standards";

const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len = (v) => Math.hypot(v.x, v.y, v.z);
const unit = (v) => { const l = len(v) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const add = (a, b, s = 1) => ({ x: a.x + b.x * s, y: a.y + b.y * s, z: a.z + b.z * s });
const toVec = (n, o) => ({ x: n.E - o.E, y: n.EL - o.EL, z: n.N - o.N });

/**
 * Vision supplies nodes + meta + BOM only.
 * Geometry, weld numbering, spool split and validation are computed here.
 */
export function buildModel(data, opts = {}) {
  const spoolMaxLen = opts.spoolMaxLen ?? 6000;
  const maxPipeLength = opts.maxPipeLength ?? 12000;

  const nps = Number(data?.meta?.nps) || 36;
  const pup = Number(data?.meta?.pupLength) || 0;
  const nodes = (data?.nodes || []).filter((n) => n && n.E != null && n.N != null && n.EL != null);
  if (nodes.length < 2) return { error: "حداقل دو گره لازم است (دو سر خط)." };

  const origin = nodes[0];
  const pts = nodes.map((n) => toVec(n, origin));
  const to = nodes.map((n) => takeOut(n.type, nps));
  const eff = to.map((t) => (t > 0 && pup > 0 ? t + pup : t));

  const chain = [];
  let seq = 0;
  const W = (at, o = {}) => { chain.push({ seq: seq++, tag: "weld", at, ...o }); };
  const E = (o) => { chain.push({ seq: seq++, tag: "el", ...o }); };

  for (let i = 0; i < nodes.length - 1; i++) {
    const dir = unit(sub(pts[i + 1], pts[i]));
    const span = len(sub(pts[i + 1], pts[i]));
    const start = add(pts[i], dir, eff[i]);
    const end = add(pts[i + 1], dir, -eff[i + 1]);
    const straight = span - eff[i] - eff[i + 1];

    if (i === 0) {
      W(pts[0], { kind: nodes[0].type === "tie-in" ? "Tie-in" : "BW", node: 0,
        forced: nodes[0].type === "tie-in", role: nodes[0].ref || "Tie-in" });
    }

    if (i > 0 && pup > 0 && to[i] > 0) {
      E({ kind: "pup", a: add(pts[i], dir, to[i]), b: start, length: pup, node: i });
      W(start, { kind: "BW", node: i, role: "Pup \u2192 Pipe" });
    }

    if (straight > 1) {
      const pieces = Math.max(1, Math.ceil(straight / maxPipeLength));
      for (let k = 0; k < pieces; k++) {
        const p0 = add(start, dir, (straight * k) / pieces);
        const p1 = add(start, dir, (straight * (k + 1)) / pieces);
        E({ kind: "pipe", a: p0, b: p1, length: straight / pieces });
        if (k < pieces - 1) W(p1, { kind: "BW", role: "Girth" });
      }
    }

    const j = i + 1;
    if (nodes[j].type === "tie-in") {
      W(pts[j], { kind: "Tie-in", node: j, forced: true, role: nodes[j].ref || "Tie-in" });
    } else {
      if (pup > 0 && to[j] > 0) {
        W(end, { kind: "BW", node: j, role: "Pipe \u2192 Pup" });
        E({ kind: "pup", a: end, b: add(pts[j], dir, -to[j]), length: pup, node: j });
        W(add(pts[j], dir, -to[j]), { kind: "BW", node: j, role: "Pup \u2192 Fitting" });
      } else {
        W(end, { kind: "BW", node: j, role: "Pipe \u2192 Fitting" });
      }
      const dirOut = pts[j + 1] ? unit(sub(pts[j + 1], pts[j])) : dir;
      E({ kind: "fitting", a: add(pts[j], dir, -to[j]), v: pts[j],
        b: add(pts[j], dirOut, to[j]), node: j, type: nodes[j].type });
      if (pts[j + 1]) {
        W(add(pts[j], dirOut, to[j]), { kind: "BW", node: j,
          role: pup > 0 ? "Fitting \u2192 Pup" : "Fitting \u2192 Pipe" });
      }
    }
  }

  const welds = chain.filter((c) => c.tag === "weld");
  const elements = chain.filter((c) => c.tag === "el");
  welds.forEach((w, i) => { w.no = `W-${String(i + 1).padStart(2, "0")}`; w.loc = w.forced ? "Field" : "Shop"; });

  elements.forEach((e) => {
    if (e.kind !== "pipe" || e.length <= spoolMaxLen) return;
    const before = welds.filter((w) => w.seq < e.seq).pop();
    const after = welds.find((w) => w.seq > e.seq);
    [before, after].forEach((w) => {
      if (!w) return;
      w.loc = "Field";
      if (!w.forced) w.kind = "Closure";
    });
  });

  const lastNo = welds.length ? welds[welds.length - 1].no : null;
  let s = 1, cursor = "SP-01";
  chain.forEach((c) => {
    c.spool = cursor;
    if (c.tag === "weld" && c.loc === "Field" && c.no !== "W-01" && c.no !== lastNo) {
      s++; cursor = `SP-${String(s).padStart(2, "0")}`;
    }
  });

  const pipeLen = elements.filter((e) => e.kind === "pipe").reduce((a, e) => a + e.length, 0);
  const pupLen = elements.filter((e) => e.kind === "pup").reduce((a, e) => a + e.length, 0);
  const toSum = to.reduce((a, v) => a + (v > 0 ? v * 2 : 0), 0);
  const clCalc = pipeLen + pupLen + toSum;

  const bomPipe = (data.bom || [])
    .filter((b) => /pipe/i.test(`${b.group || ""} ${b.description || ""}`))
    .reduce((a, b) => a + (parseFloat(b.qty) || 0), 0);

  const checks = [];
  const cmp = (label, calc, stated, tol) => {
    if (stated == null || !isFinite(stated) || stated === 0) {
      checks.push({ label, status: "skip", detail: "مقدار مرجع از نقشه خوانده نشد" });
      return;
    }
    const d = Math.abs(calc - stated);
    checks.push({ label, status: d <= tol ? "ok" : "warn",
      detail: `محاسبه ${Math.round(calc)} \u00b7 نقشه ${Math.round(stated)} \u00b7 اختلاف ${Math.round(d)} mm` });
  };
  cmp("طول لوله (straight + pup) در برابر MTO", pipeLen + pupLen, bomPipe ? bomPipe * 1000 : null, 200);
  cmp("CL Length در برابر title block", clCalc, data.meta?.clLengthM ? data.meta.clLengthM * 1000 : null, 250);

  const f = nodes[0], l = nodes[nodes.length - 1];
  checks.push({ label: "بسته‌شدن مختصات دو سر خط", status: "ok",
    detail: `\u0394E ${l.E - f.E} \u00b7 \u0394N ${l.N - f.N} \u00b7 \u0394EL ${l.EL - f.EL} mm` });

  const register = welds.map((w) => ({
    no: w.no, spool: w.spool, loc: w.loc, kind: w.kind, role: w.role || "\u2014",
    el: Math.round(origin.EL + w.at.y),
    ndt: w.loc === "Field" ? "RT 100%" : "RT 5% random",
    size: `${nps}" ${data.meta?.schedule || ""}`.trim(),
    at: w.at,
  }));

  return {
    nps, pup, origin, nodes, pts, elements, welds, register, checks,
    spoolIds: [...new Set(register.map((w) => w.spool))],
    diameter: od(nps),
    totals: {
      pipeLen, pupLen, clCalc, welds: register.length,
      field: register.filter((w) => w.loc === "Field").length,
      shop: register.filter((w) => w.loc === "Shop").length,
    },
  };
}

export function registerCsv(model, meta) {
  const head = ["Weld No", "Spool", "Shop/Field", "Type", "Joint", "Size", "EL (mm)",
    "NDT", "WPS No", "Welder ID", "NDT Report No", "Status"];
  const rows = model.register.map((w) =>
    [w.no, w.spool, w.loc, w.kind, `"${w.role}"`, `"${w.size}"`, w.el, w.ndt, "", "", "", ""]);
  return "\uFEFF" + [
    `Drawing,${meta?.drawingNo || ""},Rev,${meta?.rev || ""},Class,${meta?.pipingClass || ""}`,
    "", head.join(","), ...rows.map((r) => r.join(",")),
  ].join("\n");
}
