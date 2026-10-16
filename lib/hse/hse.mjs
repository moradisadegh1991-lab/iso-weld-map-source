/**
 * HSE: the deterministic engine behind incidents, rates, permits and
 * observations.
 *
 * INCIDENT CLASS IS DERIVED, NEVER PICKED
 *
 *   An injury's class is decided by the facts recorded about it, in the
 *   order the IOGP safety performance indicators use (IOGP Report 2022su
 *   definitions), most severe first:
 *
 *     FAT  fatality
 *     LWC  lost workday case    — at least one day away from work after the day of injury
 *     RWC  restricted work case — fit for some but not all normal duties after the day of injury
 *     MTC  medical treatment case — treatment beyond first aid by a medical professional
 *     FAC  first aid case
 *     NM   near miss            — no injury at all
 *
 *   A person who picks the class picks the statistics. Recording the facts
 *   instead means the class moves with them: the MTC that turns into two
 *   days off on Monday becomes an LWC without anybody reclassifying it.
 *   When the facts are incomplete there is no class (F-10) — an injury with
 *   no treatment recorded is not a first aid case by default.
 *
 * RATES
 *
 *   LTI = FAT + LWC; recordable (TRI) = FAT + LWC + RWC + MTC. IOGP
 *   normalises per 1 000 000 hours worked; OSHA per 200 000. Both are shown,
 *   labelled, because the two differ by a factor of five and a number
 *   without its base is how two contractors' rates end up compared wrongly.
 *   Zero hours gives no rate.
 *
 * PERMIT TO WORK
 *
 *   Hot work and confined-space entry need a gas test that passes against
 *   limits the PROJECT states — O2 band, LEL, H2S, CO — and a test taken
 *   within the validity window the project states. None of these has a
 *   default here: a permit is not activated against limits nobody wrote
 *   down. The issuer is not the requester. A permit expires at its end
 *   time without anybody closing it, and one longer than the project's
 *   maximum is refused. Hot work overlapping any other open permit in the
 *   same area is flagged as SIMOPS for a person to resolve — flagged, not
 *   refused, because a SIMOPS review can legitimately allow it.
 */

export const CLASSES = {
  FAT: { title: "فوتی", lti: true, recordable: true, rank: 0 },
  LWC: { title: "حادثهٔ منجر به روز کاری ازدست‌رفته", lti: true, recordable: true, rank: 1 },
  RWC: { title: "کار محدود", lti: false, recordable: true, rank: 2 },
  MTC: { title: "درمان پزشکی", lti: false, recordable: true, rank: 3 },
  FAC: { title: "کمک‌های اولیه", lti: false, recordable: false, rank: 4 },
  NM: { title: "شبه‌حادثه", lti: false, recordable: false, rank: 5 },
};

export const TREATMENTS = { none: "بدون درمان", first_aid: "کمک‌های اولیه", medical: "درمان پزشکی" };

/**
 * Class of one incident from its facts.
 * @param {{injured: boolean|null, fatal?: boolean|null, daysAway?: number|null,
 *          restrictedDays?: number|null, treatment?: string|null}} f
 * @returns {{cls: string|null, reason?: string}}
 */
export function classifyIncident(f) {
  if (f.injured === false) {
    if (f.fatal || n(f.daysAway) > 0 || n(f.restrictedDays) > 0 || (f.treatment && f.treatment !== "none"))
      return { cls: null, reason: "«بدون آسیب» با روز ازدست‌رفته یا درمان جور نیست" };
    return { cls: "NM" };
  }
  if (f.injured !== true) return { cls: null, reason: "معلوم نیست کسی آسیب دیده یا نه" };
  if (f.fatal === true) return { cls: "FAT" };
  const missing = [];
  if (f.fatal !== false) missing.push("فوت");
  if (n(f.daysAway) === null) missing.push("روزهای غیبت");
  if (n(f.restrictedDays) === null) missing.push("روزهای کار محدود");
  if (!TREATMENTS[f.treatment]) missing.push("نوع درمان");
  // A lost day decides the class even while the treatment is unrecorded:
  // with fatality ruled out, nothing still missing could change an LWC.
  if (f.fatal === false && n(f.daysAway) > 0) return { cls: "LWC" };
  if (missing.length) return { cls: null, reason: `ثبت نشده: ${missing.join("، ")}` };
  if (n(f.restrictedDays) > 0) return { cls: "RWC" };
  if (f.treatment === "medical") return { cls: "MTC" };
  if (f.treatment === "first_aid") return { cls: "FAC" };
  return { cls: null, reason: "آسیب ثبت شده ولی نه درمانی نه روزی — دست‌کم کمک‌های اولیه را ثبت کنید" };
}

