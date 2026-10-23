"use client";
import { usePrefs } from "../../lib/client/prefs.mjs";
import { useEpsFmt } from "./ActivityDetail";
import { HOLD_GROUPS, COMMENT_STATUS } from "../../lib/eps/planning.mjs";
import TableKit from "../ui/TableKit";

/**
 * The planning preview's own sub-forms for an activity in a version (owner's
 * requirements 2026-10-22, images 2, 5, 6): requirements, comments and
 * follow-up, and the status row with its holds. Rows are edited where they
 * stand and added with «+» under the last one; every figure of the status row
 * comes from the server (lib/eps/planning.mjs statusRow).
 *
 *   p      the preview detail (GET /api/eps/planning?versionId&activityId)
 *   a      the activity as the version plans it
 *   post   (body, done) → sends to /api/eps/planning
 */
const yes = (v) => v === true || v === "true" || v === "1";

export function Requirements({ p, a, acts = [], may, post }) {
  const { t } = usePrefs();
  const { fmt, day } = useEpsFmt();
  const H = { name: t("ep.rq.name"), doc: t("ep.rq.doc"), type: t("ep.rq.type"), hold: t("ep.rq.hold"), target: t("ep.rq.target"), done: t("ep.rq.done"),
    status: t("ep.status"), active: t("ep.rq.active"), pred: t("ep.rq.pred"), remark: t("ep.remark") };
  const byId = new Map(p.requirements.map((q) => [q.id, q]));
  const body = (v) => ({ name: v.name, docNo: v.docNo, typeId: v.typeId, holdWeight: v.holdWeight, targetDate: v.targetDate, doneDate: v.doneDate, status: v.status,
    active: yes(v.active), predActivityId: v.predActivityId || null, remark: v.remark });
  const base = { kind: "req", versionId: p.version.id, activityId: a.id };
  const rowEdit = may ? {
    fields: [{ col: H.name, name: "name", type: "text" }, { col: H.doc, name: "docNo", type: "text" },
      { col: H.type, name: "typeId", type: "select", options: p.types.map((x) => [x.id, x.name]) }, { col: H.hold, name: "holdWeight", type: "number" },
      { col: H.target, name: "targetDate", type: "date" }, { col: H.done, name: "doneDate", type: "date" }, { col: H.status, name: "status", type: "text" },
      { col: H.active, name: "active", type: "select", options: [["false", t("ep.no")], ["true", t("ep.yes")]] },
      { col: H.pred, name: "predActivityId", type: "select", options: [["", "—"], ...acts.filter((x) => x.id !== a.id).map((x) => [x.id, `${x.code} — ${x.name}`])] },
      { col: H.remark, name: "remark", type: "text" }],
    value: (k) => { const q = byId.get(k); return { name: q.name, docNo: q.doc_no || "", typeId: q.type_id, holdWeight: q.hold_weight ?? "", targetDate: q.target_date || "",
      doneDate: q.done_date || "", status: q.status || "", active: String(!!q.active), predActivityId: q.pred_activity_id || "", remark: q.remark || "" }; },
    onSave: (k, v) => post({ ...base, id: k, ...body(v) }, () => t("ep.rq.saved")),
    onAdd: (v) => post({ ...base, ...body({ typeId: p.types[0]?.id, active: "false", ...Object.fromEntries(Object.entries(v).filter(([, x]) => x !== "")) }) }, () => t("ep.rq.saved")),
  } : undefined;
  return (
    <div data-sub="requirements">
      <div className="tablewrap"><TableKit name="eps-plan-req" min={1} rowEdit={rowEdit} onDelete={may ? (k) => post({ kind: "req-remove", id: k }, () => t("ep.removed")) : undefined}>
        <table className="dtable">
          <thead><tr><th>Activity NO.</th><th>Scheduling NO.</th><th>{H.name}</th><th>{H.doc}</th><th>{H.type}</th><th>{H.hold}</th><th>{H.target}</th><th>{H.done}</th>
            <th>{H.status}</th><th>{H.active}</th><th>{H.pred}</th><th>{H.remark}</th></tr></thead>
          <tbody>{p.requirements.map((q) => (
            <tr key={q.id} data-key={q.id} data-req={q.name}>
              <td className="mono" dir="ltr">{a.code}</td><td className="mono">{p.version.code}</td><td style={{ background: "rgba(255,230,0,.18)" }}>{q.name}</td><td className="mono">{q.doc_no || ""}</td>
              <td>{q.type_name}</td><td className="mono">{fmt(q.hold_weight, 10)}</td><td className="mono">{day(q.target_date)}</td><td className="mono">{day(q.done_date)}</td>
              <td>{q.status || ""}</td><td>{q.active ? "◉" : "○"}</td><td className="mono sm" dir="ltr">{q.pred_code || ""}</td><td className="sm">{q.remark || ""}</td></tr>))}</tbody>
        </table></TableKit></div>
      {p.requirements.length === 0 && <p className="sm muted">{t("ep.rq.none")}</p>}
      <p className="sm muted">{t("ep.rq.note")}</p>
      <RequirementTypes p={p} may={may} post={post} />
    </div>);
}

