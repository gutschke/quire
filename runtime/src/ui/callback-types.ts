/**
 * Shared UI callback types — Wave C3 (2026-05-26).
 *
 * Before this extraction, several callback shapes were re-declared
 * verbatim in 2-4 region files each (NavigateCallback in 4 places,
 * DisplayNameLookup in 3, AddSeatCallback / BumpStatCallback in 2).
 * The duplication was harmless until the engineering audit on
 * 2026-05-26 flagged that a SAME-NAMED RetirePcCallback existed
 * with two DIVERGENT shapes — `(slot) => void` in stage-roster
 * vs. an object payload in chargen-dm-review — which is the kind
 * of name-collision that silently routes a payload mismatch into
 * runtime.
 *
 * This file is the single source-of-truth for callback shapes
 * that ANY region might want.  Region files re-export from here
 * (so existing imports of `RegionFooCallback` keep working
 * locally) but only one definition exists.
 *
 * **When adding a new region callback, put it here first** — if
 * the shape collides with an existing one, prefer to extend the
 * existing type rather than coin a new same-named one.
 */

import type { AppRoute } from '../routing';

/**
 * Navigation callback for in-app routing.  Used by Rail / Aside /
 * Stage regions when the DM clicks a scene/PC/NPC link.  Event
 * argument is the originating click event so the region can call
 * `preventDefault()` + decide whether to honor modifier keys.
 */
export type NavigateCallback = (e: Event, route: AppRoute) => void;

/**
 * Resolve a pcId to its currently-known display name.  Returns
 * null when the character file hasn't loaded yet — the region
 * renders the raw pcId in that case and a subsequent render
 * after the lazy load shows the name.
 */
export type DisplayNameLookup = (pcId: string) => string | null;

/**
 * Add the next-unused seat slot to the roster.  Returns the
 * allocated slot number on success, null when no slot could be
 * allocated (cap reached, no session, etc.).
 */
export type AddSeatCallback = () => number | null;

/**
 * Bump a stat field by `delta`.  Used by the player rail and the
 * stat-grid primitive for inline stat-edit affordances.  `pcId`
 * is the target PC; `key` is the lowercase stat key
 * (str/dex/con/int/wis/cha); `current` is the value the UI
 * computed the bump against (caller passes its current snapshot
 * so the dispatch is race-free against fast-fire clicks); `delta`
 * is +1 or -1.
 */
export type BumpStatCallback = (
  pcId: string,
  key: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha',
  current: number,
  delta: number
) => void;

/**
 * Stage-roster's "retire this seat" affordance.  Just opens the
 * retire dialog for the slot — the actual commit (with reason,
 * in-fiction text, optional seat memory) flows through a separate
 * payload-shaped callback (see RetirePcCommitCallback below).
 *
 * Renamed from RetirePcCallback (the divergent stage-roster
 * declaration) to disambiguate from the commit-shaped callback
 * used by chargen-dm-review.
 */
export type RetireSeatRequestCallback = (slot: number) => void;

/**
 * Chargen-dm-review's "commit the retire" callback.  Carries the
 * full DM-authored payload (in-fiction reason + DM-private reason
 * enum + optional scene id + optional seat memory).  Returns true
 * on append, false when off-session / non-coord / payload invalid.
 *
 * This is the OTHER shape that used to share the name
 * `RetirePcCallback` — kept under a clearer name so the two
 * surfaces never accidentally route the wrong payload.
 */
export type RetirePcCommitCallback = (payload: {
  pcId: string;
  inFictionReason: string;
  reason: 'died' | 'departed' | 'converted-to-npc' | 'other';
  scene?: string;
  seatMemory?: string;
}) => boolean;
