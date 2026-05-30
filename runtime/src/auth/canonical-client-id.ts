/**
 * Canonical OAuth client_id baseline (M6a ship-gate OP-017g + OP-018).
 *
 * # What this module is
 *
 * The runtime's built-in answer to "which OAuth client_id should I
 * use to initiate the Google / GitHub flow?"  It is the SAFE
 * FALLBACK if every other discovery mechanism fails: the build-time
 * embedded baseline is always available and always trusted by the
 * runtime that shipped with it.
 *
 * # Why this is a security primitive (DEC-023 class 1)
 *
 * Per OP-017g + NEW-ADV-5: the shipped `client_id` is a security
 * primitive.  An attacker who swaps it for theirs (via compromised
 * Cloudflare deploy / npm / Underleaf bundle / discovery-doc
 * tampering) makes Quire request consent against THEIR Google
 * OAuth app — and once granted, they can read every prior Quire
 * save the DM has pushed under the legitimate client_id (Google's
 * per-app file isolation is keyed on the creating client_id).
 *
 * Defenses encoded across the program:
 *
 *   1. **Build-time embedded baseline** (this file).  The runtime
 *      trusts the baseline by default.  Changing the baseline
 *      requires a code change reviewed in a PR.
 *   2. **Golden-diff CI** (`scripts/golden-diff-canonical-client-id.test.mjs`).
 *      Any change to this file fails the build unless the golden
 *      fingerprint is updated in the same PR — making the
 *      reviewer notice intentional vs. accidental changes.
 *   3. **Runtime override** (DEC-013 / DEC-017): build-time env
 *      var (`QUIRE_OAUTH_CLIENT_ID_GOOGLE`), query parameter
 *      (`?clientId.google=...`), and campaign-manifest field
 *      (`oauth.google.clientId`) for self-hosters and emergency
 *      rotation.
 *   4. **Discovery document** (`public/.well-known/quire-oauth.json`,
 *      DEC-025): a per-deploy hint the runtime fetches at first
 *      OAuth use.  The discovery doc CAN propose a different
 *      client_id (e.g. during emergency rotation), but the runtime
 *      refuses to act on the proposal unless the embedded baseline
 *      explicitly allows discovery-override OR an operator override
 *      is present.
 *   5. **README + consent-screen fingerprint** (OP-017g.3): the
 *      maintainer publishes the canonical client_id value + a
 *      screenshot of Google's verified-OAuth-app consent screen so
 *      paranoid users can diff against what they're seeing live.
 *
 * # The current baseline is a PLACEHOLDER
 *
 * Quire's production OAuth app is not yet registered — M6a code is
 * still being designed.  Until the maintainer registers the real
 * app, the baseline carries a PLACEHOLDER and `status: 'placeholder'`,
 * which the runtime treats as a hard-stop: the cloud-sync flow
 * refuses to initiate.  Replacing the placeholder is the M6a code-
 * ship checkpoint.
 *
 * # How to rotate the canonical client_id (emergency)
 *
 * See `design/save-restore-program/maintainer-ops.md` for the full
 * runbook.  The short version:
 *
 *   1. Mint a new OAuth app in Google Cloud Console with the same
 *      verified app name + scopes.
 *   2. Update this file's `GOOGLE` constant with the new
 *      `clientId` + `consentAppNameFingerprint`.
 *   3. Update `scripts/golden-diff-canonical-client-id.test.mjs`
 *      golden hash in the same PR.
 *   4. Deploy.  Update
 *      `public/.well-known/quire-oauth.json` in the same PR so
 *      the discovery doc and the embedded baseline agree.
 *   5. Announce the rotation in the README so paranoid users can
 *      diff the new consent-screen app-name.
 *
 * # Why hand-edited per-rotation rather than env-var by default
 *
 * Two reasons:
 *
 *   - **Audit trail.**  A code change to the canonical client_id
 *     leaves a git commit with reviewers.  An env-var override
 *     applied at Cloudflare deploy time leaves no source-tree
 *     audit.
 *   - **Golden-diff coupling.**  The fingerprint CI rejects
 *     undeclared changes.  If we let an env-var override the
 *     baseline silently, the CI catches nothing.
 *
 * The env-var override (`QUIRE_OAUTH_CLIENT_ID_GOOGLE` at build
 * time) is for SELF-HOSTERS, not for routine maintainer rotation.
 */

/**
 * The shape of a single provider's canonical baseline entry.
 */
export interface CanonicalClientIdEntry {
  /**
   * Provider key — `'google'` or `'github'`.  Lowercase, used as
   * the dictionary key in the discovery doc + as the
   * cache-bucket key in runtime state.
   */
  readonly provider: 'google' | 'github';

  /**
   * `'verified'` if the embedded baseline is a real, registered
   * verified-OAuth-app `client_id`.  `'placeholder'` if it is a
   * stub that the runtime should refuse to use.  Any other value
   * is treated as `'placeholder'` (fail-closed).
   *
   * The runtime's pre-flight check is:
   *
   * ```
   * if (entry.status !== 'verified') refuse('Cloud sync is not
   *   yet available in this build of Quire.');
   * ```
   *
   * This is the M6a ship-gate self-check: replacing the
   * placeholder with `'verified'` is the moment cloud sync can
   * actually ship to end users.
   */
  readonly status: 'verified' | 'placeholder';

  /**
   * The canonical OAuth client_id string.  Public (no secret).
   *
   * For Google: `<id>.apps.googleusercontent.com`.
   * For GitHub: an opaque token (e.g. `Iv1.abcd1234`).
   */
  readonly clientId: string;

