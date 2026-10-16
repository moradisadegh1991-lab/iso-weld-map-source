/**
 * Merge the two extraction passes into one payload.
 *
 * The passes run in parallel and either may fail on its own, so this has to
 * cope with half an answer: a partial extraction that the engineer can finish
 * by hand beats a dead end, which is why nothing here throws on a missing
 * half.
 */
export function mergePasses(metaPass, nodesPass) {
  const a = metaPass?.data;
  const b = nodesPass?.data;
  return {
    meta: { ...(a?.meta || {}), nps: b?.nps ?? a?.meta?.nps },
    bom: a?.bom || [],
    nodes: b?.nodes || [],
    edges: b?.edges || [],
    notes: a?.notes || [],
    unreadable: [...(a?.unreadable || []), ...(b?.unreadable || [])],
  };
}
