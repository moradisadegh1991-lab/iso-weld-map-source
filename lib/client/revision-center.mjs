"use client";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The Revisions tab's data (docs/audit/phase-8-revision-lifecycle.md): the chain of the open revision's drawing sheet, the comparison of a source
 * revision with the open one, and the carry-forward request. Everything the user chose (source, filters, the picked change, decisions) lives HERE,
 * in the workspace, so it survives a tab switch. The server plans again on apply; a request key is made once per attempt and reused on a retry,
 * so a double click or a retry cannot carry twice.
 */
export function useRevisionCenter({ session, documentId }) {
  const [lineage, setLineage] = useState(null), [fromId, setFromId] = useState(null), [compare, setCompare] = useState(null);
  const [loading, setLoading] = useState(false), [error, setError] = useState(""), [tick, setTick] = useState(0), [busy, setBusy] = useState(false);
  const [ui, setUi] = useState({ kind: "all", category: "all", q: "", pick: null, decisions: {} });
  const key = useRef(null);
  const pid = session?.projectId;
  useEffect(() => {
    if (!documentId || !pid) { setLineage(null); setCompare(null); return undefined; }
    let gone = false;
    (async () => {
      try {
        const l = await session.call(`/api/revisions?projectId=${pid}&documentId=${documentId}`);
        if (gone) return;
        setLineage(l);
        const me = l.chain.find((c) => c.documentId === documentId);
        setFromId((cur) => (cur && l.chain.some((c) => c.documentId === cur) && cur !== documentId ? cur : me?.parentDocumentId || null));
      } catch (e) { if (!gone) setError(e.message); }
    })();
    return () => { gone = true; };
  }, [documentId, pid, tick]);
  useEffect(() => {
    if (!fromId || !documentId || !pid) { setCompare(null); return undefined; }
    let gone = false;
    setLoading(true); setError("");
    (async () => {
      try { const c = await session.call(`/api/revisions?projectId=${pid}&documentId=${fromId}&compareTo=${documentId}`); if (!gone) setCompare(c); }
      catch (e) { if (!gone) { setCompare(null); setError(e.message); } }
      finally { if (!gone) setLoading(false); }
    })();
    return () => { gone = true; };
  }, [fromId, documentId, pid, tick]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const patch = useCallback((o) => setUi((u) => ({ ...u, ...o })), []);
  const create = useCallback(async (revision, changeNote) => {
    setBusy(true);
    try { const r = await session.call("/api/revisions", { method: "POST", body: JSON.stringify({ projectId: pid, action: "create", sourceDocumentId: documentId, revision, changeNote, noFile: true }) }); setTick((t) => t + 1); return { ok: true, document: r.document }; }
    catch (e) { return { error: e.message }; } finally { setBusy(false); }
  }, [session, pid, documentId]);
  const apply = useCallback(async (decisions) => {
    if (!compare) return { error: "no comparison" };
    setBusy(true);
    key.current = key.current || (globalThis.crypto?.randomUUID?.() || `k${Date.now()}${Math.random().toString(36).slice(2)}`);
    try {
      const r = await session.call("/api/revisions/carry", { method: "POST", body: JSON.stringify({ projectId: pid, fromDocumentId: compare.from.documentId, toDocumentId: compare.to.documentId, fromHash: compare.from.hash, toHash: compare.to.hash, requestKey: key.current, decisions }) });
      key.current = null; setUi((u) => ({ ...u, decisions: {} })); setTick((t) => t + 1);
      return { ok: true, result: r };
    } catch (e) { const code = e.body?.code; if (code && /STALE|LOCKED|INVALID|NOT_|UNKNOWN|FIELD/.test(code)) key.current = null; return { error: e.message, code }; } finally { setBusy(false); }
  }, [session, pid, compare]);
  return { lineage, fromId, setFromId, compare, loading, error, busy, refresh, ui, patch, create, apply };
}
