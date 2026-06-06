/**
 * Q-LT4 (2026-05-27 holistic-review): grep-lint enforcing that
 * any production read of `v.shared.synthesizedPcs` happens
 * inside a code path that has already gated on
 * `isCoordinator()`.  Raw `v.shared.synthesizedPcs` returns the
 * UNFILTERED record including DM-only sub-fields (magic-arc:
 * magicPhase, tax, threadDebt, accidentalGrants, alignmentDrift,
 * dmNotes); reading it from a player-eligible code path leaks
 * DM-only material.
 *
 * The right read for player-eligible paths is
 * `v.filteredShared.synthesizedPcs` (per state.ts:filterForViewer
 * which strips DM-only fields when the viewer isn't a coord).
 *
 * This lint catches the "engineer forgot to use filteredShared"
 * regression class.  Adversarial flagged it 3 holistic rounds ago;
 * post-D3 audit found the existing use in
 * `renderSessionOpenStage` which IS legitimately coord-gated.
 *
 * Allowlist convention: any file in
 * `FIREWALL_ALLOWLIST_FILES` is allowed to read
 * `v.shared.synthesizedPcs` directly.  Adding a file means the
 * code in it has been audited to gate on coord.  When in doubt,
 * use `v.filteredShared.synthesizedPcs` instead.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { emptyState, filterForViewer, type SessionState } from './core/state';

/**
 * Files allowed to read DM-only `v.shared.*` slots directly.
 * Each entry must be coord-gated (`isCoordinator()` check upstream)
 * before reaching the read, OR be reading a derived shape that
 * doesn't leak to the player projection.  Drift = audit the file
 * and add it here, OR refactor to `v.filteredShared.*`.
 */
/**
 * #410 (2026-05-28 Architect B3): the allowlist used to be a wholesale
 * file pass — any `v.shared.<DM-only>` read inside quire-app.ts was
 * permitted, so the ~7400-LOC god-object (the likeliest place to leak)
 * had ZERO in-file protection.  It's now a COUNT-RATCHET: each
 * allowlisted file records the number of audited reads; a NEW read
 * trips the ratchet (see the count test below), forcing an audit of
 * the new read's coord-gating before the budget is bumped.  This
 * catches the regression class (a new unaudited read) without
 * rubber-stamping every existing line.  (chargen-controller.ts was
 * removed from the allowlist — it has ZERO `v.shared.<DM-only>` reads;
 * the per-pattern test below now covers it for free.)
 *
 * The existing reads (audited when the file was first allowlisted):
 *   - renderSessionOpenStage reads DM-only sub-fields for the
 *     carryover card; early-returns `!isCoordinator()` first.
 *   - pendingBondProposalCount gates on (isCoordinator OR
 *     controllerPeerId === peerId); buildPendingBondProposalsForDmAside
 *     + the bond/clock/diff/digest reads are coord-only host methods.
 */
const FIREWALL_ALLOWLIST: ReadonlyMap<
  string,
  { maxReads: number; note: string }
> = new Map([
  [
    'quire-app.ts',
    {
      maxReads: 26,
      note: 'All reads are in coord-gated render/handler methods (or the own-seat bond-count carve-out).  2026-06-06: +1 — generateSessionDigest reads v.shared.scratchNotes (already coord-gated via isCoordinator at the top of the method) to feed DM scratch notes into the AI prompt.'
    }
  ]
]);

/**
 * D5-cleanup-2 (2026-05-27 scenario Adv-A): the Q-LT4 lint is
 * a tripwire by design.  Extended to cover ALL DM-only state
 * objects whose `v.shared` reads need coord-gating.  Pre-extension
 * the lint only caught `synthesizedPcs`; D5 added a fourth DM-only
 * shared field (`pcBondProposals`) whose direct reads needed the
 * same coverage.  Add new patterns here as DM-only state objects
 * land.
 */
