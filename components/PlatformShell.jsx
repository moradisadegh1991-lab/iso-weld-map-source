"use client";
import { MODULES } from "../lib/platform/modules.mjs";
import { STAGE_ORDER, STAGE_FA, STAGES } from "../lib/platform/workflow.mjs";

/**
 * The frame the disciplines sit in.
 *
 * Two jobs, both about orientation rather than decoration: which module am I
 * in and what else exists, and where in the process is the thing in front of
 * me. Both were previously only in somebody's head.
 *
 * Planned modules are shown, disabled, with the standard their engine will
 * answer to. Hiding them would make the platform look finished and leave
 * nobody any idea where it is going; presenting them as usable would be a
 * lie the first click exposes.
 */

export function ModuleBar({ current = "piping", onPick }) {
  return (
    <nav className="modbar" aria-label="ماژول‌ها">
      {MODULES.map((m) => {
        const live = m.status === "live";
        return (
          <button
            key={m.id}
            className={`mod ${m.id === current ? "on" : ""} ${live ? "" : "soon"}`}
            disabled={!live}
            aria-current={m.id === current ? "page" : undefined}
            title={live ? `${m.source} · ${m.standard}` : `به‌زودی — ${m.standard}`}
            onClick={() => live && onPick?.(m.id)}
          >
            <b>{m.title}</b>
            <span className="mono sm">{live ? m.subtitle : "به‌زودی"}</span>
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Where this document stands.
 *
 * `failed` deliberately has no place on the line — it is not a step towards
 * approval, it is the absence of one — so it is shown as its own state
 * rather than being squeezed in between two stages it does not lie between.
 */
export function StageRail({ stage }) {
  if (stage === STAGES.FAILED) {
    return <div className="rail failed"><span>{STAGE_FA[STAGES.FAILED]}</span></div>;
  }
  const at = STAGE_ORDER.indexOf(stage);
  return (
    <ol className="rail" aria-label="مرحلهٔ کار">
      {STAGE_ORDER.map((s, i) => (
        <li key={s} className={i < at ? "done" : i === at ? "now" : ""}
            aria-current={i === at ? "step" : undefined}>
          <i />{STAGE_FA[s]}
        </li>
      ))}
    </ol>
  );
}
