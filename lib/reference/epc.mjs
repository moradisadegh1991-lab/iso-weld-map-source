/**
 * Reference: how an EPC project for a petrochemical plant or an oil & gas
 * refinery runs — its phases and gates, the deliverables of each, the
 * handover checklists, and the standards usually applied — with, for each,
 * where the platform does it.
 *
 * This is general industry practice (NORSOK Z-007 for completion and
 * commissioning, FIDIC Silver Book for taking-over and the performance
 * certificate, IOGP/CFIHOS and ISO 14224 for handover data, IPS as Iran's
 * job-specification base), written as guidance. It decides nothing: the
 * contract, the project specifications and the editions the project adopts
 * decide. A checklist here becomes the project's only when a person adopts
 * it, and then it is the project's to change.
 */

/** Phases and gates, in order. `href`: where the platform carries the phase. */
export const PHASES = [
  { code: "FEL1", title: "مطالعات امکان‌سنجی و مفهومی", en: "Feasibility / Concept (FEL-1)",
    work: "تعریف ظرفیت، خوراک و محصول، انتخاب سایت، برآورد ±۴۰٪", gate: "تصمیم ادامه (DG1)", href: null },
  { code: "FEL2", title: "طراحی پایه (لایسنسور) و Pre-FEED", en: "Basic Design / Pre-FEED (FEL-2)",
    work: "بستهٔ طراحی پایهٔ لایسنسور (BEDP)، PFD و موازنهٔ جرم و انرژی، انتخاب گزینه", gate: "انتخاب گزینه (DG2)", href: null },
  { code: "FEL3", title: "FEED", en: "Front-End Engineering Design (FEL-3)",
    work: "P&ID نسخهٔ FEED، دیتاشیت تجهیزات اصلی، Plot Plan، برآورد ±۱۰–۱۵٪، بستهٔ مناقصهٔ EPC", gate: "تصمیم نهایی سرمایه‌گذاری (FID) و انعقاد قرارداد EPC", href: null },
  { code: "DE", title: "مهندسی تفصیلی", en: "Detailed Engineering",
    work: "صدور مدارک IFR → IFA → IFC، مدل سه‌بعدی، ایزومتریک، MTO، HAZOP و SIL، کلاس‌های لوله", gate: "IFC هر مدرک (کد ۱/۲ کارفرما)", href: "/documents" },
  { code: "PR", title: "تأمین کالا", en: "Procurement",
    work: "MR → مناقصه و TBE/CBE → PO → پیگیری → بازرسی و FAT → حمل → رسید سایت (MRR) و MIR", gate: "IRN و رسید کالا", href: "/procurement" },
  { code: "CN", title: "اجرا (ساخت و نصب)", en: "Construction",
    work: "سیویل و فونداسیون ← اسکلت فلزی ← نصب تجهیزات ← ساخت و نصب لوله ← برق و ابزار دقیق ← رنگ و عایق؛ کنترل کیفیت با ITP", gate: "تکمیل ساخت هر ساب‌سیستم", href: "/workfront" },
  { code: "MC", title: "تکمیل مکانیکی", en: "Mechanical Completion",
    work: "تست پکیج‌ها (هیدرو/پنوماتیک)، چک‌لیست‌های ITR-A، پانچ لیست A/B/C، بستن NCRها", gate: "گواهی MC (MCC) هر ساب‌سیستم — بدون پانچ A باز", href: "/completions" },
  { code: "PC", title: "پیش‌راه‌اندازی", en: "Pre-commissioning",
    work: "فلاشینگ و تمیزکاری، خشک‌کردن، تست نشتی، لوپ چک، کالیبراسیون، Run-in موتورها، چک‌لیست‌های ITR-B", gate: "آمادهٔ راه‌اندازی (RFC)", href: "/precom" },
  { code: "CM", title: "راه‌اندازی", en: "Commissioning",
    work: "تست عملکردی سیستم‌ها، ورود یوتیلیتی، اینرت کردن، تست‌های C&E و ESD، روال‌های راه‌اندازی", gate: "آمادهٔ راه‌اندازی اولیه (RFSU)", href: "/precom" },
  { code: "SU", title: "راه‌اندازی اولیه و آزمون عملکرد", en: "Start-up & Performance Test",
    work: "ورود خوراک، رسیدن به ظرفیت طراحی، آزمون تضمین‌های قرارداد (ظرفیت، مصرف، کیفیت محصول)", gate: "پذیرش موقت (PAC / Taking-Over Certificate)", href: "/precom" },
  { code: "DLP", title: "دورهٔ تضمین و تحویل نهایی", en: "Defects Liability / Notification Period",
    work: "رفع نواقص اعلام‌شده، تحویل مدارک As-Built و دیتابوک، داده‌های نگهداری (ISO 14224) به CMMS", gate: "پذیرش نهایی (FAC / Performance Certificate)", href: "/handover" },
];

