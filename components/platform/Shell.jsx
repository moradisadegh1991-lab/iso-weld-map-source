"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePlatform } from "../../lib/client/platform.mjs";
import { navigationFor, activeTab } from "../../lib/platform/navigation.mjs";
import { AREAS } from "../../lib/platform/areas.mjs";
import { can } from "../../lib/authz.mjs";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { localizeNav } from "../../lib/i18n/nav.mjs";
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
 * work areas their membership names (lib/platform/areas.mjs). A section's
 * pages are tabs across the top of the page, not separate menu entries.
 * The menu searches every tab (Ctrl+K), its groups fold and remember it, it
 * narrows to icons, and on a phone it is a drawer.
 */
export const ROLE_FA = { viewer: "بیننده", qc: "کنترل کیفیت", engineer: "مهندس", admin: "مدیر پروژه", designer: "طراح", contracts: "امور قراردادها", finance: "مالی", hr: "منابع انسانی", developer: "توسعه‌دهنده" };
const store = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } },
};

/** The light/dark switch of the top bar: the person's theme setting (lib/client/prefs.mjs), "match system" resolved to what shows. */
export function useTheme() {
  const { prefs, setPref } = usePrefs();
  const [shown, setShown] = useState("dark");
  useEffect(() => { setShown(document.documentElement.dataset.theme === "light" ? "light" : "dark"); }, [prefs.theme]);
  const toggle = () => setPref("theme", shown === "light" ? "dark" : "light");
  return [shown, toggle];
}

export default function Shell({ children }) {
  const p = usePlatform();
  const { t } = usePrefs();
  const pathname = usePathname() || "/";
  if (pathname.startsWith("/setup")) return <>{children}</>;

  if (p.status === "loading") {
    return <div className="signin"><p className="muted">{t("common.loading")}</p></div>;
  }
  if (p.status === "error") {
    // Deliberately NOT the login form: asking for a password when the server
    // is merely unreachable invites people to type it into a page that
    // cannot check it.
    return (
      <div className="signin">
        <div className="card" style={{ maxWidth: 420 }}>
          <h2>{t("common.unavailable")}</h2>
          <p className="muted sm">{p.error}</p>
          <button className="btn ghost" onClick={p.reload}>{t("common.retry")}</button>
        </div>
      </div>
    );
  }
  if (p.status === "anon") return <SignIn />;
  return <Frame p={p} pathname={pathname}>{children}</Frame>;
}

