/**
 * A tag's progress through its precedence chain.
 *
 * The chain itself is in lib/platform/precedence.mjs; this only reads and
 * writes what was recorded, then hands both to the engine. Nothing here
 * decides what precedes what.
 *
 * Call inside `withProject`.
 */
import {
  chainFor, walk, nextActions, whyNotReady, progress, DONE, IN_PROGRESS,
} from "../../platform/precedence.mjs";
import { deriveFoundationSteps } from "./civil.mjs";
import { deriveStructureSteps, NA } from "./structural.mjs";
import { deriveTagElectrical } from "./electrical.mjs";
import { deriveTagInstrument } from "./instrumentation.mjs";
import { deriveCoatingFor } from "./coating.mjs";
import { createLoader } from "../loader.mjs";

/**
 * Record that a step happened.
 *
 * `done` requires a date — the database enforces it too, because a progress
 * curve cannot be drawn from undated completions and this is the write path
 * a future script would bypass.
 */
export async function recordActivity(db, {
  projectId, tagId, code, status = DONE, doneAt = null, note = null,
  refNo = null, userId = null,
}) {
  if (status === DONE && !doneAt) throw bad("یک فعالیت تمام‌شده باید تاریخ داشته باشد.");

  // A step the data answers is not ticked by hand. Some steps are ALWAYS
  // answered (a pour, its curing, its strength; a column survey, a bolting
  // record); others are answered only
  // once their source exists — piping once lines are tagged to the machine,
  // the foundation once civil has a foundation that carries it — and stay
  // manual until then, so a project not using civil can still record it.
  // Fireproofing is refused too once the spec says it does not apply.
  const { rows: [tag] } = await db.query(
    "SELECT kind FROM tag WHERE id = $1 AND project_id = $2", [tagId, projectId]);
  if (!tag) throw notFound("tag");
  const step = (chainFor(tag.kind) || []).find((s) => s.code === code);
  if (step?.derive) {
    // `undefined` is the only "no source" answer. A pour, a survey, a
    // bolting record answer with null ("not started") before anything is
    // recorded, so they are refused from the first day.
    if ((await deriveOne(db, step.derive, { projectId, tagId, loader: createLoader(db, projectId) }, {})).value !== undefined) {
      throw bad(`مرحلهٔ «${step.title}» از داده خوانده می‌شود و دستی ثبت نمی‌شود.`);
    }
  }

  const { rows } = await db.query(
    `INSERT INTO tag_activity (project_id, tag_id, code, status, done_at, note, ref_no, recorded_by)
     VALUES ($1,$2,$3,$4::activity_status,$5,$6,$7,$8)
     ON CONFLICT (project_id, tag_id, code) DO UPDATE
        SET status = EXCLUDED.status, done_at = EXCLUDED.done_at,
            note = COALESCE(EXCLUDED.note, tag_activity.note),
            ref_no = COALESCE(EXCLUDED.ref_no, tag_activity.ref_no),
            recorded_by = EXCLUDED.recorded_by, recorded_at = now()
     RETURNING *`,
    [projectId, tagId, code, status, doneAt, note, refNo, userId]);
  return rows[0];
}

/**
 * Everything known about one tag's progress.
 *
 * The piping step is NOT read from `tag_activity`. It is derived from the
 * weld register on the lines tagged to this equipment, because that data
 * already exists and asking someone to tick a box the system can answer is
 * exactly the manual entry this platform is meant to remove. A step whose
 * `derive` the engine declares is computed here; everything else is recorded.
 */
export async function tagStatus(db, { projectId, tagId, loader = null }) {
  if (!loader?.internal && process.env.TAGSTATUS_CROSSCHECK === "1") return crossCheck(db, { projectId, tagId });
  const L = loader || createLoader(db, projectId);
  // One computation per tag per loader: a foundation under three pumps is
  // judged once, not four times.
  if (!L.status.has(tagId)) L.status.set(tagId, computeStatus(db, { projectId, tagId, L }));
  return L.status.get(tagId);
}

/**
 * Test aid: the same tag through a loader primed with every tag of the
 * project and through single queries, which must agree exactly. A primed
 * lookup that mixes one tag's rows into another's shows up here.
 */
async function crossCheck(db, { projectId, tagId }) {
  const L0 = Object.assign(createLoader(db, projectId), { internal: true });
  const plain = await computeStatus(db, { projectId, tagId, L: L0 });
  const L = Object.assign(createLoader(db, projectId), { internal: true });
  const { rows } = await db.query("SELECT id FROM tag WHERE project_id = $1", [projectId]);
  await L.prime(rows.map((r) => r.id));
  const fast = await computeStatus(db, { projectId, tagId, L });
  const a = JSON.stringify(plain), b = JSON.stringify(fast);
  if (a !== b) throw new Error(`TAGSTATUS_CROSSCHECK: primed and single-query status differ for ${tagId}\n${a}\n${b}`);
  return plain;
}