/**
 * Deliverables by discipline: the document types, the phase each is
 * issued for construction in, and what the platform reads from it (the
 * document-intake kinds) or where it lives.
 */
export const DELIVERABLES = [
  { discipline: "فرایند", docs: [
    ["PFD و موازنهٔ جرم و انرژی (H&MB)", "FEL2–FEL3", null],
    ["P&ID", "DE (IFC)", "تگ تجهیز، لاین، ابزار، ساب‌سیستم، ارجاع نقشه"],
    ["لیست لاین (Line List)", "DE", "لاین، کلاس، سرویس"],
    ["لیست تجهیزات (Equipment List)", "DE", "تگ تجهیز، سرویس، سیستم/ساب‌سیستم"],
    ["دیتاشیت فرایندی تجهیزات", "DE", "(فاز ۳ خواندن)"],
    ["Cause & Effect و منطق ESD", "DE", null],
    ["گزارش HAZOP، HAZID و مطالعهٔ SIL", "DE", null],
  ] },
  { discipline: "پایپینگ", docs: [
    ["Plot Plan و GA", "DE", null],
    ["کلاس‌های لوله (Piping Material Specification)", "DE", "/piping (کلاس لوله)"],
    ["ایزومتریک", "DE (IFC)", "/piping — رجیستر جوش (فاز ۴ خواندن)"],
    ["تحلیل تنش و استاندارد ساپورت", "DE", null],
    ["MTO", "DE", "مواد اسپول و انبار"],
  ] },
  { discipline: "مکانیک (تجهیزات)", docs: [
    ["دیتاشیت مکانیکی و مدارک وندور (VDRL)", "PR", "/procurement — VDRL"],
    ["نقشه‌های ساخت وندور و گزارش FAT", "PR", null],
    ["دستورالعمل نصب، بهره‌برداری و نگهداری (IOM)", "PR", "/handover"],
    ["لیست قطعات یدکی (SPIR)", "PR", "/handover — SPIR"],
  ] },
  { discipline: "سیویل و سازه", docs: [
    ["گزارش ژئوتکنیک و نقشه‌های فونداسیون", "DE", "/civil"],
    ["نقشه‌های اسکلت فلزی و پایپ‌رک", "DE", "/structural (فاز ۳ خواندن)"],
  ] },
  { discipline: "برق", docs: [
    ["نقشهٔ تک‌خطی (SLD) و لیست بار", "DE", "(فاز ۳ خواندن)"],
    ["لیست کابل و مسیر کابل", "DE", "/electrical — کابل‌ها"],
    ["نقشهٔ طبقه‌بندی مناطق خطرناک", "DE", null],
  ] },
  { discipline: "ابزار دقیق و کنترل", docs: [
    ["Instrument Index", "DE", "ابزار دقیق (ISA 5.1)"],
    ["دیتاشیت ابزار، Loop Diagram و Hook-up", "DE", "/instrumentation"],
    ["لیست I/O و ماتریس DCS/SIS", "DE", "/asset (شناسه‌های DCS)"],
  ] },
  { discipline: "تکمیل و راه‌اندازی", docs: [
    ["تست پکیج‌ها و دفترچهٔ MC", "MC", "/completions"],
    ["چک‌لیست‌های پیش‌راه‌اندازی و راه‌اندازی (ITR-B/C)", "PC–CM", "/precom"],
    ["روال‌های راه‌اندازی", "CM", "/precom"],
    ["مدارک As-Built و دیتابوک نهایی", "DLP", "/documents"],
  ] },
];

/**
 * Handover checklists. `phase`/`appliesTo` match the pre-commissioning
 * module, so a person can adopt one as the project's own template. MC
 * items are listed for reference: the MC module derives them from the
 * records themselves (tests, punch, NCR), it does not tick them by hand.
 */
