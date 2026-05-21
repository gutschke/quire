# Manual-testing follow-up plan

Findings from user's second pass.  Working list, processed top-to-bottom.

## Quick wins (small fixes)

1. **Version badge in a discrete corner** — so the user can tell at a
   glance whether Cloudflare has deployed the latest build.  Without
   this, every other manual-testing finding is ambiguous about which
   commit it was tested against.  Read from `package.json` version (or
   embed git commit short SHA) at build time and render in the
   document footer / corner.

2. **Copy-invite paste safety** — "HTTPS://PLAY" in clipboard report.
   Diagnosis: user clicked Copy invite (which puts a URL in clipboard),
   then pasted into the join-code field.  The code field has
   `maxlength=12` and `.toUpperCase()` on input, so the URL got
   truncated + uppercased.  Fix: when the join field receives a paste
   that looks like a URL, extract the `?join=<code>` param and use
   only the code.

3. **Require a name before host/join** — currently both flows allow
   empty names → display is the raw peerId GUID.  Disable Host /
   Join buttons until a name is entered, with explanatory tooltip.

## Roster + character display (medium)

4. **Player + character roster panel** — DM and players should see a
   visible list of "who is in this session" with names + characters.
   Helps roleplay continuity ("wait, who plays Yui?").  Replaces the
   tooltip-only display today.

5. **Editable character name / status** — players can edit their
   display name at any time.  Status string ("Tim (sleeping)") for
   AFK markers + similar meta.  Persists for the session via a
   peer-rename event.

## Story-flow fixes (medium)

6. **Reveal undo** — DM can un-reveal a scene if revealed in error.
   Players' banner updates immediately; if a player is currently
   reading the un-revealed scene, navigate them away (back to
   campaign view).  New `scene-unreveal` event; materializer removes
   from `revealedScenes`; UI surface for the DM is "Un-reveal" button
   on already-revealed scenes.

7. **Strip DM-only frontmatter from scene rendering** — scene markdown
   files may carry frontmatter (schema version) + DM-only warning
   banners at the top.  For players: render only the player-facing
   portion.  For DM: full content.  Review which scene authors use
   which patterns in Underleaf.

## Architectural (bigger)

8. **Player departure detection** — closing the browser window
   doesn't trigger a peer-leave; peer count keeps climbing.  Need:
   - PeerJS data-channel `close` event → transport emits peer-disconnect
   - SessionController auto-appends a `peer-leave` event for the
     departing peer (anyone can author it for anyone? or only the host?)
   - Materializer marks `leftAt` so they drop from "currently in
     session" counts and the roster panel
   - Handle the page-unload case: best-effort `peer-leave` via
     `beforeunload` handler with `event.kind = 'peer-leave'`

9. **"Wedged" state investigation** — user reported a scenario where
   players couldn't join and got "placeholder screen telling them
   that campaigns must be loaded from the internet and they
   currently don't have a campaign".  Reproduce + fix.  At minimum:
   the error message must not be "no campaign loaded" when the user
   was trying to join an existing session.

10. **URL-sharing safety + pairing-code design** — needs UX consult.
    A DM shares `https://play.quire.games/?campaign=X&episode=Y` in
    a group chat.  Clicking it should be safe (read-only browse),
    not auto-drop into DM mode or auto-join a stale session.  Today
    we DO have B5 (DM-content gating in active sessions) so the
    leak is closed, but the URL design itself merits a review.
    Specifically the pairing code:
    - Current: 8-char base32, doesn't expire, regenerates per host
    - Tension: short codes are usable but guessable; long codes
      are safe but annoying.  Expiring codes break "rejoin after
      network drop or laptop death".
    - Possible compromise: short visible code + longer secret
      embedded in invite URL (link works automatically; code
      requires DM approval).  Two-tier authentication.

## Order of operations

1. Version badge (everything downstream depends on knowing the test
   version)
2. Copy-invite paste safety + require-name + GUID elimination
3. Roster panel + character name editing
4. Reveal undo + frontmatter stripping
5. Player departure detection
6. Wedged-state investigation
7. URL/code design (UX consult)

Spawn UX agent for #10 in parallel with implementation work on
#1-#5.

## Stop conditions

If any of these turn out to require architectural redesign that
takes more than 2 hours, stop and surface to the user before
committing to the path.
