/**
 * Pre-render firewall for the PDF generator.
 *
 * Two audiences:
 *
 *   - `player` — what the player whose PC this is should see on a
 *     printed sheet at the table.  Strips DM-PRIVATE metadata (the
 *     DM's notes about the PC, the antagonist-attention ladder, the
 *     accidental-grants log, alignment drift, the magic-phase enum
 *     itself, and per-bond DM annotations).  PRESERVES self-
 *     knowledge: `knowsTheyCanCast` (after Realization, the player
 *     knows — see rules.md:174-188 + memory `feedback_engineering_
 *     practices_from_reviews.md` post-Realization legibility fix) and
 *     `tax` (the player feels the -2 in fiction).
 *
 *   - `dm` — the full record with no strip.  The DM page-2 dossier
 *     surfaces the DM-private fields.
 *
 * This is INTENTIONALLY narrower than `stripDmOnlyFromCharacter` in
 * character-loader.ts.  That projection is for "other players viewing
 * this PC" (cross-PC firewall) and strips knowsTheyCanCast etc to
 * hide one PC's magic state from another player.  For a printable
 * sheet the canonical use case is the PC's OWN player exporting it —
 * in which case self-knowledge must come through.  Other-PC exports
 * already received a further-scrubbed projection in their local
 * state, so this narrower strip is a no-op on already-scrubbed data.
 */

import type { Bond, CharacterRecord } from '../character-loader';

export type Audience = 'player' | 'dm';

/**
 * DM-private metadata fields stripped from player-audience PDFs.
 * Narrower than `DM_ONLY_CHARACTER_FIELDS` — see file header.
 */
export const PDF_PLAYER_STRIP_FIELDS = [
  'magicPhase',
  'threadDebt',
  'accidentalGrants',
  'alignmentDrift',
  'dmNotes'
] as const satisfies ReadonlyArray<keyof CharacterRecord>;

export function scrubForAudience(
  pc: CharacterRecord,
  audience: Audience
): CharacterRecord {
  if (audience === 'dm') return pc;
  const out: CharacterRecord = { ...pc };
  for (const field of PDF_PLAYER_STRIP_FIELDS) {
    delete (out as unknown as Record<string, unknown>)[field];
  }
  if (Array.isArray(out.bonds)) {
    out.bonds = out.bonds.map(
      (b: Bond): Bond => ({ targetPcId: b.targetPcId, text: b.text })
    );
  }
  // v1.1 (adversarial NIT P1): foci[].notes carries DM-flavor text
  // in fixtures (e.g., Rae's "broke during the Pier 14 cast" reveals
  // the cast vocabulary pre-Realization).  Layout does not currently
  // render f.notes, but the firewall must strip it so a future
  // render-layer change cannot leak it.  Defense-in-depth.
  if (Array.isArray(out.foci)) {
    out.foci = out.foci.map((f) => {
      const safe = { ...f };
      delete (safe as { notes?: unknown }).notes;
      return safe;
    });
  }
  return out;
}
