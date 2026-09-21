/**
 * Weld identity.
 *
 * A `weld_uid` is a SURROGATE: minted once when a weld first appears, then
 * carried forward to later revisions by matching, never recomputed from the
 * weld's own attributes.
 *
 * That is a deliberate reversal of the original plan, which was to derive the
 * identity from the line, the joint kind and the position on the route. Every
 * derived identity fails one of the two things that actually happen between
 * revisions — a fitting inserted upstream renumbers everything after it, and
 * a corrected running dimension moves everything on the sheet — because "is
 * this the same weld" is a relationship between two registers, not a property
 * of one weld. See lib/register/match.mjs.
 */
import { randomUUID } from "node:crypto";

export const mintWeldUid = () => "W-" + randomUUID().replace(/-/g, "").slice(0, 20);

export { absolutePosition } from "../register/normalize.mjs";
