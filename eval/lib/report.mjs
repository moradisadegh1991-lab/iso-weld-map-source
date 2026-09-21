/** Console rendering and the baseline comparison. */

const C = process.stdout.isTTY && !process.env.NO_COLOR
  ? { red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
      dim: "\x1b[2m", bold: "\x1b[1m", off: "\x1b[0m" }
  : { red: "", green: "", yellow: "", blue: "", dim: "", bold: "", off: "" };

const MARK = {
  pass: `${C.green}PASS ${C.off}`,
  fail: `${C.red}FAIL ${C.off}`,
  xfail: `${C.yellow}XFAIL${C.off}`,
  xpass: `${C.blue}XPASS${C.off}`,
};

export function printResults(results) {
  const groups = [...new Set(results.map((r) => r.kind))];
  for (const kind of groups) {
    const inGroup = results.filter((r) => r.kind === kind);
    console.log(`\n${C.bold}${kind === "golden" ? "GOLDEN — verified drawings" : "RULES — documented engine behaviour"}${C.off}`);
    for (const r of inGroup) {
      console.log(`  ${MARK[r.status]} ${r.id.padEnd(26)} ${C.dim}${r.title}${C.off}`);
      for (const a of r.assertions) {
        if (a.ok && r.status !== "xpass") continue;
        const sign = a.ok ? `${C.green}+${C.off}` : `${C.red}-${C.off}`;
        console.log(`        ${sign} ${a.name}: expected ${C.bold}${a.expected}${C.off}, got ${C.bold}${a.actual}${C.off}`);
      }
      if (r.status === "xfail" && r.gap) console.log(`        ${C.dim}gap: ${r.gap}${C.off}`);
      if (r.status === "xpass") console.log(`        ${C.blue}this known gap now passes — remove expectedToFail from the case${C.off}`);
    }
  }
}

export function printSummary(agg) {
  const pct = (m) => (m == null ? `${C.dim}n/a${C.off}` : `${m.pct}% ${C.dim}(${m.ok}/${m.of})${C.off}`);
  console.log(`\n${C.bold}SUMMARY${C.off}`);
  console.log(`  cases                    ${agg.cases}  ` +
    `${C.green}${agg.pass} pass${C.off} · ${agg.fail ? C.red : C.dim}${agg.fail} fail${C.off} · ` +
    `${C.yellow}${agg.xfail} xfail${C.off} · ${agg.xpass ? C.blue : C.dim}${agg.xpass} xpass${C.off}`);
  console.log(`  weld count exact         ${pct(agg.weldCountExact)}`);
  console.log(`  field weld set exact     ${pct(agg.fieldWeldsExact)}`);
  console.log(`  spool count exact        ${pct(agg.spoolCountExact)}`);
  console.log(`  register row exact       ${pct(agg.registerExact)}`);
  console.log(`  register field accuracy  ${agg.registerFieldAccuracy == null ? `${C.dim}n/a${C.off}`
    : `${agg.registerFieldAccuracy}% ${C.dim}(${agg.registerFields.correct}/${agg.registerFields.of})${C.off}`}`);
  console.log(`  engine warnings raised   ${agg.warnings}`);
}

/**
 * Compare a run against the recorded baseline.
 *
 * The gate is deliberately asymmetric: it blocks anything that makes the
 * engine worse and stays silent about anything that makes it better, because
 * an improvement should never need permission to land. Newly added cases are
 * reported but do not block — they have no baseline to regress against.
 */
export function compareToBaseline(agg, results, baseline) {
  const problems = [], notes = [];
  if (!baseline) return { problems, notes: ["no baseline recorded yet — run with --update-baseline"] };

  const was = new Map((baseline.cases || []).map((c) => [c.id, c.status]));
  for (const r of results) {
    const prev = was.get(r.id);
    if (prev === undefined) { notes.push(`new case ${r.id} (${r.status})`); continue; }
    if (prev === "pass" && r.status !== "pass") problems.push(`${r.id}: was pass, now ${r.status}`);
    if (prev === "xfail" && r.status === "fail") problems.push(`${r.id}: known gap widened`);
    if (prev !== "pass" && r.status === "pass") notes.push(`${r.id}: ${prev} -> pass`);
    if (r.status === "xpass") notes.push(`${r.id}: known gap now passes — promote the case`);
  }
  for (const id of was.keys()) {
    if (!results.some((r) => r.id === id)) problems.push(`${id}: case disappeared from the suite`);
  }

  const metrics = ["weldCountExact", "fieldWeldsExact", "spoolCountExact", "registerExact"];
  for (const m of metrics) {
    const now = agg[m]?.pct, then = baseline.summary?.[m]?.pct;
    if (now == null || then == null) continue;
    if (now < then) problems.push(`${m}: ${then}% -> ${now}%`);
  }
  const nowAcc = agg.registerFieldAccuracy, thenAcc = baseline.summary?.registerFieldAccuracy;
  if (nowAcc != null && thenAcc != null && nowAcc < thenAcc) {
    problems.push(`registerFieldAccuracy: ${thenAcc}% -> ${nowAcc}%`);
  }
  return { problems, notes };
}

export function printGate({ problems, notes }) {
  for (const n of notes) console.log(`  ${C.dim}note: ${n}${C.off}`);
  if (!problems.length) {
    console.log(`\n${C.green}${C.bold}GATE PASSED${C.off} — no regression against the baseline.`);
    return;
  }
  console.log(`\n${C.red}${C.bold}GATE FAILED${C.off} — ${problems.length} regression(s):`);
  for (const p of problems) console.log(`  ${C.red}x${C.off} ${p}`);
}
