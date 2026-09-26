/**
 * One row shape for the matcher, whichever side the register came from.
 *
 * The engine speaks in its own local frame with `at`, the database stores
 * absolute coordinates in columns. Neither is wrong; the matcher just should
 * not have to know which it is looking at.
 */

/** Absolute coordinates from the engine's origin-relative frame. */
export function absolutePosition(origin, at) {
  return {
    e: Number(origin.E) + Number(at.x),
    n: Number(origin.N) + Number(at.z),
    el: Number(origin.EL) + Number(at.y),
  };
}

export function fromEngine(model) {
  return (model.register || []).map((w) => ({
    no: w.no,
    kind: w.kind,
    loc: w.loc,
    role: w.role === "—" ? null : w.role,
    nps: Number(w.nps) || null,
    spool: w.spool,
    ndt: w.ndt,
    pos: absolutePosition(model.origin, w.at),
  }));
}

export function fromDb(rows) {
  return (rows || []).map((r) => ({
    uid: r.weld_uid,
    no: r.weld_no,
    kind: r.weld_kind,
    loc: r.shop_field,
    role: r.joint_role === "—" ? null : r.joint_role,
    nps: r.nps == null ? null : Number(r.nps),
    spool: r.spool_no,
    ndt: r.ndt_requirement,
    pos: { e: Number(r.pos_e), n: Number(r.pos_n), el: Number(r.pos_el) },
  }));
}
