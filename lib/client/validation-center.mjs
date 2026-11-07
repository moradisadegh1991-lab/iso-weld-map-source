"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { validate } from "../engineering/validation.mjs";

/**
 * The Reconciliation Center's data (docs/audit/phase-7-engineering-validation.md): the server's validation of the SAVED revision
 * (GET /api/validation — also returns the stored equipment, BOM ledger and warnings), and the same engine run in the page on the DRAFT
 * against that stored state. Refreshed on demand and whenever the saved run changes (a save re-opens the run). Resolving a stored warning is
 * POST /api/mark-warnings (the server checks the relationship first); the saved view is then re-read.
 */
export function useValidationCenter({ session, documentId, runId, status, payload, revision, previous = null }) {
  const [server, setServer] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!documentId || !session?.projectId) { setServer(null); setError(""); return undefined; }
    let gone = false;
    setLoading(true);
    (async () => {
      try {
        const r = await session.call(`/api/validation?projectId=${session.projectId}&documentId=${documentId}`);
        if (!gone) { setServer(r); setError(""); }
      } catch (e) { if (!gone) { setServer(null); setError(e.message); } }
      finally { if (!gone) setLoading(false); }
    })();
    return () => { gone = true; };
  }, [documentId, runId, status, session?.projectId, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const draft = useMemo(() => validate({ payload, revision: { ...revision, documentId: documentId || null, runId: runId || null, status }, saved: server?.saved || null, source: "draft", previous }),
    [payload, revision, documentId, runId, status, server, previous]);
  const resolve = useCallback(async (finding, resolution) => {
    setBusy(true);
    try {
      await session.call("/api/mark-warnings", { method: "POST", body: JSON.stringify({ projectId: session.projectId, documentId, warningId: finding.detail.warningId, resolution, baseHash: server?.payloadHash || null }) });
      setTick((t) => t + 1);
      return { ok: true };
    } catch (e) { return { error: e.message }; } finally { setBusy(false); }
  }, [session, documentId, server]);
  return { draft, server, loading, error, refresh, resolve, resolveBusy: busy };
}