const FIREWALL_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: 'v.shared.synthesizedPcs', re: /v\.shared\.synthesizedPcs\b/g },
  // #406 (2026-05-28 senior Test/Architecture consultancy): the lint
  // was hand-maintained and MISSED five DM-only objects that
  // filterForViewer wholesale-wipes — threadDebt, pinnedNpcs,
  // scratchNotes, aiAudit, casterState.  A raw `v.shared.<one>` read
  // would leak DM-only material exactly like the others.  The
  // self-completing coverage test below now PINS this list against
  // filterForViewer's actual wipe set, so a future wiped field can't
  // silently escape the lint.  (No current production file reads these
  // via the `v.shared.` destructure form — verified — so adding them
  // introduces zero violations.)
  { name: 'v.shared.threadDebt', re: /v\.shared\.threadDebt\b/g },
  { name: 'v.shared.pinnedNpcs', re: /v\.shared\.pinnedNpcs\b/g },
  { name: 'v.shared.scratchNotes', re: /v\.shared\.scratchNotes\b/g },
  { name: 'v.shared.aiAudit', re: /v\.shared\.aiAudit\b/g },
  { name: 'v.shared.casterState', re: /v\.shared\.casterState\b/g },
  // D5 (2026-05-27): bond proposals are DM-private state.
  // filterForViewer wipes them for non-coord.  Direct reads must
  // be coord-gated upstream.
  { name: 'v.shared.pcBondProposals', re: /v\.shared\.pcBondProposals\b/g },
  // SEC-3 (2026-05-27 post-D5 holistic Adversarial sweep): cover
  // the remaining DM-only shared-state objects.  Each is wiped
  // (or per-entry stripped) by filterForViewer; direct
  // `v.shared.*` reads must therefore be coord-gated or read the
  // count-only.
  // pcAccidentalGrants: append-only DM-typed silent-grant log
  // (Wave B); wiped wholesale for non-coord.
  {
    name: 'v.shared.pcAccidentalGrants',
    re: /v\.shared\.pcAccidentalGrants\b/g
  },
  // dmClocks: DM-only progress trackers (D3); wiped wholesale.
  { name: 'v.shared.dmClocks', re: /v\.shared\.dmClocks\b/g },
  // pcBonds: ratified bonds; player-visible at the array level
  // BUT per-entry dmNotes + hidden-seat-source/target stripped.
  // Direct reads from `v.shared` (not filteredShared) skip both
  // strips.
  { name: 'v.shared.pcBonds', re: /v\.shared\.pcBonds\b/g },
  // diffProposals: D1-D living-doc proposals; wiped wholesale.
  { name: 'v.shared.diffProposals', re: /v\.shared\.diffProposals\b/g }
];

// Back-compat: the original PATTERN_SYNTHESIZED_PCS export name
// is preserved as an alias for any external test that imports it.
const PATTERN_SYNTHESIZED_PCS = FIREWALL_PATTERNS[0].re;

function listSrcFiles(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...listSrcFiles(full, base));
    } else if (
      stat.isFile() &&
      entry.endsWith('.ts') &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      out.push(full);
    }
  }
  return out;
}

describe('Q-LT4 firewall allowlist — direct v.shared.* reads', () => {
  it.each(FIREWALL_PATTERNS)(
    'no production file outside the allowlist reads $name directly',
    ({ name, re }) => {
      const srcRoot = join(__dirname);
      const files = listSrcFiles(srcRoot);
      const violations: Array<{ file: string; line: number; text: string }> =
        [];
      for (const filePath of files) {
        const content = readFileSync(filePath, 'utf-8');
        re.lastIndex = 0;
        if (!re.test(content)) {
          re.lastIndex = 0;
          continue;
        }
        re.lastIndex = 0;
        const basename = filePath.split('/').pop() ?? filePath;
        if (FIREWALL_ALLOWLIST.has(basename)) continue;
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (re.test(line)) {
            violations.push({
              file: basename,
              line: i + 1,
              text: line.trim()
            });
          }
          re.lastIndex = 0;
        }
      }
      if (violations.length > 0) {
        const lines = violations.map(
          (v) =>
            `  ${v.file}:${v.line}\n    ${v.text}\n    → use v.filteredShared.* or add ${v.file} to FIREWALL_ALLOWLIST (with a maxReads budget) after auditing the coord gate`
        );
        throw new Error(
          `Q-LT4 firewall violations (${name} outside allowlist):\n${lines.join('\n')}`
        );
      }
      expect(violations).toEqual([]);
    }
  );

  it('still tripwires on synthesizedPcs (back-compat marker)', () => {
    expect(PATTERN_SYNTHESIZED_PCS.source).toContain('synthesizedPcs');
  });

  // #410 (Architect B3): the count-ratchet.  An allowlisted file is
  // permitted to read v.shared.<DM-only> directly, but it may NOT GROW
  // its read count without a deliberate audit + budget bump.  This
  // restores in-file protection to the god-object the wholesale
  // allowlist previously left completely uncovered.
  it('allowlisted files do not grow their direct v.shared.* read count', () => {
    const files = listSrcFiles(join(__dirname));
    for (const [basename, budget] of FIREWALL_ALLOWLIST) {
      const filePath = files.find(
        (f) => (f.split('/').pop() ?? f) === basename
      );
      expect(filePath, `allowlisted file ${basename} not found`).toBeDefined();
      const content = readFileSync(filePath!, 'utf-8');
      let count = 0;
      for (const { re } of FIREWALL_PATTERNS) {
        re.lastIndex = 0;
        const matches = content.match(re);
        count += matches ? matches.length : 0;
        re.lastIndex = 0;
      }
      expect(
        count,
        `${basename} now has ${count} direct v.shared.<DM-only> reads ` +
          `(budget ${budget.maxReads}).  A NEW read was added: audit its ` +
          `coord-gating, then bump maxReads (or use v.filteredShared.*).  ` +
          `${budget.note}`
      ).toBeLessThanOrEqual(budget.maxReads);
    }
  });
});

