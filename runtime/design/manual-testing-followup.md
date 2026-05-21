# Manual-testing follow-up plan

Working list, processed top-to-bottom.  Round 2 items (#1-#10) all
shipped in commit `3bf36e4`.  Round 3 items below.

## Round 2 (shipped in `3bf36e4`) — see commit message for detail

1-10: Version badge, Copy-invite paste safety, require-name, roster
panel, character/status edits, reveal undo, frontmatter stripping,
peer departure detection, wedged-state error messages, regenerate-
pairing-code button.

## Round 3 — open

### R3-A — Scene/episode routes leak DM content to URL arrivals (CRITICAL re-open of B5)

**Reproduction**: DM is hosting at
`https://play.quire.games/?campaign=X&episode=Y&scene=Z`.  DM copies
their address-bar URL into a group chat.  Player clicks → opens the
URL in an incognito window → sees the rendered scene content
immediately, before any session interaction.

The previous B5 fix gated scene routes for **non-coordinators in an
active session**.  It didn't address the **pre-session arrival**
case: when someone opens a URL with `?episode=` and `?scene=`
without having joined a session, the runtime treats them as a solo
reader and renders the scene.  That was OK for true browsing of a
public repo, but the user's threat model has shifted: arriving via
a URL someone-shared shouldn't auto-reveal content.

**Fix**:
- Block `episode` and `scene` route navigation pre-session.  Land on
  campaign view with a note: "Join the session to see scenes."
- Once in an active session: B5 gating still applies (DM sees all;
  players see reveals).
- DM solo-prep: still works because the DM clicks Host (becoming
  coordinator) and THEN navigates to scenes.

Trade-off: loses solo browsing of scenes for non-DM users.
Acceptable per the user's "never leak DM secrets" rule.  Solo
browsing of the campaign overview, world overview, and PC sheets
still works.

### R3-B — Clipboard audit (`HTTPS://PLAY` re-appears)

User reported the bug returned during round-3 testing.  Round-2 fix
added `extractJoinCode` to handle URL paste into the code input.
Need to:
1. Confirm Cloudflare has deployed `3bf36e4` (version badge tells us).
2. Audit every clipboard write in the codebase for accidental
   URL-not-code writes.
3. Audit any element-selection paths that might fall back to "select
   the URL bar contents" instead of element text.

Tasks:
- `grep` for `clipboard.writeText` — only Copy invite should hit it.
- Check if any displayed `<code>` element's selection accidentally
  captures the URL.
- Verify the build the user is testing has the new `extractJoinCode`
  path.

### R3-C — Join code should carry campaign context

**Current state**: player navigates to `play.quire.games` (no URL
params), enters a code, clicks Join.  Session connects.  But the app
has no campaign loaded → "No campaign loaded" screen with a confused
"Connected, but no campaign open" footer.

**User intent**: a join code, when accepted, should bring the player
into the full campaign experience.  The code should carry:
- which campaign (owner/repo/ref)
- where to load supporting material (= the campaign URL)
- the current shared state of the game engine (= what gossip
  already provides)

**Fix approach**: when the host appends their `peer-join` event,
include a `campaign` field with `{owner, repo, ref}`.  Guests that
receive this event learn the campaign.  The app subscribes to
`sessionView.shared.campaign` (new field) and, if it's set but no
local campaign is loaded, triggers `loadCampaign` and navigates to
the campaign view.

Plumbing:
- `SessionState` gains optional `campaign?: CampaignRef`.
- Materializer reads campaign from any peer-join's payload and sets
  state.campaign if currently unset (first-write-wins, like
  coordinator-claim).
- `SessionController.host()` accepts an optional campaign and
  embeds it in the host's peer-join.
- `QuireApp.startHosting` passes its current campaign.
- App's `subscribe` callback: when `shared.campaign` is set and
  `appState.kind === 'idle'`, kick off a navigation to that campaign.

Edge cases:
- Player joins before campaign metadata arrives: app waits in idle;
  the resume-prompt-like "Connecting..." message reassures.
- Campaign URL fails to load (404, network): error surfaces in the
  campaign-load flow, session stays connected.
- Player and host disagree on which campaign is active: the host's
  campaign wins (player's local URL is overridden).  Document this.

### R3-D — Re-investigate 6-char codes

The user asked earlier about shorter codes; I deferred.  Now they're
asking again.  Quick analysis:

- 8 chars from 31-char alphabet = 8 * log2(31) ≈ 39.6 bits
- 6 chars = 6 * log2(31) ≈ 29.7 bits = ~840M combinations

At 1 join attempt per second (the broker rate-limits guests), brute
force at 6 chars takes ~27 years on average.  Even at 100/sec, 100
days.  For a TTRPG session of 4 hours, the attacker window is
~14,400 attempts → vanishingly unlikely.  6 chars is **safe** for
this threat model.

Trade-off: 6 chars are easier to read aloud / type, but the
defensive regenerate button (round 2) makes any leak quickly
recoverable.

**Decision**: ship 6 chars.  Update `generatePairingCode(length)`
default + update the help/placeholder text accordingly.

## Order of operations (round 3)

1. **R3-A** (scene leak) — critical fix, small change
2. **R3-B** (clipboard audit) — investigation, may produce a small fix
3. **R3-C** (join carries campaign) — biggest item, ~1-2 hr
4. **R3-D** (6-char codes) — quick config change

## Stop conditions

If R3-C turns out to need a redesign of the SessionState shape
(e.g., the "campaign" belongs in a separate metadata channel, not
the event log), stop and check with user before refactoring.
