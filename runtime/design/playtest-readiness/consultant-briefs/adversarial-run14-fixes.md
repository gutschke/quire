# Adversarial review — run #14 P0/P1 fixes (run #15)

## ROLE

You are a security / firewall / forward-compat adversarial reviewer
auditing the specific P0 and P1 fixes the lead shipped in run #14.
Your job is to identify any bypass, edge-case, or hidden hazard
the lead missed. Per the user's "trust but verify" discipline:
the lead missed FC-1 + FC-2 in run #13. Do better.

## MANDATORY READS (in order)

1. Forward-compat architect report:
   `review-history/forward-compat-architect-2026-05-30.md` —
   the report that surfaced FC-1 + FC-2.
2. Run #14 ship summary in `playtest-readiness-plan.md`
   Appendix A.
3. **FC-1 fix (extraFields autosave loop):**
   - `src/persistence.ts:serializeSession` (new `extraFields`
     param)
   - `src/persistence.ts:serializeSessionForViewer` (same)
   - `src/persistence.ts:applySaveToLog` (`LoadResult.extraFields`)
   - `src/quire-app.ts` — `loadedExtraFields` field + threading
   - Tests in `src/persistence.format-stability.test.ts`
     describe block `INV-EXTRA-LOOP`.
4. **FC-2 fix (scrubber rename guard):**
   - DEC-031 in `design/save-restore-program/decisions.md`.
   - `src/persistence.ts:PER_KIND_SCRUBBERS['pc-edit']` — the
     new string-scan defense.
   - Tests in `src/persistence.format-stability.test.ts`
     describe block `INV-RENAME-FIREWALL`.
5. **OP-045 fix (rename gap):**
   - `src/character-edits.ts` — new name/pronouns/backstory
     branches.
   - `src/ui/regions/dm-pc-detail.ts` — new
     `renderRenameSection`.
   - Tests in `src/persistence.chargen-roundtrip.test.ts`
     describe block "applyCharacterEdits supports
     name/pronouns/backstory".
6. **FINDING-E fix (digest-in-AI-context):**
   - `src/ai/campaign-context.ts:buildCampaignContext` — new
     `priorDigests` param.
   - `src/quire-app.ts:submitAiPrompt` — the digest read +
     threading.
   - Tests in `src/ai/campaign-context.test.ts` describe block
     "FINDING-E".
7. **Player digest surface fix:**
   - `src/quire-app.ts:renderSessionOpenStage` non-coord branch
     — the `.session-open-player-recap` rendering.

## SPECIFIC QUESTIONS

1. **FC-1 hazard: extraFields leak via a non-loaded path.** The
   lead clears `loadedExtraFields` on `leaveSession`. Are there
   OTHER session-reset paths (`disconnectedCallback`,
   `announceLeaveAndExit`, campaign mismatch, host-load auto-
   reclaim race) where a stale extraFields could survive into a
   fresh session and contaminate someone else's save? Walk every
   path that resets `this.session` or flips campaign.

2. **FC-1 hazard: extraFields class-2 firewall.** The lead's
   doc comment says extraFields is "purely a forward-compat
   passthrough" and "NEVER use for known-DM-only data." But
   `projectSaveForViewer` preserves extraFields unchanged on the
   player projection. A future runtime that ACCIDENTALLY classifies
   sensitive material as a top-level extraField would leak it on
   the player save. Is the doc comment sufficient defense, or
   should the player projection STRIP extraFields by default? Trade
   off: strip = future runtime loses field, but firewall holds;
   passthrough = forward-compat default but leak risk.

3. **FC-2 hazard: the string-scan defense is too eager.** The
   lead's scan checks EVERY top-level string value in pc-edit
   payloads against `isDmOnlyCharacterFieldPath`. The
   regression test asserts a benign `harm` edit survives. Is
   there a USER-AUTHORED string value (a name like "tax" or
   "dmNotes" or "magicPhase") that would false-positive? Walk
   the pc-create + pc-edit value space. If a player picks the
   name "Tax" (probably no), the scan still doesn't trigger
   because `field !== 'name'` for the path check — but
   verify the case where the VALUE is the literal "tax" not
   the field. Recommend a narrowing pattern if needed.

4. **FC-2 hazard: other kinds.** The lead applied the scan
   only to `pc-edit`. The architect's report noted `bond-ratify`
   and `pc-create` also strip by name. Are they vulnerable to
   the same v:2 rename bypass? Walk each scrubber + report
   gaps.

5. **OP-045 hazard: backstory edit visibility.** The DM types
   a 4000-char backstory revision in `dm-pc-detail`'s rename
   editor. The pc-edit event fires; pcEdits[pcId][backstory]
   = NEW. The player's rail rendering pulls `effectiveCharacter`
   which merges pcEdits. Does the player see the NEW backstory
   on their rail? Verify the filter passes pcEdits[name/pronouns/
   backstory] through `filterForViewer` for non-coord viewers
   (pcEdits is player-visible by design but specific overlays
   might wipe).

6. **OP-045 hazard: race with chargen flow.** The DM-PC-detail
   rename row is gated by `onRenamePc !== null`, which is
   coord-only. But it renders ALSO during chargen, before
   pc-create has fired? Walk the early-chargen state shape.
   What does the editor show when `record.name` is empty?

7. **FINDING-E hazard: digest content as prompt injection.**
   The lead synthesizes `# Previously\n\n<digest body>` and
   passes the whole thing through `wrapUntrusted` in the AI
   prompt path. Verify the wrap. Then: does the digest body
   contain UC_CLOSE sentinels that bypass the wrap? The
   `containsUcCloseSentinel` check in `loadCampaign` doesn't
   run on session digests. A DM who pastes attacker text into
   a digest could escape. Severity?

8. **FINDING-E hazard: future-episode tact bypass.** The AI
   context tells the AI to be tactful about unrevealed plot.
   But the digest contains explicit PAST events. If the DM
   wrote a digest mentioning a Realization PC arc, then the
   NEW session's AI context includes the digest, then the
   AI references the arc to a player who hadn't reached it
   yet (rejoiner, late arrival), is that a leak? Walk
   includeDmNotes:false vs. the digest's player-visible
   classification.

9. **Player surface hazard: pre-formatted text.** The
   `<pre>` block renders the digest verbatim. Does the digest
   markdown ever contain HTML / script / inline image refs
   that happy-dom doesn't render but a real browser would?
   The system prompt + the markdown convention say "no inline
   refs to images / private files" — but the DM hand-write
   path is unguarded.

10. **Anti-regression for the run-#14 ship.** Each of the 5
    fixes has a regression test. Are the tests structured so
    that a future code-change can't silently undo the fix
    (e.g., by accidentally dropping `extraFields` from a new
    serialize variant)? Recommend additional pin-against-
    silent-flip tests if needed.

## OUTPUT FORMAT

```
# Adversarial review — run #14 fixes — 2026-MM-DD

## Verdict per fix (P0 / P1 / P2 hazards found)
[FC-1 / FC-2 / OP-045 / FINDING-E / Player digest: one line each]

## Top 3 hazards (ranked)
[file:line + minimal repro shape + fix shape + severity]

## Q1-Q10 answers
[concise; cite file:line; under 100 words per Q]

## Regression-pin recommendations
[per fix: a test that would catch a silent revert]
```

## OUTPUT FILE PATH

`design/playtest-readiness/review-history/adversarial-run14-fixes-YYYY-MM-DD.md`

## WORD BUDGET

600-800.
