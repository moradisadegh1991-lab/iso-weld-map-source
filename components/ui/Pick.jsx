"use client";
import { useEffect, useState } from "react";
import { usePlatformMaybe } from "../../lib/client/platform.mjs";
import { resolveLists, optionsFor } from "../../lib/register/value-lists.mjs";

/**
 * A value picked from one of the project's lists (lib/register/value-lists.mjs,
 * edited on /piping/defaults), in place of typing it.
 *
 *   const lists = useValueLists();
 *   <Pick list="schedule" lists={lists} value={v} onChange={(v) => …} />
 *
 * A value not in the list (read off a sheet, or given before the list had it)
 * stays, shown first and marked «خارج از فهرست»: picking never loses a value.
 * `placeholder` is the typed field's example; `empty` names "no value" in the list ("—").
 * A list with no values yet is typed into, as before — the list is filled on
 * the defaults page. `items` passes a list the page has (the spools on the
 * sheet, for a weld's spool) in place of a saved one.
 */

// one fetch per project, shared by every picker on the page; a save on the defaults page refreshes it
const cache = new Map();          // projectId → Promise<lists>
const subs = new Set();
export function refreshValueLists(projectId) { cache.delete(projectId); subs.forEach((f) => f()); }

export function useValueLists() {
  const platform = usePlatformMaybe();
  const projectId = platform?.projectId || "";
  const call = platform?.call;
  const [lists, setLists] = useState(() => resolveLists());
  const [tick, setTick] = useState(0);
  useEffect(() => { const f = () => setTick((t) => t + 1); subs.add(f); return () => subs.delete(f); }, []);
  useEffect(() => {
    if (!projectId || !call) { setLists(resolveLists()); return undefined; }
    let live = true;
    if (!cache.has(projectId)) {
      cache.set(projectId, call(`/api/value-lists?projectId=${encodeURIComponent(projectId)}`)
        .then((r) => ({ ...r.lists, _may: Boolean(r.may) }))
        .catch(() => { cache.delete(projectId); return resolveLists(); }));
    }
    cache.get(projectId).then((l) => { if (live) setLists(l); });
    return () => { live = false; };
  }, [projectId, call, tick]);
  return lists;
}

export default function Pick({ list, lists, items: given, value, onChange, disabled, className = "", style, dir = "ltr", placeholder = "", empty = "—", ...rest }) {
  const items = given || lists?.[list]?.items || [];
  const v = value ?? "";
  if (!items.length) {
    return <input dir={dir} className={className} style={style} value={v} placeholder={placeholder} disabled={disabled}
      data-pick={list} data-pick-free="" onChange={(e) => onChange?.(e.target.value)} {...rest} />;
  }
  const { options, extra } = optionsFor(items, v);
  // the list's own spelling of a value given in another case ("bw" → "BW") is what it shows
  const shown = extra != null ? extra : (options.find((o) => o.toUpperCase() === String(v).trim().toUpperCase()) ?? "");
  return (
    <select dir={dir} className={className} style={style} value={shown} disabled={disabled} data-pick={list}
      title={extra != null ? `«${extra}» در فهرست «${lists?.[list]?.label || list}» نیست` : undefined}
      data-pick-extra={extra != null ? "" : undefined} onChange={(e) => onChange?.(e.target.value)} {...rest}>
      <option value="">{empty}</option>
      {extra != null && <option value={extra}>{extra} (خارج از فهرست)</option>}
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
