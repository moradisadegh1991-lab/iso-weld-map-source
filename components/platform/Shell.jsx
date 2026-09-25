"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { navigationFor, activeItem } from "../../lib/platform/navigation.mjs";
import { AREAS } from "../../lib/platform/areas.mjs";
import { can } from "../../lib/authz.mjs";
import SignIn from "./SignIn";

/**
 * The frame every page sits in.
 *
 * It is also the authentication gate: a signed-out visitor gets the login
 * form and nothing else, so no page has to remember to check. The one page
 * outside the gate is /setup, which a new account opens from its one-time
 * link before it has a password.
 *
 * The menu is the member's: the sections their role may open, within the
 * work areas their membership names (lib/platform/areas.mjs). It searches
 * (Ctrl+K), its groups fold and remember it, it narrows to icons, and on a
 * phone it is a drawer.
 */
export const ROLE_FA = { viewer: "بیننده", qc: "کنترل کیفیت", engineer: "مهندس", admin: "مدیر پروژه", developer: "توسعه‌دهنده" };
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

export function useTheme() {
  const [theme, setTheme] = useState("dark");
  useEffect(() => { setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, []);
  const toggle = () => {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("epc.theme", next); } catch { /* ignore */ }
    setTheme(next);
  };
  return [theme, toggle];
}

export default function Shell({ children }) {
  const p = usePlatform();
  const pathname = usePathname() || "/";
  if (pathname.startsWith("/setup")) return <>{children}</>;

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
  return <Frame p={p} pathname={pathname}>{children}</Frame>;
}