export const CHECKLISTS = [
  { code: "ITR-B-PIPE-FLUSH", title: "فلاشینگ و تمیزکاری لاین", phase: "precom", appliesTo: "line",
    items: ["مسیر فلاشینگ و نقاط تخلیه طبق روال", "سرعت/حجم سیال فلاشینگ طبق روال", "بازرسی تمیزی (target/چشمی) قبول", "برداشتن صافی‌های موقت و بستن مجدد", "ثبت در گزارش و امضای ناظر"] },
  { code: "ITR-B-PIPE-DRY", title: "تخلیه، خشک‌کردن و حفاظت پس از تست", phase: "precom", appliesTo: "line",
    items: ["تخلیهٔ کامل آب تست", "خشک‌کردن تا نقطهٔ شبنم/رطوبت مشخص‌شده", "نصب مجدد شیرها و ابزارهای جداشده", "حفاظت (نیتروژن/درپوش) در صورت لزوم"] },
  { code: "ITR-B-ROT-RUNIN", title: "Run-in تجهیز دوّار", phase: "precom", appliesTo: "rotating",
    items: ["هم‌راستایی (Alignment) نهایی ثبت‌شده", "روغن‌کاری و سیستم روغن", "جهت چرخش موتور (bump test)", "Run-in بدون بار با پایش لرزش و دما", "سیستم آب‌بندی (seal) آماده"] },
  { code: "ITR-B-STATIC", title: "بازرسی داخلی و بستن تجهیز ثابت", phase: "precom", appliesTo: "static",
    items: ["بازرسی داخلی و تمیزی", "نصب Internals طبق نقشه", "بستن منهول با گسکت نهایی", "PSVها نصب و کالیبره"] },
  { code: "ITR-B-FIRED", title: "آماده‌سازی کوره (Dry-out رفرکتوری و مشعل‌ها)", phase: "precom", appliesTo: "fired",
    items: ["خشک‌کردن رفرکتوری طبق منحنی سازنده", "تست مشعل‌ها و پایلوت‌ها", "سیستم BMS و اینترلاک‌ها", "دمپر و فن‌ها"] },
  { code: "ITR-B-CABLE", title: "تست کابل و تجهیزات برقی", phase: "precom", appliesTo: "cable",
    items: ["مقاومت عایقی (IR) قبول", "پیوستگی و ترتیب فاز", "اتصال زمین", "Termination و برچسب‌گذاری"] },
  { code: "ITR-B-LOOP", title: "لوپ چک ابزار دقیق", phase: "precom", appliesTo: "loop",
    items: ["کالیبراسیون ابزار (۰–۲۵–۵۰–۷۵–۱۰۰٪)", "ارتباط تا DCS/SIS و نمایش در HMI", "جهت عملکرد شیر کنترل و حالت Fail", "آلارم‌ها و تریپ‌ها طبق C&E"] },
  { code: "CM-SYS-FUNC", title: "تست عملکردی سیستم", phase: "commissioning", appliesTo: "subsystem",
    items: ["ورود یوتیلیتی (هوا، نیتروژن، آب، بخار)", "اینرت کردن و تست نشتی سیستم", "تست C&E و ESD", "اجرای روال راه‌اندازی سیستم", "پانچ A/B بسته"] },
];

/** What each handover certificate certifies, and what the platform checks before it can be signed. */
export const CERTIFICATES = [
  { code: "MCC", title: "گواهی تکمیل مکانیکی", requires: ["همهٔ تست پکیج‌ها قبول و پذیرفته", "پانچ A باز صفر", "NCR باز صفر", "ITR-A همه رشته‌ها"], href: "/completions", platform: "امضا تا باز بودن هر مورد رد می‌شود" },
  { code: "RFC", title: "آمادهٔ راه‌اندازی", requires: ["MC پذیرفته", "همهٔ چک‌لیست‌های پیش‌راه‌اندازی قبول", "پانچ A باز صفر"], href: "/precom", platform: "rfcReadiness" },
  { code: "RFSU", title: "آمادهٔ راه‌اندازی اولیه", requires: ["RFC پذیرفته", "چک‌لیست‌های راه‌اندازی قبول", "پانچ A و B باز صفر", "NCR باز صفر"], href: "/precom", platform: "rfsuReadiness" },
  { code: "PAC", title: "پذیرش موقت (Taking-Over)", requires: ["آزمون‌های عملکرد قبول در برابر تضمین‌ها", "پانچ باقی‌مانده با فهرست و مهلت", "مدارک لازم برای بهره‌برداری"], href: "/precom", platform: "آزمون عملکرد ساخته شده؛ گواهی PAC هنوز نه" },
  { code: "FAC", title: "پذیرش نهایی (Performance Certificate)", requires: ["پایان دورهٔ تضمین", "رفع همهٔ نواقص اعلام‌شده", "As-Built و دیتابوک نهایی", "داده‌های نگهداری تحویل‌شده"], href: "/handover", platform: "هنوز نه" },
];

