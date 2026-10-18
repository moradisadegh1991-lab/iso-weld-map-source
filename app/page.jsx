"use client";
import Link from "next/link";
import { usePlatform, useProjectData } from "../lib/client/platform.mjs";
import { navigationFor, narrowed } from "../lib/platform/navigation.mjs";
import { can } from "../lib/authz.mjs";
import { usePrefs } from "../lib/client/prefs.mjs";
import { localizeNav } from "../lib/i18n/nav.mjs";

/**
 * The launchpad.
 *
 * Tiles rather than a list, and numbers on the tiles rather than labels
 * alone: the point of a launchpad is that you learn something before you
 * click. A grid of names tells you what exists, which you already knew.
 *
 * Every number here is one a project manager is actually asked for on a
 * Thursday, and each one is a link to the page that explains it.
 */
export default function Home() {
  const { project, role, projectId } = usePlatform();
  const membership = { role, areas: project?.areas || [], tiles: project?.tiles || [], party: project?.inspection_party || null };
  const { lang } = usePrefs();
  const nav = localizeNav(navigationFor(membership, can, { forms: project?.forms || [] }), lang);
  // a member narrowed to tiles sees their tiles, not the project's numbers
  const mine = narrowed(membership);

  const overview = useProjectData((id) => (mine ? null : `/api/overview?projectId=${id}`), [mine]);
  const o = mine ? null : overview.data;

  return (
    <div className="page">
      <div className="pagehead">
        <h1>{project ? `${project.code} — ${project.name}` : "میز کار"}</h1>
        {project && <span className="sub">نمای کلی پروژه</span>}
      </div>

      {!projectId && (
        <p className="empty-note">
          هیچ پروژه‌ای به حساب شما تخصیص نیافته است. مدیر سامانه باید شما را به
          یک پروژه اضافه کند.
        </p>
      )}

      {overview.error && <p className="err">{overview.error}</p>}

      {o && (
        <div className="tiles">
          <Stat href="/subsystems" icon="◈" title="ساب‌سیستم‌ها"
                total={o.subsystems.total}
                empty="هنوز شکست سیستم وارد نشده"
                desc={`${o.subsystems.ready} از ${o.subsystems.total} آمادهٔ تحویل`}
                value={o.subsystems.total}
                tone={o.subsystems.ready === o.subsystems.total ? "ok" : "warn"} />

          <Stat href="/contractors" icon="⚑" title="پیمانکاران"
                total={o.contractors.total}
                empty="هنوز پیمانکاری ثبت نشده"
                desc={o.contractors.lapsed > 0
                  ? `${o.contractors.lapsed} مورد صلاحیت منقضی با کار باز`
                  : "همه با صلاحیت معتبر"}
                value={o.contractors.total}
                tone={o.contractors.lapsed > 0 ? "bad" : "ok"} />

          <Stat href="/equipment" icon="⚙" title="تجهیزات"
                total={o.tags.total}
                empty="هنوز لیست تجهیزات وارد نشده"
                desc={o.tags.unclassified > 0
                  ? `${o.tags.unclassified} تگ در انتظار تعیین نوع`
                  : "همهٔ تگ‌ها زنجیره دارند"}
                value={o.tags.total}
                tone={o.tags.unclassified > 0 ? "warn" : "ok"} />

          <Stat href="/piping" icon="⟜" title="جوش‌ها"
                total={o.welds.total}
                empty="هنوز رجیستری ساخته نشده"
                desc={`${o.welds.tested} بازرسی‌شده از ${o.welds.total}`}
                value={o.welds.total}
                tone={o.welds.awaitingNdt > 0 ? "warn" : "ok"} />

          <Stat href="/piping" icon="❏" title="مدارک"
                total={o.documents.total}
                empty="هنوز مدرکی بارگذاری نشده"
                desc={`${o.documents.approved} رجیستر تأییدشده`}
                value={o.documents.total} tone={null} />

          <Stat href="/qc" icon="✓" title="در انتظار NDT"
                total={o.welds.total}
                empty="جوشی ثبت نشده که بازرسی بخواهد"
                desc="جوشِ زده‌شده که هنوز بازرسی نشده"
                value={o.welds.awaitingNdt}
                tone={o.welds.awaitingNdt > 0 ? "warn" : "ok"} />
        </div>
      )}

      {/* The launchpad: one tile per page, grouped as the menu is — only the tiles this person was given. */}
      {nav.map((g) => {
        const tiles = g.items.flatMap((sec) => sec.tabs.filter((t) => !t.log && t.href !== "/").map((t) => ({ ...t, sec })));
        if (!tiles.length) return null;
        return (
          <section key={g.group} className="lp-group" aria-label={g.label}>
            <h2 className="lp-title">{g.label}</h2>
            <div className="lp-tiles">
              {tiles.map((t) => (
                <Link key={t.href} href={t.href} className="lp-tile" data-tile={t.href}>
                  <span className="lp-head">{t.title}</span>
                  <span className="lp-sub">{t.sec.tabs.filter((x) => !x.log).length > 1 ? t.sec.title : t.sec.desc}</span>
                  <span className="lp-foot"><span className="lp-ic" aria-hidden="true">{t.form ? "⇄" : t.sec.icon}</span></span>
                </Link>))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/**
 * One number on the launchpad.
 *
 * `total` is what the verdict is computed OVER, and when it is zero there is
 * no verdict to give. Without this, an empty project renders a wall of green
 * zeros — "همه با صلاحیت معتبر" over nought contractors, "همهٔ تگ‌ها زنجیره
 * دارند" over nought tags — which reads as "everything is fine" and means
 * "nothing is recorded". Those are opposite things to a project manager, and
 * the green one is the dangerous direction to be wrong in.
 *
 * Same rule as the engine's: a check fed no input must not return a verdict.
 */
function Stat({ href, icon, title, desc, value, tone, total, empty }) {
  const nothing = total === 0;
  return (
    <Link href={href} className="tile">
      <span className="ic">{icon}</span>
      <span className="t">{title}</span>
      <span className="d">{nothing ? empty : desc}</span>
      <span className={`big ${nothing ? "" : tone || ""}`}>{value}</span>
    </Link>
  );
}