function Frame({ p, pathname, children }) {
  const router = useRouter();
  const [theme, toggleTheme] = useTheme();
  const [rail, setRail] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [closed, setClosed] = useState([]);
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const search = useRef(null);

  useEffect(() => { setRail(store.get("epc.nav.rail", false)); setClosed(store.get("epc.nav.closed", [])); }, []);
  useEffect(() => { setDrawer(false); setMenu(false); }, [pathname]);
  // Ctrl/⌘+K: the menu's search, from anywhere.
  useEffect(() => {
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (window.matchMedia("(max-width: 900px)").matches) setDrawer(true);
        if (rail) { setRail(false); store.set("epc.nav.rail", false); setTimeout(() => search.current?.focus(), 0); }
        else search.current?.focus();
      }
      if (e.key === "Escape") { setMenu(false); setDrawer(false); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [rail]);

  const membership = { role: p.role, areas: p.project?.areas || [] };
  const nav = navigationFor(membership, can);
  const here = activeItem(pathname);
  const found = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return null;
    return nav.flatMap((g) => g.items.filter((i) => `${i.title} ${i.desc || ""} ${g.group}`.toLowerCase().includes(n)));
  }, [q, nav]);

  const toggleGroup = (g) => {
    const next = closed.includes(g) ? closed.filter((x) => x !== g) : [...closed, g];
    setClosed(next); store.set("epc.nav.closed", next);
  };
  const toggleRail = () => { const v = !rail; setRail(v); store.set("epc.nav.rail", v); };
  const name = p.user?.displayName || p.user?.email || "";
  const initials = name.trim().charAt(0).toUpperCase() || "?";
  const groupOf = nav.find((g) => g.items.some((i) => i.href === here?.href));
  const areas = p.project?.areas || [];

  return (
    <div className={`shell ${rail ? "rail" : ""} ${drawer ? "drawer" : ""}`} dir="rtl">
      <header className="topbar">
        <button className="hamb" aria-label="منو" onClick={() => setDrawer(!drawer)}>☰</button>
        <span className="brand"><span className="logo">EPC</span><span className="t">EPC&nbsp;PLATFORM</span></span>
        {p.projects.length > 0 ? (
          <select value={p.projectId} onChange={(e) => p.setProjectId(e.target.value)} aria-label="پروژه">
            {p.projects.map((x) => <option key={x.id} value={x.id}>{x.code} — {x.name}</option>)}
          </select>
        ) : <span className="crumb">هیچ پروژه‌ای به شما تخصیص نیافته است</span>}
        {here && <span className="crumb">{groupOf ? `${groupOf.group} ›` : ""} <b style={{ color: "var(--ink)", fontWeight: 500 }}>{here.title}</b></span>}
        <span className="grow" />
        <button className="iconbtn" onClick={toggleTheme} title={theme === "light" ? "تم تیره" : "تم روشن"} aria-label="تغییر تم">
          {theme === "light" ? "☾" : "☀"}
        </button>
        <div className="usermenu">
          <button onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
            <span className="avatar">{initials}</span>
            <span className="t" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            {p.role && <span className={`role-pill ${p.role}`}>{ROLE_FA[p.role] || p.role}</span>}
            <span aria-hidden style={{ fontSize: 9, color: "var(--dim)" }}>▾</span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <div className="head">
                <b style={{ fontSize: 13 }}>{name}</b>
                <span className="e">{p.user?.email}</span>
                <span className="sm muted">{ROLE_FA[p.role] || "—"} · {areas.length ? areas.map((a) => AREAS[a]).join("، ") : "همهٔ حوزه‌ها"}</span>
              </div>
              <button role="menuitem" onClick={toggleTheme}>{theme === "light" ? "☾ تم تیره" : "☀ تم روشن"}</button>
              {can(membership, "project:members") && <Link role="menuitem" href="/admin">⚿ کاربران و دسترسی</Link>}
              <button role="menuitem" onClick={() => p.signOut()}>⏻ خروج</button>
              <button role="menuitem" className="danger" title="همهٔ نشست‌های این حساب (گوشی، رایانهٔ دیگر) باطل می‌شوند"
                      onClick={() => { if (confirm("از همهٔ دستگاه‌ها خارج شوید؟")) p.signOut({ everywhere: true }); }}>⏻ خروج از همه‌جا</button>
            </div>
          )}
        </div>
      </header>

      {(p.offline || !p.online) && (
        <div className="offline-bar" role="status">
          آفلاین — صفحهٔ <a href="/field">سایت</a> با بستهٔ ذخیره‌شده کار می‌کند و ثبت‌ها تا برگشت شبکه در صف می‌مانند.
          {p.confirmedAt && ` هویت آخرین بار ${new Date(p.confirmedAt).toLocaleString("fa-IR")} تأیید شد.`}
        </div>
      )}

      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <nav className="sidenav" aria-label="بخش‌های سامانه">
        <div className="nav-top">
          <div className="nav-search">
            <input ref={search} type="search" placeholder="جست‌وجوی بخش…" value={q} aria-label="جست‌وجوی بخش"
                   onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter" && found?.[0]) { router.push(found[0].href); setQ(""); } }} />
            {!q && <span className="k">Ctrl K</span>}
          </div>
        </div>
        <div className="nav-groups">
          {found ? (
            found.length ? found.map((i) => <NavLink key={i.href} i={i} on={here?.href === i.href} onClick={() => setQ("")} />)
              : <p className="nav-empty">بخشی با «{q}» نیست.</p>
          ) : nav.map((g) => {
            const hasHere = g.items.some((i) => i.href === here?.href);
            const isClosed = closed.includes(g.group) && !hasHere;
            return (
              <div key={g.group} className={`nav-grp ${isClosed ? "closed" : ""}`}>
                <button className="grp" onClick={() => toggleGroup(g.group)} aria-expanded={!isClosed}>
                  <span>{g.group}</span><span className="chev" aria-hidden>▾</span>
                </button>
                <div className="items">
                  {g.items.map((i) => <NavLink key={i.href} i={i} on={here?.href === i.href} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="nav-foot">
          <button onClick={toggleRail} title={rail ? "باز کردن منو" : "جمع کردن منو"} aria-label={rail ? "باز کردن منو" : "جمع کردن منو"}>
            {rail ? "«" : "»"} <span className="t">{rail ? "" : "جمع کردن منو"}</span>
          </button>
        </div>
      </nav>

      <main className="body">{children}</main>
    </div>
  );
}

function NavLink({ i, on, onClick }) {
  const soon = i.status !== "live";
  const cls = `${on ? "on" : ""} ${soon ? "soon" : ""}`.trim();
  // A planned section is a span, not a dead link: a link that goes nowhere
  // is worse than one that is visibly not ready.
  if (soon) {
    return <a className={cls} aria-disabled="true" title={i.title}><span className="ic">{i.icon}</span><span className="t">{i.title}</span><span className="tail">به‌زودی</span></a>;
  }
  return (
    <Link href={i.href} className={cls} aria-current={on ? "page" : undefined} title={i.desc ? `${i.title} — ${i.desc}` : i.title} onClick={onClick}>
      <span className="ic">{i.icon}</span><span className="t">{i.title}</span>
    </Link>
  );
}
