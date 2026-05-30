# Save/Restore Maintainer Ops

**Audience:** Quire maintainer(s) and anyone who needs to rotate
cloud-sync credentials, run an incident response, or stand up a
self-hosted Quire instance.

**Status:** v1 — written 2026-05-29 alongside the OP-017g +
OP-018 ship-gate work.  Doc location anchored by DEC-024
(colocate with the save-restore program for discoverability;
promote to top-level `ops/` once a second non-save-restore
maintainer doc lands).

This doc is the OPERATIONAL runbook companion to
`auth-strategy.md` (architecture) and `decisions.md`
(why-we-chose).  It captures the bits a maintainer needs to act
on without re-deriving the architecture from first principles.

---

## 1. Threat model reminder

Per **DEC-023** the canonical threat classes are:

1. **Internet randos / external attackers.**  Zero attack
   surface goal.  Everything in this doc that touches a
   `client_id`, OAuth flow, or deploy pipeline serves this
   class.
2. **Accidental teammate disclosure.**  Defended by the
   firewall / scrubber registries.  Not the focus of this
   doc.
3. **Malicious co-players.**  Out of scope.  Don't add
   technical defenses.

The maintainer is in the **trust boundary** for the production
build — a compromise of the maintainer's deploy key is a class-1
event that affects every DM who uses the canonical hosted
Quire.  Treat the deploy story as a security primitive.

---

## 2. Production deploy boundary

| Artifact | Owner | Notes |
|---|---|---|
| `quire.pages.dev` Cloudflare Pages site | Maintainer | Production hosted Quire. |
| Build pipeline | Cloudflare CI from `main` of this repo | Reproducible via `npm test && npm run build` locally. |
| Canonical Google OAuth app | Maintainer (Google Cloud Console) | Verified-OAuth-app status.  Holds the canonical `client_id`. |
| Canonical GitHub OAuth app (M6c) | Maintainer (GitHub) | TBD at M6c registration time. |
| Build-time embedded baseline | `src/auth/canonical-client-id.ts` | Golden-diff-protected. |
| CDN-served discovery doc | `public/.well-known/quire-oauth.json` | Golden-diff-protected. |
| OAuth callback static page | `public/auth/google/callback.{html,js}` | Golden-diff-protected. |

Self-hosters have their own deploy boundary; the override
mechanisms below let them substitute their own values for the
maintainer-owned ones.

---

## 3. Canonical client_id rotation runbook

### 3a. When to rotate

- **Compromise.**  Maintainer's Google Cloud Console credentials
  leak or are suspected to be in a wider compromise.  Rotate
  immediately.
- **Abuse.**  Google rate-limits or revokes the OAuth app for
  excess traffic or policy issues.  Rotate to a fresh app.
- **Cosmetic.**  Maintainer changes the verified-app consent
  display name (e.g. Quire branding update).  The
  `consent_app_name` + `fingerprint_sha256` need to match what
  the user sees on the consent screen.

### 3b. The rotation steps

1. **Mint a new OAuth app.**  Google Cloud Console → Create OAuth
   Client ID → Web application → Add redirect URIs (canonical
   prod, staging, `http://localhost:5173`).  Submit for verified-
   app status if doing a major rotation.
2. **Compute the new fingerprint.**
   ```
   echo -n "${APP_NAME_AS_SHOWN_IN_CONSENT}|verified" | sha256sum
   ```
   Record the hex digest.
3. **Update the build-time embedded baseline.**  Edit
   `src/auth/canonical-client-id.ts`:
   - `GOOGLE.status = 'verified'` (or keep `'placeholder'` until
     the verified-app review clears).
   - `GOOGLE.clientId = '<new-id>.apps.googleusercontent.com'`.
   - `GOOGLE.consentAppNameFingerprint = '<hex>'`.
4. **Update the discovery doc.**  Edit
   `public/.well-known/quire-oauth.json`:
   - `providers.google.status = 'verified'` (or `'placeholder'`
     consistent with step 3).
   - `providers.google.client_id`, `consent_app_name`,
     `fingerprint_sha256` set to the new values.
   - Bump `issued` to today's date.
   - Update `maintainer.tag` + `maintainer.commit` (current HEAD
     short-SHA at commit time).
5. **Update the golden-diff hashes.**
   ```
   node scripts/golden-diff-canonical-client-id.test.mjs --update
   ```
   Paste both printed hashes into `GOLDEN_HASHES` in
   `scripts/golden-diff-canonical-client-id.test.mjs`.
6. **Commit + push.**  Single PR; the title should be
   `chore(auth): rotate canonical Google client_id`.  The
   description must call out the hash change explicitly so
   reviewers eyeball it.
