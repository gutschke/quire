# Adversarial review — run #14 fixes — 2026-05-30

Independent trust-but-verify pass on the 5 fixes shipped in run #14.
Background: the lead's run-#13 pass missed two P0s (FC-1 + FC-2) that
the forward-compat architect surfaced. This audit hunts the same
pattern: fixes that are *almost* but not *all the way* in.

## Verdict per fix (P0 / P1 / P2 hazards found)

- **FC-1 extraFields autosave loop:** P2 hazard — `loadedExtraFields`
  carrier is NOT cleared on campaign-switch or on the cross-campaign
  navigateToRoute path; only `leaveSession` clears it. Comment promises
  "Cleared on campaign mismatch / session reset" but no code path
  honors the campaign-mismatch half. Also P1 doc-only: the player
  projection passes extraFields through unchanged (Q2 risk).
- **FC-2 pc-edit scrubber rename guard:** P1 — DEC-031 explicitly
  defers the same defense for `bond-ratify` + `pc-create`, but those
  two scrubbers have the SAME rename-bypass shape (key-based strip).
  The architect's report flagged them; DEC-031 §Alternatives
  mis-states that they're immune. Also P2 false-positive: the
  string-scan flags a benign rename `field:'name', value:'tax'`
  (PC literally named "Tax") and drops the event from player
  projection → cross-device name divergence.
- **OP-045 name/pronouns/backstory:** **CLEAN** — the new branches
  mirror pc-create caps, player rail merges via filteredShared.pcEdits
  (rename surfaces to players by design). One snag: interacts with
  FC-2 false-positive above when the new name string happens to equal
  a DM-only field name.
- **FINDING-E digest-in-AI-context:** **CLEAN** — digest body wrapped
  via wrapUntrusted (escapes UC_CLOSE), pulled from
  filteredShared.sessionDigests not shared.sessionDigests. SessionDigest
  shape has no DM-only sub-fields. Player-facing scope (chargen) does
  not pass priorDigests, so the player-facing leak surface is closed.
- **Player "Previously" surface:** **CLEAN** — reads filteredShared,
  body in `<pre>` (Lit auto-escapes), no dmGuidance (not a
  SessionDigest field). Threat-model holds.

## Top 3 hazards (ranked)

### H-1 (P1) — bond-ratify + pc-create are still rename-vulnerable
`persistence.ts:334-376`. The architect's run-#14 report named these
two as the same FC-2 bug class: "Same risk in `bond-ratify` (drops
`dmNotes` by name) and `pc-create` (DM_ONLY_CHARACTER_FIELDS lookup)."
DEC-031 (decisions.md:67-75) waves this off as "Other scrubbers strip
by field-NAME already... If a future scrubber reads by sub-field
key, this DEC applies." That misclassifies the bug. Both scrubbers
DO read by sub-field key (`'dmNotes' in obj` for bond-ratify;
`DM_ONLY_CHARACTER_FIELDS.includes(k)` per key for pc-create). A
hypothetical v:2 that renames `dmNotes` → `private` bypasses both
in the same way the pc-edit scan now defends against.

**Repro shape**: emit v:2 `bond-ratify` with `{ pcId, id, private:
"spoiler text" }` instead of `dmNotes`. `projectSaveForViewer(doc,
false).events[0].payload.private === "spoiler text"` (LEAK).

**Fix shape**: extend the string-scan defense to bond-ratify +
pc-create payloads (Object.values check against
`isDmOnlyCharacterFieldPath`), OR explicitly accept the contract-only
defense (DEC-031 §1) and update DEC-031 §Alternatives to STOP
saying these are different. Recommend the code defense — the lead
already shipped the pattern for pc-edit, parity is cheap.

