/**
 * The work front from the project's own records (lib/workfront.mjs decides).
 *
 * Every spool of a current register, every tag with a chain, every cable,
 * instrument and coating item: its next step from its chain, and — where the
 * step consumes material the platform tracks — whether that material is on
 * site. A spool's shop steps need the spool's material list (reserved,
 * issued or free in the warehouse); an equipment tag's installation needs
 * the equipment itself received against its PO. Material the platform does
 * not track for a step is «not needed here», not assumed; a spool with no
 * material list is «unknown», not ready.
 *
 * Call inside `withProject`.
 */
import { chainFor } from "../../platform/precedence.mjs";
import { nextStep, frontOf, horizonOf, summarize, SHOP_STEPS, daysBetween } from "../../workfront.mjs";
import { createLoader } from "../loader.mjs";
import { tagStatus } from "./activities.mjs";
import { spoolStatus } from "./piping-execution.mjs";
import { cableStatus } from "./electrical.mjs";
import { instrumentStatus } from "./instrumentation.mjs";
import { coatingStatus } from "./coating.mjs";
import { spoolMaterial } from "./spool-material.mjs";

const iso = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : d ? String(d).slice(0, 10) : null);
const EQUIPMENT_KINDS = new Set(["rotating", "static", "fired"]);

/** Expected arrival of what is still to come, per material item and per tag. */
async function arrivals(db, projectId) {
  const { rows } = await db.query(
    `SELECT l.item_id, l.tag_id, l.qty::float8 AS qty, COALESCE(f.received_qty, 0)::float8 AS received,
            COALESCE(f.shipped_qty, 0)::float8 AS shipped, l.forecast_on, l.promised_on, o.po_no,
            (SELECT max(s.eta_on) FROM shipment_line sl JOIN shipment s ON s.id = sl.shipment_id WHERE sl.po_line_id = l.id) AS eta
       FROM po_line l JOIN purchase_order o ON o.id = l.po_id LEFT JOIN reporting.fact_po_line f ON f.po_line_key = l.id
      WHERE l.project_id = $1`, [projectId]);
  const byItem = new Map(), byTag = new Map();
  for (const r of rows) {
    const open = r.received < r.qty;
    const when = open ? iso((r.shipped > 0 && r.eta) || r.forecast_on || r.promised_on) : null;
    const x = { open, when, poNo: r.po_no, shipped: r.shipped > 0 };
    if (r.item_id) (byItem.get(r.item_id) || byItem.set(r.item_id, []).get(r.item_id)).push(x);
    if (r.tag_id) (byTag.get(r.tag_id) || byTag.set(r.tag_id, []).get(r.tag_id)).push(x);
  }
  return { byItem, byTag };
}

const earliest = (xs) => xs.filter((x) => x.open && x.when).map((x) => x.when).sort()[0] || null;

async function spoolMaterialState(db, projectId, spoolId, arr) {
  const m = await spoolMaterial(db, { projectId, spoolId });
  if (!m.lines.length) return { state: "unknown", text: "فهرست مواد این اسپول در رجیستر نیست" };
  if (m.ready) return { state: "ready", text: "مواد اسپول در انبار (رزرو، حواله یا آزاد)" };
  const short = m.lines.filter((l) => l.state === "short");
  const unmatched = m.lines.filter((l) => ["unmatched", "no_item", "uom"].includes(l.state));
  if (unmatched.length) return { state: "unknown", text: unmatched.map((l) => l.text).join(" · ") };
  const etas = short.map((l) => earliest(arr.byItem.get(l.itemId) || []));
  const eta = etas.includes(null) ? null : etas.sort().at(-1);
  return { state: "short", eta, text: short.map((l) => `${l.itemCode || l.stockCode}: ${l.text}`).join(" · ")
    + (eta ? ` — رسیدن تا ${eta}` : " — در هیچ PO بازی نیست") };
}

function tagMaterialState(tagId, arr) {
  const lines = arr.byTag.get(tagId) || [];
  if (!lines.length) return { state: "unknown", text: "این تجهیز در هیچ PO ثبت نشده (تأمین کارفرما؟)" };
  if (lines.every((x) => !x.open)) return { state: "ready", text: "تجهیز در سایت رسید" };
  const eta = earliest(lines);
  const po = lines.find((x) => x.open)?.poNo;
  return { state: "short", eta, text: `هنوز نرسیده (${po})${eta ? ` — رسیدن تا ${eta}` : ""}` };
}

