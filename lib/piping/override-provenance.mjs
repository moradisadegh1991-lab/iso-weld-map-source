/** Presentation of the server's history association; never infer physical continuity from a printed number. */
const NUMBER_MATCHES = new Set([
  "same_run_number_unverified", "same_revision_number_unverified", "cross_revision_number_unverified",
]);
export function overrideProvenance(row) {
  if (row?.match_basis === "exact_spool" && row.same_spool === true) {
    return { basis: "exact_spool", exact: true, label: "pi.ex.ovr.match.exact", hint: "pi.ex.ovr.match.exactHint" };
  }
  if (NUMBER_MATCHES.has(row?.match_basis) && row.same_spool === false) {
    return { basis: row.match_basis, exact: false, label: `pi.ex.ovr.match.${row.match_basis}`, hint: "pi.ex.ovr.match.numberHint" };
  }
  return { basis: "unknown", exact: false, label: "pi.ex.ovr.match.unknown", hint: "pi.ex.ovr.match.unknownHint" };
}