function Frame({ p, pathname, children }) {
  const router = useRouter();
  const { t, lang, locale } = usePrefs();
  const [theme, toggleTheme] = useTheme();
  const roleName = (r) => (r ? t(`role.${r}`) : "—");
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

  const membership = { role: p.role, areas: p.project?.areas || [], tiles: p.project?.tiles || [], party: p.project?.inspection_party || null };
  const forms = p.project?.forms || [];
  const nav = localizeNav(navigationFor(membership, can, { forms }), lang);
  const tab = activeTab(pathname, forms);
  const here = tab && { ...tab, title: nav.flatMap((g) => g.items.flatMap((s) => s.tabs)).find((x) => x.href === tab.href)?.title || tab.title };
  const section = nav.flatMap((g) => g.items).find((s) => s.key === here?.section) || null;
  // A page this person's role does not open (a designer on the launchpad)
  // sends them to the first page it does, instead of a page of refusals.
  const allowed = nav.flatMap((g) => g.items.flatMap((s) => s.tabs.map((t) => t.href)));
  const firstAllowed = nav[0]?.items[0]?.href || null;
  const blocked = !!(p.projectId && p.role && here && firstAllowed && !allowed.includes(here.href));
  useEffect(() => { if (blocked) router.replace(firstAllowed); }, [blocked, firstAllowed, router]);
  // Search finds a page by its tab, its section or its group.
  const found = useMemo(() => {
    const n = q.trim().toLowerCase();
    if (!n) return null;
    return nav.flatMap((g) => g.items.flatMap((s) => s.tabs
      .filter((x) => `${x.title} ${s.title} ${s.desc || ""} ${g.label}`.toLowerCase().includes(n))
      .map((x) => ({ ...x, key: x.href, icon: s.icon, title: s.tabs.length > 1 ? `${s.title} › ${x.title}` : s.title, desc: s.desc, status: "live" }))));
  }, [q, nav]);

  const toggleGroup = (g) => {
    const next = closed.includes(g) ? closed.filter((x) => x !== g) : [...closed, g];
    setClosed(next); store.set("epc.nav.closed", next);
  };
  const toggleRail = () => { const v = !rail; setRail(v); store.set("epc.nav.rail", v); };
  const name = p.user?.displayName || p.user?.email || "";
  const initials = name.trim().charAt(0).toUpperCase() || "?";
  const groupOf = nav.find((g) => g.items.some((i) => i.key === here?.section));
  const areas = p.project?.areas || [];

  return (
    <div className={`shell ${rail ? "rail" : ""} ${drawer ? "drawer" : ""}`}>
      <header className="topbar">
        <button className="hamb" aria-label={t("shell.menu")} onClick={() => setDrawer(!drawer)}>☰</button>
        <span className="brand"><span className="logo">EPC</span><span className="t">EPC&nbsp;PLATFORM</span></span>
        {p.projects.length > 0 ? <ContractPicker p={p} /> : <span className="crumb">{t("shell.noProjects")}</span>}
        {section && <span className="crumb">{groupOf ? `${groupOf.label} ›` : ""} {section.tabs.length > 1 ? `${section.title} ›` : ""} <b style={{ color: "var(--ink)", fontWeight: 500 }}>{here.title}</b></span>}
        <span className="grow" />
        <button className="iconbtn" onClick={toggleTheme} title={theme === "light" ? t("shell.themeDark") : t("shell.themeLight")} aria-label={t("shell.toggleTheme")}>
          {theme === "light" ? "☾" : "☀"}
        </button>
        <div className="usermenu">
          <button onClick={() => setMenu(!menu)} aria-haspopup="menu" aria-expanded={menu}>
            <span className="avatar">{initials}</span>
            <span className="t" style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
            {p.role && <span className={`role-pill role-${p.role}`}>{roleName(p.role)}</span>}
            <span aria-hidden style={{ fontSize: 9, color: "var(--dim)" }}>▾</span>
          </button>
          {menu && (
            <div className="menu" role="menu">
              <div className="head">
                <b style={{ fontSize: 13 }}>{name}</b>
                <span className="e">{p.user?.email}</span>
                <span className="sm muted">{roleName(p.role)} · {areas.length ? areas.map((a) => AREAS[a]).join(lang === "en" ? ", " : "، ") : t("shell.allAreas")}</span>
              </div>
              <button role="menuitem" onClick={toggleTheme}>{theme === "light" ? `☾ ${t("shell.themeDark")}` : `☀ ${t("shell.themeLight")}`}</button>
              {can(membership, "project:members") && <Link role="menuitem" href="/admin">⚿ {t("shell.users")}</Link>}
              <Link role="menuitem" href="/account">⚙ {t("shell.settings")}</Link>
              <button role="menuitem" onClick={() => p.signOut()}>⏻ {t("shell.signOut")}</button>
              <button role="menuitem" className="danger" title={t("shell.signOutAllTitle")}
                      onClick={() => { if (confirm(t("shell.signOutAllConfirm"))) p.signOut({ everywhere: true }); }}>⏻ {t("shell.signOutAll")}</button>
            </div>
          )}
        </div>
      </header>

      {(p.offline || !p.online) && (
        <div className="offline-bar" role="status">
          <a href="/field">{t("shell.offline")}</a>
          {p.confirmedAt && ` ${t("shell.offlineConfirmed", { at: new Date(p.confirmedAt).toLocaleString(locale) })}`}
        </div>
      )}

      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}
      <nav className="sidenav" aria-label={t("shell.navLabel")}>
        <div className="nav-top">
          <div className="nav-search">
            <input ref={search} type="search" placeholder={t("shell.searchSection")} value={q} aria-label={t("shell.searchSection")}
                   onChange={(e) => setQ(e.target.value)}
                   onKeyDown={(e) => { if (e.key === "Enter" && found?.[0]) { router.push(found[0].href); setQ(""); } }} />
            {!q && <span className="k">Ctrl K</span>}
          </div>
        </div>
        <div className="nav-groups">
          {found ? (
            found.length ? found.map((i) => <NavLink key={i.href} i={i} on={here?.href === i.href} onClick={() => setQ("")} />)
              : <p className="nav-empty">{t("shell.noSection", { q })}</p>
          ) : nav.map((g) => {
            const hasHere = g.items.some((i) => i.key === here?.section);
            const isClosed = closed.includes(g.group) && !hasHere;
            return (
              <div key={g.group} className={`nav-grp ${isClosed ? "closed" : ""}`}>
                <button className="grp" onClick={() => toggleGroup(g.group)} aria-expanded={!isClosed}>
                  <span>{g.label}</span><span className="chev" aria-hidden>▾</span>
                </button>
                <div className="items">
                  {g.items.map((i) => <NavLink key={i.key} i={i} on={i.key === here?.section} />)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="nav-foot">
          <button onClick={toggleRail} title={rail ? t("shell.expand") : t("shell.collapse")} aria-label={rail ? t("shell.expand") : t("shell.collapse")}>
            {(lang === "en") !== rail ? "«" : "»"} <span className="t">{rail ? "" : t("shell.collapse")}</span>
          </button>
        </div>
      </nav>

      <main className="body">
        {section && section.tabs.length > 1 && <SectionTabs section={section} here={here} />}
        {children}
      </main>
    </div>
  );
}

/**
 * The top bar's pick: a contract, grouped under its project — the contracts
 * this person sees (all of a project's for its managers; otherwise those
 * they are assigned to). Picking a contract opens its project too; «کل پروژه»
 * is the project with no contract picked, for the project-wide sections.
 */
function ContractPicker({ p }) {
  const { t } = usePrefs();
  const value = p.contractId ? `c:${p.contractId}` : `p:${p.projectId}`;
  const pick = (v) => {
    const [kind, id] = v.split(":");
    if (kind === "p") return p.setContract(id, "");
    const proj = p.projects.find((x) => (x.contracts || []).some((c) => c.id === id));
    if (proj) p.setContract(proj.id, id);
  };
  return (
    <select value={value} onChange={(e) => pick(e.target.value)} aria-label={t("shell.contractPick")} title={t("shell.contractPickTitle")} style={{ maxWidth: 360 }}>
      {p.projects.map((x) => (
        <optgroup key={x.id} label={`${x.code} — ${x.name}`}>
          <option value={`p:${x.id}`}>{x.code} — {t("shell.wholeProject")}</option>
          {(x.contracts || []).map((c) => (
            <option key={c.id} value={`c:${c.id}`}>{t("shell.contract", { no: c.contract_no, title: c.title })}{c.access && c.access !== "manage" ? ` (${t(`shell.access.${c.access}`)})` : ""}</option>))}
        </optgroup>))}
    </select>
  );
}

/**
 * The section's pages, as tabs. Each is its own address (a link), so a
 * bookmarked or QR-coded page opens on its own tab.
 */
function SectionTabs({ section, here }) {
  return (
    <nav className="section-tabs no-print" aria-label={section.title}>
      <span className="st-title"><span aria-hidden>{section.icon}</span> {section.title}</span>
      {/* Links to pages, not ARIA tabs: each is its own address. */}
      <div className="st-list">
        {section.tabs.map((t) => (
          <Link key={t.href} href={t.href}
                aria-current={t.href === here?.href ? "page" : undefined} className={t.href === here?.href ? "on" : ""}>{t.title}</Link>
        ))}
      </div>
    </nav>
  );
}

function NavLink({ i, on, onClick }) {
  const { t } = usePrefs();
  const soon = i.status !== "live";
  const cls = `${on ? "on" : ""} ${soon ? "soon" : ""}`.trim();
  // A planned section is a span, not a dead link: a link that goes nowhere
  // is worse than one that is visibly not ready.
  if (soon) {
    return <a className={cls} aria-disabled="true" title={i.title}><span className="ic">{i.icon}</span><span className="t">{i.title}</span><span className="tail">{t("shell.soon")}</span></a>;
  }
  return (
    <Link href={i.href} className={cls} aria-current={on ? "page" : undefined} title={i.desc ? `${i.title} — ${i.desc}` : i.title} onClick={onClick}>
      <span className="ic">{i.icon}</span><span className="t">{i.title}</span>
    </Link>
  );
}
