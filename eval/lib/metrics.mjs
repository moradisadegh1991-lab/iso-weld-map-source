/**
 * Scoring for one evaluation case.
 *
 * Every assertion is opt-in: a case only declares what its author actually
 * verified. A case that states nothing asserts nothing and cannot pass, which
 * is deliberate — an empty expectation is a bug in the case, not a pass.
 */

const setEq = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const sorted = (a) => [...a].sort();

/** Fields of the weld register that a case may pin down, row by row. */
const REGISTER_FIELDS = ["loc", "kind", "nps", "spool", "role"];

export function evaluateCase(def, model) {
  const assertions = [];
  const expect = def.expect || {};

  const assert = (name, ok, expected, actual) =>
    assertions.push({ name, ok, expected, actual });

  // ── the engine refused to build a model ──────────────────────────────
  if (model.error) {
    if (expect.error) {
      const wanted = typeof expect.error === "string" ? expect.error : "";
      assert("error", wanted ? model.error.includes(wanted) : true, expect.error, model.error);
    } else {
      assert("builds", false, "a model", `error: ${model.error}`);
    }
    return finish(def, assertions, { errored: true, warnCount: 0 });
  }
  if (expect.error) {
    assert("error", false, expect.error, "the engine built a model without error");
    return finish(def, assertions, { errored: false, warnCount: countWarn(model) });
  }

  const register = model.register || [];
  const field = register.filter((w) => w.loc === "Field").map((w) => w.no);
  const girth = register.filter((w) => w.role === "Girth").length;
  const closures = register.filter((w) => w.kind === "Closure").length;

  if (expect.weldCount != null) {
    assert("weldCount", register.length === expect.weldCount, expect.weldCount, register.length);
  }
  if (expect.fieldWeldCount != null) {
    assert("fieldWeldCount", field.length === expect.fieldWeldCount, expect.fieldWeldCount, field.length);
  }
  if (expect.fieldWelds != null) {
    assert("fieldWelds", setEq(expect.fieldWelds, field),
      sorted(expect.fieldWelds).join(" "), sorted(field).join(" ") || "(none)");
  }
  if (expect.spoolCount != null) {
    const n = (model.spoolIds || []).length;
    assert("spoolCount", n === expect.spoolCount, expect.spoolCount, n);
  }
  if (expect.girthWelds != null) {
    assert("girthWelds", girth === expect.girthWelds, expect.girthWelds, girth);
  }
  if (expect.closureWelds != null) {
    assert("closureWelds", closures === expect.closureWelds, expect.closureWelds, closures);
  }

  // ── per-row register comparison, the strictest check we have ──────────
  let fieldsTotal = 0, fieldsCorrect = 0;
  if (Array.isArray(expect.register)) {
    const byNo = new Map(register.map((w) => [w.no, w]));
    const mismatches = [];
    for (const row of expect.register) {
      const got = byNo.get(row.no);
      if (!got) {
        for (const k of REGISTER_FIELDS) if (row[k] != null) fieldsTotal++;
        mismatches.push(`${row.no}: missing from register`);
        continue;
      }
      for (const k of REGISTER_FIELDS) {
        if (row[k] == null) continue;
        fieldsTotal++;
        if (String(got[k]) === String(row[k])) fieldsCorrect++;
        else mismatches.push(`${row.no}.${k}: expected ${row[k]}, got ${got[k]}`);
      }
    }
    assert("register", mismatches.length === 0,
      `${fieldsTotal} fields`,
      mismatches.length ? mismatches.slice(0, 4).join(" · ") +
        (mismatches.length > 4 ? ` · +${mismatches.length - 4} more` : "")
        : `${fieldsCorrect}/${fieldsTotal} fields`);
  }

  // ── validation checks produced by the engine ─────────────────────────
  const warnCount = countWarn(model);
  if (expect.maxWarnings != null) {
    assert("maxWarnings", warnCount <= expect.maxWarnings, `<= ${expect.maxWarnings}`, warnCount);
  }
  if (Array.isArray(expect.warningLabels)) {
    const labels = (model.checks || []).filter((c) => c.status === "warn").map((c) => c.label);
    const missing = expect.warningLabels.filter(
      (want) => !labels.some((l) => l.includes(want)));
    assert("warningLabels", missing.length === 0,
      expect.warningLabels.join(" · "), missing.length ? `missing: ${missing.join(" · ")}` : "all present");
  }

  if (!assertions.length) {
    assert("hasExpectations", false, "at least one expectation", "the case declares none");
  }

  return finish(def, assertions, { errored: false, warnCount, fieldsTotal, fieldsCorrect });
}

function countWarn(model) {
  return (model.checks || []).filter((c) => c.status === "warn").length;
}

function finish(def, assertions, extra) {
  const passed = assertions.every((a) => a.ok);
  const xfail = def.expectedToFail === true;
  // xfail semantics, as in pytest: a known gap must not turn CI red, but a
  // known gap that starts passing is news — someone fixed it and the case
  // needs to be promoted.
  const status = xfail ? (passed ? "xpass" : "xfail") : (passed ? "pass" : "fail");
  return {
    id: def.id,
    kind: def.kind || "rule",
    title: def.title || def.id,
    status,
    gap: def.gap || null,
    assertions,
    ...extra,
  };
}

/** Roll per-case results up into the numbers the baseline gate compares. */
export function aggregate(results) {
  const counted = (s) => results.filter((r) => r.status === s).length;
  const rate = (name) => {
    const rel = results.filter((r) => r.assertions.some((a) => a.name === name));
    if (!rel.length) return null;
    const ok = rel.filter((r) => r.assertions.find((a) => a.name === name).ok).length;
    return { ok, of: rel.length, pct: round(ok / rel.length * 100) };
  };
  const fieldsTotal = results.reduce((a, r) => a + (r.fieldsTotal || 0), 0);
  const fieldsCorrect = results.reduce((a, r) => a + (r.fieldsCorrect || 0), 0);

  return {
    cases: results.length,
    pass: counted("pass"),
    fail: counted("fail"),
    xfail: counted("xfail"),
    xpass: counted("xpass"),
    passRate: round(counted("pass") / Math.max(1, results.length - counted("xfail") - counted("xpass")) * 100),
    weldCountExact: rate("weldCount"),
    fieldWeldsExact: rate("fieldWelds"),
    spoolCountExact: rate("spoolCount"),
    registerExact: rate("register"),
    registerFieldAccuracy: fieldsTotal ? round(fieldsCorrect / fieldsTotal * 100) : null,
    registerFields: { correct: fieldsCorrect, of: fieldsTotal },
    warnings: results.reduce((a, r) => a + (r.warnCount || 0), 0),
  };
}

const round = (n) => Math.round(n * 100) / 100;
