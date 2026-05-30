# UX Strategy

## North star

A returning DM after 3–6 months can find their campaign and resume it
WITHOUT prior knowledge. A player joining a 2-month-old campaign sees
"continue your journey" not "import a JSON file."

## Locked principles

1. **TTRPG prime directive.** Save/restore UI is in-fiction-supportive, not
   files-and-folders. "Pick up the chronicle" beats "load the .json".
2. **Silent-player firewall.** If a player's save was evicted, they get a
   fresh-start UI with NO mention that a save once existed. Telling them
   "we lost your save" is itself a spoiler — they don't know they're
   missing anything. The DM can soft-warn them at the table.
3. **DM gets the operational view.** The DM sees the engineering reality
   ("autosave: 3 minutes ago", "browser storage at 12%") in a hidden
   advanced surface, not on the play cockpit.
4. **Engine surfaces stay neutral.** Campaign-authored copy provides the
   in-fiction framing; engine emits generic "session-resume-available"
   signals that the campaign can theme.

## Resume prompt (M5 target)

Instead of:
> "84 session events saved 3 months ago. Resume?"

Target:
> "Last seen: Chapter 3 — Underleaf, 12 weeks ago.
> Mei, Rho, and Iris were in the rain. [Continue] [Start fresh]"

Components:
- Last-revealed scene title (from `revealedScenes` LWW)
- PC names (from `pcSlots` + `synthesizedPcs`)
- Last session-digest headline (if present)

## Recently-played list (M5 target)

On the no-campaign landing, surface campaigns with localStorage evidence:

> "Pick up where you left off:
> • Underleaf — Chapter 3, last seen 12 weeks ago
> • Quirewater — Chapter 1, last seen 3 weeks ago"

~60 LOC. The "campaign" is the localStorage-key suffix; the title comes
from the campaign's `manifest.json` (we already fetch this).

## Eviction recovery (M5 target)

DM-only soft-warn at session-open when the DM's expected autosave is missing:

> "Your browser storage was cleared since the last session. Your manual
> save from 4 weeks ago is still on disk if you saved one. Otherwise, ask
> any player at the table to share their save — Quire merges them."

NO equivalent for players: silent-player firewall.

## In-fiction copy review (M8)

Spawn the TTRPG-expert sub-agent at the M8 gate with:
- The full list of save/restore-related UI strings.
- The TTRPG prime directive.
- The world doc and current campaign tone.

Have them rewrite the strings. Iterate.

## M8 UAT milestone items deferred from M6a (DEC-026, run #5)

The following M6a cloud-sync features ship logic + fallback
defenses in M6a but require real-world verification that the
program lead can't run today (no APP-enrolled test account, no
real Cloudflare emergency-rotation rehearsal):

1. **APP-enrolled-account OAuth walk-through.** Per OP-024 +
   DEC-026: the popup-failure detector (popup-close-without-
   postMessage in <2s, error `security_key_required`,
   sessionStorage empty on return) ships in M6a alongside
   the full-page-redirect fallback (OP-015).  Verify against
   a live Google account in APP enrollment that:
   - The OAuth consent screen renders the verified Quire app
     name + fingerprint (matches `consent_app_name` from the
     discovery doc).
   - WebAuthn-in-popup either completes (detector silent) or
     triggers the fallback (detector fires; full-page redirect
     succeeds).
   - The detector does NOT false-positive on a slow-but-
     successful WebAuthn ceremony (widen the 2s timeout if it
     does).
2. **Cloudflare Pages CDN cache TTL for `.well-known/`
   rotation.**  Per DEC-025: the rotation runbook claims
   ~1-5 min propagation for the discovery doc.  Run an
   actual rotation in staging, observe propagation time
   across edge nodes, and pin the empirical number in
   `maintainer-ops.md` §3b.

## Cloud-push consent dialog (M6a, OP-027) — copy review at M8

