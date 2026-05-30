# UX Consultant Review — Cloud Sync Auth (M6)

**Reviewer:** Independent UX/TTRPG consultant, fresh pass.
**Date:** 2026-05-29. Scope: validate M6 against at-the-table reality.

## Verdict

**Conditional accept on M6a-design** with NEW-UX-1, NEW-UX-2, NEW-UX-3
as P1 ship-blockers (spec omissions, not architecture rewrites). Core
auth design is sound. Gaps are *placement, discovery, error recovery*
— the parts that turn a working flow into a flow a DM finds without
reading docs. The lead's UX-1..UX-4 cover token mechanics + framing
well; this pass covers what the lead's own role made hard to see.

---

## NEW-UX-1 — First-time-setup placement undefined (P1, ship-block)

`auth-strategy.md:62-94` describes the flow assuming "Push to Drive"
already exists in the DM's view. Nothing says **where the button
lives** or **when it first appears** (mandate item 2 unanswered).

A DM who finishes session 1 without finding the button has no backup;
rules.md prime directive ("DM cognitive load minimized") says the
engine owes them this.

**Fix.** Just-in-time, NOT setup-wizard. Surface at three moments,
decreasing weight:
1. End-of-session digest panel (post `session-digest`): inline chip
   *"Back up this session [Drive]"*. Piggybacks the existing
   scene-break.
2. DM-only operational view (`auth-strategy.md:128` already has
   "Download backup" — co-locate): persistent button.