/** The contract's list of requirement kinds, each with the hold column it counts in — editable, as the owner asked. */
function RequirementTypes({ p, may, post }) {
  const { t } = usePrefs();
  const H = { name: t("ep.rq.type"), group: t("ep.rq.holdCol") };
  const byId = new Map(p.types.map((x) => [x.id, x]));
  const opts = HOLD_GROUPS.map((g) => [g, t(`ep.hold.${g}`)]);
  const rowEdit = may ? {
    fields: [{ col: H.name, name: "name", type: "text" }, { col: H.group, name: "holdGroup", type: "select", options: opts }],
    value: (k) => ({ name: byId.get(k).name, holdGroup: byId.get(k).hold_group }),
    onSave: (k, v) => post({ kind: "req-type", id: k, ...v }, () => t("ep.rq.typeSaved")),
    onAdd: (v) => post({ kind: "req-type", contractId: p.contractId, name: v.name, holdGroup: v.holdGroup || "others" }, () => t("ep.rq.typeSaved")),
  } : undefined;
  return (
    <details style={{ marginTop: 8 }} data-req-types>
      <summary className="sm">{t("ep.rq.types", { n: p.types.length })}</summary>
      <TableKit name="eps-plan-req-types" min={1} rowEdit={rowEdit} onDelete={may ? (k) => post({ kind: "req-type-remove", id: k }, () => t("ep.removed")) : undefined}>
        <table className="dtable" style={{ maxWidth: 480 }}><thead><tr><th>{H.name}</th><th>{H.group}</th></tr></thead>
          <tbody>{p.types.map((x) => <tr key={x.id} data-key={x.id}><td>{x.name}</td><td>{t(`ep.hold.${x.hold_group}`)}</td></tr>)}</tbody></table></TableKit>
    </details>);
}

