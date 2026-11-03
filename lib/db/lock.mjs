/**
 * Row locks for the material lifecycle (audit 2026-11-03).
 *
 * A balance (stock, what is reserved, what a PO line has received or shipped) is the sum of rows, and "is there enough?"
 * is a read followed by a write: two requests can both read the same balance and both write. A unique constraint cannot
 * say that, so the thing being spent is locked first (`SELECT … FOR UPDATE`) inside a transaction, and the balance is
 * read AFTER the lock — the second request waits, then sees the first one's rows.
 *
 * ORDER, always: an item, then its lot; PO lines in id order. Two operations that need the same rows then take them in
 * the same order, so they queue instead of deadlocking. Call these only inside `db.transaction`.
 */
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });

export async function lockItem(db, projectId, itemId) {
  const { rows: [i] } = await db.query("SELECT id FROM material_item WHERE id = $1 AND project_id = $2 FOR UPDATE", [itemId, projectId]);
  if (!i) throw notFound("item");
}

/** The PO lines, in id order. A line that is not in this project is not found. */
export async function lockPoLines(db, projectId, poLineIds) {
  for (const id of [...new Set(poLineIds.map(String))].sort()) {
    const { rows: [l] } = await db.query("SELECT id FROM po_line WHERE id = $1 AND project_id = $2 FOR UPDATE", [id, projectId]);
    if (!l) throw notFound("PO line");
  }
}