async function computeStatus(db, { projectId, tagId, L }) {
  const tag = await L.tag(tagId);
  if (!tag) throw notFound("tag");

  const chain = chainFor(tag.kind);
  // A kind with no chain gets no verdict. Guessing at one would report hold
  // points that do not apply, or omit ones that do.
  if (!chain) {
    return { tag, chain: null,
      reason: `برای نوع «${tag.kind || "نامشخص"}» زنجیرهٔ پیش‌نیاز تعریف نشده است.` };
  }

  const rows = await L.activities(tagId);
  const recorded = Object.fromEntries(rows.map((r) => [r.code, r.status]));

  // Derived steps. `undefined` means the source does not exist for this tag
  // (no lines, no foundation) and the recorded value stands; anything else —
  // including null, "not started" — replaces it.
  const notes = {};
  const manual = new Set();
  const na = new Set();
  const cache = {};
  for (const s of chain.filter((x) => x.derive)) {
    const { value: v, note } = await deriveOne(db, s.derive, { projectId, tagId, loader: L }, cache);
    if (note) notes[s.code] = note;
    if (v === undefined) { manual.add(s.code); continue; }
    // Not applicable counts as done for what waits on it — nothing is
    // waiting for fireproofing on a rack that needs none — but is shown as
    // not applicable, never as an inspection that took place.
    if (v === NA) { recorded[s.code] = DONE; na.add(s.code); continue; }
    if (v) recorded[s.code] = v; else delete recorded[s.code];
  }

  const steps = walk(chain, recorded, { na }).map((s) => {
    const rec = rows.find((r) => r.code === s.code);
    return {
      ...s,
      // A fallback step with no source is recorded by hand, so it is not
      // shown as derived even though the chain allows it to be.
      derived: s.derived && !manual.has(s.code),
      na: na.has(s.code),
      note: notes[s.code] || null,
      doneAt: rec?.done_at || null, refNo: rec?.ref_no || null,
    };
  });

  return {
    tag,
    steps,
    next: nextActions(chain, recorded),
    why: whyNotReady(chain, recorded),
    progress: progress(chain, recorded, { na }),
    derivedPiping: manual.has("piping") ? null : recorded.piping ?? null,
  };
}

/**
 * Steps answered together from one source: a foundation's pour, curing and
 * strength all come from its pours; a structure's plumb, bolting and
 * fireproofing from its survey, bolting records and spec. Loaded once per
 * tag, not once per step.
 */
const GROUPS = [
  { codes: new Set(["pour", "curing", "strength"]), key: "civil", load: deriveFoundationSteps },
  { codes: new Set(["plumb", "bolting", "fireproofing"]), key: "steel", load: deriveStructureSteps },
];

/**
 * One derived step's value and note. `undefined` = no source, a manual step.
 */
async function deriveOne(db, derive, ctx, cache) {
  const g = GROUPS.find((x) => x.codes.has(derive));
  if (g) {
    cache[g.key] ||= await g.load(db, ctx);
    return { value: cache[g.key].steps[derive], note: cache[g.key].notes[derive] || null };
  }
  return { value: await DERIVERS[derive]?.(db, ctx), note: null };
}

/**
 * The equipment `foundation` step, answered by civil.
 *
 * `undefined` when no foundation carries this tag: civil is not tracking
 * it, and the step stays a manual record. Otherwise the step is done when
 * EVERY foundation under the machine has been handed over — a compressor
 * on two foundations is not ready to set because one of them is.
 */
async function deriveEquipmentFoundation(db, { projectId, tagId, loader }) {
  const rows = await loader.carriedBy(tagId);
  if (!rows.length) return undefined;
  const states = [];
  for (const { id } of rows) states.push(await tagStatus(db, { projectId, tagId: id, loader }));
  if (states.every((s) => s.why?.ready)) return DONE;
  if (states.some((s) => s.progress?.done > 0)) return IN_PROGRESS;
  return null;
}

/**
 * The piping step, answered from the weld register instead of a checkbox.
 *
 * Returns null when this tag has no lines yet — an unknown is not a "not
 * started", and reporting it as one would make a tag nobody has routed
 * piping to look like a tag whose piping is merely pending.
 */
async function derivePiping(db, { tagId, loader }) {
  if (!(await loader.lineCount(tagId))) return undefined;
  const n = await loader.pipingCounts(tagId);
  if (!n || n.items === 0) return null;
  if (n.tested === n.items) return DONE;
  if (n.installed > 0) return IN_PROGRESS;
  return null;
}

const DERIVERS = {
  piping: derivePiping, foundation: deriveEquipmentFoundation, electrical: deriveTagElectrical,
  instrument: deriveTagInstrument,
  // A structure's paint, from its coating item's sign-off.
  painting: async (db, { projectId, tagId, loader }) => (await deriveCoatingFor(db, { projectId, tagId, loader }))?.value,
};

/**
 * Every tag that is not ready, with the work that can actually start today.
 *
 * Ordered by how close it is to done, worst first: a tag at 10% needs a
 * different conversation from one at 90%.
 */
export async function blockedTags(db, { projectId, subsystemId = null }) {
  const { rows: tags } = await db.query(
    `SELECT id FROM tag
      WHERE project_id = $1 AND ($2::uuid IS NULL OR subsystem_id = $2::uuid)`,
    [projectId, subsystemId]);

  const loader = createLoader(db, projectId);
  await loader.prime(tags.map((t) => t.id));
  const out = [];
  for (const { id } of tags) {
    const s = await tagStatus(db, { projectId, tagId: id, loader });
    if (!s.chain && !s.steps) continue;              // no chain, no verdict
    if (s.why?.ready) continue;
    out.push({
      tagId: s.tag.id, tagNo: s.tag.tag_no, kind: s.tag.kind,
      pct: s.progress.pct,
      rootCauses: s.why.rootCauses,
      outOfOrder: s.steps.filter((x) => x.outOfOrder).map((x) => x.code),
    });
  }
  return out.sort((a, b) => a.pct - b.pct);
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
