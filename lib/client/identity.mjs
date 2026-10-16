/**
 * Who the browser says it is.
 *
 * In development that is a name typed into a box; with Keycloak wired it will
 * be a token from the identity provider. Either way it is only ever a claim —
 * every route re-resolves it server-side, so nothing here is a trust
 * boundary. Kept in localStorage because retyping it on every reload is the
 * kind of friction that makes people leave the tool alone.
 */
const KEY = "isoweld.identity";

export function getIdentity() {
  try { return localStorage.getItem(KEY) || ""; } catch { return ""; }
}

export function setIdentity(value) {
  try { localStorage.setItem(KEY, value); } catch { /* private mode, not fatal */ }
}

export function authHeaders(identity = getIdentity()) {
  return { authorization: `Bearer ${identity}`, "content-type": "application/json" };
}