/**
 * #406 (2026-05-28): make the lint SELF-COMPLETING for the
 * wholesale-wipe category.  Rather than trust the hand-maintained
 * FIREWALL_PATTERNS list, derive the set of DM-only state objects that
 * `filterForViewer` actually wipes-to-empty for a non-coord viewer
 * (the unambiguous "this whole object is DM-only" signal), and assert
 * BOTH that the wipe set matches an expected list (so a NEW wipe trips
 * this test → forces human review) AND that every wiped object has a
 * `v.shared.<key>` lint pattern (so it can't silently escape Q-LT4).
 */
describe('#406 firewall lint is self-completing for wholesale-wiped objects', () => {
  /** The DM-only state objects filterForViewer wipes to empty.  If you
   *  add/remove a wholesale wipe in filterForViewer, update this list
   *  AND add a FIREWALL_PATTERNS entry — the assertions below enforce
   *  both. */
  const EXPECTED_WHOLESALE_WIPED = [
    'threadDebt',
    'pinnedNpcs',
    'scratchNotes',
    'aiAudit',
    'casterState',
    'pcAccidentalGrants',
    'diffProposals',
    'dmClocks',
    'pcBondProposals'
  ].sort();

  function isEmptyContainer(v: unknown): boolean {
    if (Array.isArray(v)) return v.length === 0;
    if (v && typeof v === 'object') {
      return Object.keys(v as Record<string, unknown>).length === 0;
    }
    return false;
  }

  /** Build a saturated state where every known DM-only object is
   *  NON-empty.  These keys are wiped-not-read by filterForViewer, so
   *  cast dummies are safe (their contents are never inspected). */
  function saturatedState(): SessionState {
    const s = emptyState() as unknown as Record<string, unknown>;
    s.coordinator = 'dm';
    s.threadDebt = { pc1: 'noticed' };
    s.pinnedNpcs = ['npc1'];
    s.scratchNotes = [{ peerId: 'dm', ts: 1, text: 'x' }];
    s.aiAudit = [{ peerId: 'dm', ts: 1, kind: 'prompt' }];
    s.casterState = { pc1: { ladderState: 'noticed', taxActive: false, spamCount: 0 } };
    s.pcAccidentalGrants = { pc1: [{ ts: 1, note: 'x' }] };
    s.diffProposals = [{ id: 'd1' }];
    s.dmClocks = { c1: { name: 'x', filled: 0, segments: 4 } };
    s.pcBondProposals = { pc1: [{ text: 'x' }] };
    return s as unknown as SessionState;
  }

  it('the set filterForViewer wipes matches the expected list (tripwire on wipe-list change)', () => {
    const state = saturatedState();
    const coordView = filterForViewer(state, 'dm'); // identity (coordinator)
    const playerView = filterForViewer(state, 'alice'); // stripped
    const wiped: string[] = [];
    for (const key of Object.keys(coordView as unknown as Record<string, unknown>)) {
      const before = (coordView as unknown as Record<string, unknown>)[key];
      const after = (playerView as unknown as Record<string, unknown>)[key];
      if (!isEmptyContainer(before) && isEmptyContainer(after)) {
        wiped.push(key);
      }
    }
    expect(wiped.sort()).toEqual(EXPECTED_WHOLESALE_WIPED);
  });

  it('every wholesale-wiped object has a v.shared.<key> lint pattern', () => {
    const patternNames = new Set(FIREWALL_PATTERNS.map((p) => p.name));
    const missing = EXPECTED_WHOLESALE_WIPED.filter(
      (key) => !patternNames.has(`v.shared.${key}`)
    );
    expect(
      missing,
      `wholesale-wiped DM-only objects with no Q-LT4 lint pattern: ${missing.join(', ')}`
    ).toEqual([]);
  });
});
