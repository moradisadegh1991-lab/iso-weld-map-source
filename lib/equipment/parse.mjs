/**
 * Reading an equipment list.
 *
 * WHY NO MODEL RUNS HERE
 *
 * An equipment list is a TABLE. It arrives as an Excel sheet or a CSV far
 * more often than as a scan, and for a table a language model is strictly
 * worse than a parser: it costs money, it takes seconds instead of
 * milliseconds, and — the part that matters — it can return a tag number
 * that was never in the file. A parser cannot invent "P-2101A".
 *
 * So the model is the FALLBACK, not the default. It earns its place only
 * when the list arrives as a scan, and even then it is told to transcribe
 * rather than to classify. See the `equipment` pass in app/api/extract.
 *
 * This file is the deterministic path, and it follows the same discipline as
 * lib/truth/parse.mjs: forgiving about SHAPE, strict about MEANING. It will
 * take a comma, a tab, aligned columns or Persian headers; it will never
 * guess a value it did not read.
 */
import { parseDelimited, guessMapping } from "../truth/parse.mjs";

const S = "[\\s_.\\-]*";

/**
 * Header spellings seen on real equipment lists, in both languages.
 *
 * `no` is matched with a negative lookahead on "list"/"sheet", because an
 * equipment list's own document number sits in a column called "LIST NO" on
 * some templates and would otherwise capture the tag column.
 */
export const EQUIPMENT_HEADERS = {
  tagNo: [new RegExp(`(equip(ment)?${S})?tag${S}(no|number)?`, "i"),
          new RegExp(`^item${S}(no|number)$`, "i"),
          /شماره\s*تگ/, /^تگ$/, /پلاک/],
  description: [/\b(description|service|name|title)\b/i, /شرح|سرویس|نام/],
  type: [new RegExp(`\\b(type|kind|category|equipment${S}type)\\b`, "i"), /نوع/],
  subsystem: [new RegExp(`\\bsub${S}system\\b`, "i"), /زیر\s*سیستم|ساب\s*سیستم/],
  system: [new RegExp(`^system(${S}(no|code))?$`, "i"), /^سیستم$/],
  unit: [/\b(unit|area|plant)\b/i, /واحد|منطقه/],
  pid: [/\bp\s*&?\s*id\b/i, /\bpfd\b/i, /پی\s*اند\s*آی\s*دی/],
  weight: [/\b(weight|mass)\b/i, /وزن/],
  qty: [/\b(qty|quantity|no${S}off|count)\b/i, /تعداد/],
  vendor: [/\b(vendor|manufacturer|maker|supplier)\b/i, /سازنده|وندور|تأمین/],
};

/**
 * Which precedence chain a piece of equipment follows.
 *
 * THE DESCRIPTION DECIDES, NOT THE TAG PREFIX. Tag letter conventions vary
 * between projects and even between units — "C-" is a compressor on one job
 * and a column on the next — so a classifier keyed on the prefix is a
 * classifier that is confidently wrong on somebody else's list. It would
 * hand a column the alignment hold points of a compressor, or hide a
 * compressor's from it, and both are worse than not answering.
 *
 * Anything this cannot place returns null. `tagStatus` already refuses to
 * produce a verdict for a kind with no chain, so an unclassified tag is
 * visibly unclassified rather than quietly given the wrong chain. That is
 * F-10 applied to a different input: a classifier fed something it cannot
 * read must not return an answer.
 */
const ROTATING_WORDS = [
  /\bpumps?\b/i, /\bcompressors?\b/i, /\bblowers?\b/i, /\bturbines?\b/i,
  /\bagitators?\b/i, /\bmixers?\b/i, /\bcentrifuges?\b/i, /\bgenerators?\b/i,
  /\bextruders?\b/i, /\bexpanders?\b/i, /\bfans?\b/i, /\bblowers?\b/i,
  /پمپ/, /کمپرسور/, /بلوئر|دمنده/, /توربین/, /همزن|میکسر/, /سانتریفیوژ/, /ژنراتور/,
];

const STATIC_WORDS = [
  /\bvessels?\b/i, /\bdrums?\b/i, /\bcolumns?\b/i, /\btowers?\b/i,
  /\bexchangers?\b/i, /\breboilers?\b/i, /\bcondensers?\b/i, /\btanks?\b/i,
  /\breactors?\b/i, /\bseparators?\b/i, /\bsilos?\b/i, /\bhoppers?\b/i,
  /\bknock[\s-]*out\b/i, /\bscrubbers?\b/i,
  /\baccumulators?\b/i, /\b(driers?|dryers?)\b/i, /\bconverters?\b/i,
  // Fired equipment has no shaft to align, so the static chain is the right
  // one — but it is not a complete one: refractory dry-out and tube-coil
  // checks are not in it. A fired-heater chain is the honest next step.
  //
  // "Boiler" is deliberately NOT here. "Boiler Feed Water Pump" is a pump,
  // and with "boiler" in this list it would read both ways and drop to
  // unclassified — a false ambiguity on one of the most common tags in a
  // plant.
  /\bfurnaces?\b/i, /\bfired[\s-]*heaters?\b/i, /\breformers?\b/i,
  /کوره/,
  /مخزن/, /برج/, /مبدل/, /راکتور|رآکتور/, /جداکننده/, /تانک/, /سیلو/,
];

