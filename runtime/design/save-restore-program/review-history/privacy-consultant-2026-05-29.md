# Independent Privacy / Data-Flow Review — Cloud-Sync Auth (M6)

**Reviewer:** External privacy / threat-model consultant (independent of program lead).
**Subject:** `auth-strategy.md` draft 2 + `auth-strategy-review.md` (self-review).
**Scope:** Data-flow inventory, cross-tenant / cross-tab leaks, third-party
ACL semantics, telemetry, consent ceremony, re-identification, network
observers, proxy trust, forensics.
**Charter:** find what the lead missed on privacy + data-flow.

---

## Verdict

**Conditional GO for M6a** with **five P1 findings** the lead did not
enumerate. The self-review's PRV-1 (popup blockers) and PRV-2 (what
Google sees) are correct as far as they go but stop at the OAuth
handshake. They do not cover (a) the cross-tab `localStorage` leak
surface that M5 introduced, (b) the consent ceremony for player
content the DM uploads on the table's behalf, (c) re-identification
via DM `peerId` across cloud saves, (d) the Cloudflare-Worker
fallback's escalation of trust if SEC-3 forces it, or (e) forensic
non-recoverability when a DM reports a leak.

The civilized-peer threat model justifies most of these as "not
worth blocking ship" — but they need to be **named explicitly** so the
next reviewer doesn't re-discover them and so the DM-facing copy
honestly reflects what's being uploaded.

---

## NEW-PRV-3 — Cross-tab localStorage leak via M5 recently-played list (P1)