export const BASES = { iogp: 1_000_000, osha: 200_000 };

/**
 * Rates over a set of classified incidents and the hours they happened in.
 * Unclassified incidents are counted apart, never folded into zero.
 */
export function rates(classes, hours) {
  const count = (pred) => classes.filter((c) => c && pred(CLASSES[c])).length;
  const lti = count((c) => c.lti), trc = count((c) => c.recordable);
  const h = n(hours);
  const per = (k, base) => (h > 0 ? Math.round((k * base / h) * 100) / 100 : null);
  return {
    hours: h ?? 0, lti, recordable: trc,
    fatalities: classes.filter((c) => c === "FAT").length,
    unclassified: classes.filter((c) => !c).length,
    ltif: { iogp: per(lti, BASES.iogp), osha: per(lti, BASES.osha) },
    trir: { iogp: per(trc, BASES.iogp), osha: per(trc, BASES.osha) },
  };
}

// ── permits ──────────────────────────────────────────────────────────────

export const PERMIT_TYPES = {
  cold: { title: "کار سرد", gas: false },
  hot: { title: "کار گرم", gas: true },
  confined_space: { title: "ورود به فضای بسته", gas: true, needs: ["attendant"] },
  electrical_isolation: { title: "ایزولاسیون برقی", gas: false, needs: ["isolation_ref"] },
  excavation: { title: "حفاری", gas: false },
  work_at_height: { title: "کار در ارتفاع", gas: false },
  lifting: { title: "بالابری", gas: false },
  radiography: { title: "رادیوگرافی", gas: false },
};

const NEED_TITLE = { attendant: "نگهبان فضای بسته (Standby)", isolation_ref: "شمارهٔ گواهی ایزولاسیون (LOTO)" };

/** The project limits a gas test is judged against, and which are unset. */
export const GAS_LIMITS = {
  hse_o2_min_pct: "حداقل O2 (%)",
  hse_o2_max_pct: "حداکثر O2 (%)",
  hse_lel_max_pct: "حداکثر LEL (%)",
  hse_h2s_max_ppm: "حداکثر H2S (ppm)",
  hse_co_max_ppm: "حداکثر CO (ppm)",
  hse_gas_test_validity_min: "اعتبار تست گاز (دقیقه)",
};

export function unsetGasLimits(project) {
  return Object.keys(GAS_LIMITS).filter((k) => n(project?.[k]) === null);
}

/**
 * One gas test against the project's limits.
 * @returns {{ok: boolean|null, failures: string[], reason?: string}}
 */
export function judgeGasTest(t, project) {
  const unset = unsetGasLimits(project);
  if (unset.length) return { ok: null, failures: [], reason: `حدود تست گاز در مشخصات پروژه تعیین نشده: ${unset.map((k) => GAS_LIMITS[k]).join("، ")}` };
  const r = { o2: n(t.o2Pct), lel: n(t.lelPct), h2s: n(t.h2sPpm), co: n(t.coPpm) };
  const unread = Object.entries(r).filter(([, v]) => v === null).map(([k]) => k.toUpperCase());
  if (unread.length) return { ok: null, failures: [], reason: `قرائت نشده: ${unread.join("، ")}` };
  const p = Object.fromEntries(Object.keys(GAS_LIMITS).map((k) => [k, Number(project[k])]));
  const failures = [];
  if (r.o2 < p.hse_o2_min_pct || r.o2 > p.hse_o2_max_pct) failures.push(`O2 ${r.o2}% خارج از ${p.hse_o2_min_pct}–${p.hse_o2_max_pct}`);
  if (r.lel > p.hse_lel_max_pct) failures.push(`LEL ${r.lel}% > ${p.hse_lel_max_pct}`);
  if (r.h2s > p.hse_h2s_max_ppm) failures.push(`H2S ${r.h2s} > ${p.hse_h2s_max_ppm} ppm`);
  if (r.co > p.hse_co_max_ppm) failures.push(`CO ${r.co} > ${p.hse_co_max_ppm} ppm`);
  return { ok: failures.length === 0, failures };
}

