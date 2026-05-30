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