/**
 * Standards commonly applied, with what in the platform judges by them.
 * Editions are NOT given: the edition is a project fact, set in the
 * project's standards register.
 */
export const STANDARDS = [
  { group: "پایپینگ", items: [
    ["ASME B31.3", "Process Piping — طراحی، ساخت، NDT و تست فشار", "موتور رجیستر جوش، نمونه‌برداری NDT تدریجی (§341.3.4)، فشار تست (§345)"],
    ["ASME B16.5 / B16.47 / B16.9", "فلنج و فیتینگ", null],
    ["ASME B36.10 / B36.19", "ابعاد لوله", "هندسهٔ اسپول"],
    ["ASME Section IX", "صلاحیت جوشکار و WPS/PQR", "صلاحیت جوشکار"],
    ["ASME Section V", "روش‌های NDT", "ماتریس NDT"],
  ] },
  { group: "تجهیزات ثابت و کوره", items: [
    ["ASME Section VIII Div.1/2", "مخازن تحت فشار", null],
    ["TEMA / API 660", "مبدل‌های پوسته و لوله", null],
    ["API 650 / API 620", "مخازن ذخیره", null],
    ["API 560", "کوره‌های فرایندی (Fired Heaters)", "زنجیرهٔ پیش‌نیاز کوره"],
    ["API 520 / API 521", "شیرهای اطمینان و سیستم فلر", null],
  ] },
  { group: "تجهیزات دوّار", items: [
    ["API 610", "پمپ‌های سانتریفیوژ", null],
    ["API 617 / API 618", "کمپرسورها", null],
    ["API 686", "نصب ماشین‌آلات", null],
  ] },
  { group: "سیویل و سازه", items: [
    ["ACI 318", "بتن سازه‌ای — پذیرش مقاومت", "موتور پذیرش بتن"],
    ["AISC 360 / AISC 303 / RCSC", "سازهٔ فلزی، رواداری نصب، پیچ‌های پرمقاومت", "موتور شاقولی و پیش‌تنیدگی پیچ"],
    ["EN 1090-2", "اجرای سازهٔ فلزی", "موتور شاقولی (گزینهٔ دیگر)"],
    ["AWS D1.1", "جوشکاری سازه", "NDT جوش سازه"],
  ] },
  { group: "برق و ابزار دقیق", items: [
    ["IEC 60364-6", "تست تأسیسات برقی (مقاومت عایقی)", "موتور IR کابل"],
    ["IEC 60079", "تجهیزات در مناطق خطرناک", null],
    ["IEC 61511", "سیستم‌های ابزاری ایمنی (SIS)", null],
    ["ISA 5.1", "نمادها و شناسهٔ ابزار دقیق", "خواندن تگ ابزار و لوپ"],
  ] },
  { group: "رنگ و عایق", items: [
    ["ISO 8501-1", "درجهٔ آماده‌سازی سطح", "موتور رنگ"],
    ["ISO 19840", "اندازه‌گیری ضخامت فیلم خشک (DFT)", "موتور رنگ"],
    ["ISO 12944", "حفاظت خوردگی سازه‌های فولادی", null],
  ] },
  { group: "تکمیل، تحویل و داده", items: [
    ["NORSOK Z-007", "تکمیل مکانیکی و راه‌اندازی", "MC، RFC، RFSU"],
    ["ISO 14224", "داده‌های قابلیت اطمینان و نگهداری", "شناسنامهٔ تحویل به CMMS"],
    ["IOGP CFIHOS", "مشخصات تحویل اطلاعات تأسیسات", "مرجع ساختار داده"],
    ["ISO 15926", "یکپارچگی داده در چرخهٔ عمر تأسیسات", null],
  ] },
  { group: "ایمنی و HSE", items: [
    ["IOGP Report 6 / گزارش آماری", "طبقه‌بندی رویداد و LTIF/TRIR", "موتور HSE"],
    ["NFPA (مثلاً 15، 30)", "حفاظت در برابر حریق", null],
  ] },
  { group: "قرارداد", items: [
    ["FIDIC Silver Book (EPC/Turnkey)", "تحویل موقت، دورهٔ اعلام نقص، گواهی عملکرد", "گواهی‌های تحویل"],
  ] },
  { group: "ایران", items: [
    ["IPS (استانداردهای نفت ایران)", "پایهٔ مشخصات فنی پروژه‌های وزارت نفت، به‌همراه الحاقیهٔ پروژه", "در رجیستر استانداردهای پروژه با کد و ویرایش ثبت شود"],
  ] },
];
