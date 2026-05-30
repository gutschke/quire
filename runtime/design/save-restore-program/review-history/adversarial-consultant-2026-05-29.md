# Adversarial Consultant — Independent Review (2026-05-29)

**Engagement.** External adversarial review of `auth-strategy.md`
(draft 2) + `auth-strategy-review.md` self-review. Charter: find what
the program lead missed, especially firewall-leak and token-abuse
classes adjacent to the four-prior-breach pattern (#392/#393/#395 +
the recent map-blob).

**Verdict.** Draft 2 is structurally sound on OAuth mechanics
(SEC-1..5 are correct as stated) but **the cloud save path has
two unrefuted firewall-class breaches and three unowned account-loss /
supply-chain risks**. I concur with ADV-1's appdata pivot. I disagree
with the lead's conclusion that "DM-coord save = full log on the DM's
own account = accepted per threat model" is safe on read-back; the
read-back path is unmodeled. Two findings (NEW-ADV-1, NEW-ADV-5) are
**P0 BLOCKING for M6a**. NEW-ADV-2 is the missing "5th breach" the
brief warned to expect.

---

## NEW-ADV-1 (P0, BLOCK M6a) — Restore-as-player loads the DM-coord projection unscrubbed

**Claim.** `loadFromFile` (quire-app.ts:6934) → `loadFromString` →
`applySaveToLog` (persistence.ts:888) **never consults the viewer's
coord status**. The DM-coord cloud save is the full log with `scratch-
note`, `dm-clock-*`, `caster-state-set`, `ai-prompt`, `proposal-*`,
`bond-propose`, `npc-pin`, `accidental-grant-log` (persistence.ts:457-510).
A peer who pulls that file is now holding **the raw DM events on
their device**, materializing into `state.coordinator` = whoever
holds it now.

**The threat path the lead missed.** The brief's scenario is real:
DM hands off to substitute DM (drops coord), original DM rejoins as
PLAYER, original DM clicks "Pull from my Drive" to recover their own
data → `applySaveToLog` ingests DM-only events into a NOW-NON-COORD
peer's event log. `filterForViewer` (state.ts:850) strips at RENDER
time keyed on **live** `state.coordinator`, so the screen is clean —
**but the autosave path uses `serializeSessionForViewer(events, …,
viewerPeerId, currentCoordinator)` at quire-app.ts:6790**, and the
ingester is no longer coord, so the autosave should re-strip. It
DOES (the scrub is symmetric on save). **Good.** But:

- The localStorage event log on the ex-DM's device still contains
  the raw DM-only events between pull and the first autosave flush.
  `AutosaveController` is debounced; a tab-kill in the window =
  `scratchNote: "the Quiet is speaking through Mei"` in
  `quire.save.<owner>-<repo>` localStorage. Kid/spouse/IT picks up
  the laptop, opens the JSON in TextEdit, reads it. Same accidental-
  disclosure model the firewall exists to defeat.
- WORSE: when this ex-DM is connected to live peers, `applyEvent`
  now **propagates via sync-response by default** per DEC-005. The
  DM-only events the ex-DM just pulled from cloud are about to be
  **rebroadcast to bob+carol** who never had them. The "civilized
  peer" model says players are trusted-not-malicious, but the
  firewall's job is to prevent ACCIDENTAL disclosure of DM material
  — and broadcasting `scratch-note` to all peers is exactly that.

**Regression assertion.** In `persistence.restore-drill.test.ts`,
add: build a coord log with sentinel `scratch-note`, save as coord,
load into a fresh peer that is NOT the coord, call `applyEvent` with
default propagation, assert (a) the autosave produced by the new
peer contains no sentinel, AND (b) the broadcast queue contains no
DM-only event kinds. Today: (a) likely passes (autosave re-strips);
(b) **FAILS** — propagation has no firewall pass.

