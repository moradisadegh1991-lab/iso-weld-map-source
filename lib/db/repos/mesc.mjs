/**
 * MESC catalogue and the MESC number of each stock item.
 * Rules: lib/warehouse/mesc.mjs. Call inside `withProject`.
 */
import { normalizeMesc, formatMesc, mescPrefixes, parseCatalogue, mescState, searchCatalogue, MESC_LEVELS } from "../../warehouse/mesc.mjs";

/**
 * Load (or add to) the project's copy of the owner's catalogue. A file with
 * unreadable lines is refused whole, with every line named: half a
 * catalogue would verify some codes and call the rest unknown.
 */
export async function importCatalogue(db, { projectId, text, edition, userId = null }) {
  if (!String(edition || "").trim()) throw bad("ویرایش کاتالوگ MESC را بنویسید (مثلاً «NIOC MESC 1402»).");
  const { groups, items, problems } = parseCatalogue(text);
  if (problems.length) throw bad(problems.slice(0, 10).join(" · ") + (problems.length > 10 ? ` · و ${problems.length - 10} مورد دیگر` : ""));
  if (!groups.length && !items.length) throw bad("فایل هیچ کد MESC ندارد.");
  for (const g of groups) {
    await db.query(`INSERT INTO mesc_group (project_id, prefix, title) VALUES ($1,$2,$3)
      ON CONFLICT (project_id, prefix) DO UPDATE SET title = EXCLUDED.title`, [projectId, g.prefix, g.title]);
  }
  for (const it of items) {
    await db.query(`INSERT INTO mesc_entry (project_id, code, description, uom) VALUES ($1,$2,$3,$4)
      ON CONFLICT (project_id, code) DO UPDATE SET description = EXCLUDED.description, uom = EXCLUDED.uom`,
      [projectId, it.code, it.description, it.uom]);
  }
  await db.query("UPDATE project SET mesc_edition = $2 WHERE id = $1", [projectId, edition.trim()]);
  await db.query("INSERT INTO mesc_import (project_id, edition, groups, entries, by_user) VALUES ($1,$2,$3,$4,$5)",
    [projectId, edition.trim(), groups.length, items.length, userId]);
  return { groups: groups.length, entries: items.length };
}

/** Set or clear a stock item's MESC number. A number not in a loaded catalogue, or in another unit, is refused. */
export async function setItemMesc(db, { projectId, itemId, mescCode }) {
  const { rows: [item] } = await db.query("SELECT id, code, uom FROM material_item WHERE id = $1 AND project_id = $2", [itemId, projectId]);
  if (!item) throw notFound("item");
  if (mescCode === null || mescCode === undefined || String(mescCode).trim() === "") {
    await db.query("UPDATE material_item SET mesc_code = NULL WHERE id = $1", [itemId]);
    return { ...item, mesc_code: null };
  }
  const code = normalizeMesc(mescCode);
  if (!code) throw bad(`«${mescCode}» کد MESC نیست — ده رقم: گروه اصلی ۲، زیرگروه ۲، زیرگروه فرعی ۲، کالا ۳، رقم آخر ۱.`);
  const { loaded, entry } = await lookup(db, projectId, code);
  const st = mescState({ code, uom: item.uom }, { catalogueLoaded: loaded, entry });
  if (st.code === "unknown" || st.code === "uom") throw bad(`${formatMesc(code)}: ${st.text}`);
  const { rows: [dup] } = await db.query(
    "SELECT code FROM material_item WHERE project_id = $1 AND mesc_code = $2 AND id <> $3", [projectId, code, itemId]);
  if (dup) throw Object.assign(bad(`کد ${formatMesc(code)} قبلاً به کالای ${dup.code} داده شده — یک کد MESC یعنی یک کالا.`), { code: "MESC_DUPLICATE" });
  const { rows: [r] } = await db.query("UPDATE material_item SET mesc_code = $2 WHERE id = $1 RETURNING *", [itemId, code]);
  return { ...r, state: st };
}

/** Every stock item with its MESC number, state and group titles; the catalogue's size and edition. */
export async function mescBoard(db, { projectId }) {
  const { rows: [p] } = await db.query("SELECT mesc_edition FROM project WHERE id = $1", [projectId]);
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM mesc_entry WHERE project_id = $1", [projectId]);
  const { rows: items } = await db.query(
    `SELECT i.id, i.code, i.description, i.category, i.uom, i.mesc_code, e.description AS mesc_description, e.uom AS mesc_uom,
            (e.code IS NOT NULL) AS in_catalogue
       FROM material_item i LEFT JOIN mesc_entry e ON e.project_id = i.project_id AND e.code = i.mesc_code
      WHERE i.project_id = $1 ORDER BY i.code`, [projectId]);
  const { rows: groups } = await db.query("SELECT prefix, title FROM mesc_group WHERE project_id = $1", [projectId]);
  const title = Object.fromEntries(groups.map((g) => [g.prefix, g.title]));
  const { rows: imports } = await db.query(
    `SELECT m.edition, m.groups, m.entries, m.at, u.display_name AS by_name FROM mesc_import m LEFT JOIN app_user u ON u.id = m.by_user
      WHERE m.project_id = $1 ORDER BY m.at DESC LIMIT 5`, [projectId]);
  return {
    edition: p.mesc_edition, entries: n, imports,
    items: items.map((i) => {
      const pre = mescPrefixes(i.mesc_code);
      return {
        ...i, formatted: formatMesc(i.mesc_code),
        state: mescState({ code: i.mesc_code, uom: i.uom }, { catalogueLoaded: n > 0, entry: i.in_catalogue ? { uom: i.mesc_uom } : null }),
        path: pre ? MESC_LEVELS.map((l) => ({ level: l.title, prefix: pre[l.key], title: title[pre[l.key]] || null })) : null,
      };
    }),
  };
}

/** Catalogue entries matching a code prefix or description words — for a person to pick from. */
export async function searchMesc(db, { projectId, q }) {
  const digits = String(q || "").replace(/[\s.\-/]/g, "");
  const { rows } = /^\d{2,10}$/.test(digits)
    ? await db.query("SELECT code, description, uom FROM mesc_entry WHERE project_id = $1 AND code LIKE $2 ORDER BY code LIMIT 20", [projectId, `${digits}%`])
    : await db.query("SELECT code, description, uom FROM mesc_entry WHERE project_id = $1", [projectId]);
  const { rows: used } = await db.query("SELECT mesc_code, code FROM material_item WHERE project_id = $1 AND mesc_code IS NOT NULL", [projectId]);
  const usedBy = Object.fromEntries(used.map((u) => [u.mesc_code, u.code]));
  return searchCatalogue(rows, q).map((e) => ({ ...e, formatted: formatMesc(e.code), usedBy: usedBy[e.code] || null }));
}

async function lookup(db, projectId, code) {
  const { rows: [{ n }] } = await db.query("SELECT count(*)::int AS n FROM mesc_entry WHERE project_id = $1", [projectId]);
  const { rows: [entry] } = await db.query("SELECT * FROM mesc_entry WHERE project_id = $1 AND code = $2", [projectId, code]);
  return { loaded: n > 0, entry: entry || null };
}

const bad = (m) => Object.assign(new Error(m), { status: 400, code: "INVALID_INPUT" });
const notFound = (what) => Object.assign(new Error(`${what} not found`), { status: 404 });
