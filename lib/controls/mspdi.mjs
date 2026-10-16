/**
 * An MS Project schedule, read from its XML form (MSPDI).
 *
 * MS Project saves this itself: File ◄ Save As ◄ "XML Format (*.xml)". The
 * binary .mpp needs Java (MPXJ) to read, which a site server does not have;
 * the XML is the same plan, task for task, and is what the platform takes.
 *
 * What is read is what the file states — names, outline, dates, the
 * baseline, % complete, links, and the custom fields by the alias the
 * planner gave them (WF, Plan%, Project Price …). Nothing is rescheduled
 * here: the dates are MS Project's, as of the file's status date.
 *
 * The format is regular enough that a scoped tag reader is exact for it;
 * there is no general XML parser in this repository and this does not try
 * to be one.
 */

const DAY_MIN = 480; // default when the file states no MinutesPerDay

const unescape = (s) => s
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, "&");

/** The text of the first <tag> directly inside `xml` (no nesting of the same tag in MSPDI scalars). */
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? unescape(m[1].trim()) : null;
}
/** Every <name>…</name> block, outermost, in order. */
function blocks(xml, name) {
  const out = [];
  const open = `<${name}>`, close = `</${name}>`;
  let i = 0;
  for (;;) {
    const a = xml.indexOf(open, i);
    if (a < 0) break;
    const b = xml.indexOf(close, a);
    if (b < 0) break;
    out.push(xml.slice(a + open.length, b));
    i = b + close.length;
  }
  return out;
}
/** Remove nested blocks so a task's own scalars are not read from its baseline or links. */
const strip = (xml, ...names) => names.reduce((s, n) => s.replace(new RegExp(`<${n}>[\\s\\S]*?</${n}>`, "g"), ""), xml);

const date = (s) => (s ? s.slice(0, 10) : null);
const num = (s) => (s == null || s === "" ? null : Number(s));
/** ISO-8601 duration (PT123H30M0S) to working days. */
export function durationDays(s, minutesPerDay = DAY_MIN) {
  if (!s) return null;
  const m = s.match(/^-?P(?:(\d+(?:\.\d+)?)D)?T?(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/);
  if (!m) return null;
  const minutes = (Number(m[1] || 0) * 24 * 60) + Number(m[2] || 0) * 60 + Number(m[3] || 0) + Number(m[4] || 0) / 60;
  return Math.round((minutes / minutesPerDay) * 100) / 100;
}

/** MSPDI link type codes. */
export const LINK_TYPE = { 0: "FF", 1: "FS", 2: "SF", 3: "SS" };

/**
 * Parse an MSPDI document.
 * Returns { title, author, statusDate, startDate, finishDate, lastSaved,
 *           fields: {alias → fieldName}, tasks: [...], links: [...] }.
 */
export function parseMspdi(xml) {
  if (!/<Project[\s>]/.test(xml) || !xml.includes("<Tasks>")) {
    throw Object.assign(new Error("این فایل XML برنامهٔ MS Project نیست (Project/Tasks پیدا نشد). در MS Project: Save As ◄ XML Format."),
      { status: 400, code: "NOT_MSPDI" });
  }
  const head = xml.slice(0, xml.indexOf("<Tasks>"));
  const minutesPerDay = num(tag(head, "MinutesPerDay")) || DAY_MIN;

  // Custom fields: FieldID → the planner's alias (or the field name when unnamed).
  const fieldById = {};
  const ext = head.match(/<ExtendedAttributes>([\s\S]*?)<\/ExtendedAttributes>/);
  for (const b of ext ? blocks(ext[1], "ExtendedAttribute") : []) {
    const id = tag(b, "FieldID");
    if (id) fieldById[id] = tag(b, "Alias") || tag(b, "FieldName");
  }

  const tasksXml = xml.slice(xml.indexOf("<Tasks>"), xml.indexOf("</Tasks>"));
  const tasks = [];
  const links = [];
  for (const b of blocks(tasksXml, "Task")) {
    const own = strip(b, "Baseline", "PredecessorLink", "ExtendedAttribute", "TimephasedData");
    const uid = num(tag(own, "UID"));
    if (uid == null || tag(own, "IsNull") === "1") continue;
    const baseline = blocks(b, "Baseline").map((x) => ({ n: tag(x, "Number"), start: tag(x, "Start"), finish: tag(x, "Finish") }))
      .find((x) => x.n === "0") || {};
    const custom = {};
    for (const e of blocks(b, "ExtendedAttribute")) {
      const alias = fieldById[tag(e, "FieldID")];
      if (alias) custom[alias] = tag(e, "Value");
    }
    for (const l of blocks(b, "PredecessorLink")) {
      links.push({
        predUid: num(tag(l, "PredecessorUID")), succUid: uid,
        type: LINK_TYPE[tag(l, "Type")] || "FS",
        // LinkLag is in tenths of a minute.
        lagDays: Math.round(((num(tag(l, "LinkLag")) || 0) / 10 / minutesPerDay) * 100) / 100,
      });
    }
    tasks.push({
      uid, id: num(tag(own, "ID")), name: tag(own, "Name") || "",
      wbs: tag(own, "WBS"), outline: tag(own, "OutlineNumber"), level: num(tag(own, "OutlineLevel")),
      summary: tag(own, "Summary") === "1", milestone: tag(own, "Milestone") === "1",
      start: date(tag(own, "Start")), finish: date(tag(own, "Finish")),
      blStart: date(baseline.start), blFinish: date(baseline.finish),
      actStart: date(tag(own, "ActualStart")), actFinish: date(tag(own, "ActualFinish")),
      durationDays: durationDays(tag(own, "Duration"), minutesPerDay),
      pct: num(tag(own, "PercentComplete")),
      critical: tag(own, "Critical") === "1",
      custom,
    });
  }
  // Parent by outline number: "3.1.2" belongs to "3.1".
  const byOutline = new Map(tasks.map((t) => [t.outline, t]));
  for (const t of tasks) {
    const parent = t.outline && t.outline.includes(".") ? byOutline.get(t.outline.slice(0, t.outline.lastIndexOf("."))) : null;
    t.parentUid = parent ? parent.uid : (t.level > 0 ? byOutline.get("0")?.uid ?? null : null);
  }
  return {
    title: tag(head, "Title") || tag(head, "Name"),
    author: tag(head, "Author"),
    lastSaved: tag(head, "LastSaved"),
    statusDate: date(tag(head, "StatusDate")),
    startDate: date(tag(head, "StartDate")),
    finishDate: date(tag(head, "FinishDate")),
    fields: Object.values(fieldById),
    tasks, links,
  };
}