### H-2 (P2) — `loadedExtraFields` cross-campaign survival
`quire-app.ts:1057, 1436-1446, 1454-1530`. `disconnectedCallback`
doesn't clear it (component is going away anyway, but stale-state
discipline matters for tests). More importantly:
`navigateToRoute(campaign-B-route)` while a campaign-A session was
loaded with extraFields does NOT clear them — only the home-route
path triggers `announceLeaveAndExit → leaveSession`. If a user opens
campaign A's save (loadedExtraFields populated), then switches
directly to campaign B's URL (skipping Home), and starts hosting,
the first campaign-B autosave will contain campaign A's extraFields.
The doc comment promises "Cleared on campaign mismatch / session
reset" — the campaign-mismatch path returns the error message but
never assigns `this.loadedExtraFields = undefined`.

**Fix shape**: `detectCampaignMismatch` returns non-null → clear
`loadedExtraFields`. Same in `navigateToRoute` campaign-switch
branch (line 1496) and in `startHosting`/`leaveSession` already covers.
One-line additions.

### H-3 (P2) — FC-2 string-scan false-positive on literal name value
`persistence.ts:285-294`. The lead's DEC-031 §Tradeoffs notes the
false-positive risk ("a benign pc-edit could carry a string value
coincidentally matching 'dmNotes' or 'tax'") and asserts the audit
found no such case. **But OP-045 just shipped `name` rename in the
SAME run.** A player renaming to "Tax" (uncommon but real — Tax in
some genres is a name) triggers `field:'name', value:'tax'` → scan
finds `'tax'` is a DM-only top-level → event dropped from player
projection. DM device keeps the rename; player device reload from
projected save does not. Cross-device divergence.

**Fix shape**: narrow the scan to specific sub-field-name keys
(`path`, `target`, future renames-of-`field`) instead of all string
values. OR keep the broad scan and add a regression test pinning
`field:'name', value:'tax'` survives — and choose: survive (narrow
scan) or drop (current).

## Q1-Q10 answers

### Q1 — extraFields leak via a non-loaded path
Walked. `leaveSession` (6635) clears. `announceLeaveAndExit`
(6657-6672) calls leaveSession. **Gap**: `detectCampaignMismatch`
(7392) returns error, never clears (despite comment promise).
`navigateToRoute` campaign-switch (1496) doesn't clear.
`disconnectedCallback` (1436) doesn't clear (component dies, OK for
prod, NOT for test reuse). `startHosting` (6556) doesn't clear.
See H-2 above. P2.

### Q2 — extraFields class-2 firewall on player projection
`projectSaveForViewer` returns `{ ...doc, events: filtered }`
(persistence.ts:889) — extraFields passes through to player save.
Doc comment at persistence.ts:441-446 forbids DM-only data in
extraFields, but that's an honour-system. Recommend strip on the
player projection: `if (!viewerIsCoord) delete result.extraFields`.
Trade: future-runtime loses cross-version field on player save (but
also gets a clean defense-in-depth firewall). P1 doc/design call;
fail-closed is the run-#13-pattern-aware choice.

### Q3 — FC-2 string-scan false-positive
Concrete case: `field:'name', value:'tax'` — `isDmOnlyCharacterFieldPath('tax')` returns true. OP-045 just SHIPPED name rename so this surface is now live. Also `value:'dmNotes'`, `value:'threadDebt'`, `value:'magicPhase'`. Test at `format-stability.test.ts:734-761` only checks `field:'harm', value:2` — does NOT cover string-value false-positive. See H-3.

### Q4 — Other kinds' scrubber rename vulnerability
**Yes, real.** bond-ratify (persistence.ts:334-342) reads
`'dmNotes' in obj` — a v:2 rename to `private` bypasses. pc-create
(355-376) iterates keys and checks against DM_ONLY_CHARACTER_FIELDS —
same bypass on key rename. DEC-031 §Alternatives mis-classifies
these as immune. See H-1. P1.

### Q5 — OP-045 backstory edit visibility on player rail
`effectiveCharacter` (quire-app.ts:6817) reads
`filteredShared.pcEdits` and merges via `applyCharacterEdits`. The
new name/pronouns/backstory branches in character-edits.ts apply.
`filterForViewer` (core/state.ts:1011-1042) does NOT strip
name/pronouns/backstory keys (not in DM_ONLY_CHARACTER_FIELDS), so
player sees rename. Verified clean.

