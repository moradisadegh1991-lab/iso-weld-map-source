/**
 * What must happen before what, around a tag.
 *
 * WHY THIS IS THE SECOND MODULE AND NOT ELECTRICAL
 *
 * A subsystem's readiness table says WHAT is incomplete. It cannot say WHY,
 * and "why" is the entire job of a construction planner. The answer lives in
 * a chain that every discipline touches in turn and none of them owns:
 *
 *   فونداسیون → استقرار → گروت → الایمنت → پایپینگ → کنترل تنش لوله
 *                                              ↘ برق ↘ ابزار دقیق → راه‌اندازی
 *
 * An equipment tag is where all six disciplines meet. Building it first turns
 * `tag` from a filing label into the dependency graph the schedule is really
 * made of — so "why is 21-01 late" stops being an afternoon in Primavera and
 * becomes a query.
 *
 * THIS IS ENGINE CODE, NOT MODEL CODE. No language model decides what
 * precedes what. The order below is engineering practice, written down where
 * it can be reviewed and tested, exactly as `lib/engine.js` holds B31.3.
 *
 * `blocked` is NEVER stored — it is computed from the predecessors every time
 * it is asked for. A stored blocked flag is wrong the moment its predecessor
 * completes, and nobody goes back to clear it.
 */

/** A step nobody has recorded anything against yet. */
export const NOT_STARTED = "not_started";
export const IN_PROGRESS = "in_progress";
export const DONE = "done";

/**
 * The chain for machinery that turns.
 *
 * Two orderings here are the ones people get wrong, and both cost money:
 *
 * GROUT BEFORE ALIGNMENT. Grout cures and the baseplate moves. Aligning
 * first means aligning to a position that will not survive the pour, and the
 * alignment has to be done twice — once for nothing.
 *
 * ALIGNMENT RE-CHECKED AFTER PIPING. Bolting up a suction and discharge
 * flange pulls the machine. This is pipe strain, it is invisible on a
 * walkdown, and it is a leading cause of the vibration and bearing failures
 * that show up months into operation — by which time it reads as an
 * equipment problem rather than an installation one. API 686 treats the
 * post-connection check as a distinct hold point, so it is a distinct step
 * here. The tolerance itself belongs to the project's own machinery spec,
 * not to this file.
 *
 * Electrical and instrumentation hang off `set` rather than the piping
 * chain, because they genuinely can proceed in parallel — a chain drawn as
 * one line would invent a dependency and idle two crews.
 */
const ROTATING = [
  { code: "foundation", discipline: "civil",           title: "فونداسیون و بولت", after: [],
    derive: "foundation" },
  { code: "set",        discipline: "equipment",       title: "استقرار و تراز بیس‌پلیت", after: ["foundation"] },
  { code: "grout",      discipline: "civil",           title: "گروت‌ریزی", after: ["set"] },
  { code: "align",      discipline: "equipment",       title: "الایمنت سرد", after: ["grout"] },
  { code: "piping",     discipline: "piping",          title: "اتصال پایپینگ",
    after: ["align"], derive: "piping" },
  { code: "strain",     discipline: "equipment",       title: "کنترل تنش لوله و الایمنت نهایی", after: ["piping"] },
  { code: "electrical", discipline: "electrical",      title: "ترمینیشن برق", after: ["set"],
    derive: "electrical" },
  { code: "instrument", discipline: "instrumentation", title: "نصب و تست ابزار دقیق", after: ["set"],
    derive: "instrument" },
  { code: "ready",      discipline: "equipment",       title: "آمادگی راه‌اندازی",
    after: ["strain", "electrical", "instrument"] },
];

