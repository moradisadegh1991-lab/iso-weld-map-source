"use client";
/**
 * Who is signed in, and which project they are looking at.
 *
 * One context for the whole shell. Every page needs the same three facts —
 * the user, the project list, the selected project — and a page that keeps
 * its own copy is how a UI ends up saving into one project while listing
 * another.
 *
 * None of this is a trust boundary. Every route re-resolves the session
 * cookie and re-checks membership server-side; this is convenience, and it
 * is allowed to be this simple only because of that.
 */
import { createContext, useContext, useCallback, useEffect, useMemo, useState } from "react";

const Ctx = createContext(null);

const LAST_PROJECT = "epc.lastProject";

export function PlatformProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, projects: [] });
  const [projectId, setProjectIdRaw] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      if (res.status === 401) return setState({ status: "anon", user: null, projects: [] });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
      setState({ status: "in", user: body.user, projects: body.projects, authMode: body.authMode });
    } catch (e) {
      // A failed /me is NOT treated as signed out: showing the login form
      // when the server is merely unreachable makes people type a password
      // into a page that cannot check it.
      setState({ status: "error", user: null, projects: [], error: e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Remember the last project across reloads. localStorage can throw in a
  // private window, so every access is guarded and the app works without it.
  useEffect(() => {
    if (state.status !== "in" || !state.projects.length) return;
    let remembered = null;
    try { remembered = localStorage.getItem(LAST_PROJECT); } catch { /* ignore */ }
    const known = state.projects.find((p) => p.id === remembered);
    // One project is the normal case on site; an unselected dropdown there
    // is just a step to forget.
    setProjectIdRaw(known?.id || state.projects[0].id);
  }, [state.status, state.projects]);

  const setProjectId = useCallback((id) => {
    setProjectIdRaw(id);
    try { localStorage.setItem(LAST_PROJECT, id); } catch { /* ignore */ }
  }, []);

  const call = useCallback(async (url, init = {}) => {
    const res = await fetch(url, {
      ...init,
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
    });
    const body = await res.json().catch(() => ({ error: `پاسخ ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(body.error || `پاسخ ${res.status}`), { body, res });
    return body;
  }, []);

  const signOut = useCallback(async ({ everywhere = false } = {}) => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ everywhere }) });
    setState({ status: "anon", user: null, projects: [] });
  }, []);

  const project = useMemo(
    () => state.projects.find((p) => p.id === projectId) || null,
    [state.projects, projectId]);

  const value = useMemo(() => ({
    ...state, projectId, setProjectId, project,
    role: project?.role || null,
    call, signOut, reload: load,
  }), [state, projectId, project, setProjectId, call, signOut, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePlatform() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePlatform must be used inside <PlatformProvider>");
  return v;
}

/**
 * Load something from the API whenever the project changes.
 *
 * Every section page does exactly this, and each one hand-rolling it is how
 * you get five different loading states and two forgotten error paths.
 * Returns `{data, error, busy, reload}` — never throws into render.
 */
export function useProjectData(makeUrl, deps = []) {
  const { call, projectId } = usePlatform();
  const [out, setOut] = useState({ data: null, error: null, busy: false });

  const reload = useCallback(async () => {
    if (!projectId) return;
    setOut((o) => ({ ...o, busy: true, error: null }));
    try {
      setOut({ data: await call(makeUrl(projectId)), error: null, busy: false });
    } catch (e) {
      setOut({ data: null, error: e.message, busy: false });
    }
    // makeUrl is a closure the caller recreates each render, so it is
    // deliberately not a dependency; `deps` is the caller's own list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call, projectId, ...deps]);

  useEffect(() => { reload(); }, [reload]);
  return { ...out, reload };
}
