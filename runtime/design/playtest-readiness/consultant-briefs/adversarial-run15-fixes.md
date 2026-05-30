# Adversarial review — run #15 critical fixes (run #16)

## ROLE

You are a security / firewall / forward-compat adversarial reviewer
auditing the specific P1 fixes the lead shipped in run #15. The
lead missed FC-1 + FC-2 in run #13, then mis-classified the FC-2
parity (bond-ratify + pc-create) and shipped a false-positive UX-3
test in run #14. Per "trust but verify": find the next gap before
real players hit it.

## MANDATORY READS (in order)

1. Adversarial v2 report (the report that surfaced the run-#15
   fixes): `review-history/adversarial-run14-fixes-2026-05-30.md`.
2. TTRPG/UX expert v2 report (the report that surfaced UX-3 +
   UX-5): `review-history/ttrpg-ux-expert-v2-2026-05-30.md`.
3. Run #15 ship summary in `playtest-readiness-plan.md`
   Appendix B (new this run).
4. **UX-3 routing fix (player auto-trigger):**
   - `src/quire-app.ts` — the player-side auto-trigger block at
     the `applySessionViewChange` subscriber (search "Run #15
     (UX-3 routing fix").
   - `src/quire-app.ts` — `playerHasUnseenDigest`,
     `getPlayerLastSeenDigestTs`, `setPlayerLastSeenDigestTs`,
     `playerLastSeenDigestTsInMemory`,
     `dismissPlayerDigestRecap`.
   - `src/quire-app.ts:renderSessionOpenStage` non-coord branch
     — the new dismiss button + markdown rendering.
   - Tests in `src/persistence.simulation-10-routing-and-drafts.
     test.ts` Scenarios 1, 2, 3.
5. **FC-2 parity (bond-ratify + pc-create) + narrowing (pc-edit
   value-scan):**
   - `src/persistence.ts:FIELD_NAME_KEYS` +
     `payloadFieldNameKeyNamesDmField`.
   - `src/persistence.ts:PER_KIND_SCRUBBERS['pc-edit' | 'bond-
     ratify' | 'pc-create']`.
   - DEC-031 (revised) in `design/save-restore-program/decisions.
     md`.
   - Tests in `src/persistence.format-stability.test.ts`
     describe block `INV-RENAME-FIREWALL` — new "Tax" rename,
     bond-ratify v:2 rename bypass, pc-create v:2 rename bypass.
6. **loadedExtraFields cross-campaign clear:**
   - `src/quire-app.ts:navigateToRoute` — the new
     `loadedExtraFields = undefined` assignment in the slug-
     mismatch path.
7. **UX-5 digest draft persistence:**
   - `src/digest-draft-persistence.ts` (NEW module).
   - `src/ui/regions/session-digest.ts` — `campaignSlug` prop +
     `connectedCallback` + `loadPersistedDraft` +
     `schedulePersistDraft` + `persistDraftNow` +
     `handleSave/Discard/Generate` clear/save hooks.
   - `src/quire-app.ts:currentCampaignSlugForPersistence` + the
     `<session-digest>` wiring.
   - Tests in `src/persistence.simulation-10-routing-and-drafts.
     test.ts` Scenarios 4, 5, 6.
8. **Send button regression fix:**
   - `src/ui/regions/chat-panel.ts:108`,
     `src/ui/regions/ai-panel.ts:635`.
9. **Foundation continuation:**
   - `.card` migration to tokens in `src/ui/styles/quire-app.css.
     ts` (search "Run #15 (visual-design expert v2 #1").
   - Brittle-class doc comment.
   - `quire-topbar-help-chip:focus-visible` migrated to
     `--ring-focus`.

## SPECIFIC QUESTIONS

1. **UX-3 hazard: routing-trigger leak.** The player-side
   auto-flip gate is `!coordHolders.has(peerId)` +
   `filteredShared.sessionDigests.length > 0` +
   `playerHasUnseenDigest`. Walk: can a CO-DM in `bound-following`
   mode (not a coord but also not a true player) ever flip into
   session-open mode via this trigger and see content meant for
   players? Does it matter?

2. **UX-3 hazard: seen-marker race across campaign-switch.** The
   in-memory mirror persists across navigateToRoute (it's an
   instance field). If a DM-shared link bounces the player from
   campaign A to campaign B mid-session, does the in-memory mirror
   carry over to leak a "I already saw this" gate for campaign
   B's first digest? Walk the navigateToRoute flow + the
   in-memory mirror lifecycle.

3. **UX-3 hazard: dismiss handler races with a new digest.** The
   dismiss handler writes the seen-marker for the CURRENT last
   digest. If a new digest lands between the dismiss read and the
   set, can the new digest's later `ts` be silently lost as
   "seen" because the dismiss wrote the OLDER ts? Walk
   `dismissPlayerDigestRecap`.

4. **FC-2 narrowing: is FIELD_NAME_KEYS complete?** The lead
   picked `field/path/target/key/attr/prop`. Are there other
   sub-field-key names a v:2 author would plausibly choose
   (`prop`, `slot`, `member`, `dotted`, `id`?) that would
   bypass? The contract is "any v:2 rename is forbidden per
   DEC-031" so this is defense-in-depth — but recommend any
   additions if the vocab is incomplete.

5. **FC-2 false-positive: is the narrowing too narrow?** The
   regression test pins `field:'name', value:'Tax'` SURVIVING.
   But what about `field:'name', value:'dmNotes'` (a player who
   names themselves literally "dmNotes")? Should that survive
   (it's just a name) or drop (defense-in-depth)? Document the
   current behavior + recommend.

6. **FC-2 parity: are there more scrubbers?** The lead added
   the field-name-key scan to pc-edit + bond-ratify + pc-create.
   Walk every entry in `PER_KIND_SCRUBBERS`. Any others that
   read by sub-field key (not by name)? Map-blob? Focus-grant?
   pc-retire?

7. **UX-5 hazard: digest draft leak across PCs.** The persisted
   draft is keyed by campaign-slug only — not by `pcId` or
   `sessionStartTs`. If the same DM hand-types two drafts (one
   from session 5, one from session 6) without saving, does the
   second overwrite the first silently? Is that the right
   tradeoff?

8. **UX-5 hazard: stale draft re-surfaces after save.** The save
   handler clears the persisted entry. But what if save fails
   (onSave returns false)? Walk the failure path. Does the
   draft survive correctly? Verify.

9. **UX-5 hazard: campaign-slug change leaves a stale draft.** The
   `updated()` hook re-loads on campaignSlug change. But it
   doesn't CLEAR the on-screen draft first — if the user switches
   campaigns and the new campaign has no persisted draft, does
   the prior campaign's draft text persist visually? Walk
   `loadPersistedDraft` against this case.

10. **Anti-regression for the run-#15 ship.** Each fix has a
    regression test. Are the tests structured so a future
    code-change can't silently undo the fix (e.g., by
    accidentally dropping the in-memory mirror or the
    FIELD_NAME_KEYS check)? Recommend additional pin-against-
    silent-flip tests if needed.

## OUTPUT FORMAT

```
# Adversarial review — run #15 fixes — 2026-MM-DD

## Verdict per fix (P0 / P1 / P2 hazards found)
[UX-3 routing / UX-3 dismiss / FC-2 narrowing / FC-2 parity /
 loadedExtraFields / UX-5 / Send button / .card migration:
 one line each]

## Top 3 hazards (ranked)
[file:line + minimal repro shape + fix shape + severity]

## Q1-Q10 answers
[concise; cite file:line; under 100 words per Q]

## Regression-pin recommendations
[per fix: a test that would catch a silent revert]
```

## OUTPUT FILE PATH

`design/playtest-readiness/review-history/adversarial-run15-fixes-YYYY-MM-DD.md`

## WORD BUDGET

600-800.
