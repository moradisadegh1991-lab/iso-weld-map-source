/**
 * The daily site report's content: what it holds and what is accepted.
 *
 * People, machines and materials are three lists, each with its own unit,
 * and never one column of numbers — the old Access daily report summed
 * scaffolding tools, drinking water and welders in a single field, and its
 * totals meant nothing. A value the platform already holds (timesheets, HSE,
 * completed steps) is brought in and marked as such; a value typed here is
 * marked as typed. Nothing is filled in by guess: an empty list is "none
 * recorded", not zero.
 */

export const SOURCE = { manual: "ورود دستی", hr: "کارکرد منابع انسانی", platform: "داده‌های پروژه" };
export const SHIFT = { day: "روز", night: "شب", both: "روز و شب" };
export const WEATHER = { clear: "صاف", cloudy: "ابری", rain: "بارانی", wind: "باد شدید", dust: "گرد و خاک", hot: "گرمای شدید", fog: "مه" };

const num = (v) => (v === "" || v == null ? null : Number(v));
const text = (v) => { const s = String(v ?? "").trim(); return s || null; };
const src = (v) => (SOURCE[v] ? v : "manual");

/**
 * Normalise what a form sent and list what is wrong with it.
 * @returns {{ content, problems: string[] }}
 */
export function checkDaily(input = {}) {
  const p = [];
  const w = input.weather || {};
  const content = {
    shift: SHIFT[input.shift] ? input.shift : "day",
    working: input.working !== false,
    weather: { condition: WEATHER[w.condition] ? w.condition : null, tempMin: num(w.tempMin), tempMax: num(w.tempMax), humidity: num(w.humidity) },
    manpower: [], equipment: [], materials: [], work: [], stoppages: [],
    hse: { incidents: num(input.hse?.incidents), permits: num(input.hse?.permits), observations: num(input.hse?.observations),
      note: text(input.hse?.note), source: src(input.hse?.source) },
    notes: text(input.notes),
  };
  const { tempMin, tempMax, humidity } = content.weather;
  for (const [k, v] of [["حداقل دما", tempMin], ["حداکثر دما", tempMax]]) if (v != null && (!Number.isFinite(v) || v < -40 || v > 65)) p.push(`${k} °C باید عددی میان ۴۰- و ۶۵ باشد.`);
  if (tempMin != null && tempMax != null && tempMin > tempMax) p.push("حداقل دما از حداکثر بیشتر است.");
  if (humidity != null && (!Number.isFinite(humidity) || humidity < 0 || humidity > 100)) p.push("رطوبت باید درصدی میان ۰ و ۱۰۰ باشد.");

  const count = (v, label, row) => {
    const n = num(v);
    if (n == null) return 0;
    if (!Number.isInteger(n) || n < 0) { p.push(`${label} در ردیف ${row} باید عدد صحیح نامنفی باشد.`); return 0; }
    return n;
  };
  (input.manpower || []).forEach((r, i) => {
    const row = i + 1;
    if (!text(r.role)) { p.push(`سمت در ردیف ${row} نیروی انسانی لازم است.`); return; }
    const m = { role: text(r.role), discipline: text(r.discipline), employer: text(r.employer),
      present: count(r.present, "تعداد حاضر", row), leave: count(r.leave, "تعداد مرخصی", row), night: count(r.night, "تعداد شب‌کار", row),
      hours: num(r.hours), source: src(r.source) };
    if (m.hours != null && (!Number.isFinite(m.hours) || m.hours < 0)) p.push(`ساعت کار در ردیف ${row} نامعتبر است.`);
    content.manpower.push(m);
  });
  (input.equipment || []).forEach((r, i) => {
    const row = i + 1;
    if (!text(r.name)) { p.push(`نام دستگاه در ردیف ${row} ماشین‌آلات لازم است.`); return; }
    content.equipment.push({ name: text(r.name), owner: text(r.owner), working: count(r.working, "تعداد فعال", row),
      idle: count(r.idle, "تعداد غیرفعال", row), note: text(r.note), source: src(r.source) });
  });
  (input.materials || []).forEach((r, i) => {
    const row = i + 1;
    if (!text(r.name)) { p.push(`نام مصالح در ردیف ${row} لازم است.`); return; }
    const qty = num(r.qty);
    if (!text(r.unit)) p.push(`واحد «${text(r.name)}» لازم است — مقدار بی‌واحد معنایی ندارد.`);
    if (qty == null || !Number.isFinite(qty) || qty < 0) p.push(`مقدار «${text(r.name)}» باید عدد نامنفی باشد.`);
    content.materials.push({ name: text(r.name), unit: text(r.unit), qty, note: text(r.note), source: src(r.source) });
  });
  (input.work || []).forEach((r, i) => {
    if (!text(r.description)) { p.push(`شرح کار در ردیف ${i + 1} لازم است.`); return; }
    const qty = num(r.qty);
    if (qty != null && (!Number.isFinite(qty) || qty < 0)) p.push(`مقدار کار در ردیف ${i + 1} نامعتبر است.`);
    if (qty != null && !text(r.unit)) p.push(`واحد مقدار کار در ردیف ${i + 1} لازم است.`);
    content.work.push({ description: text(r.description), discipline: text(r.discipline), location: text(r.location), qty, unit: text(r.unit),
      state: r.state === "claimed" ? "claimed" : r.state === "done" ? "done" : null, ref: text(r.ref), source: src(r.source) });
  });
  (input.stoppages || []).forEach((r, i) => {
    if (!text(r.reason)) { p.push(`علت توقف در ردیف ${i + 1} لازم است.`); return; }
    const hours = num(r.hours);
    if (hours != null && (!Number.isFinite(hours) || hours < 0 || hours > 24)) p.push(`ساعت توقف در ردیف ${i + 1} باید میان ۰ و ۲۴ باشد.`);
    content.stoppages.push({ reason: text(r.reason), scope: text(r.scope), hours, note: text(r.note) });
  });
  for (const [k, v] of Object.entries({ "حوادث": content.hse.incidents, "مجوزهای کار": content.hse.permits, "مشاهدات": content.hse.observations })) {
    if (v != null && (!Number.isInteger(v) || v < 0)) p.push(`تعداد ${k} باید عدد صحیح نامنفی باشد.`);
  }
  return { content, problems: p };
}

/** Totals for the report head — each list summed in its own unit, never across. */
export function dailyTotals(content) {
  const by = (rows, key, val) => rows.reduce((m, r) => { const k = r[key] || "—"; m[k] = (m[k] || 0) + (val(r) || 0); return m; }, {});
  return {
    people: (content.manpower || []).reduce((s, r) => s + (r.present || 0), 0),
    onLeave: (content.manpower || []).reduce((s, r) => s + (r.leave || 0), 0),
    peopleByDiscipline: by(content.manpower || [], "discipline", (r) => r.present),
    machinesWorking: (content.equipment || []).reduce((s, r) => s + (r.working || 0), 0),
    machinesIdle: (content.equipment || []).reduce((s, r) => s + (r.idle || 0), 0),
    stoppageHours: (content.stoppages || []).reduce((s, r) => s + (r.hours || 0), 0),
  };
}
