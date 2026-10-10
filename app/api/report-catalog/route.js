export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { authenticate, errorResponse } from "../../../lib/server/session.mjs";
import { withProject } from "../../../lib/db/scope.mjs";
import { assertCan, can, ACTIONS } from "../../../lib/authz.mjs";
import * as cat from "../../../lib/db/repos/catalog.mjs";
import { logEvent } from "../../../lib/db/repos/log.mjs";
import { KIND } from "../../../lib/reports/catalog.mjs";

/**
 * The daily report's catalogue of roles, machines and materials.
 *   GET                          the list (everyone on the project reads it)
 *   POST {kind:"add"}            one item typed by a person
 *   POST {kind:"active"}         stop or resume offering an item
 *   POST {kind:"import-access"}  the old Access daily report's list (data/daily-access/catalog.json)
 * Changes are for whoever manages the project's members, and go to the section log.
 */
const BUNDLED = path.join(process.cwd(), "data", "daily-access", "catalog.json");

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.VIEW_PROJECT);
    const bundled = JSON.parse(await readFile(BUNDLED, "utf8").catch(() => "null"));
    return await withProject(db, projectId, async () => Response.json({
      items: await cat.listCatalog(db, { projectId }), kinds: KIND, may: { edit: can(membership, ACTIONS.MANAGE_MEMBERS) },
      bundled: bundled ? { source: bundled.source, items: bundled.items.length, problems: bundled.problems, duplicates: bundled.duplicates } : null,
    }));
  } catch (e) { return errorResponse(e); }
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { projectId, kind } = body;
    if (!projectId) return Response.json({ error: "projectId is required" }, { status: 400 });
    const { db, user, membership } = await authenticate(request, { projectId });
    if (!membership) return Response.json({ error: "not found" }, { status: 404 });
    assertCan(membership, ACTIONS.MANAGE_MEMBERS);
    return await withProject(db, projectId, async () => {
      let row, label, comment = null;
      if (kind === "add") {
        row = await cat.addCatalogItem(db, { projectId, kind: body.itemKind, name: body.name, nameEn: body.nameEn, discipline: body.discipline, unit: body.unit, userId: user.id });
        label = `فهرست: ${row.name}`;
      } else if (kind === "active") {
        row = await cat.setCatalogActive(db, { projectId, id: body.id, active: body.active });
        label = `فهرست: ${row.name}`; comment = row.active ? "فعال" : "غیرفعال";
      } else if (kind === "import-access") {
        const c = JSON.parse(await readFile(BUNDLED, "utf8"));
        row = await cat.importCatalog(db, { projectId, items: c.items, source: c.source, userId: user.id });
        label = "ورود فهرست از گزارش روزانهٔ Access"; comment = `${row.added} افزوده، ${row.kept} از قبل بود`;
      } else return Response.json({ error: `unknown kind: ${kind}` }, { status: 400 });
      await logEvent(db, { projectId, section: "reports", entityType: "resource_catalog", entityId: row?.id || null, label,
        action: kind === "import-access" ? "imported" : "updated", comment, userId: user.id });
      return Response.json({ ok: true, row });
    });
  } catch (e) { return errorResponse(e); }
}
