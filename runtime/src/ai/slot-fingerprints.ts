/**
 * 2026-06-06: campaign slot-fingerprint extractor.
 *
 * The campaign's narrative addresses each PC by slot index — the
 * scenes (and DM docs) include `{{pc:N}}` references that name the
 * player who should be doing a specific thing.  Example from
 * Underleaf episode 1 scene 3:
 *
 *   "{{pc:3}} (radio hobbyist) notices the plane's avionics
 *    health is degrading."
 *   "{{pc:3}} carries a small SDR (software-defined radio)…"
 *
 * The script-author wrote these BEFORE chargen ran, so the
 * "fingerprint" of each slot (what role it implies, what props it
 * carries, what character traits it telegraphs) is a property of
 * the CAMPAIGN, not of any specific player.  After chargen the DM
 * can use the fingerprints to decide which (player+PC) pair should
 * carry which slot label.
 *
 * This module is the input bundle that lets the AI propose a
 * realignment with grounding in the script the author actually
 * wrote — rather than a vibes-only read on chat samples.
 *
 * Pure data transformation: takes a list of (path, body) tuples
 * the caller already fetched, scans for `{{pc:N}}` matches with
 * ~200 chars of surrounding context, and bundles per-slot.  Spoiler
 * firewall is the caller's responsibility — the bundle here is
 * data-only; the caller decides which files (player-facing vs DM-
 * only) to include.
 */

export interface SlotFingerprintExcerpt {
  /** Episode-relative path the excerpt comes from. */
  path: string;
  /** Snippet of surrounding text (~200 chars). */
  excerpt: string;
}

export interface SlotFingerprint {
  slot: number;
  /** Number of `{{pc:N}}` references found across all sources. */
  mentions: number;
  /**
   * Up to ~6 excerpts per slot, each with ~200 chars of context.
   * Excerpts span scenes + DM docs — author's intent often shows
   * cleanest in the DM-only docs (e.g., `dm/the-gate.md`).
   */
  excerpts: SlotFingerprintExcerpt[];
}

/**
 * Regex matching `{{pc:N}}` where N is a positive integer.  Mirror
 * the same pattern as `markdown.ts:substitutePcSlots` to stay in
 * sync.
 */
const PC_SLOT_RE = /\{\{pc:([1-9]\d*)\}\}/g;

const CONTEXT_RADIUS = 100; // chars on each side; ~200 total

const MAX_EXCERPTS_PER_SLOT = 6;

export interface SourceDoc {
  path: string;
  body: string;
}

/**
 * Scan a batch of campaign markdown docs for `{{pc:N}}` references
 * and bundle per-slot.  Excerpts are deduplicated (same path + same
 * slot keeps only the first ~6 hits) and trimmed to the radius.
 *
 * Returns a sorted-ascending list of SlotFingerprint, one per
 * slot N that appears at least once.  Empty list when no campaign
 * file references any slot.
 */
export function extractSlotFingerprints(
  docs: ReadonlyArray<SourceDoc>
): SlotFingerprint[] {
  const bySlot = new Map<number, SlotFingerprint>();
  for (const doc of docs) {
    let m: RegExpExecArray | null;
    PC_SLOT_RE.lastIndex = 0;
    while ((m = PC_SLOT_RE.exec(doc.body)) !== null) {
      const slot = Number(m[1]);
      if (!Number.isFinite(slot)) continue;
      let entry = bySlot.get(slot);
      if (!entry) {
        entry = { slot, mentions: 0, excerpts: [] };
        bySlot.set(slot, entry);
      }
      entry.mentions += 1;
      if (entry.excerpts.length < MAX_EXCERPTS_PER_SLOT) {
        const start = Math.max(0, m.index - CONTEXT_RADIUS);
        const end = Math.min(doc.body.length, m.index + m[0].length + CONTEXT_RADIUS);
        const raw = doc.body
          .slice(start, end)
          .replace(/\s+/g, ' ')
          .trim();
        entry.excerpts.push({ path: doc.path, excerpt: raw });
      }
    }
  }
  return Array.from(bySlot.values()).sort((a, b) => a.slot - b.slot);
}
