"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { usePlatform } from "../../lib/client/platform.mjs";
import { navigationFor, activeItem } from "../../lib/platform/navigation.mjs";
import { can } from "../../lib/authz.mjs";
import SignIn from "./SignIn";

/**
 * The frame every page sits in.
 *
 * It is also the authentication gate: a signed-out visitor gets the login
 * form and nothing else, so no page has to remember to check. That is the
 * same reasoning as putting the approval rule in one place — a check that
 * each screen must remember is a check one screen will forget.
 */
export default function Shell({ children }) {
  const p = usePlatform();
  const pathname = usePathname() || "/";

  if (p.status === "loading") {
    return <div className="signin"><p className="muted">در حال بارگذاری…</p></div>;
  }
  if (p.status === "error") {
    // Deliberately NOT the login form: asking for a password when the server
    // is merely unreachable invites people to type it into a page that
    // cannot check it.
    return (
      <div className="signin">
        <div className="card" style={{ maxWidth: 420 }}>
          <h2>سامانه در دسترس نیست</h2>
          <p className="muted sm">{p.error}</p>
          <button className="btn ghost" onClick={p.reload}>تلاش دوباره</button>
        </div>
      </div>
    );
  }
  if (p.status === "anon") return <SignIn />;

  const nav = navigationFor({ role: p.role }, can);
  const here = activeItem(pathname);
  const initials = (p.user?.displayName || p.user?.email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="shell" dir="rtl">
      <header className="topbar">
        <span className="brand">EPC&nbsp;PLATFORM</span>

        {p.projects.length > 0 ? (
          <select value={p.projectId} onChange={(e) => p.setProjectId(e.target.value)}
                  aria-label="پروژه">
            {p.projects.map((x) => (
              <option key={x.id} value={x.id}>{x.code} — {x.name}</option>
            ))}
          </select>
        ) : (
          <span className="crumb">هیچ پروژه‌ای به شما تخصیص نیافته است</span>
        )}

        {here && <span className="crumb">/ {here.title}</span>}
        <span className="grow" />

        <div className="who">
          <span className="avatar">{initials}</span>
          <span>{p.user?.displayName || p.user?.email}</span>
          {p.role && <span className="pill">{ROLE_FA[p.role] || p.role}</span>}
          <button className="btn ghost" style={{ padding: "5px 10px" }} onClick={() => p.signOut()}>
            خروج
          </button>
          <button className="btn ghost" style={{ padding: "5px 10px" }}
                  title="همهٔ نشست‌های این حساب (گوشی، رایانهٔ دیگر) باطل می‌شوند"
                  onClick={() => { if (confirm("از همهٔ دستگاه‌ها خارج شوید؟")) p.signOut({ everywhere: true }); }}>
            خروج از همه‌جا
          </button>
        </div>
      </header>

      <nav className="sidenav" aria-label="بخش‌های سامانه">
        {nav.map((g) => (
          <div key={g.group}>
            <div className="grp">{g.group}</div>
            {g.items.map((i) => {
              const soon = i.status !== "live";
              const on = here?.href === i.href;
              const cls = `${on ? "on" : ""} ${soon ? "soon" : ""}`.trim();
              // A planned section is a span, not a dead link: a link that
              // goes nowhere is worse than one that is visibly not ready.
              return soon ? (
                <a key={i.href} className={cls} aria-disabled="true">
                  <span className="ic">{i.icon}</span>{i.title}
                  <span className="tail">به‌زودی</span>
                </a>
              ) : (
                <Link key={i.href} href={i.href} className={cls}
                      aria-current={on ? "page" : undefined}>
                  <span className="ic">{i.icon}</span>{i.title}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <main className="body">{children}</main>
    </div>
  );
}

const ROLE_FA = { viewer: "بیننده", qc: "کنترل کیفیت", engineer: "مهندس", admin: "مدیر" };
