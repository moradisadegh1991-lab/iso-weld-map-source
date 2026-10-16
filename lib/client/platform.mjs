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
const LAST_CONTRACT = "epc.lastContract";
// Who was last confirmed signed in, and to which projects — so the field
// page opens with no network. Display only: every request is still checked
// by the server, and nothing is sent until it can be.
const IDENTITY = "epc.identity";

const readIdentity = () => { try { return JSON.parse(localStorage.getItem(IDENTITY) || "null"); } catch { return null; } };
const writeIdentity = (v) => { try { v ? localStorage.setItem(IDENTITY, JSON.stringify(v)) : localStorage.removeItem(IDENTITY); } catch { /* ignore */ } };

export function PlatformProvider({ children }) {
  const [state, setState] = useState({ status: "loading", user: null, projects: [] });
  const [projectId, setProjectIdRaw] = useState("");
  // The contract picked in the top bar ("" = the project as a whole). Its
  // project is always `projectId`.
  const [contractId, setContractIdRaw] = useState("");
  const [online, setOnline] = useState(true);

  const load = useCallback(async () => {
    let res;
    try {
      res = await fetch("/api/auth/me", { credentials: "same-origin" });
    } catch (e) {
      // No network at all. With an identity confirmed earlier on this
      // device, open in offline mode; without one there is nothing to show.
      const known = readIdentity();
      if (known) return setState({ status: "in", offline: true, user: known.user, projects: known.projects, confirmedAt: known.at });
      return setState({ status: "error", user: null, projects: [], error: e.message });
    }
    try {
      if (res.status === 401) { writeIdentity(null); return setState({ status: "anon", user: null, projects: [] }); }
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
      writeIdentity({ user: body.user, projects: body.projects, at: new Date().toISOString() });
      setState({ status: "in", user: body.user, projects: body.projects, authMode: body.authMode });
    } catch (e) {
      // A failed /me is NOT treated as signed out: showing the login form
      // when the server is merely unreachable makes people type a password
      // into a page that cannot check it.
      setState({ status: "error", user: null, projects: [], error: e.message });
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // The network coming back is the moment to re-confirm who this is.
  useEffect(() => {
    const up = () => { setOnline(true); load(); };
    const down = () => setOnline(false);
    setOnline(typeof navigator === "undefined" ? true : navigator.onLine !== false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, [load]);

  // Remember the last project across reloads. localStorage can throw in a
  // private window, so every access is guarded and the app works without it.
  useEffect(() => {
    if (state.status !== "in" || !state.projects.length) return;
    let remembered = null;
    try { remembered = localStorage.getItem(LAST_PROJECT); } catch { /* ignore */ }
    let rememberedContract = null;
    try { rememberedContract = localStorage.getItem(LAST_CONTRACT); } catch { /* ignore */ }
    const known = state.projects.find((p) => p.id === remembered);
    // One project is the normal case on site; an unselected dropdown there
    // is just a step to forget.
    const proj = known || state.projects[0];
    setProjectIdRaw(proj.id);
    const cs = proj.contracts || [];
    // A remembered contract this person still sees; else, for someone who sees
    // contracts only (no project-wide role over them), their first one.
    const keep = cs.find((c) => c.id === rememberedContract);
    setContractIdRaw(keep ? keep.id : rememberedContract === "" ? "" : cs[0]?.id || "");
  }, [state.status, state.projects]);

  const setProjectId = useCallback((id) => {
    setProjectIdRaw(id);
    setContractIdRaw("");
    try { localStorage.setItem(LAST_PROJECT, id); localStorage.setItem(LAST_CONTRACT, ""); } catch { /* ignore */ }
  }, []);

  /** The top bar's pick: a contract (and so its project), or a project as a whole (contractId ""). */
  const setContract = useCallback((pid, cid = "") => {
    setProjectIdRaw(pid);
    setContractIdRaw(cid || "");
    try { localStorage.setItem(LAST_PROJECT, pid); localStorage.setItem(LAST_CONTRACT, cid || ""); } catch { /* ignore */ }
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
    writeIdentity(null);
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ everywhere }) });
    } catch { /* offline: the cookie expires on its own; this device forgets now */ }
    setState({ status: "anon", user: null, projects: [] });
  }, []);

  const project = useMemo(
    () => state.projects.find((p) => p.id === projectId) || null,
    [state.projects, projectId]);

  const contract = useMemo(
    () => (project?.contracts || []).find((c) => c.id === contractId) || null,
    [project, contractId]);

  const value = useMemo(() => ({
    ...state, projectId, setProjectId, project, online,
    contractId: contract ? contract.id : "", contract, setContract,
    role: project?.role || null,
    call, signOut, reload: load,
  }), [state, projectId, project, setProjectId, contract, setContract, call, signOut, load, online]);

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
      const url = makeUrl(projectId);
      if (!url) { setOut({ data: null, error: null, busy: false }); return; }      // a caller with nothing to load here
      setOut({ data: await call(url), error: null, busy: false });
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
