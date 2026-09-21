/**
 * Browser-side session state: who you are and which project you are in.
 *
 * Lifted out of the save bar because the review queue needs the same two
 * facts, and two components each keeping their own copy is how a UI ends up
 * saving into one project while listing another.
 *
 * None of this is a trust boundary — every route re-resolves the identity and
 * re-checks membership server-side. It is a convenience, and it is allowed to
 * be this simple only because of that.
 */
import { useCallback, useEffect, useState } from "react";
import { getIdentity, setIdentity as persist, authHeaders } from "./identity.mjs";

export function useSession() {
  const [identity, setIdentityState] = useState("");
  const [projects, setProjects] = useState(null);
  const [projectId, setProjectId] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setIdentityState(getIdentity()); }, []);

  const call = useCallback(async (url, init = {}) => {
    const res = await fetch(url, { ...init, headers: authHeaders(identity) });
    const body = await res.json().catch(() => ({ error: `پاسخ ${res.status}` }));
    if (!res.ok) throw Object.assign(new Error(body.error || `پاسخ ${res.status}`), { body, res });
    return body;
  }, [identity]);

  const connect = useCallback(async (who = identity) => {
    if (!who) return;
    setBusy(true);
    setError(null);
    try {
      persist(who);
      setIdentityState(who);
      const res = await fetch("/api/projects", { headers: authHeaders(who) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || `پاسخ ${res.status}`);
      setProjects(body.projects);
      // Choosing for them when there is only one is not a shortcut: a single
      // project is the normal case on site, and an unselected dropdown there
      // is just a step to forget.
      if (body.projects.length === 1) setProjectId(body.projects[0].id);
    } catch (e) {
      setProjects(null);
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }, [identity]);

  const role = projects?.find((p) => p.id === projectId)?.role || null;

  return {
    identity, setIdentity: setIdentityState,
    projects, projectId, setProjectId, role,
    connected: !!projects, busy, error, setError,
    connect, call,
  };
}