`src/auth/cloud-push-consent.ts` ships with
`DEFAULT_CONSENT_COPY` as an engineering-language
placeholder.  At M8, TTRPG-craft replaces with in-fiction-tuned
copy that:
- Names the destination explicitly ("YOUR Google Drive").
- Names the content categories ("chat, character drafts, bond
  notes").
- Reassures the DM about player visibility ("players can read
  what they wrote") AND destination opacity ("they cannot see
  this Drive folder").
- Single Acknowledge action — no nag / remember-me
  checkbox.  The acknowledgment IS the next click.
- Silent-player firewall: NO player-visible surface — the
  dialog is DM-only.

## §A10 Cloud-sync placement + first-encounter discovery (M6a, OP-017b)

**Status:** Locked 2026-05-29 run #6.  This section is the
engineering answer to NEW-UX-1 (where does the button live?) +
NEW-UX-2 (cross-device handoff discovery).  The independent UX
consultant proposed three just-in-time surfaces; this section
picks two as M6a-shipping + defers the third to a follow-up.

### Locked: NO setup wizard, NO "connect cloud" landing prompt

Surfacing cloud sync as a first-launch ceremony fails the TTRPG
prime directive (admin before play).  A returning DM after 3
months should be able to load + run their table without ever
thinking about Drive.  Cloud sync is a backup destination, not a
prerequisite for play.

The three placements below are PROGRESSIVE DISCLOSURE — the DM
encounters cloud sync exactly when it would help them, never
before.

### Placement A — End-of-session digest (PRIMARY surface)

**Where:** the existing "session digest" surface that already
fires at session-close.  Today the digest summarizes events
played; we add a single chip below the summary text.

**Trigger:** session-close (DM clicks "Wrap up" OR the
visibilitychange flush fires on tab-close-with-pending-changes).
The chip appears IF AND ONLY IF the DM has played for ≥10
minutes this session — short scratch sessions don't surface it.

**Affordance:**

```
[Chip]  Back up tonight's session to my Drive?
        ⓘ You'll sign in to Google; your players' chat and
        character notes are part of the backup. (Once per
        campaign, then we just remember.)
```

- Button copy: "Back up to my Drive" (canonical button text
  used everywhere — single phrase the DM learns once).
- Microcopy beat: silent-player-firewall preserved — players
  see nothing about this chip; it's rendered behind the
  DM-only conditional that `serializeSessionForViewer` already
  uses for the digest itself.
- Position: directly below the session-digest body, above any
  "Continue / New session" actions.  NEVER inline-modal — the
  DM should be able to ignore it without dismissal ceremony.

**Why this is the primary surface:** the moment a DM
*understands* the value of cloud backup is when they just
finished a session and are about to close the tab.  This is
also the natural in-fiction moment for the first-push consent
ceremony (OP-027 / DEC-020) — they're already in
"end-of-session reflection" mode.

### Placement B — DM operational view (DISCOVERY surface)

**Where:** the DM-only operational view (the hidden advanced
surface called out under "Locked principles" point 3).  Cloud
sync gets a section labeled "Backups".

**Trigger:** DM opens the operational view (hotkey or menu
item).  Always rendered when the surface is open — operational
view IS the files-and-folders surface for the DM who wants the
engineering reality.

**Affordance (when never connected):**

```
Backups
  Local autosave:  ✓  saved 47 seconds ago
  Manual save:        last on 2026-05-03  [Download again]
  My Drive:           not connected       [Back up to my Drive]
```

**Affordance (when connected and current):**

```
Backups
  Local autosave:  ✓  saved 47 seconds ago
  My Drive:        ✓  pushed 12 minutes ago — markus@gmail.com
                      [Push now]  [Disconnect Drive]
```

**Affordance (when connected but behind):**

```
Backups
  Local autosave:  ✓  saved 47 seconds ago
  My Drive:        ⚠  last push 3 days ago (42 events behind)
                      [Push now]  [Disconnect Drive]
```

- Account email surfaces on the second line (NEW-SEC-4 account-
  mismatch defense: the DM can see at a glance which account
  they're connected as).
- "Disconnect Drive" wires to `withdrawAcknowledgment` (the
  OP-029 forensic-recovery hook) and the OAuth token-revoke
  best-effort path (§A9.1).

### Placement B's M6a-FS variant (NEW, DEC-028 run #7)

The Backups section under M6a-FS renders the same shape with
two changes:

**Affordance (when never connected, FS-API path):**

```
Backups
  Local autosave:  ✓  saved 47 seconds ago
  My folder:          not connected       [Connect a folder]
```

**Affordance (when connected and current, FS-API path):**

```
Backups
  Local autosave:  ✓  saved 47 seconds ago
  My folder:       ✓  pushed 12 minutes ago — Google Drive/Quire/
                      [Push now]  [Pull]  [Disconnect]
```

- The second line names the FOLDER, not an account email.
  There's no Google account to surface — Quire doesn't know
  which cloud provider (if any) is watching the folder.  The
  DM is responsible for that mapping in their own head.
- "Disconnect" wires to `withdrawAcknowledgment` (same
  OP-029 hook as OAuth) and `fs-api-cloud-push.disconnectFolder`
  (drops the IndexedDB handle record).
- On Safari / Firefox / mobile (per §FS.1 verdict): render a
  placeholder "Cloud backup isn't available in this browser
  yet — OAuth Drive sync is in development for Safari, Firefox,
  and mobile."  The Connect button does not render.

The same `<backups-card>` element renders BOTH the FS-API
shape (when `cloudPush.isAvailable()` is true) and the
"unavailable" shape (when false) per the §FS.1 verdict.  Once
M6a-OAuth ships, the card grows a parallel "My Drive" line
sitting alongside "My folder" — multi-destination rendering
is the natural extension (consent ledger is already
per-destination per DEC-020).

### Placement C — Recently-played row (DEFERRED to a follow-up)

The consultant's third surface — a "cloud backup attached" badge
on the recently-played row at the no-campaign landing.  Deferred
to a follow-up because it depends on the cross-device probe
(§A11) AND requires the DM to be signed into Drive on the device
where the landing renders.  The honest UX for the cold-landing
case is the probe in §A11; the badge is value-add once the probe
is live.  Track as a follow-up under M6a-UI.

### Discovery story for the returning DM after 3 months

A DM who set up Drive backup in episode 1 and returns to a
3-month-old campaign:

1. The recently-played row renders (M5, exists today).
2. They click in → the campaign loads from localStorage.
3. The session digest from their last session is part of the
   resume prompt (M5 follow-up #429 enriches this).
4. The first new session-close triggers the §A10-A chip again,
   reminding them backup is on.  ("Backed up to your Drive — last
   on 2026-02-14")  This is the "discovery" — they SEE the
   backup chip, they know backups are still running.

A DM who never set up backup:

1. Same path 1-3.
2. Session-close fires the §A10-A chip with the "would you like
   to back up?" first-time copy.  No nag — if they ignore it,
   it surfaces again at the next session-close.

A DM who set up backup but rotated devices:

1. Same path 1-3 — local state is the same on the new device
   because they restored from a manual save or a player's save.
2. The §A11 probe (next section) handles the
   "cloud-backup-exists-on-Drive-but-local-is-empty" case.

---

## §A11 Cross-device handoff discovery (M6a, OP-017b NEW-UX-2)

**Status:** Locked 2026-05-29 run #6 per DEC-015 (NEVER
auto-load).  This section spec's the probe behavior + the
surfacing UX.

### The failure mode this closes

A DM opens Quire on a different device — tablet, work laptop,
borrowed machine — and lands on a campaign URL.  Local state is
empty.  Today: they get the "no save found" UI.  If they then
click "Push to Drive" tonight, pull-rebase-push silently
destroys last week's events (rebase against empty == nothing to
rebase).  The cloud backup they were RELYING on becomes the
mechanism by which their campaign vanishes.

### Probe trigger

The runtime probes `drive.appdata` for a file matching the
current `campaignId` on:

1. **Landing on a campaign URL with empty local state** AND
2. **Drive connection is established on THIS device** (the
   runtime has a live access_token in JS memory OR M6b
   passphrase-unlocked refresh_token).

The probe runs ONLY when both conditions are met.  In
particular: the probe does NOT trigger an OAuth flow on landing
— that would be a setup-wizard violation of the prime
directive.  If Drive isn't connected on this device, the
landing shows the existing "no local state" UI with an
additional one-line affordance:

```
Don't see your campaign?  [Check Drive for backups]
```

Click → standard OAuth flow → on success, probe runs → result
surfaces per below.

### Probe shape

One Drive REST call to list files in `drive.appdata` with a
`name = quire-<campaignId>.json` filter.  Wraps the standard
`drive-api.listAppdata` helper (§§ Piece 2 below).  Budget:
single HTTP round trip, ~200ms p50 against a warm token.  Falls
within the page-render budget.

### Probe shape — M6a-FS variant (NEW, DEC-028 run #7)

Under M6a-FS the cross-device probe is fundamentally
DIFFERENT.  There is no global Drive REST endpoint to query;
the folder handle is per-origin per-device.  So:

- IF a folder IS connected on THIS device (handle present in
  IndexedDB): the probe is `fs-api-cloud-push.listSavesInFolder({campaignId})`
  — enumerate `.quire-save.json` files in the folder.  If a
  matching file exists, surface the `[Load it] [Start fresh]`
  prompt with the file's `lastModifiedMs`.  Local cost; no
  network.
- IF NO folder is connected on this device: surface the
  existing "no local state" UI plus a one-line
  `[Connect a folder to look for backups]` affordance.
  Click → consent ceremony → folder picker → listSavesInFolder
  → surface result.

The probe does NOT cross devices.  A DM on a fresh laptop has
to re-pick their sync-watched folder before Quire can see
prior backups — but once they do, the file is sitting there
from any previous device that pushed.

If both M6a-FS and M6a-OAuth are connected for the same
campaign, M6a-FS's `listSavesInFolder` runs first (no network
round-trip).  Drive REST is fallback / cross-validation only.

The probe response is one of:

- **Found.**  File exists; `modifiedTime` and
  `headRevisionId` returned.  Continue to surfacing.
- **Not found.**  Empty list result.  Render existing "no save
  found" UI; do NOT alarm the DM (they may legitimately want
  to start fresh here).
- **Error.**  Network or 401 — fall through to the error
  matrix (§A12).  The "check Drive for backups" affordance
  remains available for manual retry.

### Surfacing UX

When the probe finds a matching file:

```
┌──────────────────────────────────────────────────┐
│ Your Drive has a backup from 12 days ago.       │
│ ─────────────────────────────────────────────── │
│ [Load it]              [Start fresh]            │
│                                                  │
│ ⓘ Loading replaces this device's empty session   │
│   with your last backup.  Starting fresh leaves  │
│   the backup alone; you can load it later from   │
│   the operational view.                          │
└──────────────────────────────────────────────────┘
```

- **Default action: Load it.**  Per DEC-015 — Load is the right
  default for the DM-with-empty-local case.  The prompt is
  presented immediately on probe completion; no nag-and-defer.
- **NEVER auto-load.**  Per DEC-015.  Surprise restore is worse
  than missing backup — a DM intending a fresh start should
  never have last week's events silently replayed.
- **Both buttons are equally weighted visually.**  The DM is
  making a real choice; "Load it" being the default does NOT
  hide the "Start fresh" path.
- **Silent-player firewall:** the prompt is DM-only.  Players
  joining via WebRTC see the campaign as fresh until the DM's
  choice resolves.

### Anti-pattern: the "we found a backup we can't tell you
about" non-prompt

NEVER surface "we may have a backup here" without resolving
the probe.  Either we found one and offer Load/Start, or we
didn't and we show no prompt.  Ambiguous "maybe there's a
backup" copy is worse than silence.

---

## §A12 Error UX matrix (M6a, OP-017b NEW-UX-3)

**Status:** Locked 2026-05-29 run #6.  Shape + behavior
locked; final copy deferred to M8 (TTRPG-craft owns in-fiction
wording).

Five failure modes the design listed without UX, each with:
error code → detection signal → user-facing copy (placeholder)
→ recovery action.  The runtime hands these to a
`reportOAuthFailure(code)` UI seam; the seam renders the
copy + action.  All copy below is engineering-language
placeholder — the M8 pass replaces with in-fiction-tuned
wording.

| # | Error code | Detection signal | Copy spec (placeholder) | Recovery action |
|---|---|---|---|---|
| 1 | `popup-blocked` | `window.open` returned null, OR no postMessage within 3s of opening, OR popup `closed` flag true within 1s | "Your browser blocked the Drive sign-in popup.  [Try again in this tab]" | Click → full-page redirect using same PKCE flow (§A1.5).  State preserved via per-flow UUID `sessionStorage` key.  On return, the page loads, detects `?code=...&state=...` in URL, redeems with preserved verifier. |
| 2 | `user-denied` | OAuth error `access_denied` (or `consent_required` with no user action) returned in callback | "You didn't grant access.  Quire saves your session locally for now.  [Try again]" | Click → restart OAuth flow.  NO shame language — denial is a valid choice.  The "Back up to my Drive" chip stays in its un-connected state. |
| 3 | `network-failure` | `fetch` rejects, OR HTTP 5xx, OR DNS failure, OR offline event during flow | "Couldn't reach Google.  Your session is safe locally.  [Retry]" | Click → restart OAuth flow OR retry the failed request (Drive REST call).  The wording acknowledges local safety first — the DM should not panic that they lost data. |
| 4 | `account-mismatch` | id_token `sub` returned by Google differs from cached `sub` (NEW-SEC-4 / OP-023) | "Backing up as: workaccount@example.com.  This is a different Google account from your last backup (markus@gmail.com).  [Use this account]  [Sign in to markus@gmail.com]" | Surfaced BEFORE any file write.  Two paths: (a) accept the new account — cache the new `sub`, start a FRESH backup file under this account's appdata (DEC-014 per-DM-appdata); (b) re-auth into the original account — runtime calls `?prompt=login&login_hint=<cached-email>` to nudge Google's account picker. |
| 5 | `app-blocked` | OAuth error `security_key_required` OR popup closes within 2s without postMessage AND APP detection signals fired (OP-024) | First auth: "Heads-up: your Google account asks for a fresh sign-in each session.  That's normal for Advanced Protection accounts."  Subsequent auth: silent re-auth as expected. | First-time: surface as INFO chip, NOT error.  The flow proceeds via full-page redirect (§A1.5 fallback).  Per DEC-026, real-world APP walkthrough deferred to M8 UAT — if the detector false-positives, surface a "Sign-in is taking longer than expected" sub-state at 4s. |

### Error-surface principles (engine-side; campaign authoring layers in-fiction copy)

1. **Local safety stated first** for codes 1-3.  The DM's
   session events are still in localStorage; cloud failure does
   NOT lose data.  Every copy beat must reassure local safety
   before suggesting recovery.
2. **Single primary action per error.**  No
   "[Try again]  [Cancel]  [Help]  [Report bug]" decision
   paralysis.  One verb the DM can click.
3. **Silent-player firewall preserved.**  Error chips render
   only on the DM's surface.  Players see no "DM had a backup
   error" notification — that would itself be a disclosure.
4. **In-progress modal vs. non-modal:**
   - During an active OAuth popup flow: errors are MODAL within
     the OAuth UI region (the chip / button that started the
     flow).  Blocks the DM's next click on that surface.
   - After auth succeeded but a later push failed (case 3
     network mid-push): errors are NON-MODAL chips in the
     operational view.  The DM continues running the session;
     they handle the chip when they want.
5. **No exception-to-string for OAuth errors.**  The runtime
   maps OAuth `error` codes to one of the five matrix entries.
   Unknown codes map to `network-failure` (the most innocuous,
   highest-recovery-probability bucket).  Per OP-030 / DEC-023
   class 1: never log raw OAuth error_description (may contain
   PII); the `redactOAuthError` helper (lands with M6a code)
   strips known PII fields before any logging path.
6. **Recovery actions reuse the same code paths.**  "[Try again]"
   for popup-blocked is the SAME orchestrator-entry call as the
   original click, just with a different `fallbackToFullPage:
   true` flag.  This keeps the matrix testable as state
   transitions over a small set of inputs.

### Mapping to engine surfaces

`oauth-orchestrator.ts` (lands in Piece 2 below) returns
typed `OrchestratorFailure` results keyed by the codes above.
The UI surface that initiated the flow (the §A10-A chip or
§A10-B operational view) maps the code to its placement-
appropriate rendering.  This separation lets the UI evolve
(M8 in-fiction copy review) without re-shaping the
orchestrator.

---

## Player Save button (M5 sub-task)

Today: Player clicks Save expecting "my character"; gets a session log.

Decision needed: **rename or repurpose?**

- Option A (rename): "Download session log" + a tooltip "for the DM's
  records, or if you need to switch devices."
- Option B (repurpose): Player Save → exports JUST the player's PC sheet,
  not the whole session log. DM's Save still exports the whole log.

Recommended default: **Option B.** A player's mental model when they hit
Save is their character sheet — the whole-session-log save is a DM concept
that doesn't have a natural player use-case.

Tradeoff: Option B requires a new "character-only" save format. Probably
just a subset of the existing format with the events filtered to
`pc-*` for the player's pcId. Add to M5.
