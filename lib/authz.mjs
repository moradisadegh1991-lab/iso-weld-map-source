/**
 * Authorisation policy.
 *
 * This module answers "may this person do this", and nothing else. It holds
 * no transport, no session parsing and no identity provider: authentication
 * is a separate seam (see `resolveIdentity` below), so the rules that carry
 * professional responsibility can be read, reviewed and tested by themselves.
 *
 * The one rule that matters most: only an `engineer` approves a weld
 * register. The tool drafts; a qualified person signs. That is the whole
 * basis on which the output is allowed near a fabrication shop, and it is
 * expressed here as code rather than as a sentence in a README.
 */

export const ROLES = ["viewer", "engineer", "qc", "admin"];

/** Higher wins when a person somehow holds two. */
const RANK = { viewer: 0, qc: 1, engineer: 2, admin: 3 };

export const ACTIONS = {
  VIEW_PROJECT: "project:view",
  UPLOAD_DOCUMENT: "document:upload",
  RUN_EXTRACTION: "extraction:run",
  EDIT_EXTRACTION: "extraction:edit",
  APPROVE_REGISTER: "register:approve",
  ASSIGN_WELD: "weld:assign",
  RECORD_NDT: "ndt:record",
  MANAGE_WELDERS: "welder:manage",
  MANAGE_PIPING_CLASS: "piping-class:manage",
  DRAW_NDT_SAMPLE: "ndt:sample",
  MANAGE_MEMBERS: "project:members",
  // HSE: anybody working the site records what happened (incidents, hours,
  // observations, gas tests, permit requests); issuing a permit is a
  // signature, and the issuer is never the requester (lib/hse/hse.mjs).
  RECORD_HSE: "hse:record",
  ISSUE_PERMIT: "hse:permit",
  // Project controls: budgets, baselines, cost and the risk register.
  MANAGE_CONTROLS: "controls:manage",
  // Quality: raising and working punch items and NCRs is QC's daily work;
  // approving a concession (use-as-is, repair) is an engineering signature.
  RECORD_QUALITY: "quality:record",
  APPROVE_CONCESSION: "quality:concession",
  // Completions: test packages and their tests are QC's; accepting a test
  // is by someone other than its recorder (lib/db/repos/completions.mjs).
  // Mechanical completion is signed by engineering and accepted by a
  // second person.
  RECORD_COMPLETIONS: "completions:record",
  SIGN_MC: "completions:mc",
};

const GRANTS = {
  viewer: [ACTIONS.VIEW_PROJECT],
  qc: [ACTIONS.VIEW_PROJECT, ACTIONS.UPLOAD_DOCUMENT, ACTIONS.ASSIGN_WELD,
       ACTIONS.RECORD_NDT, ACTIONS.MANAGE_WELDERS, ACTIONS.DRAW_NDT_SAMPLE, ACTIONS.RECORD_HSE,
       ACTIONS.RECORD_QUALITY, ACTIONS.RECORD_COMPLETIONS],
  engineer: [
    ACTIONS.VIEW_PROJECT, ACTIONS.UPLOAD_DOCUMENT, ACTIONS.RUN_EXTRACTION,
    ACTIONS.EDIT_EXTRACTION, ACTIONS.APPROVE_REGISTER, ACTIONS.ASSIGN_WELD,
    ACTIONS.MANAGE_PIPING_CLASS, ACTIONS.DRAW_NDT_SAMPLE, ACTIONS.RECORD_HSE, ACTIONS.ISSUE_PERMIT,
    ACTIONS.MANAGE_CONTROLS, ACTIONS.RECORD_QUALITY, ACTIONS.APPROVE_CONCESSION,
    ACTIONS.RECORD_COMPLETIONS, ACTIONS.SIGN_MC,
  ],
  admin: Object.values(ACTIONS),
};

export function highestRole(roles = []) {
  return roles.filter((r) => r in RANK).sort((a, b) => RANK[b] - RANK[a])[0] || null;
}

/**
 * @param {{ role?: string|null }} membership  the person's standing in THIS project
 * @param {string} action                      one of ACTIONS
 */
export function can(membership, action) {
  const role = membership?.role;
  if (!role || !(role in GRANTS)) return false;
  return GRANTS[role].includes(action);
}

/** Throwing variant, for the top of a request handler. */
export function assertCan(membership, action) {
  if (!can(membership, action)) {
    const err = new Error(`forbidden: ${membership?.role || "no role"} may not ${action}`);
    err.status = 403;
    err.code = "FORBIDDEN";
    throw err;
  }
}

/**
 * Authentication seam.
 *
 * The reference architecture puts Keycloak here, issuing a JWT whose `sub`
 * becomes `app_user.subject`. That needs a running identity provider, so the
 * adapter is injected rather than hard-wired: production passes a verifier
 * that checks the token signature and claims, and tests pass one that does
 * not. Nothing downstream can tell the difference, and nothing downstream
 * decides permissions — that is this file's job alone.
 *
 * @param {{ verify: (token: string) => Promise<{sub: string, email?: string, name?: string}> }} verifier
 */
export function createIdentityResolver(verifier) {
  if (typeof verifier?.verify !== "function") {
    throw new Error("createIdentityResolver needs a verifier with a verify(token) method");
  }
  return async function resolveIdentity(token) {
    if (!token) {
      const err = new Error("unauthenticated");
      err.status = 401;
      err.code = "UNAUTHENTICATED";
      throw err;
    }
    const claims = await verifier.verify(token);
    if (!claims?.sub) {
      const err = new Error("token carries no subject");
      err.status = 401;
      err.code = "UNAUTHENTICATED";
      throw err;
    }
    return { subject: claims.sub, email: claims.email || null, displayName: claims.name || null };
  };
}
