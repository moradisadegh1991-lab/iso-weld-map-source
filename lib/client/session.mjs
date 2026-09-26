"use client";
/**
 * The old session hook, now an adapter over the platform context.
 *
 * It used to own the identity: a subject string typed into a box and kept in
 * localStorage. That is gone — authentication is a signed HttpOnly cookie
 * issued by /api/auth/login, and the shell is the gate.
 *
 * This survives as an adapter rather than being deleted because SaveBar,
 * ReviewQueue and EditPanel all take a `session` prop, and rewriting four
 * components to change where two fields come from is churn that buys
 * nothing. Everything it returns now comes from one place, which was the
 * point of the original hook in the first place.
 */
import { useCallback, useState } from "react";
import { usePlatform } from "./platform.mjs";

export function useSession() {
  const p = usePlatform();
  const [error, setError] = useState(null);

  const call = useCallback(async (url, init) => {
    try {
      return await p.call(url, init);
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [p]);

  return {
    // `identity` is now display only. Nothing is sent with it: the cookie
    // travels on its own and the server never reads a subject from a header
    // when one is present.
    identity: p.user?.email || p.user?.displayName || "",
    setIdentity: () => {},
    connect: async () => {},
    connected: p.status === "in",

    projects: p.projects,
    projectId: p.projectId,
    setProjectId: p.setProjectId,
    role: p.role,

    busy: p.status === "loading",
    error, setError,
    call,
  };
}
