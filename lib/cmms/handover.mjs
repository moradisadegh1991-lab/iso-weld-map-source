/**
 * Handover to maintenance (CMMS / EAM): the asset master a maintenance
 * system needs for every tag, the checklist that says whether a tag can be
 * handed over, and the export.
 *
 * ISO 14224 (2016) arranges equipment in a taxonomy; this platform already
 * holds levels 4–6 of it: the unit (plant/unit), the system and subsystem
 * (section/system), and the tag (equipment unit). The equipment CLASS is
 * assigned by an engineer from ISO 14224 Annex A — never read off a tag
 * prefix, because "P-" is a pump on one project and a package on another.
 * The list below is the subset of Annex A classes this platform offers; a
 * class outside it is recorded as given, not rejected, and labelled as such.
 *
 * CRITICALITY is company policy: the levels (A/B/C, 1–5, …) are what the
 * project states, and a tag's level comes with its basis. No levels stated,
 * no criticality accepted — there is no default ranking.
 *
 * FUNCTIONAL LOCATION — the code the CMMS files the tag under — is built
 * from the project's template, e.g. "{plant}-{unit}-{system}-{tag}". No
 * template, no code: inventing a structure the CMMS will then refuse is
 * worse than leaving it blank.
 *
 * READY FOR HANDOVER when: class, criticality and functional location are
 * known; manufacturer, model and serial are recorded; the tag's subsystem
 * has an accepted MC; and, where the tag was bought on a PO, the vendor's
 * operation and maintenance manual (VDRL code IOM) is accepted. A tag with
 * no PO in the platform has no IOM to check — "not recorded", which holds
 * it, because an asset without its manual cannot be maintained. And the tag
 * has an APPROVED maintenance plan: at least one approved task (a considered
 * run-to-failure decision counts — it is a plan) — lib/cmms/maintenance.mjs.
 */

export const ISO14224_CLASSES = {
  // Rotating
  BL: "Blowers and fans", CE: "Combustion engines", CF: "Centrifuges", CO: "Compressors",
  EG: "Electric generators", EM: "Electric motors", GT: "Gas turbines", LE: "Liquid expanders",
  MI: "Mixers", PU: "Pumps", ST: "Steam turbines", TE: "Turboexpanders",
  // Mechanical
  CR: "Cranes", HB: "Heaters and boilers", HE: "Heat exchangers", PI: "Piping", VE: "Vessels", WI: "Winches",
  // Safety and control
  FG: "Fire and gas detectors", VA: "Valves",
};

export const FLOC_TOKENS = ["plant", "unit", "system", "subsystem", "tag"];

/**
 * Build a functional location from the project's template.
 * @returns {{code: string|null, reason?: string}}
 */
export function flocFor(template, ctx) {
  if (!String(template || "").trim()) return { code: null, reason: "الگوی Functional Location در مشخصات پروژه تعیین نشده" };
  const used = [...String(template).matchAll(/\{([a-z]+)\}/g)].map((m) => m[1]);
  const unknown = used.filter((t) => !FLOC_TOKENS.includes(t));
  if (unknown.length) return { code: null, reason: `الگو نشانهٔ ناشناخته دارد: ${unknown.join("، ")}` };
  if (!used.includes("tag")) return { code: null, reason: "الگو باید {tag} داشته باشد — وگرنه دو تگ یک مکان می‌گیرند" };
  const missing = used.filter((t) => !String(ctx[t] ?? "").trim());
  if (missing.length) return { code: null, reason: `برای این تگ معلوم نیست: ${missing.join("، ")}` };
  return { code: String(template).replace(/\{([a-z]+)\}/g, (_, t) => String(ctx[t]).trim()) };
}

/**
 * The parent location: the template up to the tag, i.e. the system the
 * CMMS hangs the tag under. Null when the tag's own location is unknown.
 */
export function flocParent(template, ctx) {
  if (!flocFor(template, ctx).code) return null;
  const parent = String(template).replace(/[-./_\s]*\{tag\}.*$/, "");
  if (!parent.includes("{")) return parent.trim() || null;
  return parent.replace(/\{([a-z]+)\}/g, (_, t) => String(ctx[t]).trim());
}

/** The project's criticality levels, parsed; [] when none are stated. */
export function criticalityLevels(stated) {
  return [...new Set(String(stated || "").split(/[,،\s]+/).map((x) => x.trim()).filter(Boolean))];
}

/** Problems with a tag's asset master entry, or []. */
export function masterProblems({ isoClass, criticality, criticalityBasis, yearBuilt }, levels) {
  const out = [];
  if (isoClass && !/^[A-Z]{2}$/.test(isoClass)) out.push("کد کلاس ISO 14224 دو حرف بزرگ است (مثلاً PU)");
  if (criticality) {
    if (!levels.length) out.push("سطوح Criticality در مشخصات پروژه تعیین نشده؛ رتبه‌ای پذیرفته نمی‌شود");
    else if (!levels.includes(criticality)) out.push(`Criticality «${criticality}» جزو سطوح پروژه (${levels.join("، ")}) نیست`);
    if (!String(criticalityBasis || "").trim()) out.push("مبنای Criticality (ارزیابی ریسک، شمارهٔ گزارش) لازم است");
  }
  const y = yearBuilt === null || yearBuilt === undefined || yearBuilt === "" ? null : Number(yearBuilt);
  if (y !== null && !(Number.isInteger(y) && y >= 1900 && y <= 2100)) out.push("سال ساخت معتبر نیست");
  return out;
}

/**
 * Whether a tag can be handed over, item by item.
 * Each item: ok (true) · missing (false) · unknown (null, the platform holds
 * no source to judge from).
 */
export function handoverChecklist({ master = {}, floc, mcAccepted, iom, pmApproved = 0 }) {
  const has = (v) => !!String(v ?? "").trim();
  const items = [
    { key: "class", ok: has(master.isoClass) },
    { key: "criticality", ok: has(master.criticality) },
    { key: "floc", ok: floc?.code ? true : false, note: floc?.reason || null },
    { key: "manufacturer", ok: has(master.manufacturer) },
    { key: "model", ok: has(master.model) },
    { key: "serial", ok: has(master.serialNo) },
    { key: "mc", ok: mcAccepted === true ? true : mcAccepted === false ? false : null },
    { key: "iom", ok: iom === "accepted" ? true : iom === null || iom === undefined ? null : false, note: iom && iom !== "accepted" ? iom : null },
    { key: "pm", ok: Number(pmApproved) > 0 },
  ];
  return { items, ready: items.every((i) => i.ok === true), open: items.filter((i) => i.ok !== true).map((i) => i.key) };
}

export const CHECK_FA = {
  class: "کلاس ISO 14224", criticality: "Criticality", floc: "Functional Location", manufacturer: "سازنده",
  model: "مدل", serial: "شمارهٔ سریال", mc: "MC پذیرفته‌شدهٔ ساب‌سیستم", iom: "دفترچهٔ O&M فروشنده (IOM)",
  pm: "برنامهٔ نگهداری (PM) تأییدشده",
};

/** CSV with a UTF-8 BOM, so Excel opens Persian text correctly. Every field quoted. */
export function toCsv(columns, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return "﻿" + [columns.map(([, h]) => q(h)).join(","),
    ...rows.map((r) => columns.map(([k]) => q(r[k])).join(","))].join("\r\n") + "\r\n";
}