**Claim.** The auth flow correctly puts `code_verifier` / `state` /
access tokens in **sessionStorage** (per-tab) and in-memory
(`auth-strategy.md:70-93`). But the **M5 recently-played list** lives
in `localStorage` (per the brief's framing). `localStorage` is
**same-origin shared across all tabs and all browser profiles
signed into the same OS user account that share the origin**.

Two distinct humans sharing a laptop (DM + their partner who plays a
different campaign in another tab — explicitly called out in the
brief as scenario 7) **see each other's recently-played campaign
slugs and last-played timestamps in their dropdowns**. That is a
cross-tenant disclosure of campaign existence + cadence.

The Drive auth flow does **not** make this worse on its own. But it
creates an **inferential link**: an observer who later sees a Drive
file named `<campaign-slug>.json` in `drive.appdata` (visible only
to Quire-the-app via the access_token) can now correlate "the DM
of campaign X authenticated to Drive on machine Y at time T" with
"campaign X appears in the partner's recently-played list at time
T+1." On a shared browser profile, the partner becomes a passive
observer of the DM's session cadence.

**Severity:** P1 — silently violates the spoiler-firewall *spirit*
(a partner can deduce DM activity for a campaign they are NOT in).
**Not** a P0 because the data is "campaign slug + timestamp," not
content.

**Fix.**
- Document the cross-tab semantics of the M5 list explicitly in
  `auth-strategy.md` (it is currently absent — the recently-played
  list isn't even mentioned in the auth doc).
- Recommend: scope the recently-played list to **a per-Google-account
  hash** once the DM has authenticated. Pre-auth: anonymous; post-
  auth: keyed by `sha256(google_sub)`. Two distinct Google users on
  the same browser profile then get disjoint lists. Pure-local DMs
  who never auth fall back to today's behavior.
- Alternative: move the recently-played list to **IndexedDB inside an
  origin-private filesystem (OPFS)** — still same-origin but at
  least not snapshot-friendly to a casual partner with devtools.
- Regression test: add a unit test that a recently-played write keyed
  to account A is NOT visible to a `getRecentlyPlayed()` call keyed
  to account B.

**Hand-off:** save-restore lead → M5 implementer.

---

## NEW-PRV-4 — DM-uploads-players'-content has no consent ceremony (P1, GDPR-adjacent)

**Claim.** Per `auth-strategy.md:204-213`, the DM's save is the
**DM-coord projection** — the full event log, including DM-only
events. That log also contains **every player's authored content**:
chat lines, character drafts, bond notes, intent statements,
realization moments. When the DM clicks "Back up to Drive", **the
players' words go to the DM's Google Drive** — a destination none of
them consented to.

The current threat model (`project_quire_threat_model.md`) handles
the *peer* threat ("malicious teammate") and the *outsider* threat
but **does not address the DM-as-data-custodian**. The civilized-DM
default is "of course it's fine, we're friends" — which is true,
until it isn't (estranged co-DM, group dissolution, the DM's Google
account is later compromised and the cloud copy outlives the campaign).

Under **GDPR Art. 4(7) / 6(1)(a)**, if any player is in the EU and
the DM operates as the "controller" of player-authored content
(arguable — Quire's setup is closer to a household exemption, but
not airtight when content includes adult/violent fiction), explicit
informed consent is required. The DM has no UI affordance to
collect or display this consent today.

**Severity:** P1 — not because GDPR enforcement is likely against a
home-game DM (it isn't), but because Quire's spoiler-firewall ethos
("never tell a player about a thing they didn't consent to") is
**violated in spirit** by silently uploading their words.

**Fix.**
- One-time per campaign: on first push, surface a **DM-only**
  acknowledgement: "You are uploading the full table's content
  (including your players' chat, character drafts, and bond notes)
  to YOUR Google Drive. Players can read what they have written to
  this campaign; they cannot see this Drive folder. [Acknowledge]"
  — silent-player-firewall preserved (we don't notify the players,
  we educate the DM).
- Document in user-facing privacy doc (referenced by PRV-2) that the
  DM-coord projection is what gets uploaded and what that contains.
- Defer per-player opt-out to v2 — it's a real surface but the
  civilized-peer model gives us cover for v1.
- Add to `decisions.md` as a NEW DEC: "Player-authored content rides
  along with DM cloud saves; civilized-peer model accepts this; DM
  is educated via one-time push-acknowledgement."

**Hand-off:** TTRPG-craft + UX experts for the in-fiction copy.

---

## NEW-PRV-5 — peerId in event log is a stable cross-campaign re-identifier (P1)

**Claim.** Per `auth-strategy.md:202-217` and A6, the save is a full
event log. Each event carries the authoring `peerId` (a UUID
generated once per device per origin). The same DM saving **two
different campaigns** to **two different Drive accounts** (or two
GitHub repos) will embed **the same DM peerId** in both files.

Anyone with read access to both saves (e.g. the GitHub-hosted
public-repo save in M6c + a leaked Drive backup; or one DM acting as
a player in another DM's campaign whose save then ends up in a
third-party hand) can now **link the two campaigns to the same
person** without any other identifier.

For DMs running a public campaign on GitHub (the Underleaf style)
AND a private campaign on Drive, this is a **pseudonymity break**.
It is not a "Quire bug" — it is the standard CRDT-with-stable-peer-
id assumption — but it is **load-bearing for the durability +
firewall story** and **invisible to the DM**.

**Severity:** P1 — silent linkage; civilized-peer model does not
explicitly accept it.

**Fix.**
- **Document the linkage** in `auth-strategy.md` token threat model
  section (the table at lines 269-276 is the right home — add a row
  for "peerId in saved events / Persistent / In every save / Links
  the same author across all saves they touched").
- Add to the DM-only operational view: "Your participant ID for this
  campaign: 7f2a... — saves you push will identify you as the
  author. If you need a fresh identity for a new campaign, [Rotate
  peerId]." Rotation breaks LWW determinism with old events from this
  peer — guard rail: "Rotate only when creating a new campaign."
- Regression: add a unit test that asserts `peerId` survives the
  save → restore roundtrip (it does today; pin it so a future
  "anonymize on push" feature can't silently break the LWW story).

**Hand-off:** Engineering expert for the rotation primitive design.

---

## NEW-PRV-6 — Cloudflare-Worker token-exchange fallback (SEC-3) is a major trust escalation (P1, conditional)

**Claim.** If the CORS probe (`open-problems.md:11-24`, SEC-3) fails
and we fall back to the Cloudflare Worker as a token-exchange proxy,
**that Worker sees the OAuth auth code in plaintext, in transit, with
the matching code_verifier**. The Worker — operated by the maintainer
— then has the full ability to redeem the code for an access_token,
**impersonate any DM through their flow, and write to their
`drive.appdata`**.

The current threat model (`project_quire_threat_model.md`) treats
the **maintainer** as trusted (Google/GitHub-the-company are NOT
modeled as adversaries; the maintainer is the user's own deployment
in most cases). But a **Cloudflare-hosted maintainer-run Worker** is
a different trust statement than "the static bundle runs in the
DM's browser." It introduces a network-attached intermediary that:
1. **Logs** every exchange by default (Cloudflare logs request
   metadata; the Worker code can be made not to log bodies, but the
   Cloudflare control plane sees ingress + egress timestamps).
2. **Can be compromised** without the DM noticing — a malicious push
   to the Worker source rewrites token-exchange to siphon tokens.
3. **Is unilaterally controlled by the maintainer** — self-hosters
   running their own bundle still hit *the maintainer's Worker* by
   default (per ARC-3 / OP-013, self-hosters can override, but the
   default is "trust the maintainer").

**Severity:** P1 **conditional** on SEC-3 forcing the fallback.
P0 if SEC-3 fallback ships without explicit DM acknowledgement.

**Fix.**
- **Block the fallback** path from shipping silently. If CORS
  probe fails: surface in `decisions.md` as a NEW DEC requiring an
  explicit go/no-go, NOT a quiet "we'll just deploy a Worker."
- If we DO deploy the Worker: (a) the Worker MUST NOT log bodies
  (Cloudflare Workers config); (b) the DM-facing connect-Drive
  ceremony MUST disclose "Quire's auth proxy briefly sees your
  Google authorization code — [learn more]"; (c) self-hosters get a
  config-override path documented BEFORE the Worker ships.
- Verify the alternative path: a **client-side-only fallback** using
  Drive's `gapi.client` library, which is hosted by Google itself
  and never routes through our infrastructure. May obviate the
  Worker entirely for the Drive path.

**Hand-off:** Security consultant + Architect joint review **before**
any Worker code lands.

---

## NEW-PRV-7 — No forensic story when a DM reports "my saves leaked" (P2)

**Claim.** M6a stores no server-side logs (by design — Quire is a
static bundle). If a DM reports "I think my Drive save leaked to my
ex-co-DM," Quire has **no ability to help them reconstruct what
happened**:
- No record of when `drive.appdata` files were pushed (Google has
  this in Drive's revision history, accessible only to the DM).
- No record of which access_tokens were issued to which sessions
  (in-memory only; lost on tab close).
- No way to distinguish "the co-DM had legitimate access yesterday
  and downloaded a copy" from "the co-DM phished the OAuth code last
  Tuesday."

This is **consistent with the no-server architecture** and
**probably the right trade-off** — adding telemetry would itself be
a privacy regression. But it should be **named** so the DM-facing
docs honestly say "we can't help you with leak forensics; check your
Google Drive activity log."

**Severity:** P2 — acceptable but undocumented.

**Fix.**
- Add to user-facing privacy doc: "Quire stores no server-side logs.
  If you suspect a leak, check your Google Drive activity at
  https://myaccount.google.com/security and revoke Quire's grant."
- DM-only operational view: include a deep-link to the Google
  account permissions page for one-click revocation.

**Hand-off:** UX expert for the in-fiction copy of the revoke-help
affordance.

---

## NEW-PRV-8 — OAuth-failure console logs may leak email (P2)

**Claim.** When OAuth fails — wrong scope, APP-revoked refresh
token, network error — the typical SPA pattern is to `console.error`
the response, which **may include the user's email in the error
payload from Google's token endpoint**. Anything in `console.*` is
visible to:
- Browser extensions (per SEC blast-radius scenario #4 in the draft
  at `auth-strategy.md:286`).
- Devtools auto-screenshot tools / bug-report bundlers.
- Sentry-like error reporters if Quire ever adds one.

Quire has no error reporter today (good). But there's no **lint rule
or convention** that says "don't `console.log` the OAuth response
body." A well-meaning engineer adding "for debugging" leaves a
permanent email-leak landmine.

**Severity:** P2.

**Fix.**
- Add a lint or convention: OAuth error paths use a
  `redactOAuthError(err)` helper that strips known PII fields
  (`email`, `sub`, `name`, `picture`) before logging.
- Regression test: a fuzz test that feeds OAuth-error-shaped
  payloads through the error logger and asserts no email-shaped
  string in the output.

**Hand-off:** Engineering expert.

---

## NEW-PRV-9 — `drive.appdata` semantics need verified citation (P2)

**Claim.** The draft (A2, `decisions.md` DEC-009) asserts
`drive.appdata` is:
1. Hidden from the user's Drive UI.
2. Not accessible to other apps.
3. Counted toward Drive's 15GB free-tier quota.
4. Deleted when the user un-installs the OAuth grant (?).
5. NOT scanned by Google's automated content-safety pipeline (?).

Items 1-3 are correct per Google's docs as of authoring date.
Items 4 and 5 are **not verified** in the draft:
- **(4)** Google's documented behavior is that `drive.appdata` files
  are *orphaned but not deleted* when the user revokes the OAuth
  grant — they linger in the user's quota with no app able to read
  them. The DM reading `decisions.md` may believe revocation = clean
  slate; it isn't.
- **(5)** Google Drive's TOS reserves the right to scan content for
  CSAM and policy violations regardless of folder visibility.
  Campaign notes containing adult or violent fiction (Underleaf
  encourages dark themes) **may trigger automated review** with
  consequences up to account suspension. The DM has no notice.

**Severity:** P2 — affects the durability + privacy story but not
the auth design itself.

**Fix.**
- Verify (4) and (5) against Google's current docs; cite the URL +
  retrieval date in `auth-strategy.md:113-118`.
- If confirmed: add to DM-only documentation: "Revoking Quire's
  Drive access does NOT delete your backed-up campaigns; use
  Quire's Disconnect → Erase action first." And: "Google may scan
  your campaign content per their content policies. If your
  campaign contains adult or violent fiction, consider GitHub
  (which does not scan repo content) instead of Drive."

**Hand-off:** save-restore lead — doc-only fix.

---

## Agreements with the self-review

- **PRV-1 (popup / COOP) and PRV-2 (what Google sees) are correct.**
  My findings extend rather than contradict them.
- **SEC-1 through SEC-5 are the right defenses.** No disagreement on
  the OAuth-mechanics side.
- **DEC-009 (drive.appdata default) is the correct call.** It closes
  ADV-1 as the lead claims AND incidentally reduces the GDPR-
  controller surface (because the data is harder to share than a
  `drive.file` document).

---

## Disagreements / Pushback

- **The self-review's framing of PRV-2 as "P3 — for documentation"**
  underestimates its load-bearing role. The user-facing privacy doc
  is not a nice-to-have; per NEW-PRV-4 (DM-as-controller), it is the
  artifact that converts an implicit upload into informed-DM
  upload. Bump PRV-2 to P2 and treat it as part of the M6a ship
  acceptance criteria.
- **The token threat-model table (`auth-strategy.md:269-276`)** lists
  the OAuth artifacts but **omits the saved-document artifacts** — the
  `peerId`s, the player chat content, the campaign-slug-in-Drive-
  file-name. The table should be expanded to cover what's IN the
  upload, not just what authorizes it.

---

## Hand-offs

| Finding | Owner |
|---|---|
| NEW-PRV-3 (M5 cross-tab) | save-restore lead → M5 implementer |
| NEW-PRV-4 (consent ceremony) | TTRPG-craft + UX (copy); save-restore lead (gating logic) |
| NEW-PRV-5 (peerId linkage) | Engineering (rotation primitive); save-restore lead (doc) |
| NEW-PRV-6 (Worker trust) | Security + Architect joint, BEFORE Worker code |
| NEW-PRV-7 (forensics) | UX (in-fiction copy of revoke-help) |
| NEW-PRV-8 (email leak) | Engineering (lint + fuzz test) |
| NEW-PRV-9 (appdata semantics) | save-restore lead (verification + doc) |

---

## Final recommendation

**Conditional GO for M6a.** Before M6a ships:
1. **Land NEW-PRV-4** (DM consent acknowledgement on first push) —
   this is the cheapest fix and the highest leverage for honoring
   Quire's firewall ethos.
2. **Land NEW-PRV-3** (account-scoped recently-played list) — the
   cross-tab leak is silent and the fix is local to M5.
3. **Block NEW-PRV-6** as a gate on the SEC-3 outcome. If CORS
   probe passes, NEW-PRV-6 disappears; if it fails, the Worker
   needs its own decision record.

The remaining findings (NEW-PRV-5, 7, 8, 9) can land in M6b or as
parallel doc-PRs but should be **explicitly named** in `decisions.md`
so they aren't re-discovered next round.

The self-review's "civilized-peer threat model accepts this" answer
is correct for SECURITY but is insufficient for PRIVACY — privacy
expectations apply even between civilized peers (the DM's partner
who shares the laptop is civilized AND has no business knowing the
campaign cadence). The findings above tighten the privacy story
without compromising the security or threat-model framing.

**Word count:** ~1490.