/** The whole front: every item with work left, its next step, its material and its horizon. */
export async function workFront(db, { projectId, today = new Date().toISOString().slice(0, 10) }) {
  const arr = await arrivals(db, projectId);
  const items = [];
  const add = (x) => {
    let n = nextStep(x.steps);
    if (!n) return;
    // An equipment tag's derived step (its foundation, its piping) is another
    // item's work: the tag waits on it, it is not a second piece of work.
    if (n.open && n.step.derived && EQUIPMENT_KINDS.has(x.kind)) n = { step: n.step, open: false, waitingOn: [`${n.step.title} (از رشتهٔ دیگر)`] };
    const front = frontOf(x.kind, n.step);
    const material = n.open ? (x.material ? x.material(n.step) : { state: "na" }) : null;
    const it = { kind: x.kind, id: x.id, item: x.item, front, subsystem: x.subsystem || null,
      step: n.step.title, stepCode: n.step.code, open: n.open, waitingOn: n.waitingOn || [],
      state: n.step.claimedOn ? "claimed" : n.step.status, material };
    it.horizon = horizonOf({ open: n.open, material }, today);
    it.eta = material?.eta || null;
    it.inDays = it.eta ? daysBetween(today, it.eta) : null;
    items.push(it);
  };

  // Spools of the current (approved or latest) register.
  const { rows: spools } = await db.query(
    `SELECT s.id FROM spool s JOIN reporting.current_run cr ON cr.run_id = s.extraction_run_id
      WHERE s.project_id = $1 ORDER BY s.spool_no`, [projectId]);
  for (const { id } of spools) {
    const st = await spoolStatus(db, { projectId, spoolId: id });
    const n = nextStep(st.steps);
    const mat = n?.open && SHOP_STEPS.has(n.step.code) && ["released", "fit_up"].includes(n.step.code)
      ? await spoolMaterialState(db, projectId, id, arr) : { state: "na" };
    add({ kind: "spool", id, item: `${st.spool.spool_no}${st.spool.line_no ? ` · ${st.spool.line_no}` : ""}`, steps: st.steps, material: () => mat });
  }

  // Tags: foundations, structures and equipment.
  const loader = createLoader(db, projectId);
  const { rows: tags } = await db.query(
    `SELECT t.id, t.tag_no, t.kind, s.code AS subsystem FROM tag t LEFT JOIN subsystem s ON s.id = t.subsystem_id
      WHERE t.project_id = $1 ORDER BY t.tag_no`, [projectId]);
  for (const t of tags.filter((x) => chainFor(x.kind))) {
    const st = await tagStatus(db, { projectId, tagId: t.id, loader });
    add({ kind: t.kind, id: t.id, item: t.tag_no, subsystem: t.subsystem, steps: st.steps,
      // The machine itself is the material of its installation.
      material: (step) => (EQUIPMENT_KINDS.has(t.kind) && step.discipline === "equipment" ? tagMaterialState(t.id, arr) : { state: "na" }) });
  }

  for (const { id } of (await db.query("SELECT id FROM cable WHERE project_id = $1 ORDER BY cable_no", [projectId])).rows) {
    const st = await cableStatus(db, { projectId, cableId: id });
    add({ kind: "cable", id, item: st.cable.cable_no, steps: st.steps });
  }
  for (const { id } of (await db.query("SELECT id FROM instrument WHERE project_id = $1 ORDER BY tag_no", [projectId])).rows) {
    const st = await instrumentStatus(db, { projectId, instrumentId: id });
    add({ kind: "instrument", id, item: st.instrument.tag_no, steps: st.steps });
  }
  for (const { id } of (await db.query("SELECT id FROM coating_item WHERE project_id = $1", [projectId])).rows) {
    const st = await coatingStatus(db, { projectId, itemId: id });
    add({ kind: "coating", id, item: st.item?.label || st.item?.spool_no || st.item?.tag_no || "آیتم رنگ", steps: st.steps });
  }

  const order = { day: 0, week: 1, month: 2, later: 3, unknown: 4, blocked: 5 };
  items.sort((a, b) => order[a.horizon] - order[b.horizon] || (a.inDays ?? 0) - (b.inDays ?? 0) || a.front.localeCompare(b.front) || a.item.localeCompare(b.item));
  return { today, items, ...summarize(items) };
}