**Fix.** Either (i) `applySaveToLog` accepts a `viewerCoord` arg and
**scrubs at apply time** when the viewer is not the original coord,
OR (ii) the cloud-pull UI hard-refuses a coord-projection save when
the local peer is not coord ("This is the DM's backup. You must
reclaim coord before importing it.").

**This is the 5th breach the brief told me to find.** Same class as
#392/#393/#395: render-gated, write-/restore-not-gated.

---

## NEW-ADV-2 (P1) — `applyEvent` rebroadcast crosses the firewall

**Claim.** DEC-005 made `applyEvent` propagate via sync-response by
default, and sync-response is **exempt from the R2.1 impersonation
defense** ("recipients dedup via EventLog id check"). There is no
firewall classifier on this path. Combined with NEW-ADV-1, a non-coord
peer who pulls a DM save sprays DM-only events at the gossip network.

**Even without the cloud-pull pivot:** today, an ex-coord whose
`coordinator-yield` event has landed but who still has a
`scratch-note` in their event log will rebroadcast that scratch-note
on next applyEvent (e.g. during a recovery rejoin). The brief is
correct that this is hiding somewhere.

**Regression.** `peer.restore-rebroadcast.test.ts` model: pre-load
log with `scratch-note`, flip coord to bob, alice (now non-coord)
applies a benign event with propagate=true, assert no `scratch-note`
hits bob's sync-response inbound. Today: not asserted.

**Fix.** `forwardShareToOthers` filters out
`PLAYER_SCOPE_STRIP_KINDS` AND runs `PER_KIND_SCRUBBERS` before
sending to any peer who is not the current coord. Reuses the existing
SSOT — no new firewall list.

---

## NEW-ADV-3 (P1) — Account-loss = total campaign loss; not documented

**Claim.** `drive.appdata` is hidden AND inaccessible from any other
app or via Drive's UI restore-from-trash. If the DM's Google account
is suspended (TOS violation, billing failure, death, hostile
takeover-then-reset), the appdata content is **structurally
irrecoverable** — Google's own takeout export does not include
appdata for third-party apps. The design has no answer.

**Severity.** Quire's promise is "your campaign is durable." If the
DM's Google account dies, the campaign dies. The lead's brief
framing ("DM's own backup of their own DM-side state") obscures
that this is **the only off-device backup the M6a/M6b path offers**.

**Fix.** Three options, choose ≥1:
1. **Mandatory local-disk copy on each push.** The "Download backup"
   button already exists in the operational view (per A2 draft 2);
   make it FIRE AUTOMATICALLY on every cloud push, write to the
   downloads folder.
2. **`drive.file` opt-in is documented as the recoverability path**,
   not just "manual recovery." Make this a feature, not a footnote.
3. **GitHub M6c lands sooner.** A campaign in a GitHub repo survives
   the DM's Google account. Re-rank M6c against M6b.

This belongs in `decisions.md` as DEC-010 with revisit-if note.

---

## NEW-ADV-4 (P2) — "Cleartext on Drive acceptable" is not validated against DM-only event payload contents

**Claim.** The locked clause in A6 says "the DM is on the trusted side
of the firewall; Google the company is not in the threat model."
This is the right answer for `scratch-note`. It is **not obviously
the right answer for**:
- `ai-prompt` / `ai-response` payloads, which include the DM's prompts
  AND AI completions (NPC-killer-secrets, plot twists, generated prose
  for future scenes).
- `npc-pin` payloads, which can carry real-world player identifiers
  if the DM tracks "PC alice = real-name Sarah."
- `bond-ratify.dmNotes` and `pc-create.dmNotes` (free-form DM text).
- Saved `chargen-pack-deliver` payloads, which per the chargen-
  authorship division contain player-authored prose the player gave
  to the DM under an implicit "DM eyes only" expectation.

**Threat.** Google Drive AS A COMPANY is not adversarial. Google
Drive being **subpoenaed or breached** is. The civilized-peer threat
model deliberately excludes Google-as-adversary; the lead inherited
that. But the brief asks: is "Google can read it" *actually*
acceptable for the DM-coord projection? My read: **the user should
make this choice with the facts in front of them**, not have it
locked in by the engineer's threat-model interpretation.

**Fix.** `auth-strategy.md` adds a "What's in the file Google holds"
section listing the kinds + DM-typed fields above. Push UI shows
a one-time "what's saved" disclosure on first push. Defer client-
side encryption (out of scope for M6 per non-goals) but call it out
as the natural M7+ direction if a user pushes back.

---

## NEW-ADV-5 (P0, BLOCK M6a) — Canonical client_id supply-chain integrity

**Claim.** ARC-3 / OP-013 treats the shipped `client_id` as a
deployment-config artifact ("self-hosters override"). It is **also
a security primitive**. An attacker who compromises Quire's
Cloudflare Pages deploy OR npm package OR Underleaf-hosted bundle
swaps the canonical `client_id` for theirs — the user's OAuth
consent flow renders against the ATTACKER's Google OAuth app
("WeirdApp wants Drive access"), but UX-1's planned microcopy
("You'll authenticate with Google") gives the user no signal to
reject. Once granted, the attacker's app has `drive.appdata` on
the user's account — and **reads from the user's appdata too**,
because Drive's per-app isolation is keyed on which app CREATED
the file. If the attacker's `client_id` is registered with the
same canonical app project, they read all prior Quire saves.

**Mitigations the design omits.**
- Subresource Integrity (SRI) on the deployed bundle.
- A documented `client_id` value in the README so a paranoid user can
  diff what their browser actually sent.
- Cloudflare Pages deploy-key + branch-protection requirements.
- The OAuth consent screen text needs to be a known fingerprint
  ("Quire by Markus Gutschke wants…") — if it ever changes, the
  user's vigilance is the only line.

**Fix.** OP-013 gets a **security-axis** sub-task: document SRI,
publish the canonical client_id + verified-OAuth-app screenshot in
the README so users have a reference to compare against.

---

## NEW-ADV-6 (P1) — Passphrase-derived key is theater under offline attack

**Claim.** M6b's PBKDF2-HMAC-SHA256 + 100k iter against a typical
DM-chosen passphrase (~40 bits Shannon entropy) is **NOT** a strong
defense against an attacker who has stolen IndexedDB. 2^40 / 100k iter
on commodity GPU ≈ days, on rented compute ≈ hours. The lead's UX-3
move ("passphrase-protected refresh token") sounds like security; it
delivers obfuscation.

**The actual security property of M6b** is: a CO-LOCATED snooper
(spouse, kid, screen-share viewer) who has device access but not
the passphrase is delayed. That's worth shipping. **But don't
overclaim it in user-facing copy**, and don't let it create a
false sense that refresh tokens are "safe at rest."

**Fix.**
- Microcopy: "Quire encrypts your sign-in so a passer-by can't use
  it from your device." NOT "Your sign-in is securely encrypted."
- Set passphrase-strength minimum (length 12+, reject top-10k common).
- Document the limit in `auth-strategy.md` token-threat-model table.
- Consider scrypt-via-WASM (N=2^17, r=8, p=1) as the real choice
  even though it's heavy; M6b is opt-in so the cost is acceptable.

---

## NEW-ADV-7 (P2) — Conflict-resolution quota-exhaustion DoS

**Claim.** A7's pull-rebase-push with `If-Match revision_id` plus
DEC-005's auto-broadcast-on-applyEvent is a viable
**self-amplification loop** under co-DM compromise: attacker's
account rapidly pushes empty deltas, legit DM's `If-Match`
constantly fails, legit DM's client auto-retries (per A7's "force
a pull-and-merge first"), Drive API per-user rate limit hits
(1k req/100s default), legit DM is locked out of their own save.

Per ADV-2's note ("revision_id is not a security token"), this is
**outside the civilized-peer model** so it might be defensible. But
the lead's brief explicitly asked me to probe it.

**Fix.** Exponential backoff with jitter on `If-Match` failures.
Hard cap retries at 3, then surface "Your Drive sync is busy —
last successful push N min ago" and stop. Manual button to retry.

---

## NEW-ADV-8 (P1) — OAuth callback page is an XSS sink

**Claim.** SEC-2 documents the same-origin postMessage protocol but
treats the callback page as "TINY static." The brief is right: it's
the most security-critical static page in the entire deploy. If it
reflects URL parameters into the postMessage payload without
validation, an attacker who can get the user to load
`/auth/google/callback?code=<EVIL_JS_SOMEHOW>&state=…` can XSS into
opener context. Even without XSS, a callback that postMessages
`{ raw_url: window.location.href }` to opener leaks the auth code
into anything listening on `window.message` — every browser
extension, every iframe.

**Fix.** Callback page MUST:
1. Use a strict CSP (`default-src 'none'; script-src 'self'`); no
   inline scripts.
2. Parse `URLSearchParams` and postMessage ONLY `{ code, state }` —
   never the raw URL.
3. Validate `state` matches **at the callback** as a sanity check
   (the opener re-validates; defense in depth).
4. Be audited as a separate artifact in CI — diff against a golden
   file, fail the build on any change without explicit sign-off.

Lock this in `auth-strategy.md` A1 step 7 and **ship the CSP
header check** as a deploy-time test.

---

## NEW-ADV-9 (P2) — CORS-proxy worker is unowned trust

**Claim.** SEC-3's fallback ("tiny Cloudflare Worker as token-exchange
proxy") transfers the entire OAuth flow's confidentiality to the
worker operator. The auth code passes through; the worker COULD
exchange it for an access_token and silently keep a copy.

The lead's design treats this as a contingency without specifying:
- Who runs it? (presumably "the maintainer")
- Is its source published in the same repo as Quire?
- Reproducible build / hash-pinned deploy?
- Is the worker's URL canonical or per-deploy?

**Fix.** If CORS probe (OP-016) fails and we ship the worker:
1. Source lives in `runtime/cloudflare-worker/` in the same repo.
2. README documents the deployed hash; a self-hoster can re-deploy
   their own worker and override.
3. Worker is stateless — explicit no-logging policy, asserted by a
   deploy-time test.

---

## NEW-ADV-10 (P3) — Recently-played list leaks metadata

**Claim.** `recently-played.ts:151` renders `owner/repo` + last-played
date on the landing. A co-located observer (over-shoulder, screen-
share) learns the DM's campaign schedule. Trivial in a civilized-
peer model; documented for completeness per the brief.

**Fix.** None required for M5. Note as low-impact in
`open-problems.md` if any external review pass cares.

---

## Agreements with the program lead's self-review

- ADV-1 (default `drive.appdata`) — concur, strongest single fix.
- SEC-1/5 (PKCE redirect binding, crypto.getRandomValues) — correct.
- SEC-2 (postMessage targetOrigin + state validation) — correct as
  far as it goes; NEW-ADV-8 extends it.
- UX-3 (re-auth-every-session unacceptable) — concur on the UX read;
  NEW-ADV-6 challenges the security framing of the fix.
- ARC-1 (same save format Drive + GitHub) — concur, simpler.

## Disagreements

- A6 LOCKED clause "cleartext on cloud acceptable" — too strong.
  Validate per NEW-ADV-4 before locking.
- DEC-008 layering — concur on layers, but M6b's "passphrase-protected
  refresh_token" deserves a tempered security claim (NEW-ADV-6).
- The lead's review treats "DM-coord save → DM-coord restore" as the
  only path. NEW-ADV-1 shows the cross-role restore path is real and
  unguarded.

## Hand-offs

- **Engineering reviewer:** NEW-ADV-1 + NEW-ADV-2 need a
  `persistence.restore-firewall.test.ts` analogous to firewall-fuzz.
  Specifically the apply-side and the rebroadcast-side.
- **TTRPG/UX:** NEW-ADV-6's microcopy ("Quire encrypts your sign-in so
  a passer-by can't use it") and NEW-ADV-4's "what's saved" disclosure
  are UX-craft work.
- **Architect:** NEW-ADV-3 account-loss is an
  architecture-of-durability question; M6c sequencing decision.

## Final recommendation

**BLOCK M6a ship until:**
1. NEW-ADV-1: apply-time firewall on `applySaveToLog` OR hard-refuse
   coord-projection saves on non-coord pull. Ship the regression
   test first; the fix is small.
2. NEW-ADV-5: SRI on the bundle + canonical client_id publication.
3. NEW-ADV-8: callback-page CSP + golden-diff CI check.

**Ship M6a with documented caveats for:** NEW-ADV-4 (cleartext
disclosure), NEW-ADV-6 (passphrase-key strength), NEW-ADV-7 (DoS
backoff is mitigation, not defense).

**Re-route to architect:** NEW-ADV-3 (account-loss) belongs in the
M6c GitHub-as-durability prioritization discussion before M6b ships.

The four prior firewall breaches were all the same class
(render-gated, write-not-gated). The brief told me to expect the
5th. **NEW-ADV-1 is it**, dressed in OAuth clothes: the cloud-pull
path is the new write surface, and the firewall doesn't follow the
event log across the read-back boundary.
