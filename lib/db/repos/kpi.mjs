/**
 * The project's KPIs, shown in the platform itself (the "گزارش‌ها و KPI"
 * page). Call inside `withProject`.
 *
 * Every figure is read from the same records the module pages use — the
 * PMS roll-up, the EVM board, the reporting views — so a KPI and the page it
 * links to cannot disagree. A figure with nothing under it is null and the
 * page says "ثبت نشده"; it is never shown as zero.
 */
import { pmsView } from "./pms.mjs";
import { activityView } from "./eps-activities.mjs";
import { plannedPctAt } from "../../eps/activities.mjs";
import { controlsBoard } from "./controls.mjs";
import { rates, CLASSES } from "../../hse/hse.mjs";

const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);
const days = (a, b) => (a && b ? Math.round((Date.parse(a) - Date.parse(b)) / 86400000) : null);
const iso = (d) => (d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * One KPI: `value` (number or null), `unit`, `tone` (ok/warn/bad or ""),
 * `href` (the page that explains it), `def` (how it is computed, in words).
 */
const kpi = (label, value, { unit = "", tone = "", href = null, def = "", sub = null } = {}) =>
  ({ label, value: value ?? null, unit, tone: value == null ? "" : tone, href, def, sub });

export async function projectKpis(db, { projectId, today = new Date().toISOString().slice(0, 10) }) {
  const one = async (sql, params = [projectId]) => (await db.query(sql, params)).rows[0];
  const all = async (sql, params = [projectId]) => (await db.query(sql, params)).rows;
  const sections = [];

  // ── progress and schedule ──
  {
    const v = await pmsView(db, { projectId });
    const p = v.pms;
    const root = v.tasks.find((t) => t.level === 0) || null;
    const slip = root ? days(root.finish, root.bl_finish) : null;
    const lateTasks = v.tasks.filter((t) => !t.is_summary && (t.pct ?? 0) < 100 && t.bl_finish && t.finish > t.bl_finish).length;
    const now = p?.nodes[0]?.now ?? null;
    let plan = null, planAt = null;
    if (p?.curve) {
      const at = p.import.data_date || null;
      if (at) {
        // The baseline plan at the data date, over the linked part — the same curve the PMS page draws.
        const pts = p.curve.baseline;
        const before = pts.filter((x) => x.on <= at);
        plan = before.length ? before.at(-1).pct : 0;
        if (at > pts.at(-1).on) plan = pts.at(-1).pct;
        planAt = at;
      }
    }
    const linkedActual = p?.curve ? (p.curve.actual.at(-1)?.pct ?? p.curve.undated) : null;
    let board = null;
    try { board = await controlsBoard(db, { projectId }); } catch { board = null; }
    // the plan is the EPS: each contract's master plan, its progress and its curve (one WBS, 2026-10-17)
    const { rows: masters } = await db.query(
      `SELECT v.id, v.code, c.contract_no FROM eps_version v JOIN eps_pms p ON p.id = v.pms_id JOIN contract c ON c.id = p.contract_id
        WHERE v.project_id = $1 AND v.master ORDER BY c.contract_no, p.seq`, [projectId]);
    const eps = [];
    for (const m of masters) {
      const view = await activityView(db, { projectId, versionId: m.id });
      const root = { children: view.roots };
      let act = 0, any = false, late = 0;
      for (const n of view.roots) if (n.pct != null) { any = true; act += ((n.wf || 0) / 100) * n.pct; }
      const walk = (n) => { for (const a of n.activities) if (a.plan_end && a.plan_end < today && (a.pct ?? 0) < 100) late++; n.children.forEach(walk); };
      view.roots.forEach(walk);
      const plan = plannedPctAt(root, today);
      const actual = any ? Math.round(act * 100) / 100 : null;
      eps.push(
        kpi(`پیشرفت فیزیکی — ${m.contract_no}`, actual, { unit: "%", href: "/eps/activities", sub: `برنامهٔ اصلی ${m.code}`,
          tone: plan != null && actual != null ? (actual >= plan ? "ok" : "bad") : "", def: "جمع وزنی پیشرفت فعالیت‌های برنامهٔ اصلی با W.F (گزارش روزانه، پیوند پلتفرم یا پیشرفت اعلام‌شدهٔ فایل)" }),
        kpi(`برنامه تا امروز — ${m.contract_no}`, plan, { unit: "%", href: "/eps/activities", def: "منحنی برنامهٔ اصلی: برنامهٔ هر فعالیت روی روزهای خودش، با W.F" }),
        kpi(`فعالیت‌های عقب از برنامه — ${m.contract_no}`, late, { href: "/eps/activities", tone: late ? "warn" : "ok", def: "فعالیت‌های ناتمام که پایان برنامه‌شان گذشته است" }));
    }
    const legacy = !masters.length && p ? " — ورودی قدیمی؛ در EPS به نسخه تبدیل کنید" : "";
    sections.push({ key: "progress", title: "پیشرفت و برنامه", kpis: masters.length ? [...eps,
      kpi("SPI (حساب‌های کنترلی)", board?.total?.spi ?? null, { href: "/controls",
        tone: board?.total?.spi == null ? "" : board.total.spi >= 1 ? "ok" : "bad", def: "EV ÷ PV روی حساب‌هایی که بودجه و هزینه دارند" }),
      kpi("CPI", board?.total?.money?.cpi ?? null, { href: "/controls",
        tone: board?.total?.money?.cpi == null ? "" : board.total.money.cpi >= 1 ? "ok" : "bad", def: "EV ÷ AC" }),
    ] : [
      kpi("پیشرفت فیزیکی (PMS)", now == null ? null : Math.round(now * 10000) / 100, { unit: "%", href: "/eps",
        def: "جمع وزنی پیشرفت گام‌های PMS با W.F، با آخرین گزارش هر گام",
        sub: p ? `تاریخ داده: ${p.import.data_date || "نامعلوم"}${legacy}` : null }),
      kpi("برنامهٔ مبنا تا تاریخ داده", plan == null ? null : Math.round(plan * 10) / 10, { unit: "%", href: "/eps",
        def: "منحنی خط مبنا روی آیتم‌های پیوندخورده به برنامه", sub: planAt ? `در ${planAt}` : null }),
      kpi("واقعی همان آیتم‌ها", linkedActual == null ? null : Math.round(linkedActual * 10) / 10, { unit: "%", href: "/eps",
        tone: plan != null && linkedActual != null ? (linkedActual >= plan ? "ok" : "bad") : "",
        def: "پیشرفت آیتم‌های PMS که به فعالیت برنامه پیوند دارند (همان مبنای مقایسه)" }),
      kpi("جابه‌جایی پایان پروژه", slip, { unit: "روز", href: "/eps", tone: slip > 0 ? "bad" : "ok",
        def: "پایان جاری برنامه منهای پایان خط مبنا" }),
      kpi("فعالیت‌های عقب از مبنا", v.tasks.length ? lateTasks : null, { href: "/eps", tone: lateTasks ? "warn" : "ok",
        def: "فعالیت‌های ناتمام که پایان جاری‌شان بعد از پایان مبناست" }),
      kpi("SPI (حساب‌های کنترلی)", board?.total?.spi ?? null, { href: "/controls",
        tone: board?.total?.spi == null ? "" : board.total.spi >= 1 ? "ok" : "bad", def: "EV ÷ PV روی حساب‌هایی که بودجه و هزینه دارند" }),
      kpi("CPI", board?.total?.money?.cpi ?? null, { href: "/controls",
        tone: board?.total?.money?.cpi == null ? "" : board.total.money.cpi >= 1 ? "ok" : "bad", def: "EV ÷ AC" }),
    ] });
  }

  // ── piping ──
  {
    const w = await one(`SELECT count(*)::int AS total, count(*) FILTER (WHERE is_welded)::int AS welded,
        count(*) FILTER (WHERE is_examined)::int AS examined, count(*) FILTER (WHERE awaiting_ndt)::int AS awaiting
      FROM reporting.fact_weld WHERE project_key = $1`);
    const r = await one(`SELECT sum(shots)::int AS shots, sum(rejects)::int AS rejects FROM reporting.kpi_welder_performance WHERE project_key = $1`);
    sections.push({ key: "piping", title: "پایپینگ و جوش", kpis: [
      kpi("جوش زده‌شده", w.total ? pct(w.welded, w.total) : null, { unit: "%", href: "/piping/overview", sub: w.total ? `${w.welded} از ${w.total}` : null,
        def: "جوش‌های ثبت‌شده به‌عنوان زده‌شده از کل جوش‌های رجیسترهای تأییدشده" }),
      kpi("جوش بازرسی‌شده (NDT)", w.total ? pct(w.examined, w.total) : null, { unit: "%", href: "/piping/overview" }),
      kpi("در انتظار NDT", w.total ? w.awaiting : null, { href: "/piping/overview", tone: w.awaiting ? "warn" : "ok" }),
      kpi("نرخ تعمیر جوش", r?.shots ? pct(r.rejects, r.shots) : null, { unit: "%", href: "/piping/overview",
        tone: r?.shots ? (r.rejects / r.shots > 0.05 ? "bad" : "ok") : "", def: "شات‌های رد ÷ کل شات‌ها (رادیوگرافی/UT)" }),
    ] });
  }

  // ── quality ──
  {
    const pu = await one(`SELECT count(*) FILTER (WHERE closed_on IS NULL)::int AS open,
        count(*) FILTER (WHERE closed_on IS NULL AND category = 'A')::int AS a,
        count(*) FILTER (WHERE closed_on IS NULL AND category = 'B')::int AS b,
        count(*) FILTER (WHERE closed_on IS NULL AND due_on < $2)::int AS overdue, count(*)::int AS total
      FROM reporting.fact_punch WHERE project_key = $1`, [projectId, today]);
    const nc = await one(`SELECT count(*) FILTER (WHERE is_open)::int AS open,
        count(*) FILTER (WHERE is_open AND response_due < $2)::int AS overdue, count(*)::int AS total,
        round(avg(days_to_close))::int AS avg_close
      FROM reporting.fact_ncr WHERE project_key = $1`, [projectId, today]);
    sections.push({ key: "quality", title: "کیفیت", kpis: [
      kpi("Punch باز", pu.total ? pu.open : null, { href: "/quality", tone: pu.a ? "bad" : pu.open ? "warn" : "ok", sub: pu.total ? `A: ${pu.a} · B: ${pu.b}` : null }),
      kpi("Punch عقب از مهلت", pu.total ? pu.overdue : null, { href: "/quality", tone: pu.overdue ? "bad" : "ok" }),
      kpi("NCR باز", nc.total ? nc.open : null, { href: "/quality", tone: nc.open ? "warn" : "ok" }),
      kpi("NCR عقب از مهلت پاسخ", nc.total ? nc.overdue : null, { href: "/quality", tone: nc.overdue ? "bad" : "ok" }),
      kpi("میانگین زمان بستن NCR", nc.avg_close, { unit: "روز", href: "/quality" }),
    ] });
  }

  // ── HSE ──
  {
    const inc = await all("SELECT incident_class, is_lti, occurred_on FROM reporting.fact_hse_incident WHERE project_key = $1");
    const h = await one("SELECT sum(hours)::float8 AS hours, min(work_date) AS first FROM reporting.fact_hse_manhours WHERE project_key = $1");
    const r = rates(inc.map((i) => (CLASSES[i.incident_class] ? i.incident_class : null)), h.hours);
    const lastLti = inc.filter((i) => i.is_lti).map((i) => iso(i.occurred_on)).sort().at(-1) || null;
    const permits = await one(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*)::int AS total
      FROM reporting.fact_hse_permit WHERE project_key = $1`);
    sections.push({ key: "hse", title: "HSE", kpis: [
      kpi("نفرساعت ثبت‌شده", h.hours ? Math.round(h.hours) : null, { href: "/hse" }),
      kpi("LTIF", h.hours ? r.ltif.iogp : null, { href: "/hse", tone: r.lti ? "bad" : "ok", def: "حادثهٔ منجر به از دست رفتن روز کاری × ۱٬۰۰۰٬۰۰۰ ÷ نفرساعت (IOGP)" }),
      kpi("TRIR", h.hours ? r.trir.iogp : null, { href: "/hse", tone: r.recordable ? "warn" : "ok", def: "حادثهٔ ثبت‌شدنی × ۱٬۰۰۰٬۰۰۰ ÷ نفرساعت (IOGP)" }),
      kpi("روز بدون LTI", h.hours ? days(today, lastLti || iso(h.first)) : null, { href: "/hse", tone: "ok",
        def: "از آخرین حادثهٔ LTI (یا از اولین نفرساعت ثبت‌شده) تا امروز", sub: lastLti ? `آخرین LTI: ${lastLti}` : "LTI ثبت نشده" }),
      kpi("مجوز کار فعال", permits.total ? permits.active : null, { href: "/hse" }),
    ] });
  }

  // ── completions ──
  {
    const sub = await one("SELECT count(*)::int AS n FROM subsystem WHERE project_id = $1");
    const mc = await one("SELECT count(*) FILTER (WHERE is_accepted)::int AS acc FROM reporting.fact_mc WHERE project_key = $1");
    const rf = await one("SELECT count(*) FILTER (WHERE is_accepted)::int AS acc FROM reporting.fact_rfsu WHERE project_key = $1");
    const tp = await one("SELECT count(*)::int AS n, count(*) FILTER (WHERE is_accepted)::int AS acc FROM reporting.fact_test_package WHERE project_key = $1");
    sections.push({ key: "completions", title: "تکمیل و راه‌اندازی", kpis: [
      kpi("MC پذیرفته", sub.n ? pct(mc.acc, sub.n) : null, { unit: "%", href: "/completions", sub: sub.n ? `${mc.acc} از ${sub.n} ساب‌سیستم` : null }),
      kpi("RFSU پذیرفته", sub.n ? pct(rf.acc, sub.n) : null, { unit: "%", href: "/precom", sub: sub.n ? `${rf.acc} از ${sub.n}` : null }),
      kpi("Test Pack پذیرفته", tp.n ? pct(tp.acc, tp.n) : null, { unit: "%", href: "/completions", sub: tp.n ? `${tp.acc} از ${tp.n}` : null }),
    ] });
  }

  // ── supply and documents ──
  {
    const po = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE slip_days > 0)::int AS late,
        count(*) FILTER (WHERE float_days < 0)::int AS short FROM reporting.fact_po_line WHERE project_key = $1`);
    const vd = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE last_code IS NULL AND due_on < $2)::int AS overdue
      FROM reporting.fact_vendor_document WHERE project_key = $1`, [projectId, today]);
    const tr = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE returned_on IS NULL AND response_due < $2)::int AS overdue
      FROM reporting.fact_transmittal_item WHERE project_key = $1`, [projectId, today]);
    sections.push({ key: "supply", title: "خرید و مدارک", kpis: [
      kpi("ردیف PO با تأخیر", po.n ? po.late : null, { href: "/procurement", tone: po.late ? "warn" : "ok", sub: po.n ? `از ${po.n} ردیف` : null,
        def: "پیش‌بینی تحویل بعد از تاریخ تعهد" }),
      kpi("ردیف PO دیرتر از نیاز سایت", po.n ? po.short : null, { href: "/procurement", tone: po.short ? "bad" : "ok", def: "شناوری منفی نسبت به ROS" }),
      kpi("مدرک وندور عقب از مهلت", vd.n ? vd.overdue : null, { href: "/procurement", tone: vd.overdue ? "bad" : "ok" }),
      kpi("پاسخ ترانسمیتال عقب از مهلت", tr.n ? tr.overdue : null, { href: "/documents", tone: tr.overdue ? "bad" : "ok" }),
    ] });
  }

  // ── daily reports ──
  {
    const dr = await one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'open')::int AS open,
        count(*) FILTER (WHERE status = 'approved')::int AS approved,
        count(*) FILTER (WHERE report_date >= ($2::date - 30))::int AS last30, max(report_date) AS last
      FROM report r JOIN report_type t ON t.id = r.report_type_id WHERE r.project_id = $1 AND t.code IN ('DR', 'CR')`, [projectId, today]).catch(() => null);
    sections.push({ key: "daily", title: "گزارش روزانه", kpis: dr ? [
      kpi("گزارش‌های ۳۰ روز اخیر", dr.n ? dr.last30 : null, { href: "/contract-reports", sub: dr.last ? `آخرین: ${iso(dr.last)}` : null }),
      kpi("در گردش (منتظر امضا/تأیید)", dr.n ? dr.open : null, { href: "/contract-reports", tone: dr.open ? "warn" : "ok" }),
      kpi("تأیید نهایی‌شده", dr.n ? dr.approved : null, { href: "/contract-reports", tone: "ok" }),
    ] : [] });
  }

  // ── risk ──
  const risks = await all(`SELECT code, title, score, residual_score, owner, due_on FROM reporting.fact_risk
    WHERE project_key = $1 AND status = 'open' ORDER BY coalesce(residual_score, score) DESC, score DESC LIMIT 5`);
  const welders = await all(`SELECT stamp_no, welder_name, welds_made, shots, rejects, repair_rate_pct FROM reporting.kpi_welder_performance
    WHERE project_key = $1 AND shots > 0 ORDER BY repair_rate_pct DESC NULLS LAST LIMIT 10`);
  const lines = await all(`SELECT line_no, piping_class, welds_total, welds_done, welds_examined, awaiting_ndt, pct_welded
    FROM reporting.kpi_line_progress WHERE project_key = $1 ORDER BY pct_welded ASC, line_no LIMIT 200`).catch(() => []);
  return { today, sections, risks, welders, lines };
}
