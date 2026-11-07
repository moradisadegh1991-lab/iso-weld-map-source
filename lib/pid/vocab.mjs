import { parseTag } from "../instrumentation/isa.mjs";

/** The closed vocabularies of the P&ID draft (pure, no Node imports: the browser uses them too). */
export const CLASSES = ["equipment", "instrument", "line", "valve", "inline", "connector", "tie-in", "process-connection"];
export const EDGE_TYPES = ["process", "signal", "control", "mechanical", "offpage"];
export const REVIEW = ["extracted", "needs_review", "corrected", "approved", "rejected", "unresolved", "ambiguous", "superseded"];
/** Symbols a reader may name, per class. Anything else is "UNKNOWN" — never guessed, never "closest match". */
export const SYMBOLS = {
  equipment: ["pump", "compressor", "heat-exchanger", "vessel", "drum", "column", "tank", "furnace", "filter", "package", "other-equipment"],
  valve: ["gate-valve", "globe-valve", "ball-valve", "butterfly-valve", "check-valve", "control-valve", "safety-valve", "other-valve"],
  inline: ["strainer", "reducer", "orifice", "spectacle-blind", "other-inline"],
  instrument: ["bubble", "control-valve", "analyzer", "switch", "indicator", "other-instrument"],
  line: ["process-line"], connector: ["offpage"], "tie-in": ["tie-in"], "process-connection": ["process-connection"],
};
export const UNKNOWN = "UNKNOWN";

/** The instrument's ISA reading of its tag — what its letters say, nothing more. `null` letters/function when the tag is not ISA. */
export function instrumentFacts(tag) {
  const p = parseTag(tag) || parseTag(String(tag || "").replace(/^\d{2}[- ]?/, ""));
  return p ? { letters: p.letters, loop: p.loop, category: p.category, functions: p.functions, variable: p.variable } : null;
}

