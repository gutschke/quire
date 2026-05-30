/*
 * Quire OAuth callback page logic (M6a, OP-017).
 *
 * Loaded by /auth/google/callback.html as type="module" — runs in
 * its own ECMAScript module scope; nothing leaks to the global.
 *
 * Defenses encoded here (the HTML defenses are in callback.html
 * + public/_headers; the JS defenses are below):
 *   1. Parse `URLSearchParams` ONLY.  Never pass the raw URL
 *      to postMessage.
 *   2. postMessage payload is `{ code, state }` — both strings,
 *      both validated.  The opener decodes `state` and
 *      cross-checks the embedded flowId / intent / campaignId.
 *      We do NOT decode state here — that keeps the callback
 *      page mechanically minimal and lets the opener be the
 *      single source of truth for state validation.
 *   3. Use explicit `targetOrigin = window.location.origin` so
 *      postMessage doesn't leak the code to a cross-origin
 *      opener.  Opener side validates `event.origin`.
 *   4. Refuse to act if `window.opener` is null (no popup
 *      relationship) — the callback was loaded directly by an
 *      attacker hoping we'd postMessage to a window the
 *      attacker controls.  In that case, surface the error and
 *      stop.
 *   5. On any error, do NOT postMessage anything sensitive.
 *      Surface a status string to the user and let them close
 *      manually.
 *   6. Auto-close after a successful postMessage (500ms timer
 *      so the user sees the "Returning to Quire" text briefly).
 *
 * NOTE: this file is golden-diff'd by
 * scripts/golden-diff-callback.test.mjs.  Any change requires
 * updating both the file AND the golden hash recorded in the
 * test fixture.
 */

/**
 * Set the visible status line.  The element is required by the
 * golden-diff'd HTML; if it's somehow missing (e.g. someone
 * deployed a stripped callback.html), no-op safely.
 */
function setStatus(text) {
  const el = document.getElementById('status');
  if (el) el.textContent = text;
}

/**
 * Bounded sanity check on the auth code + state values.  Real
 * Google auth codes are <=512 chars; state nonces emitted by our
 * opener are ~200 chars per DEC-012.  Hard ceilings here reject
 * pathological payloads (a hostile redirect could try to flood
 * the postMessage channel).
 */
const MAX_CODE_LEN = 1024;
const MAX_STATE_LEN = 2048;

function isBoundedString(s, max) {
  return typeof s === 'string' && s.length > 0 && s.length <= max;
}

function main() {
  // Defense (4): require window.opener.  If we're loaded
  // directly (not from a popup), bail.
  if (!window.opener) {
    setStatus('Error: this page must be opened by Quire.');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');

  // Google can return an error param if the user denied consent
  // or the OAuth app config is broken.  Forward the error string
  // (NOT the description, which can carry email PII — OP-030) so
  // the opener can surface the matching UX matrix copy.
  if (error) {
    // Bounded sanity: a hostile redirect might pad error.
    if (!isBoundedString(error, 128)) {
      setStatus('Error: malformed response.');
      return;
    }
    try {
      window.opener.postMessage(
        { source: 'quire-oauth', error },
        window.location.origin
      );
    } catch (e) {
      setStatus('Error: could not reach Quire window.');
      return;
    }
    setStatus('Sign-in canceled.');
    setTimeout(() => window.close(), 500);
    return;
  }

  // Success path: validate code + state shapes.
  if (!isBoundedString(code, MAX_CODE_LEN)) {
    setStatus('Error: missing or oversized authorization code.');
    return;
  }
  if (!isBoundedString(state, MAX_STATE_LEN)) {
    setStatus('Error: missing or oversized state token.');
    return;
  }

  try {
    // postMessage payload is { source, code, state } — three
    // strings, no raw URL.  The opener uses `source` to filter
    // postMessages from unrelated origins / extensions, then
    // decodes `state` to extract flowId + intent + campaignId
    // and verifies the HMAC + nonce.  Defense in depth: opener
    // also verifies event.origin.
    window.opener.postMessage(
      { source: 'quire-oauth', code, state },
      window.location.origin
    );
  } catch (e) {
    setStatus('Error: could not reach Quire window.');
    return;
  }

  setStatus('Success. Closing.');
  // Brief visible delay so the user sees the success state, then
  // auto-close.  If window.close() is blocked (top-window
  // restrictions), the user can close manually — the visible
  // copy already tells them so.
  setTimeout(() => {
    try {
      window.close();
    } catch (e) {
      // No-op: user will see "Closing." and close manually.
    }
  }, 500);
}

main();
