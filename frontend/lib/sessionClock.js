// The 12-hour session: every sign-in lasts SESSION_MAX_AGE_HOURS from the
// moment the password was entered - reloads, token refreshes, switching
// stores or modules never push it back. Must match the backend's
// SESSION_MAX_AGE_SECONDS (core/session_policy.py), which enforces the same
// limit on every API call; this side only signs the user out on time.
//
// The sign-in time is read from the access token's `amr` claim, which
// Supabase copies unchanged into every refreshed token - so every tab, and
// every reload, arrives at the same deadline without storing anything.

export const SESSION_MAX_AGE_HOURS = 12;
const SESSION_MAX_AGE_MS = SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;

function tokenClaims(token) {
  try {
    const part = token.split(".")[1];
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(part.length / 4) * 4, "=");
    return JSON.parse(atob(base64));
  } catch {
    return null;
  }
}

/** Epoch ms the user signed in, or null for an unreadable token. */
export function sessionStartedAt(token) {
  if (!token) return null;
  const claims = tokenClaims(token);
  if (!claims) return null;
  const stamps = (Array.isArray(claims.amr) ? claims.amr : [])
    .map((entry) => Number(entry?.timestamp))
    .filter((n) => Number.isFinite(n) && n > 0);
  // No sign-in time: the token's own issue time (the backend refuses such
  // a token anyway).
  const seconds = stamps.length ? Math.min(...stamps) : Number(claims.iat);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/** Epoch ms the session ends, or null. */
export function sessionExpiresAt(token) {
  const started = sessionStartedAt(token);
  return started === null ? null : started + SESSION_MAX_AGE_MS;
}

export function isSessionExpired(token, now = Date.now()) {
  const expiresAt = sessionExpiresAt(token);
  return expiresAt !== null && now >= expiresAt;
}
