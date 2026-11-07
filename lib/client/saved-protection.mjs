"use client";
import { useEffect, useMemo, useState } from "react";
import { protector } from "../register/mark-protection.mjs";

/**
 * What the SAVED revision holds against deleting a mark (installed / tested equipment and accessories, installed and reserved
 * allocation lines, an approved revision), read through the existing routes the page already uses:
 *   GET /api/iso-equipment?projectId&documentId       GET /api/bom-allocations?projectId&documentId
 * and handed to the sheet and its tables as `protect(ref)`. Advice shown BEFORE the confirm: the server decides on save and is the
 * authority (409s). With no saved revision there is no saved state, and nothing is blocked here.
 *
 * Used by both workspaces (the typed weld list and the model route) — one rule, one reader.
 */
export function useSavedProtection({ session, documentId, items, status }) {
  const [saved, setSaved] = useState({ equipment: [], lines: [], phase: "none" });
  useEffect(() => {
    if (!documentId || !session?.projectId) { setSaved({ equipment: [], lines: [], phase: "none" }); return undefined; }
    let gone = false;
    (async () => {
      try {
        const q = `projectId=${session.projectId}&documentId=${documentId}`;
        const [e, a] = await Promise.all([session.call(`/api/iso-equipment?${q}`), session.call(`/api/bom-allocations?${q}`)]);
        if (!gone) setSaved({ equipment: e?.equipment || [], lines: a?.lines || [], phase: "ok" });
      } catch { if (!gone) setSaved({ equipment: [], lines: [], phase: "error" }); }
    })();
    return () => { gone = true; };
  }, [documentId, session?.projectId, status]);
  return useMemo(() => protector(items, { equipment: saved.equipment, lines: saved.lines, locked: status === "approved" }), [items, saved, status]);
}