/**
 * Deliberately NOT classified.
 *
 * An air cooler has a fan that needs aligning and a bundle that does not;
 * a package or a skid is a box whose contents decide. Guessing either way
 * puts a real hold point on the wrong side of a handover, so these are
 * handed to the engineer by name instead.
 */
const AMBIGUOUS_WORDS = [
  /\bair[\s-]*cool/i, /\bfin[\s-]*fan\b/i, /\bpackages?\b/i, /\bskids?\b/i,
  /هواخنک/, /پکیج/, /اسکید/,
];

/**
 * @returns {{kind: "rotating"|"static"|null, why: string}}
 */
export function classifyKind(...texts) {
  const t = texts.filter(Boolean).join(" ");
  if (!t.trim()) return { kind: null, why: "شرحی برای تشخیص نوع نبود" };

  const hit = (list) => list.find((re) => re.test(t));
  const amb = hit(AMBIGUOUS_WORDS);
  if (amb) return { kind: null, why: "نوعش قطعی نیست و باید مهندس تعیین کند" };

  const rot = hit(ROTATING_WORDS);
  const sta = hit(STATIC_WORDS);
  // A description that matches both — "pump house vessel" — is a description
  // this cannot read, not a coin to flip.
  if (rot && sta) return { kind: null, why: "شرح هم دوّار و هم ثابت می‌خوانَد" };
  if (rot) return { kind: "rotating", why: "دوّار" };
  if (sta) return { kind: "static", why: "ثابت" };
  return { kind: null, why: "شرح با هیچ نوع شناخته‌شده‌ای نخواند" };
}

/** A tag number worth importing: it has letters and digits, and no spaces. */
const looksLikeTag = (s) => /^[A-Za-z0-9][A-Za-z0-9\-_/.]{1,30}$/.test(s) && /\d/.test(s);

/**
 * Turn parsed rows into tag records.
 *
 * Rows without a plausible tag number are skipped rather than imported as
 * junk: an equipment list carries section headings, blank separators and a
 * totals row, and every one of them would otherwise become a tag that a
 * subsystem waits on forever.
 */
export function toTags(rows, mapping) {
  const at = (r, f) => (mapping[f] == null ? null : String(r[mapping[f]] ?? "").trim());
  const out = [];
  const skipped = [];

  for (const r of rows) {
    const tagNo = at(r, "tagNo");
    if (!tagNo) continue;                       // blank line
    if (!looksLikeTag(tagNo)) { skipped.push(tagNo); continue; }

    const description = at(r, "description") || null;
    const type = at(r, "type") || null;
    const { kind, why } = classifyKind(description, type);
    out.push({
      tagNo,
      description,
      type,
      kind,
      kindReason: why,
      subsystem: at(r, "subsystem") || null,
      system: at(r, "system") || null,
      unit: at(r, "unit") || null,
      pid: at(r, "pid") || null,
      vendor: at(r, "vendor") || null,
    });
  }

  // A tag repeated in the list is one tag described twice, but the two rows
  // may disagree. Reporting it beats silently keeping whichever came last.
  const seen = new Map();
  const duplicates = [];
  for (const t of out) {
    const k = t.tagNo.toUpperCase();
    if (seen.has(k)) duplicates.push(t.tagNo);
    else seen.set(k, t);
  }

  return { tags: [...seen.values()], skipped, duplicates };
}

/**
 * The whole deterministic path, from pasted text to tag records.
 *
 * @returns {{headers, mapping, unmapped, tags, skipped, duplicates, suspectDelimiter}}
 */
export function parseEquipmentList(text) {
  const { headers, rows, suspectDelimiter } = parseDelimited(text);
  if (!headers.length) return { headers: [], tags: [], error: "چیزی خوانده نشد." };
  if (suspectDelimiter) {
    return { headers, tags: [], suspectDelimiter,
      error: "جداکنندهٔ ستون‌ها شناخته نشد — کل سطر در یک ستون افتاد." };
  }
  const { mapping, unmapped } = guessMapping(headers, EQUIPMENT_HEADERS);
  if (mapping.tagNo == null) {
    return { headers, mapping, unmapped, tags: [],
      error: `ستون شمارهٔ تگ پیدا نشد. سرستون‌ها: ${headers.join(" · ")}` };
  }
  return { headers, mapping, unmapped, ...toTags(rows, mapping) };
}

/** How many were placed, and what is left for a person. Honest counters. */
export function summarise({ tags = [] }) {
  const byKind = { rotating: 0, static: 0, unclassified: 0 };
  for (const t of tags) byKind[t.kind || "unclassified"]++;
  return {
    total: tags.length,
    ...byKind,
    pctClassified: tags.length
      ? Math.round(((tags.length - byKind.unclassified) / tags.length) * 1000) / 10
      : 0,
  };
}