/** Vessels, exchangers, filters: set and connected, never aligned. */
const STATIC = [
  { code: "foundation", discipline: "civil",           title: "فونداسیون و بولت", after: [],
    derive: "foundation" },
  { code: "set",        discipline: "equipment",       title: "استقرار و تراز", after: ["foundation"] },
  { code: "grout",      discipline: "civil",           title: "گروت‌ریزی", after: ["set"] },
  { code: "piping",     discipline: "piping",          title: "اتصال پایپینگ",
    after: ["grout"], derive: "piping" },
  { code: "electrical", discipline: "electrical",      title: "ترمینیشن برق (تریسینگ/ارت)", after: ["set"],
    derive: "electrical" },
  { code: "instrument", discipline: "instrumentation", title: "نصب و تست ابزار دقیق", after: ["set"],
    derive: "instrument" },
  { code: "ready",      discipline: "equipment",       title: "آمادگی راه‌اندازی",
    after: ["piping", "electrical", "instrument"] },
];

/**
 * A piping spool, from release to the shop to acceptance.
 *
 * The same engine as the equipment chains — walk, nextActions, whyNotReady —
 * because the sequence is the same kind of thing: work that has an order,
 * owned by different crews, where "why is this late" means tracing back to
 * the step that can actually start.
 *
 * Three steps are DERIVED from the weld register and never ticked by hand:
 * shop welding, shop NDT and field welding. The register already knows which
 * welds on this spool are done and examined; asking a supervisor to confirm
 * it is the double entry this platform exists to remove.
 *
 * The orderings that matter, and why:
 *
 *   FIT-UP BEFORE WELDING. Fit-up is its own hold point in any ITP — root
 *   gap, alignment and bevel are inspected before the root pass, because
 *   after it they cannot be.
 *
 *   SHOP NDT BEFORE ERECTION. A reject found in the shop is a cut in the
 *   shop. The same reject found in the rack is scaffolding, a permit and a
 *   day.
 *
 *   SUPPORTS BEFORE THE PRESSURE TEST. This is test-package practice, not
 *   a code rule: the pre-test walkdown checks the permanent supports are in.
 *   B31.3 §345.3.2 goes further for gas lines and ADDS temporary supports to
 *   carry the water, which is in addition to the permanent ones, not a
 *   substitute for them. A project that tests some lines on temporary
 *   supports alone would change this ordering in its own ITP.
 *
 *   TEST BEFORE PAINT AND INSULATION. B31.3 §345.3.1 requires joints to be
 *   left uninsulated and exposed for examination during the leak test —
 *   insulation or paint over a weld hides the weep the test is there to
 *   reveal. (Paragraph numbers are from the edition this was written
 *   against; check them against the edition your contract names.)
 *
 * A buried spool is also tested before backfill for the same reason, but
 * backfill is civil's step and belongs to their chain, not this one.
 */
const PIPING_SPOOL = [
  { code: "released",   discipline: "piping", title: "صدور به کارگاه", after: [] },
  { code: "fit_up",     discipline: "piping", title: "فیت‌آپ و بازرسی آن", after: ["released"] },
  { code: "shop_weld",  discipline: "piping", title: "جوشکاری کارگاهی (فابریکیشن)",
    after: ["fit_up"], derive: "shop_weld" },
  { code: "shop_ndt",   discipline: "piping", title: "NDT جوش‌های کارگاهی",
    after: ["shop_weld"], derive: "shop_ndt" },
  { code: "erected",    discipline: "piping", title: "نصب در محل (ارکشن)", after: ["shop_ndt"] },
  { code: "field_weld", discipline: "piping", title: "جوش و NDT سایت",
    after: ["erected"], derive: "field_weld" },
  { code: "supports",   discipline: "piping", title: "نصب ساپورت دائم", after: ["erected"] },
  { code: "test",       discipline: "piping", title: "تست فشار (هیدرو/پنوماتیک)",
    after: ["field_weld", "supports"] },
  { code: "painted",    discipline: "piping", title: "رنگ و عایق", after: ["test"] },
  { code: "ready",      discipline: "piping", title: "رفع پانچ و تحویل", after: ["painted"] },
];

