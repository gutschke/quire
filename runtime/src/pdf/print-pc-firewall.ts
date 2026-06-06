/**
 * Pre-render firewall for the PDF generator.
 *
 * Two audiences:
 *
 *   - `player` — what a player should see on a printed sheet.  Two
 *     scrub strengths controlled by `selfExport`:
 *       * selfExport=true (DEFAULT — the player whose PC this is):
 *         narrow scrub.  Strips DM-private metadata (dmNotes,
 *         accidentalGrants, threadDebt, alignmentDrift, magicPhase,
 *         per-bond dmNotes, foci[].notes).  PRESERVES self-knowledge:
 *         `knowsTheyCanCast` and `tax` (after Realization the player
 *         knows; rules.md:174-188).
 *       * selfExport=false (cross-PC export — someone else's PC):
 *         broader scrub.  ALSO strips knowsTheyCanCast and tax so
 *         one player can't see another PC's magic state.  Aligns
 *         with `DM_ONLY_CHARACTER_FIELDS` for cross-PC viewing.
 *
 *   - `dm` — the full record with no strip.  The DM page-2 dossier
 *     surfaces the DM-private fields.
 *
 * Defense-in-depth: in production an other-player's record reaching
 * the renderer is already cross-PC stripped at the state layer.  The
 * `selfExport=false` strip is a no-op on already-stripped data; the
 * value is that the PDF code self-describes the firewall and a
 * future state-layer regression doesn't silently leak through this
 * surface.
 */

import type { Bond, CharacterRecord } from '../character-loader';

export type Audience = 'player' | 'dm';

/**
 * DM-private metadata fields stripped from EVERY player-audience
 * PDF, regardless of selfExport.  These are author-side notes the
 * PC's own player should not see about themselves either.
 */
export const PDF_PLAYER_STRIP_FIELDS = [
  'magicPhase',
  'threadDebt',
  'accidentalGrants',
  'alignmentDrift',
  'dmNotes'
] as const satisfies ReadonlyArray<keyof CharacterRecord>;

/**
 * Additional fields stripped when `selfExport === false` — these
 * are fields the OWN player legitimately knows about themselves
 * (after Realization) but another player MUST NOT see about a
 * sibling PC.  When the PDF code is asked to render a record the
 * caller cannot vouch is the caller's own, set selfExport=false.
 */
export const PDF_CROSS_PC_STRIP_FIELDS = [
  'knowsTheyCanCast',
  'tax'
] as const satisfies ReadonlyArray<keyof CharacterRecord>;

export function scrubForAudience(
  pc: CharacterRecord,
  audience: Audience,
  selfExport = true
): CharacterRecord {
  if (audience === 'dm') return pc;
  const out: CharacterRecord = { ...pc };
  for (const field of PDF_PLAYER_STRIP_FIELDS) {
    delete (out as unknown as Record<string, unknown>)[field];
  }
  if (!selfExport) {
    for (const field of PDF_CROSS_PC_STRIP_FIELDS) {
      delete (out as unknown as Record<string, unknown>)[field];
    }
  }
  if (Array.isArray(out.bonds)) {
    out.bonds = out.bonds.map(
      (b: Bond): Bond => ({ targetPcId: b.targetPcId, text: b.text })
    );
  }
  if (Array.isArray(out.foci)) {
    out.foci = out.foci.map((f) => {
      const safe = { ...f };
      delete (safe as { notes?: unknown }).notes;
      return safe;
    });
  }
  return out;
}