7. **Deploy + verify.**  After Cloudflare Pages publishes:
   - `curl https://quire.pages.dev/.well-known/quire-oauth.json | jq`
     and confirm the new values are live.
   - Open Quire fresh in an incognito window, click "Push to
     Drive" (post-M6a ship), confirm the consent screen shows
     the new verified-app name + a matching fingerprint.
8. **CDN cache lag.**  Cloudflare Pages serves the discovery doc
   with default CDN caching; **emergency rotation has a TTL of
   ~1-5 minutes** before all edge nodes pick up the new doc.
   For a true emergency, deploy a runtime version bump (forces a
   bundle hash change) — DMs whose tabs are open fetch the new
   bundle (and thus the new embedded baseline) on the next page
   load.

### 3c. What NOT to do during rotation

- **Don't bypass the golden-diff.**  Manually editing
  `scripts/golden-diff-canonical-client-id.test.mjs` without
  also editing `canonical-client-id.ts` defeats the whole
  protection.  Always use `--update` mode.
- **Don't update only the discovery doc.**  Without a baseline
  update, the runtime falls back to the embedded baseline (the
  old, compromised, or rate-limited app).  The discovery doc
  alone is a HINT, not a binding override.
- **Don't deploy `'verified'` status without an actually-
  verified Google app review.**  The status string is meant to
  match Google's actual app state — flipping it preemptively
  surfaces wrong consent-screen text to users and erodes their
  ability to spot a future attack.

---

## 4. Discovery doc semantics

`public/.well-known/quire-oauth.json` is the per-deploy hint the
runtime fetches at first OAuth use.  Per **DEC-025**, hosting is
Cloudflare Pages static asset (cheapest, in our trust boundary,
acceptable CDN cache TTL).

### 4a. Status values + runtime behavior