/**
 * A fired heater: cracking furnace, reformer, process heater.
 *
 * Until now these rode the static chain, which is right about alignment
 * (there is no shaft) and wrong about almost everything else: a furnace is
 * steel, coils, refractory and burners, and the step that most often goes
 * wrong — the refractory dry-out — was not in any chain at all.
 *
 *   COIL TEST BEFORE PROCESS PIPING. A leak found on an isolated coil is a
 *   coil repair. Found after the transfer lines are connected, it is a
 *   system test with the heater inside it.
 *
 *   BURNERS AFTER REFRACTORY. Burner tiles are set in the floor lining.
 *
 *   DRY-OUT LAST, AFTER BURNERS, FUEL PIPING AND INSTRUMENTS. The lining is
 *   dried by firing the heater's own burners on a controlled heat-up curve,
 *   so it needs fuel, burners and a working burner management system. It
 *   is the first time the castable sees heat; moisture driven off too fast
 *   turns to steam inside it and spalls the lining. The curve is the
 *   refractory manufacturer's, not this file's.
 *
 * Dry-out is often scheduled in pre-commissioning, after mechanical
 * completion. "ready" here means ready for process service, which is why
 * dry-out sits before it. API 560 (fired heaters) and API 936 (refractory
 * installation QC) are the references; use the editions your contract names.
 */
const FIRED = [
  { code: "foundation", discipline: "civil",           title: "فونداسیون و بولت", after: [],
    derive: "foundation" },
  { code: "steel",      discipline: "structural",      title: "نصب سازه و کیسینگ", after: ["foundation"] },
  { code: "coil",       discipline: "equipment",       title: "نصب کویل‌های رادیانت و کانوکشن", after: ["steel"] },
  { code: "coil_test",  discipline: "equipment",       title: "تست هیدرواستاتیک کویل", after: ["coil"] },
  { code: "refractory", discipline: "equipment",       title: "نصب و عمل‌آوری نسوز", after: ["steel"] },
  { code: "burners",    discipline: "equipment",       title: "نصب مشعل‌ها", after: ["refractory"] },
  { code: "piping",     discipline: "piping",          title: "اتصال پایپینگ فرایند و سوخت",
    after: ["coil_test"], derive: "piping" },
  { code: "electrical", discipline: "electrical",      title: "ترمینیشن برق", after: ["steel"],
    derive: "electrical" },
  { code: "instrument", discipline: "instrumentation", title: "ابزار دقیق و BMS", after: ["steel"],
    derive: "instrument" },
  { code: "dryout",     discipline: "equipment",       title: "خشک‌کردن نسوز (Dry-out) با مشعل",
    after: ["refractory", "burners", "piping", "electrical", "instrument"] },
  { code: "ready",      discipline: "equipment",       title: "آمادگی بهره‌برداری فرایندی", after: ["dryout"] },
];

/**
 * A foundation, from the first excavation to handing it to mechanical.
 *
 * This is the root of every equipment chain: a machine's `foundation` step
 * is answered by this chain reaching `ready`, once civil has a foundation
 * that carries it. The orderings that cost the most when they are wrong:
 *
 *   ANCHOR BOLTS CHECKED BEFORE THE PRE-POUR HOLD POINT. Bolt positions are
 *   set from the equipment vendor's CERTIFIED anchor-bolt drawing, not from
 *   the preliminary one. A bolt pattern found wrong after the pour is a core
 *   drill, epoxy anchors and an engineering query — or a new foundation.
 *
 *   THE PRE-POUR INSPECTION IS A HOLD POINT, AND EVERY TRADE SIGNS IT.
 *   Rebar, cover, formwork, bolts, embedded plates, electrical and
 *   instrument conduits cast into the base: after the pour none of them can
 *   be inspected, only broken out.
 *
 *   HANDOVER WAITS FOR STRENGTH ACCEPTANCE, NOT FOR THE CALENDAR. The
 *   strength step is answered by ACI 318 acceptance of this pour's own test
 *   and of every three-test window of its class it belongs to
 *   (lib/civil/concrete.mjs). Setting a machine on concrete whose class is
 *   under a low-strength investigation is the thing this prevents. A project
 *   that loads earlier on a specified early strength states that in its own
 *   spec; this chain does not assume it.
 *
 * Pour, curing and strength are DERIVED: the pour card, the specified
 * curing period and the cylinder breaks answer them, not a tick.
 */