3. Recently-played landing (#424): tiny *"Backed up"* / *"Not
   backed up"* status per row.

Setup-wizard fails the prime directive (admin before play).

**Regression:** fresh campaign + `session-digest` event → assert
"Back up" chip findable in digest-panel DOM.

---

## NEW-UX-2 — Cross-device auto-discovery missing (P1, ship-block)

Mandate item 4 unaddressed. DM on tablet next week: localStorage
empty, M5 recently-played (#424) per-localStorage so tablet shows
nothing. Cloud backup exists in `drive.appdata` but DM must *know*
to click "Pull from Drive."

**Failure mode:** DM sees empty "fresh campaign" landing, starts new
save over the top, *silently destroys cloud backup on next push*.
Pull-rebase-push (`auth-strategy.md:228-238`) can't help — rebase of
"empty" loses last week's events.

**Fix.** Campaign-URL landing should:
1. Show *"Connect Drive to check for backups"* inline when no local
   state — same surface as recently-played.
2. After connect, auto-probe `drive.appdata` for any file matching
   `campaignId`. If found: *"You backed this up 6 days ago on
   another device. [Load it] [Start fresh]"* — Load default.
3. NEVER auto-load — silent restore surprises a DM intending a
   fresh start.

This is "pull-on-discovery", not sync. Single-click, explicit,
discoverable.

**Regression:** fresh tab + cloud-connected + appdata has campaign X
→ landing surfaces "backup available" before any user action.

---

## NEW-UX-3 — Error UX enumerated, not designed (P1, ship-block)

`auth-strategy.md:278-289` lists token-loss scenarios for the security
reviewer but never says what the **DM sees** on each failure. Mid-
session OAuth errors with four players watching is the prime-directive
violation par excellence.

**Five modes need designed copy:**

| Failure | Fix |
|---|---|
| Popup blocked | Detect via 3s timeout. Inline: *"Your browser blocked the Drive popup. [Try again in this tab]"* — fall back to full-page redirect (PRV-1) |
| User denies consent | *"You didn't grant access. Quire saves locally for now. [Try again]"* — no shame |
| Network failure | *"Couldn't reach Google. Your session is safe locally. [Retry]"* |
| Account mismatch | At consent: *"Backing up as: markus@gmail.com. [Wrong account?]"* before file write |
| APP-blocked refresh | First auth: *"Heads-up: your Google account asks for fresh sign-in each session."* |

**Fix.** Add §A11 "Error UX matrix" to `auth-strategy.md`.

---

## NEW-UX-4 — Co-DM auth identity undesigned (P1)

Mandate item 5. `auth-strategy.md:225-242` covers concurrent-push
merge but not *identity*: which DM owns the canonical backup? Co-DMs
have different Google accounts. If only the primary connects Drive,
the secondary has no recovery if the primary disappears — the **exact
class of risk cloud-sync exists to defend against.**

**Fix, three options:**
1. Each co-DM connects their own Drive, pushes to their own
   `drive.appdata`. Pull-on-discovery (NEW-UX-2) probes whichever
   co-DM is signed in. Simple, no shared state.
2. Designated backup-DM with hand-off recorded in manifest event.
3. GitHub (M6c) is naturally shared; Drive (M6a) is per-DM.
   Different tools, different jobs.

**Recommended:** ship M6a with (1) + document the gap. Resolves
naturally in M6c.

**Regression:** two co-DM peers, different Drive accounts, both push
→ assert both files exist; neither destroys the other.

---

## NEW-UX-5 — Mid-session token expiry warning missing (P2)

Mandate item 6. ~60min TTL + 3-hour session = token WILL expire
mid-session. Design says nothing about what DM sees.

**Fix.** Two-stage:
1. Silent re-auth on push when possible (sessionStorage has
   `code_verifier`, recently-consented apps often grant instantly).
2. Inline non-blocking banner if popup needed: *"Drive backup needs a
   quick reconnect — does not interrupt play. [Reconnect when ready]"*.
   Never auto-popup mid-scene.

DM reconnects at next scene-break; engine never forces the moment.

---

## NEW-UX-6 — Fiction-supportive copy lens (P2)

Mandate item 7. Rating every user-visible string vs prime directive.

| Source | String | Rating | Alternative |
|---|---|---|---|
| auth-strategy.md:62 | "Push to Drive" | ⚠ | "Back up to my Drive" (lock UX-4) |
| auth-strategy.md:88 | Google consent string | ✗ forced | Unavoidable; surrounding copy must compensate |
| auth-strategy.md:107 | "Save to a visible Drive file instead" | ⚠ | "Keep a copy you can find in Drive yourself" |
| auth-strategy.md:188 | Device Flow code "AB12-CDEF" | ⚠ | "Open github.com/login/device on any device, type AB12-CDEF" |
| (any) | "OAuth handshake required" | ✗ | NEVER use. *"Connecting to Drive…"* |
| review.md:269 | "Type your Quire passphrase to unlock cloud sync" | ⚠ | "Unlock backups on this device" |
| (error) | "Token endpoint CORS blocked" | ✗ | "Couldn't reach Google. Try again." |
| review.md:106 | "Disconnect Drive" | ✓ | Lock |

**Fix.** Add §A12 "User-visible string catalog" to `auth-strategy.md`.
Defer final copy to M8 in-fiction review (ux-strategy.md:60).

---

## NEW-UX-7 — Passphrase recovery undefined (P1, ship-block for M6b)

Mandate item 8. `auth-strategy.md:96-105 + 296` and review UX-3
introduce passphrase-encrypted refresh_token. **Neither says what
happens when the DM forgets it.** DMs forget passphrases.

If "forgot" = "locked out of cloud sync" → catastrophic.
If "forgot" = "discard local blob, re-auth, set new passphrase" →
fine. The blob protects only local credential persistence, not the
canonical save (which is cleartext-on-Drive per
`auth-strategy.md:202-222`).

**Fix.** Lock semantics now:
- Passphrase is per-device, optional, **lossable without consequence.**
- UI: *"Forgot passphrase? [Clear stored login on this device]"* →
  wipes IndexedDB blob, triggers fresh OAuth flow (degrades to M6a).
- Document: passphrase ≠ encryption-of-save.

**Regression:** passphrase-set + "Forgot" click → assert IndexedDB
cleared + fresh OAuth prompt.

---

## NEW-UX-8 — Silent-player firewall: backup-status surface (P3)

Mandate item 9. `drive.appdata` filename hidden ✓. But the operational
view's *"Backed up N events at HH:MM"* is the kind of admin text a
player might glimpse over a DM's shoulder. "N events" is fine; "Last
backup contains <scene title>" would leak.

**Fix.** Confirm backup-status NEVER includes scene titles, NPC names,
or session-digest text. Event count + timestamp only.

**Hand-off:** Adversarial reviewer classify any backup-status event-kind
that persists to state — confirm no `revealedScenes` /
`session-digest` text leaks through.

---

## NEW-UX-9 — "No-cloud" DM path: honest, not pressured (P3)

Mandate item 10. Risk: "Connect Drive" CTA on every landing nags the
DM who declines.

**Fix.** After explicit decline, engine remembers per-campaign and
demotes CTA to operational-view icon. Re-surface only on eviction-
recovery (ux-strategy.md:50-57): *"This campaign isn't backed up. If
your browser clears storage, you'd lose progress. [Connect Drive]
[Not now]"* — honest, not pressuring.

---

## Agreements with the lead's review

- **UX-1** (popup feels like leaving Quire). Load-bearing. Lock.
- **UX-3** (layered M6a/M6b ship). Correct framing.
- **UX-4** ("Back up" not "Sync"). Lock.
- **ADV-1 → A2 revision** (`drive.appdata` default). Excellent — also
  closes most of NEW-UX-8.

## Disagreements

- **UX-2 (Device Flow as GitHub default)** correct for the table but
  fails first-time-setup: a DM alone on a laptop with no phone handy
  finds Device Flow worse than popup. Recommend Device Flow default
  WITH "Use popup instead" fallback link. Refine OQ4.
- Layered ship M6a/M6b is right but the framing implies M6b is
  *polish*. Actually M6b is the **normal** experience; M6a is
  degradation. Document the inversion or DMs will skip M6b setup.

## Hand-offs

- **Adversarial:** NEW-UX-8 backup-status classification pass.
- **TTRPG-craft:** NEW-UX-6 copy catalog → M8 in-fiction review.
- **Engineering:** NEW-UX-2 auto-probe needs perf estimate (probe
  on every landing).

## Final recommendation

**Block M6a ship on NEW-UX-1, NEW-UX-2, NEW-UX-3** — spec omissions,
≤1 doc-edit pass each.

**Block M6b ship on NEW-UX-7** — lock semantics, document, ship.

NEW-UX-4 (co-DM identity) ships as documented limitation for M6a;
resolves naturally in M6c.

NEW-UX-5/6/8/9 are P2/P3 polish — track but don't block.

The auth design is sound. The remaining work is placement,
discovery, and error recovery — the parts that turn a working flow
into one a DM finds without reading docs.