export function Comments({ p, a, may, post }) {
  const { t } = usePrefs();
  const { day } = useEpsFmt();
  const H = { item: t("ep.cm.item"), by: t("ep.cm.by"), date: t("ep.cm.date"), status: t("ep.status"), dept: t("ep.cm.dept"), done: t("ep.cm.done"), remark: t("ep.remark") };
  const byId = new Map(p.comments.map((c) => [c.id, c]));
  const base = { kind: "comment", versionId: p.version.id, activityId: a.id };
  const body = (v) => ({ item: v.item, actionBy: v.actionBy || null, actionDate: v.actionDate, status: v.status || "open", department: v.department, doneDate: v.doneDate, remark: v.remark });
  const rowEdit = may ? {
    fields: [{ col: H.item, name: "item", type: "text" }, { col: H.by, name: "actionBy", type: "select", options: [["", "—"], ...p.people.map((u) => [u.id, u.display_name || "—"])] },
      { col: H.date, name: "actionDate", type: "date" }, { col: H.status, name: "status", type: "select", options: COMMENT_STATUS.map((s) => [s, t(`ep.cm.st.${s}`)]) },
      { col: H.dept, name: "department", type: "text" }, { col: H.done, name: "doneDate", type: "date" }, { col: H.remark, name: "remark", type: "text" }],
    value: (k) => { const c = byId.get(k); return { item: c.item, actionBy: c.action_by || "", actionDate: c.action_date || "", status: c.status, department: c.department || "",
      doneDate: c.done_date || "", remark: c.remark || "" }; },
    onSave: (k, v) => post({ ...base, id: k, ...body(v) }, () => t("ep.cm.saved")),
    onAdd: (v) => post({ ...base, ...body(v) }, () => t("ep.cm.saved")),
  } : undefined;
  return (
    <div data-sub="comments">
      <div className="tablewrap"><TableKit name="eps-plan-comments" min={1} rowEdit={rowEdit} onDelete={may ? (k) => post({ kind: "comment-remove", id: k }, () => t("ep.removed")) : undefined}>
        <table className="dtable">
          <thead><tr><th>Activity NO</th><th>Scheduling NO</th><th>Row</th><th>{H.item}</th><th>{H.by}</th><th>{H.date}</th><th>{H.status}</th><th>{H.dept}</th><th>{H.done}</th><th>{H.remark}</th></tr></thead>
          <tbody>{p.comments.map((c) => (
            <tr key={c.id} data-key={c.id} data-comment={c.row_no}>
              <td className="mono" dir="ltr">{a.code}</td><td className="mono">{p.version.code}</td><td className="mono">{c.row_no}</td><td style={{ minWidth: 260 }}>{c.item}</td>
              <td>{c.action_by_name || ""}</td><td className="mono">{day(c.action_date)}</td><td>{t(`ep.cm.st.${c.status}`)}</td><td>{c.department || ""}</td>
              <td className="mono">{day(c.done_date)}</td><td className="sm">{c.remark || ""}</td></tr>))}</tbody>
        </table></TableKit></div>
      {p.comments.length === 0 && <p className="sm muted">{t("ep.cm.none")}</p>}
    </div>);
}

/** The status row (images 6 and 9): weights and progress against the version's plan, and what is held, by column. */
export function Status({ p, a }) {
  const { t } = usePrefs();
  const { fmt, day, w } = useEpsFmt();
  const s = p.status;
  const pct = (v) => (v == null ? "—" : `${fmt(v)}%`);
  const cells = [
    ["Scheduling Name", p.version.title], ["Scheduling NO.", p.version.code], ["ACTIVITY NO.", a.code], ["Description", a.name],
    ["Original Start", day(s.start)], ["Orig. Durat", fmt(s.days)], ["Original Finish", day(s.end)], ["Percent", w(s.percent)], ["W.F", w(s.wv, 10)],
    ["Plan Progress", pct(s.planProgress)], ["Unit", s.unit || "—"], ["Original Weight", fmt(s.originalWeight, 4)], ["Actual Weight", fmt(s.actualWeight, 4)],
    ["Plan Weight", fmt(s.planWeight, 4)], ["Done Weight", fmt(s.doneWeight, 4)], ["Actual Progress", pct(s.actualProgress)], ["Remain Weight", fmt(s.remainWeight, 4)],
    ["Front Weight", fmt(s.frontWeight, 4)], ["Total Hold", fmt(s.totalHold, 4)],
    ...HOLD_GROUPS.map((g) => [`${t(`ep.hold.${g}`)} Hold`, fmt(s.holds[g], 4)]),
  ];
  return (
    <div data-sub="status">
      <div className="tablewrap"><table className="dtable">
        <thead><tr>{cells.map(([h]) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody><tr data-status={a.code}>{cells.map(([h, v]) => <td key={h} className="mono" data-col={h}>{v}</td>)}</tr></tbody></table></div>
      <p className="sm muted">{t("ep.ss.note")}</p>
    </div>);
}