const FOUNDATION = [
  { code: "excavation", discipline: "civil", title: "خاک‌برداری و تراز کف", after: [] },
  { code: "blinding",   discipline: "civil", title: "بتن مگر (لاغر)", after: ["excavation"] },
  { code: "rebar",      discipline: "civil", title: "آرماتوربندی و قالب‌بندی", after: ["blinding"] },
  { code: "embedments", discipline: "civil",
    title: "انکر بولت و قطعات مدفون — کنترل با نقشهٔ وندور", after: ["rebar"] },
  { code: "pre_pour",   discipline: "civil",
    title: "بازرسی پیش از بتن‌ریزی (Hold point، امضای همهٔ رشته‌ها)", after: ["embedments"] },
  { code: "pour",       discipline: "civil", title: "بتن‌ریزی", after: ["pre_pour"], derive: "pour" },
  { code: "curing",     discipline: "civil", title: "عمل‌آوری", after: ["pour"], derive: "curing" },
  { code: "strength",   discipline: "civil", title: "پذیرش مقاومت بتن (ACI 318)",
    after: ["pour"], derive: "strength" },
  { code: "backfill",   discipline: "civil", title: "باز کردن قالب و خاک‌ریزی", after: ["curing"] },
  { code: "ready",      discipline: "civil", title: "تحویل به مکانیک",
    after: ["strength", "backfill"] },
];

/**
 * A steel structure: pipe rack, platform, shelter.
 *
 * Its first step is civil's, exactly as a machine's is: the foundations
 * that carry it answer `foundation`. The orderings that matter:
 *
 *   PLUMB BEFORE FINAL BOLTING. Pretensioning locks the frame where it
 *   stands. A column plumbed after its joints are pretensioned is plumbed by
 *   loosening them — or not at all.
 *
 *   GROUT AFTER PLUMB AND BOLTING. Grout under the base plates fixes the
 *   column where the survey accepted it; grouting first fixes it wherever
 *   the levelling nuts left it.
 *
 *   FIREPROOFING AFTER BOLTING. Cementitious fireproofing over a joint hides
 *   the joint from the bolting inspection.
 *
 * Plumb and bolting are DERIVED: the survey and the bolting records answer
 * them (lib/structural/steel.mjs). Fireproofing does not apply when the
 * structure's spec says it is not required.
 */
const STRUCTURE = [
  { code: "foundation",   discipline: "civil",      title: "فونداسیون و بولت", after: [],
    derive: "foundation" },
  { code: "erection",     discipline: "structural", title: "نصب ستون، تیر و بادبند", after: ["foundation"] },
  { code: "plumb",        discipline: "structural", title: "شاقولی و تراز (نقشه‌برداری)",
    after: ["erection"], derive: "plumb" },
  { code: "bolting",      discipline: "structural", title: "سفت‌کاری نهایی پیچ‌ها و بازرسی",
    after: ["plumb"], derive: "bolting" },
  { code: "grout",        discipline: "civil",      title: "گروت زیر بیس‌پلیت", after: ["plumb", "bolting"] },
  { code: "fireproofing", discipline: "structural", title: "ضدحریق (Fireproofing)",
    after: ["bolting"], derive: "fireproofing" },
  { code: "painting",     discipline: "structural", title: "رنگ نهایی و تاچ‌آپ", after: ["bolting"],
    derive: "painting" },
  { code: "ready",        discipline: "structural", title: "تحویل به پایپینگ / مکانیک",
    after: ["grout", "fireproofing", "painting"] },
];

