"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * The P&ID workspace's data: the project's P&ID drawings, the current draft of the open one (draft, validation, registers, asset-link proposals)
 * and the person's actions (every one a request the server re-checks: GET/POST /api/pid, POST /api/pid/review). Nothing is approved from here
 * except by an explicit action; a stale edit comes back as 409 STALE_RUN and the draft is re-read.
 */
export function usePidDocs({ session }) {
  const [docs, setDocs] = useState([]), [loading, setLoading] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0);
  useEffect(() => {
    if (!session?.projectId) { setDocs([]); return undefined; }
    let gone = false; setLoading(true);
    session.call(`/api/pid?projectId=${session.projectId}`).then((r) => { if (!gone) { setDocs(r.documents || []); setError(""); } }).catch((e) => { if (!gone) setError(e.message); }).finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [session?.projectId, tick]);
  return { docs, loading, error, refresh: useCallback(() => setTick((t) => t + 1), []) };
}

export function usePidDraft({ session, documentId }) {
  const [data, setData] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0), [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    if (!documentId || !session?.projectId) { setData(null); setError(""); return undefined; }
    let gone = false; setLoading(true);
    session.call(`/api/pid?projectId=${session.projectId}&documentId=${documentId}`)
      .then((r) => { if (!gone) { setData(r); setError(""); } })
      .catch((e) => { if (!gone) { setData(null); setError(e.res?.status === 404 ? "" : e.message); } })
      .finally(() => { if (!gone) setLoading(false); });
    return () => { gone = true; };
  }, [documentId, session?.projectId, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const post = useCallback(async (path, body) => {
    setBusy(true); setNotice("");
    try { const r = await session.call(path, { method: "POST", body: JSON.stringify({ projectId: session.projectId, ...body }) }); setTick((t) => t + 1); return { ok: true, result: r }; }
    catch (e) { setNotice(e.message); if (e.body?.code === "STALE_RUN") setTick((t) => t + 1); return { error: e.message, code: e.body?.code, details: e.body?.details }; }
    finally { setBusy(false); }
  }, [session]);
  const act = useCallback((uid, action, extra = {}) => post("/api/pid/review", { runId: data?.run?.id, uid, action, baseHash: data?.run?.payloadHash, ...extra }), [post, data]);
  const approveDraft = useCallback(() => post("/api/pid/review", { runId: data?.run?.id, action: "approve_draft" }), [post, data]);
  const ingest = useCallback((body) => post("/api/pid", { documentId, ...body }), [post, documentId]);
  const confirmMapping = useCallback((sourceRunId, fromUid, toUid) => post("/api/pid/review", { runId: data?.run?.id, action: "confirm_mapping", sourceRunId, fromUid, toUid, baseHash: data?.run?.payloadHash }), [post, data]);
  return { data, loading, error, busy, notice, refresh, act, approveDraft, ingest, confirmMapping, setNotice, session };
}