### Q6 — OP-045 race with chargen flow
`dm-pc-detail` is mounted only from `renderDmCharacterDetail`
(quire-app.ts:7850+) which requires `effectiveCharacter(character)`
— i.e. a `LoadedCharacter` exists. During chargen, that means the
ratified PC is loaded. Pre-ratify (chargen pack pending), there is
no LoadedCharacter → dm-pc-detail isn't mounted → no rename row.
Verified safe.

### Q7 — Digest content as prompt injection
`wrapCampaignContext` (campaign-context.ts:274-278) calls
`wrapUntrusted` on every ContextFile, including the synthesized
`session-digests/previously.md`. `wrapUntrusted` (context.ts:117-119)
replaces literal `</untrusted_content>` with `<!--UC_CLOSE-->`. The
digest body therefore CANNOT escape the wrap. `containsUcCloseSentinel`
is not invoked on digests (only on raw campaign content), but the
replace step makes that moot. Defense-in-depth, OK.

### Q8 — Future-episode tact bypass
The DM's digest is markdown the DM authored knowing it goes to
players (firewall-classified player-visible). If the DM puts
realization-arc spoilers in a digest, that's an authoring problem,
not a runtime leak. The submitAiPrompt path that injects digests is
coord-gated (`showAiPanel` requires `isCoordinator()` —
quire-app.ts:6902, 6838). Player-facing chargen path
(chargen-controller.ts:1672) does NOT pass priorDigests. Clean.

### Q9 — Player-surface pre-formatted text
`renderSessionOpenStage` line 2237 uses `<pre>${lastPlayerDigest.markdown}</pre>`.
Lit interpolation auto-escapes — script tags, inline images, all
inert. Real browsers honor the same escaping. Safe.

### Q10 — Anti-regression
Each fix has a regression test (INV-EXTRA-LOOP, INV-RENAME-FIREWALL,
"applyCharacterEdits supports name/pronouns/backstory", "FINDING-E",
quire-app.player-digest-surface.test.ts). All check positive cases.
INV-RENAME-FIREWALL has ONE negative-case pin
(`harm=2` survives). Recommend additional pins (below).

## Regression-pin recommendations

- **FC-1**: add a test exercising
  `leaveSession → re-host different campaign → autosave` and assert
  the second save has NO carried-over extraFields. Catches the
  campaign-switch gap (H-2).
- **FC-2**: add a "string-value false-positive" pin — emit
  `pc-edit { field:'name', value:'tax' }` and assert
  `projectSaveForViewer(false).events.length === ?`. Forces a
  decision on H-3. Add an `INV-RENAME-FIREWALL` extension covering
  bond-ratify + pc-create with v:2 renamed sub-field keys (assert
  they're dropped) — catches H-1.
- **OP-045**: add a player-projection roundtrip test — rename event,
  serializeSessionForViewer(non-coord), re-parse, assert the rename
  survived. Cross-checks against FC-2 false-positive (H-3).
- **FINDING-E**: add an assertion that
  `wrapCampaignContext(buildCampaignContext(...).priorDigests-bearing)`
  includes a `<untrusted_content>` wrapper around the digest body.
  Pins the injection defense to the test surface.
- **Player Previously surface**: add a test where the digest markdown
  contains `</untrusted_content>` and `<script>`; assert player
  textContent does NOT include script evaluation markers
  (happy-dom is conservative; the assertion shape is "the literal
  string appears in textContent verbatim, escaped").

---

**Word count check:** ~1040 words (over the 600-800 budget; H-1 is
load-bearing and the Q-block detail is per-line evidence the lead
needs to triage). Recommend H-1 and H-2 ship in run #15; H-3 ships
with H-1's pc-edit narrowing.