/**
 * A power or control cable, from its route to acceptance.
 *
 *   ROUTE BEFORE PULLING. A cable pulled into a tray that is not finished
 *   is pulled twice, or damaged the first time.
 *
 *   IR AFTER TERMINATION. The acceptance test is on the cable as it will be
 *   energised, glands and lugs included — a test on the drum proves the
 *   factory, not the installation.
 *
 *   HV WITHSTAND FOR MEDIUM VOLTAGE ONLY. It does not apply to LV cables,
 *   and for MV its voltage, duration and pass criterion are the commissioning
 *   spec's; it is recorded by the tester who signs the certificate.
 *
 *   READY IS A SIGN-OFF. The repository refuses it while any earlier step is
 *   open — unlike a physical step, which is recorded out of order when that
 *   is what happened. Reporting reads `ready` as "tested and accepted".
 *
 * IR is DERIVED from the recorded test and the IEC 60364-6 limit
 * (lib/electrical/cable.mjs).
 */
const CABLE = [
  { code: "route",      discipline: "electrical", title: "مسیر آماده (سینی / ترانشه / داکت)", after: [] },
  { code: "pulled",     discipline: "electrical", title: "کابل‌کشی", after: ["route"] },
  { code: "terminated", discipline: "electrical", title: "گلند و ترمینیشن دو سر", after: ["pulled"] },
  { code: "ir",         discipline: "electrical", title: "تست مقاومت عایق (IR)",
    after: ["terminated"], derive: "ir" },
  { code: "hv_test",    discipline: "electrical", title: "تست ولتاژ بالا (فقط MV)",
    after: ["ir"], derive: "hv_test" },
  { code: "continuity", discipline: "electrical", title: "پیوستگی و توالی فاز", after: ["terminated"] },
  { code: "ready",      discipline: "electrical", title: "آماده برای برق‌دار شدن",
    after: ["ir", "hv_test", "continuity"] },
];

/**
 * A field instrument, from the bench to a signed loop check.
 *
 *   CALIBRATE BEFORE INSTALLING. A bench calibration finds a faulty
 *   transmitter in the workshop; found after hook-up, it is a permit, a
 *   drained impulse line and a second hook-up.
 *
 *   LOOP CHECK AFTER HOOK-UP AND WIRING. The loop check proves the whole
 *   path — process connection, device, cable, marshalling, DCS point,
 *   alarm. With any piece missing it proves only the pieces that exist.
 *   It is signed once per loop, and every instrument in the loop takes its
 *   step from that signature (the repository refuses the signature while
 *   any instrument in the loop is not yet connected).
 *
 * Calibration is DERIVED for transmitters and local gauges from their
 * points (lib/instrumentation/isa.mjs); for valves, switches and elements it
 * is the technician's signed test (stroke, trip point, sensor check).
 */
const INSTRUMENT = [
  { code: "calibrated", discipline: "instrumentation",
    title: "کالیبراسیون / تست استروک / ست‌پوینت", after: [], derive: "calibrated" },
  { code: "installed",  discipline: "instrumentation", title: "نصب در محل", after: ["calibrated"] },
  { code: "hookup",     discipline: "instrumentation", title: "هوک‌آپ فرایندی / ایمپالس", after: ["installed"] },
  { code: "wired",      discipline: "instrumentation", title: "سیم‌بندی و ترمینیشن", after: ["installed"] },
  { code: "loop_check", discipline: "instrumentation", title: "لوپ چک (امضای لوپ)",
    after: ["hookup", "wired"], derive: "loop_check" },
  { code: "ready",      discipline: "instrumentation", title: "آماده برای راه‌اندازی", after: ["loop_check"] },
];

/**
 * Painting and insulation of one item — a spool, a structure, a vessel.
 *
 *   PREPARATION, THEN COATS IN ORDER. Each coat is judged on the readings
 *   taken after it, cumulative, against the nominal DFT up to that coat
 *   (ISO 19840), and on the conditions it was applied in (dew point).
 *
 *   INSULATION AFTER THE FINAL COATING INSPECTION — and, on a spool, after
 *   its leak test: B31.3 §345.3.1 wants the joints exposed during the test.
 *   Paint is allowed before the test; insulation is not, and the
 *   repository holds the insulation step until the spool's test is recorded.
 *
 * Preparation, coats and insulation are DERIVED from the inspector's
 * measurements (lib/coating/coating.mjs). Insulation and cladding do not
 * apply to an item with no insulation. `ready` is a sign-off: the spool's
 * "painted" step and reporting both read it.
 */