| `status` | Runtime behavior |
|---|---|
| `placeholder` | Cloud sync is hard-stopped.  The UI hides the "Push to Drive" affordance.  No OAuth flow starts. |
| `verified` | Cloud sync is enabled.  OAuth flow starts against the embedded baseline (the discovery doc's `client_id` is a hint that v1 does NOT use unless `allowDiscoveryOverride` is `true` per-entry in the baseline). |
| `unavailable` | The maintainer has explicitly disabled cloud sync (e.g. mid-incident).  The UI surfaces "Cloud sync is temporarily unavailable. Saves to local storage continue working." |
| (any other) | Treated as `placeholder` (fail-closed). |

### 4b. Field reference

```json
{
  "version": 1,
  "issued": "YYYY-MM-DD",
  "providers": {
    "google": {
      "status": "verified" | "placeholder" | "unavailable",
      "client_id": "<id>.apps.googleusercontent.com",
      "consent_app_name": "Quire",
      "fingerprint_sha256": "<64-hex>",
      "note": "free-form maintainer-only field; not consumed by runtime"
    },
    "github": { /* same shape */ }
  },
  "maintainer": {
    "tag": "<release-tag>",
    "commit": "<short-sha>",
    "contact": "see runtime/design/save-restore-program/maintainer-ops.md"
  }
}
```

---

## 5. Self-hoster override

Self-hosters need their own `client_id` (the maintainer's
canonical app's redirect URIs don't include the self-hoster's
domain, so Google rejects auth at redirect time anyway).

### 5a. Build-time env var (primary path)

```
QUIRE_OAUTH_CLIENT_ID_GOOGLE=<self-host-id>.apps.googleusercontent.com \
  npm run build
```

The runtime reads `import.meta.env.QUIRE_OAUTH_CLIENT_ID_GOOGLE`
at the OAuth call site and passes it to `resolveClientId()`.
The env-var path takes precedence over both the embedded
baseline AND the discovery doc.

This is the **recommended** self-hoster path because:
- It produces a reproducible build with the override baked in.
- The override leaves a deploy-pipeline audit trail.
- It composes naturally with self-hoster CSP + cookies + ALL
  the other origin-bound config.

### 5b. Query parameter (emergency / debug)

```
https://your-deploy.example/?clientId.google=<id>.apps.googleusercontent.com
```

The runtime accepts a query parameter override at flow-start
time.  Use sparingly — the parameter is visible in browser
history, screenshots, server logs, etc.

### 5c. Campaign-manifest field (per-campaign)

```yaml
# In an Underleaf campaign manifest:
oauth:
  google:
    clientId: <id>.apps.googleusercontent.com
```

Useful for community-published campaigns that want to route
auth to their own Drive app (e.g. a campaign that hosts shared
NPC assets in a maintainer-controlled Drive).  Not consumed in
v1; placeholder spec for the rotation runbook.

---

## 6. Incident response cheat sheet

### "Google revoked our app"

1. Confirm in Google Cloud Console (status + revocation reason).
2. Set discovery doc `status: 'unavailable'` immediately; push +
   wait for CDN propagation (~5 min).  This surfaces the
   "Cloud sync temporarily unavailable" copy to live DMs.
3. Begin rotation runbook (§3b) with a new app.
4. Communicate via the README + project channel: "Cloud sync
   was disabled at <time> due to <reason>; expected resolution
   <ETA>."
5. After rotation: revert discovery doc to `status: 'verified'`
   with the new values.

### "Suspected client_id compromise"

1. Set discovery doc `status: 'unavailable'`.  Push.
2. Revoke the compromised app in Google Cloud Console.  This
   immediately invalidates every outstanding access token + every
   refresh token.  Users will need to re-auth after rotation.
3. Begin rotation runbook (§3b).
4. Post-mortem: file a doc-only OP entry capturing what
   happened, the timeline, and any program-wide changes (e.g.
   deploy-key rotation, branch-protection changes).

### "Cloudflare deploy compromised"

This is a class-1 worst case.  The attacker controls the
runtime bundle + the discovery doc.  Steps:

1. **Out-of-band channel.**  Post a notice via README + project
   channels: "Quire's hosted instance at quire.pages.dev is
   compromised as of <time>.  Do NOT click 'Push to Drive'
   until further notice."
2. **Revoke deploy keys.**  In Cloudflare Pages settings.
3. **Revoke OAuth app.**  Google Cloud Console.  This invalidates
   in-flight tokens; the attacker's harvested codes/tokens stop
   working.
4. **Re-pivot.**  Build a fresh deploy from a known-good commit;
   redeploy under a fresh domain if the existing one's CDN cache
   is suspect.  Run the rotation runbook.
5. **User comms.**  DMs whose accounts may have been linked to
   the attacker's OAuth app should visit
   `myaccount.google.com/permissions` and revoke any unknown
   app grants.

---

## 7. UAT-deferred limitations (per DEC-026)

The following are known to need real-world verification but are
explicitly parked until M8 UAT because the test prerequisites
(real APP-enrolled account, real DM at-table walk-through)
aren't available in the program lead's environment.

| Limitation | Where tracked | UAT step |
|---|---|---|
| APP-enrolled account WebAuthn-in-popup flow | OP-024 (status: parked-until-UAT) | Run a fresh OAuth flow on an APP-enabled Google account; verify popup-failure detector fires + full-page-redirect fallback succeeds. |
| Real Cloudflare Pages CDN cache TTL for `.well-known/` | DEC-025 + this doc | Deploy a rotation, observe propagation time in real edge nodes; update §3b CDN-cache-lag claim with the empirical number. |

---

## 8. Where to look for what

- Architecture: `auth-strategy.md`.
- Decisions: `decisions.md` (DEC-013 / DEC-017 / DEC-024 / DEC-025
  are the canonical-client-id-related entries).
- Open problems: `open-problems.md` (OP-017g + OP-018 are the
  feeder problems for this doc).
- Charter: `README.md`.
- Test plan: `test-strategy.md`.
- UX plan: `ux-strategy.md`.
- Build-time baseline: `src/auth/canonical-client-id.ts`.
- Discovery doc: `public/.well-known/quire-oauth.json`.
- Golden-diff CI: `scripts/golden-diff-canonical-client-id.test.mjs`.
- Callback golden-diff CI: `scripts/golden-diff-callback.test.mjs`.

---

## 8.5. M6a-FS — File System Access API path (NEW, DEC-028)

The **M6a-FS** path requires NO maintainer setup.  Unlike
M6a-OAuth (which is gated on the maintainer registering a
verified Google OAuth app), M6a-FS works the moment the code
is deployed:

- **No OAuth client_id to register.**  Quire never speaks to
  Google / Dropbox / OneDrive / iCloud.
- **No Cloudflare proxy / Worker.**  No network hop the
  maintainer has to host.
- **No verified-app review delay.**  The browser's
  `showDirectoryPicker` permission dialog is the consent
  surface; no third party sits in the trust chain.

Both M6a paths can be live simultaneously:

| Path | Maintainer prerequisite | End-user requirement |
|---|---|---|
| **M6a-FS** | NONE.  Just deploy. | Chromium desktop browser + desktop sync client (Drive Desktop / Dropbox / OneDrive / iCloud Drive). |
| **M6a-OAuth** | Register verified Google OAuth app + flip `GOOGLE.status` from `'placeholder'` to `'verified'` (see §3b). | Any browser that supports OAuth popups, including mobile + Safari + Firefox. |

End-user-side, the `<backups-card>` surface auto-feature-detects
and renders the right copy:

- API present + desktop → "Connect a folder" affordance.
- Safari → "Try Chrome or Edge on your desktop." copy.
- Firefox → same.
- Mobile → "not available on mobile devices" copy.

### Flipping M6a-FS live

M6a-FS goes live with any deploy that includes the run #7 code
+ the `<backups-card>` integration into the eventual operational
view.  **No external registration required.**  Same deploy
pipeline as any other Quire change.

### File-naming convention (so users can find the file by hand)

Save files in the DM's chosen folder follow this convention:

`<campaign-slug>.quire-save.json`

The slug is derived from the campaign id:

- Lowercased.
- Anything not `[a-z0-9._-]` is replaced with `-`.
- Runs of `-` collapse to a single `-`.
- Leading/trailing `-` trimmed.
- Truncated to 64 chars; falls back to `campaign` if empty.

Examples:

- `gutschke/underleaf@main` → `gutschke-underleaf-main.quire-save.json`
- `Owner/Repo@v1.0` → `owner-repo-v1.0.quire-save.json`

If a user needs to find their save file without using Quire —
e.g. for a "rescue this campaign" recovery — the file is at the
top level of whichever folder the DM picked, with this name.

### Multi-campaign layout

ONE folder, file-per-campaign.  A DM who picks `Google
Drive/Quire/` once and connects two campaigns to it ends up
with both saves in that folder:

```
Google Drive/Quire/
├── underleaf.quire-save.json
├── test-campaign.quire-save.json
```

Quire keeps a separate handle record per campaign in IndexedDB
(per-campaign accounting for "last pushed when" + conflict
detection baseline), even though the handles structurally
point to the same folder.

### Permission lifecycle (user-visible behavior)

The browser does NOT auto-grant write access on tab reload —
privacy defense by design.  Behavior the DM will observe:

1. First connect: pick a folder; permission granted for this
   session.
2. Tab closes; user reopens; Quire still has the handle but
   permission has rolled back.
3. First push of the new session: Quire surfaces a "Reconnect
   folder" prompt; click triggers the browser's permission
   dialog.
4. Grant: subsequent pushes go through silently within the
   session.

This is browser-enforced and applies on EVERY new tab.  We
cannot silently auto-push on tab open.  Documented for the
maintainer so user reports of "Quire kept asking me to
reconnect the folder" are recognized as expected behavior, not
a bug.

### Conflict-detection behavior

Before each push, Quire reads the file's current
`lastModified`.  If it's newer than what Quire last observed,
the file was modified externally — typically the desktop sync
client pulled a newer copy from cloud (another device wrote
first).

User-visible: Quire surfaces "Another device updated this
campaign's backup.  Pull first, then push."  No data is
overwritten on the conflict path.

The CRDT merge layer in `persistence.ts` handles the actual
reconciliation; this is the same machinery the M4 restore
drill exercises.

### Disconnect semantics

- **DM clicks Disconnect** → Quire forgets the folder handle
  and withdraws the consent acknowledgment.  Does NOT delete
  the file from the folder; the DM can recover it via their
  file browser.
- **User revokes permission in browser settings** → next
  Quire-side probe returns 'denied'; the UI surfaces a
  reconnect prompt.

Stronger "Disconnect → Erase" semantics (delete the save file
on disconnect) are deferred per OP-029.

### What this section does NOT cover

- Choosing a folder location that's actually inside a sync
  tool's watched tree — that's the DM's problem.  Quire
  cannot verify which tool watches which folder.
- Coordinating co-DM-shared folders — each co-DM connects
  their own folder per DEC-014.  The CRDT merge handles
  divergence at restore time.
- Mobile devices — out of scope per DEC-028; mobile DMs use
  M6a-OAuth instead (when available).

---

## 9. Standing instructions

Per the M6a program lead's standing instructions:

- **Never commit a real client_id to a test fixture, build
  artifact, or scratch file.**  Route via the override
  mechanisms in §5.
- **If you observe a credential in a staged diff (test fixture,
  build artifact, anywhere), STOP IMMEDIATELY, unstage, and
  flag in the PR.**  The `.gitignore` patterns added in
  `80893e0` are a safety net, not a substitute for review.
- **Every change to `src/auth/canonical-client-id.ts` or
  `public/.well-known/quire-oauth.json` is load-bearing.**
  The golden-diff makes the hash update mandatory; reviewers
  must call it out in PR descriptions.
