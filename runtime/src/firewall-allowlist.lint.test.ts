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
 * Files allowed to read `v.shared.synthesizedPcs` directly.
 * Each entry must be coord-gated (`isCoordinator()` check upstream)
 * before reaching the read.  Drift = audit the file and add it
 * here, OR refactor to `v.filteredShared.synthesizedPcs`.
 */
const FIREWALL_ALLOWLIST_FILES: ReadonlySet<string> = new Set([
  // `renderSessionOpenStage` reads DM-only sub-fields (tax,
  // threadDebt, alignmentDrift) for the carryover-card display;
  // the function early-returns `!isCoordinator()` before reaching
  // any v.shared read.  See quire-app.ts:1683.
  'quire-app.ts',
  // promoteNpcToPc + the chargen-controller pcSlots derivation —
  // both run in coord-only host methods.  promote-npc emits new
  // pc-create + seat-add + pc-slot-bind events on coord author.
  // chargen-controller's read is for slot allocation (coord only).
  'chargen-controller.ts'
]);

const PATTERN_SYNTHESIZED_PCS = /v\.shared\.synthesizedPcs\b/g;

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

describe('Q-LT4 firewall allowlist — v.shared.synthesizedPcs', () => {
  it('no production file outside the allowlist reads v.shared.synthesizedPcs directly', () => {
    const srcRoot = join(__dirname);
    const files = listSrcFiles(srcRoot);
    const violations: Array<{ file: string; line: number; text: string }> = [];
    for (const filePath of files) {
      const content = readFileSync(filePath, 'utf-8');
      if (!PATTERN_SYNTHESIZED_PCS.test(content)) {
        PATTERN_SYNTHESIZED_PCS.lastIndex = 0;
        continue;
      }
      PATTERN_SYNTHESIZED_PCS.lastIndex = 0;
      const basename = filePath.split('/').pop() ?? filePath;
      if (FIREWALL_ALLOWLIST_FILES.has(basename)) continue;
      // Collect line+text for the error report.
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (PATTERN_SYNTHESIZED_PCS.test(line)) {
          violations.push({
            file: basename,
            line: i + 1,
            text: line.trim()
          });
        }
        PATTERN_SYNTHESIZED_PCS.lastIndex = 0;
      }
    }
    if (violations.length > 0) {
      const lines = violations.map(
        (v) =>
          `  ${v.file}:${v.line}\n    ${v.text}\n    → use v.filteredShared.synthesizedPcs, or add ${v.file} to FIREWALL_ALLOWLIST_FILES after auditing the coord gate`
      );
      throw new Error(
        `Q-LT4 firewall violations (v.shared.synthesizedPcs outside allowlist):\n${lines.join('\n')}`
      );
    }
    expect(violations).toEqual([]);
  });
});