const COATING = [
  { code: "surface_prep",     discipline: "coating", title: "آماده‌سازی سطح (بلاست) و پروفیل",
    after: [], derive: "surface_prep" },
  { code: "coats",            discipline: "coating", title: "اعمال لایه‌ها (DFT و شرایط محیطی)",
    after: ["surface_prep"], derive: "coats" },
  { code: "final_inspection", discipline: "coating", title: "بازرسی نهایی رنگ (چشمی / هالیدی)", after: ["coats"] },
  { code: "insulation",       discipline: "coating", title: "عایق‌کاری (ضخامت)",
    after: ["final_inspection"], derive: "insulation" },
  { code: "cladding",         discipline: "coating", title: "روکش (کلدینگ) و آب‌بندی", after: ["insulation"] },
  { code: "ready",            discipline: "coating", title: "تحویل رنگ و عایق",
    after: ["final_inspection", "insulation", "cladding"] },
];

export const CHAINS = {
  rotating: ROTATING, static: STATIC, fired: FIRED, foundation: FOUNDATION,
  structure: STRUCTURE, piping_spool: PIPING_SPOOL, cable: CABLE, instrument: INSTRUMENT,
  coating: COATING,
};

/** The kinds of steel structure, declared once like EQUIPMENT_KINDS. */
export const STRUCTURE_TYPES = {
  pipe_rack: "پایپ رک", platform: "پلتفرم", shelter: "شلتر / سوله", structure: "سازهٔ فلزی",
};

/**
 * The kinds of equipment, declared once.
 *
 * The classifier, the repository that validates a manual choice, and every
 * screen that labels a tag read this — so adding a kind is one edit, and a
 * kind cannot be offered on a screen that the repository would refuse.
 */
export const EQUIPMENT_KINDS = { rotating: "دوّار", static: "ثابت", fired: "کوره / هیتر آتشین" };

/**
 * A spool stage (reporting.spool_stage) in words.
 *
 * `planned` and `unknown` are not chain steps: the first means nothing has
 * happened yet, the second that the old revision never knew this spool.
 */
export function spoolStageTitle(code) {
  if (code === "planned") return "روی کاغذ";
  if (!code || code === "unknown") return "نامشخص";
  return PIPING_SPOOL.find((s) => s.code === code)?.title || code;
}

/** Steps a chain answers from data rather than from a recorded activity. */
export const derivedSteps = (chain) => chain.filter((s) => s.derive).map((s) => s.code);

/**
 * Which chain a tag follows.
 *
 * Returns null rather than guessing for a kind nobody declared. A tag filed
 * under the wrong chain would report a hold point that does not exist, or
 * — worse — omit one that does.
 */
export function chainFor(kind) {
  return CHAINS[String(kind || "").toLowerCase()] || null;
}

/** The step every chain ends at. */
export const TERMINAL = "ready";

/**
 * The state of every step, given what has been recorded.
 *
 * @param {Array} chain    from CHAINS
 * @param {Record<string, string>} recorded  code -> NOT_STARTED|IN_PROGRESS|DONE
 * @returns {Array<{code, title, discipline, status, blocked, waitingOn}>}
 */
export function walk(chain, recorded = {}, { na = new Set(), early = new Set() } = {}) {
  const byCode = new Map(chain.map((s) => [s.code, s]));
  const state = (c) => recorded[c] || NOT_STARTED;

  return chain.map((s) => {
    const waitingOn = s.after.filter((p) => state(p) !== DONE);
    // A step already recorded as done is done, even if a predecessor is not.
    // That situation is a data problem worth surfacing, not a reason to
    // contradict a record somebody signed. A NOT-APPLICABLE step is "done"
    // only so nothing waits on it; nobody recorded it, so it cannot have
    // been recorded out of order.
    // An `early` step is one a code allows before its usual predecessor —
    // B31.3 lets an uninsulated spool be painted before its leak test.
    const outOfOrder = state(s.code) === DONE && waitingOn.length > 0 && !na.has(s.code)
      && !early.has(s.code);
    return {
      code: s.code,
      title: s.title,
      discipline: s.discipline,
      derived: Boolean(s.derive),
      status: state(s.code),
      blocked: state(s.code) !== DONE && waitingOn.length > 0,
      waitingOn: waitingOn.map((p) => ({ code: p, title: byCode.get(p)?.title || p })),
      outOfOrder,
    };
  });
}