  /**
   * SHA-256 (hex, lowercase) of the consent-screen-displayed
   * app name + the verified-OAuth-app status string.  Used as
   * a stable fingerprint a paranoid user can recompute from the
   * Google consent screen they're seeing live.
   *
   * Computation (when the maintainer registers a real app):
   *
   * ```
   * fingerprint = sha256(`${appNameAsShownInConsent}|verified`)
   *             .digest('hex')
   * ```
   *
   * Placeholder builds carry all-zeros.
   */
  readonly consentAppNameFingerprint: string;

  /**
   * Whether this baseline accepts a discovery-doc override.
   * Default `false` — the runtime trusts the baseline strictly
   * and only honors operator overrides (env / query / manifest).
   *
   * Setting to `true` makes the runtime willing to use a
   * discovery-doc-proposed client_id IF the discovery doc's
   * fingerprint matches a configured allowlist (not implemented
   * in v1; placeholder switch for the rotation runbook).
   */
  readonly allowDiscoveryOverride: boolean;
}

/**
 * Google's canonical baseline (placeholder until M6a code ships).
 *
 * When the maintainer registers the production OAuth app:
 *
 *   1. Set `status: 'verified'`.
 *   2. Replace `clientId` with the real value
 *      `<id>.apps.googleusercontent.com`.
 *   3. Set `consentAppNameFingerprint` to
 *      `sha256(appNameAsShownInConsent + '|verified').digest('hex')`.
 *   4. Update the golden-diff hash in
 *      `scripts/golden-diff-canonical-client-id.test.mjs`.
 *   5. Update `public/.well-known/quire-oauth.json` in the same PR.
 *
 * The runtime's `assertReadyForOAuth(GOOGLE)` helper below treats
 * `status !== 'verified'` as a hard refusal.
 */
export const GOOGLE: CanonicalClientIdEntry = {
  provider: 'google',
  status: 'placeholder',
  clientId: 'PROBE_BOGUS_CLIENT_ID.apps.googleusercontent.com',
  consentAppNameFingerprint:
    '0000000000000000000000000000000000000000000000000000000000000000',
  allowDiscoveryOverride: false
};

/**
 * GitHub's canonical baseline (placeholder until M6c code ships).
 * See `GOOGLE` for the rotation procedure; the GitHub Device Flow
 * does not technically need an OAuth app `client_id` to start the
 * flow, but registering one gives us a verified-app surface +
 * per-app rate limits.
 */
export const GITHUB: CanonicalClientIdEntry = {
  provider: 'github',
  status: 'placeholder',
  clientId: 'PLACEHOLDER_GITHUB_CLIENT_ID',
  consentAppNameFingerprint:
    '0000000000000000000000000000000000000000000000000000000000000000',
  allowDiscoveryOverride: false
};

/**
 * The runtime calls this before initiating any OAuth popup.  If
 * the baseline is still a placeholder, we refuse — the cloud-sync
 * UI surfaces a "Cloud sync is not yet available in this build"
 * message instead of opening a broken popup against a bogus
 * client_id.
 *
 * Throws on placeholder.  Caller catches + surfaces the
 * error-UX-matrix copy (`ux-strategy.md` §A11).
 */
export function assertReadyForOAuth(
  entry: CanonicalClientIdEntry
): asserts entry is CanonicalClientIdEntry & { status: 'verified' } {
  if (entry.status !== 'verified') {
    throw new Error(
      `Quire cloud sync (${entry.provider}) is not yet available in ` +
        `this build. The canonical OAuth client_id is a placeholder; ` +
        `the maintainer must register a verified OAuth app and update ` +
        `src/auth/canonical-client-id.ts before this flow can run. ` +
        `(See design/save-restore-program/maintainer-ops.md.)`
    );
  }
}

/**
 * Convenience: is the build's baseline ready to ship cloud sync
 * for this provider?  Used by the UI to hide the "Push to Drive"
 * button on placeholder builds rather than show-and-fail.
 */
export function isReadyForOAuth(entry: CanonicalClientIdEntry): boolean {
  return entry.status === 'verified';
}

/**
 * Resolve the effective client_id for a provider, honoring the
 * override precedence:
 *
 *   1. Operator override (env var at build time).  Trumps
 *      everything else — self-host case.
 *   2. Discovery-doc proposal IF the baseline allows it AND a
 *      fingerprint check passes (not implemented in v1; the
 *      hook exists for the rotation runbook).
 *   3. Embedded baseline.
 *
 * For v1 only paths (1) and (3) are wired; (2) is a future
 * extension point.  The function is a pure value-resolver — no
 * I/O — to keep it test-friendly.
 *
 * The `envOverride` argument is read from `import.meta.env` at
 * the call site (which is Vite-aware) and passed in here.  We
 * deliberately do NOT touch `import.meta.env` from inside this
 * module so the module stays trivially importable from Node CLI
 * tests + the golden-diff script.
 */
export function resolveClientId(
  entry: CanonicalClientIdEntry,
  envOverride?: string | undefined
): {
  clientId: string;
  source: 'env-override' | 'baseline' | 'placeholder';
} {
  if (typeof envOverride === 'string' && envOverride.length > 0) {
    return { clientId: envOverride, source: 'env-override' };
  }
  if (entry.status !== 'verified') {
    return { clientId: entry.clientId, source: 'placeholder' };
  }
  return { clientId: entry.clientId, source: 'baseline' };
}
