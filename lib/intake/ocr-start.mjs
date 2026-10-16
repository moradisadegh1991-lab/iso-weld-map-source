/**
 * Queue a scanned revision for OCR (from the intake page, or on its own when
 * a reply gives a scan code 1 or 2). The queued run is recorded now; the
 * reading, and its log entry, when the engine finishes.
 */
import { withProject } from "../db/scope.mjs";
import { getStore } from "../storage/index.mjs";
import * as intake from "../db/repos/intake.mjs";
import { logEvent } from "../db/repos/log.mjs";
import { enqueue } from "./ocr-queue.mjs";

export async function startOcr(db, { projectId, revisionId, userId }) {
  const run = await intake.queueOcr(db, { projectId, revisionId, userId });
  const store = await getStore();
  enqueue(revisionId, async () => {
    const r = await intake.ocrRevision(db, { projectId, revisionId, store, userId });
    await withProject(db, projectId, () => logEvent(db, { projectId, section: "documents", entityType: "doc_intake", label: "خواندن مدرک با OCR",
      action: "recorded", comment: `${r.run.status} · ${r.items.length} ردیف${r.run.error ? ` — ${r.run.error}` : ""}`, userId }));
  });
  return run;
}