/** What can be started right now, and by which discipline. */
export function nextActions(chain, recorded = {}) {
  return walk(chain, recorded)
    .filter((s) => s.status !== DONE && !s.blocked)
    .map(({ code, title, discipline, status }) => ({ code, title, discipline, status }));
}

/**
 * Why a step cannot happen — traced back to the work that actually has to
 * start, not just its immediate predecessor.
 *
 * "راه‌اندازی بسته است چون کنترل تنش انجام نشده" is not useful; the crew that
 * has to move is the one pouring the foundation. So the trace walks back
 * until it reaches steps with nothing left blocking them, and reports those.
 *
 * @returns {{ready: boolean, rootCauses: Array, path: Array}}
 */
export function whyNotReady(chain, recorded = {}, target = TERMINAL) {
  const steps = new Map(walk(chain, recorded).map((s) => [s.code, s]));
  const goal = steps.get(target);
  if (!goal) return { ready: false, rootCauses: [], path: [], unknownTarget: true };
  if (goal.status === DONE) return { ready: true, rootCauses: [], path: [] };

  const roots = new Map();
  const path = [];
  const seen = new Set();

  (function back(code) {
    if (seen.has(code)) return;          // a chain is a DAG, but guard anyway
    seen.add(code);
    const s = steps.get(code);
    if (!s || s.status === DONE) return;
    path.push({ code: s.code, title: s.title, discipline: s.discipline, status: s.status });
    if (!s.blocked) { roots.set(s.code, s); return; }
    for (const w of s.waitingOn) back(w.code);
  })(target);

  return {
    ready: false,
    // The work that can actually start today, which is the only part anyone
    // can act on this morning.
    rootCauses: [...roots.values()].map(
      ({ code, title, discipline, status }) => ({ code, title, discipline, status })),
    path,
  };
}

/** How far along a tag is. Steps done over the steps that apply. */
export function progress(chain, recorded = {}, { na = new Set() } = {}) {
  // Not-applicable steps are out of scope, not work done: they leave both
  // sides of the fraction, or a rack that needs no fireproofing would show
  // progress nobody made.
  const scope = chain.filter((s) => !na.has(s.code));
  const done = scope.filter((s) => (recorded[s.code] || NOT_STARTED) === DONE).length;
  return { done, total: scope.length,
    pct: scope.length ? Math.round((done / scope.length) * 1000) / 10 : 0 };
}

/**
 * Is a chain well formed?
 *
 * Exported so a test can assert it, and so a chain added later cannot ship
 * with a predecessor nobody defined or a cycle that would hang `whyNotReady`.
 */
export function validateChain(chain) {
  const codes = new Set(chain.map((s) => s.code));
  const problems = [];
  if (codes.size !== chain.length) problems.push("duplicate step code");
  if (!codes.has(TERMINAL)) problems.push(`no "${TERMINAL}" step`);

  for (const s of chain) {
    for (const p of s.after) {
      if (!codes.has(p)) problems.push(`${s.code} waits on unknown step ${p}`);
    }
  }
  // Cycle detection: a cycle would make whyNotReady recurse forever, and the
  // `seen` guard there would hide it rather than report it.
  const mark = new Map();
  const visit = (code, stack) => {
    if (mark.get(code) === "done") return;
    if (stack.has(code)) { problems.push(`cycle through ${code}`); return; }
    stack.add(code);
    for (const p of chain.find((s) => s.code === code)?.after || []) visit(p, stack);
    stack.delete(code);
    mark.set(code, "done");
  };
  for (const s of chain) visit(s.code, new Set());
  return problems;
}