/**
 * Can this permit be activated now, and if not, why. Every reason is
 * listed, not just the first, so the issuer fixes them in one pass.
 * @param permit {type, validFrom, validTo, requestedBy, attendant, isolationRef}
 * @param latestGasTest {testedAt, ...readings} | null
 */
export function activationCheck(permit, { issuerId, now, latestGasTest, project }) {
  const reasons = [];
  const type = PERMIT_TYPES[permit.type];
  if (!type) return { ok: false, reasons: [`نوع مجوز «${permit.type}» شناخته نشد`] };
  if (permit.requestedBy && issuerId && permit.requestedBy === issuerId)
    reasons.push("صادرکننده و درخواست‌کننده یک نفرند");
  for (const k of type.needs || []) if (!String(permit[camel(k)] || "").trim()) reasons.push(`${NEED_TITLE[k]} ثبت نشده`);
  const from = time(permit.validFrom), to = time(permit.validTo), t = time(now);
  const maxH = n(project?.hse_permit_max_hours);
  if (from === null || to === null || to <= from) reasons.push("بازهٔ اعتبار مجوز درست نیست");
  else {
    if (maxH === null) reasons.push("حداکثر مدت مجوز در مشخصات پروژه تعیین نشده");
    else if ((to - from) / 3_600_000 > maxH) reasons.push(`مدت مجوز از ${maxH} ساعت بیشتر است`);
    if (t >= to) reasons.push("زمان اعتبار مجوز گذشته");
  }
  if (type.gas) {
    if (!latestGasTest) reasons.push("تست گاز ثبت نشده");
    else {
      const g = judgeGasTest(latestGasTest, project);
      if (g.ok === null) reasons.push(g.reason);
      else if (!g.ok) reasons.push(`تست گاز رد: ${g.failures.join(" · ")}`);
      else {
        const age = (t - time(latestGasTest.testedAt)) / 60_000;
        const valid = Number(project.hse_gas_test_validity_min);
        if (age < 0) reasons.push("زمان تست گاز بعد از اکنون است");
        else if (age > valid) reasons.push(`تست گاز ${Math.round(age)} دقیقه پیش گرفته شده؛ اعتبار ${valid} دقیقه است`);
      }
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** State of a permit at `now`: expiry is computed, not stored. */
export function permitState(p, now) {
  if (p.status === "closed" || p.status === "cancelled") return p.status;
  if (time(now) >= time(p.validTo)) return p.status === "active" ? "expired" : "lapsed";
  return p.status;
}

/**
 * SIMOPS: pairs of open permits in the same area, overlapping in time, at
 * least one of them hot work.
 */
export function simops(permits, now) {
  const open = permits.filter((p) => ["requested", "active"].includes(permitState(p, now)));
  const out = [];
  for (let i = 0; i < open.length; i++) for (let j = i + 1; j < open.length; j++) {
    const a = open[i], b = open[j];
    if (!a.area || norm(a.area) !== norm(b.area)) continue;
    if (a.type !== "hot" && b.type !== "hot") continue;
    if (time(a.validFrom) < time(b.validTo) && time(b.validFrom) < time(a.validTo)) out.push([a.id, b.id]);
  }
  return out;
}

// ── observations ─────────────────────────────────────────────────────────

export const OBSERVATION_KINDS = { unsafe_act: "عمل ناایمن", unsafe_condition: "شرایط ناایمن", good_practice: "رفتار ایمن" };
export const SEVERITIES = { low: "کم", medium: "متوسط", high: "زیاد" };

/** open / overdue / closed. A good practice needs no action and is never overdue. */
export function observationState(o, today) {
  if (o.closedOn) return "closed";
  if (o.kind === "good_practice") return "closed";
  if (!o.dueOn) return "no_due";
  return String(o.dueOn) < String(today) ? "overdue" : "open";
}

const n = (v) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
const time = (v) => (v === null || v === undefined || v === "" ? null : new Date(v).getTime());
const norm = (s) => String(s).trim().toUpperCase().replace(/\s+/g, "");
const camel = (k) => k.replace(/_(\w)/g, (_, c) => c.toUpperCase());
