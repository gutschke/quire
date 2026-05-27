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

/**
 * Files allowed to read DM-only `v.shared.*` slots directly.
 * Each entry must be coord-gated (`isCoordinator()` check upstream)
 * before reaching the read, OR be reading a derived shape that
 * doesn't leak to the player projection.  Drift = audit the file
 * and add it here, OR refactor to `v.filteredShared.*`.
 */
const FIREWALL_ALLOWLIST_FILES: ReadonlySet<string> = new Set([
  // `renderSessionOpenStage` reads DM-only sub-fields (tax,
  // threadDebt, alignmentDrift) for the carryover-card display;
  // the function early-returns `!isCoordinator()` before reaching
  // any v.shared read.  See quire-app.ts:1683.
  // D5: pendingBondProposalCount reads v.shared.pcBondProposals
  // but gates on (isCoordinator OR controllerPeerId === peerId).
  // D5: buildPendingBondProposalsForDmAside is coord-only.
  'quire-app.ts',
  // promoteNpcToPc + the chargen-controller pcSlots derivation —
  // both run in coord-only host methods.  promote-npc emits new
  // pc-create + seat-add + pc-slot-bind events on coord author.
  // chargen-controller's read is for slot allocation (coord only).
  'chargen-controller.ts'
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
        if (FIREWALL_ALLOWLIST_FILES.has(basename)) continue;
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
            `  ${v.file}:${v.line}\n    ${v.text}\n    → use v.filteredShared.* or add ${v.file} to FIREWALL_ALLOWLIST_FILES after auditing the coord gate`
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
});
