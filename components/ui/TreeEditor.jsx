"use client";
import { useState } from "react";
import { usePrefs } from "../../lib/client/prefs.mjs";

/**
 * A tree whose branches are moved by drag and drop: drop a node on another
 * to put it under it, or on the top strip to make it a root. Every move goes
 * to `onMove(id, parentId)`; the server refuses a move under itself. Each
 * node may render extra content (`render(node)`) and actions (`actions(node)`).
 */
export default function TreeEditor({ nodes, onMove, render, actions, editable = true, label }) {
  const { t } = usePrefs();
  label = label || t("ui.tree.branch");
  const [drag, setDrag] = useState(null);
  const [over, setOver] = useState(null);
  const drop = (parentId) => (e) => {
    e.preventDefault();
    const id = drag || e.dataTransfer.getData("text/plain");
    setOver(null); setDrag(null);
    if (id && id !== parentId) onMove(id, parentId);
  };
  // One context object, so each node stays the same component across renders: a node
  // defined inside this function would be a new component on every hover, and React
  // would remount the very element being dragged — which ends the browser's drag.
  const ctx = { drag, setDrag, over, setOver, drop, render, actions, editable };
  return (
    <div>
      {editable && (
        <div onDragOver={(e) => { e.preventDefault(); setOver("root"); }} onDragLeave={() => setOver(null)} onDrop={drop(null)} data-drop-root=""
          className="sm muted" style={{ padding: 6, marginBottom: 4, borderRadius: 6, border: `1px dashed ${over === "root" ? "var(--cy, #1b7f99)" : "var(--line, #ccd)"}` }}>
          {t("ui.tree.dropTop", { label })}
        </div>
      )}
      {nodes.length === 0 ? <p className="empty-note">{t("ui.tree.empty")}</p> : <ul style={{ margin: 0, padding: 0 }}>{nodes.map((n) => <TreeNode key={n.id} n={n} depth={0} ctx={ctx} />)}</ul>}
    </div>
  );
}

function TreeNode({ n, depth, ctx }) {
  const { drag, setDrag, over, setOver, drop, render, actions, editable } = ctx;
  return (
    <li style={{ listStyle: "none" }}>
      <div draggable={editable} data-node={n.id}
        onDragStart={(e) => { setDrag(n.id); e.dataTransfer.setData("text/plain", n.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDrag(null); setOver(null); }}
        onDragOver={(e) => { if (!editable) return; e.preventDefault(); if (over !== n.id) setOver(n.id); }}
        onDragLeave={() => setOver((o) => (o === n.id ? null : o))}
        onDrop={editable ? drop(n.id) : undefined}
        style={{ display: "flex", gap: 8, alignItems: "center", padding: "4px 8px", marginInlineStart: depth * 20, borderRadius: 6,
          border: `1px dashed ${over === n.id ? "var(--cy, #1b7f99)" : "transparent"}`, background: drag === n.id ? "var(--hl, #eef6f8)" : undefined,
          cursor: editable ? "grab" : undefined }}>
        {editable && <span aria-hidden="true" className="muted">⠿</span>}
        <span>{n.children?.length ? "▾" : "•"}</span>
        <span style={{ flex: 1 }}>{render ? render(n) : n.name}</span>
        {actions && actions(n)}
      </div>
      {n.children?.length > 0 && <ul style={{ margin: 0, padding: 0 }}>{n.children.map((c) => <TreeNode key={c.id} n={c} depth={depth + 1} ctx={ctx} />)}</ul>}
    </li>
  );
}

/** Every node of a tree with its path, for pickers: [{ id, path: "A › B", node }]. */
export function flatten(nodes, prefix = "") {
  return nodes.flatMap((n) => {
    const path = prefix ? `${prefix} › ${n.name}` : n.name;
    return [{ id: n.id, path, node: n }, ...flatten(n.children || [], path)];
  });
}
