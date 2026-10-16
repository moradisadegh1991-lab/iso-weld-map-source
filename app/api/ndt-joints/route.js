export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, ACTIONS } from "../../../lib/authz.mjs";
import {
  jointBoard, setRule, removeRule, upsertJoint, recordJointWeld, recordJointNdt, drawJointSample, drawJointProgressive,
} from "../../../lib/db/repos/joint-ndt.mjs";
import { SCOPES, JOINT_TYPES, METHODS, EXTENSIONS } from "../../../lib/ndt/joints.mjs";

export async function GET(request) {
  try {
    const projectId = new URL(request.url).searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    return await withProject(db, projectId, async () => {
      const { rows: tags } = await db.query(
        "SELECT id, tag_no, discipline FROM tag WHERE project_id = $1 AND discipline IN ('structural', 'equipment') ORDER BY tag_no", [projectId]);
      const { rows: supports } = await db.query(
        "SELECT s.id, s.support_no, l.line_no FROM pipe_support s LEFT JOIN line l ON l.id = s.line_id WHERE s.project_id = $1 ORDER BY s.support_no", [projectId]);
      const { rows: welders } = await db.query("SELECT id, stamp_no, name FROM welder WHERE project_id = $1 ORDER BY stamp_no", [projectId]);
      return Response.json({ ...(await jointBoard(db, { projectId })), tags, supports, welders,
        scopes: SCOPES, jointTypes: JOINT_TYPES, methods: METHODS, extensions: EXTENSIONS });
    });
  } catch (e) { return errorResponse(e); }
}

// The matrix and the register are engineering's; welding is site work; NDT and draws are QC's.
const NEED = {
  rule: "EDIT_EXTRACTION", "rule-remove": "EDIT_EXTRACTION", joint: "EDIT_EXTRACTION",
  weld: "ASSIGN_WELD", ndt: "RECORD_NDT", sample: "DRAW_NDT_SAMPLE", progressive: "DRAW_NDT_SAMPLE",
};

export async function POST(request) {
  try {
    const body = await request.json();
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    if (!NEED[kind]) return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS[NEED[kind]]);
    return await withProject(db, projectId, async () => {
      const args = { ...body, projectId, userId: user.id };
      const run = { rule: setRule, "rule-remove": removeRule, joint: upsertJoint, weld: recordJointWeld, ndt: recordJointNdt,
        sample: drawJointSample, progressive: drawJointProgressive }[kind];
      return Response.json({ result: (await run(db, args)) ?? null });
    });
  } catch (e) { return errorResponse(e); }
}
