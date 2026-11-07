/**
 * The SLD symbol vocabulary, VERSIONED (Phase 12.3). Adding a class is a new vocabulary version; a class is never reinterpreted in place.
 *   detect: "geometry"  — a shape rule in classify.mjs can find it; "text" — recognised from printed text only; "topology" — needs connectivity (Phase 12.4):
 *           listed so the contract can carry it, NEVER produced by this phase.
 * Unknown shapes are class UNKNOWN with their evidence kept; a class is never guessed from a nearby word alone.
 */
export const VOCAB_VERSION = "sld-vocab/1";
export const UNKNOWN = "UNKNOWN";

const C = (id, group, detect, label, note = "") => ({ id, group, detect, label, note });
export const CLASSES = Object.freeze([
  C("transformer", "power", "geometry", "Transformer", "two or three overlapping circles"),
  C("generator", "power", "geometry", "Generator", "circle with G"),
  C("motor", "power", "geometry", "Motor", "circle with M"),
  C("load", "power", "text", "Load", "a box or arrow labelled LOAD"),
  C("ups", "power", "text", "UPS", "a box labelled UPS"),
  C("battery", "power", "geometry", "Battery", "alternating long / short parallel plates"),
  C("rectifier", "power", "text", "Rectifier", "a box labelled REC / RECT / AC-DC"),
  C("inverter", "power", "text", "Inverter", "a box labelled INV / DC-AC"),
  C("circuit_breaker", "switching", "geometry", "Circuit breaker", "square crossed by an X"),
  C("isolator", "switching", "geometry", "Isolator / disconnect switch", "short oblique blade across a conductor"),
  C("load_break_switch", "switching", "text", "Load break switch", "only when printed as LBS / load break"),
  C("fuse", "switching", "geometry", "Fuse", "narrow rectangle on a conductor"),
  C("contactor", "switching", "text", "Contactor", "only when printed as K / contactor"),
  C("relay", "switching", "text", "Relay", "device code in a box / circle"),
  C("earthing_switch", "switching", "text", "Earthing switch", "only when printed as ES / earthing switch"),
  C("busbar", "distribution", "geometry", "Busbar", "long heavy line"),
  C("bus_coupler", "distribution", "topology", "Bus coupler", "needs the two bus sections it joins"),
  C("bus_section", "distribution", "topology", "Bus section", "needs connectivity"),
  C("feeder", "distribution", "topology", "Feeder", "a role, not a shape"),
  C("incoming_feeder", "distribution", "topology", "Incoming feeder", "a role, not a shape"),
  C("outgoing_feeder", "distribution", "topology", "Outgoing feeder", "a role, not a shape"),
  C("panel_switchgear", "distribution", "geometry", "Panel / switchgear", "large outline holding several symbols"),
  C("current_transformer", "instrument", "geometry", "Current transformer (CT)", "small circle on a conductor"),
  C("voltage_transformer", "instrument", "geometry", "Voltage transformer (VT / PT)", "two small overlapping circles — ambiguous with a transformer"),
  C("ammeter", "instrument", "geometry", "Ammeter", "circle with A"),
  C("voltmeter", "instrument", "geometry", "Voltmeter", "circle with V"),
  C("protection_relay", "instrument", "geometry", "Protection relay", "box / circle with an ANSI device code"),
  C("energy_meter", "instrument", "geometry", "Energy meter", "circle with Wh / kWh"),
  C("connection_line", "connection", "geometry", "Electrical connection line", "a drawn conductor segment — NOT connectivity"),
  C("junction", "connection", "geometry", "Junction", "small filled dot"),
  C("ground", "connection", "geometry", "Ground / earth", "stacked plates of decreasing length"),
  C("offpage_reference", "annotation", "geometry", "Off-page reference", "pentagon / arrow outline or a box with an off-page text"),
  C("cable_annotation", "annotation", "text", "Cable annotation", "text with cores × size / insulation"),
  C("equipment_tag", "annotation", "text", "Equipment tag", "text shaped like a tag"),
  C("voltage_annotation", "annotation", "text", "Voltage annotation", "text with kV / V"),
  C("rating_annotation", "annotation", "text", "Rating annotation", "text with kVA / MW / A / Hz / %Z …"),
  C("text_label", "annotation", "text", "Other text", "kept; never discarded"),
]);
export const CLASS_IDS = Object.freeze(new Set([...CLASSES.map((c) => c.id), UNKNOWN]));
export const GEOMETRY_CLASSES = Object.freeze(new Set(CLASSES.filter((c) => c.detect === "geometry").map((c) => c.id)));
export const TOPOLOGY_CLASSES = Object.freeze(new Set(CLASSES.filter((c) => c.detect === "topology").map((c) => c.id)));

/** what printed text INSIDE (or touching) a symbol's outline supports. Evidence for a class, never proof on its own. */
export const INNER_TEXT = Object.freeze({
  circle: [[/^M$/i, "motor"], [/^G$/i, "generator"], [/^A$/i, "ammeter"], [/^V$/i, "voltmeter"], [/^(?:Wh|kWh|MWh|WH|KWH)$/, "energy_meter"], [/^(?:CT)$/i, "current_transformer"], [/^(?:VT|PT)$/i, "voltage_transformer"]],
  rect: [[/^UPS$/i, "ups"], [/^(?:REC|RECT|AC\s?[-/]\s?DC)$/i, "rectifier"], [/^(?:INV|DC\s?[-/]\s?AC)$/i, "inverter"], [/^(?:BAT|BATT|BATTERY)$/i, "battery"], [/^LOAD$/i, "load"],
    [/^(?:LBS|LBSW)$/i, "load_break_switch"], [/^K\d*$/i, "contactor"], [/^(?:ES|E\/S)$/i, "earthing_switch"], [/^(?:REL|R|PR|MPR)$/i, "protection_relay"]],
});
