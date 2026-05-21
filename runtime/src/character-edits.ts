/**
 * Apply a flat key→value edits map to a base CharacterRecord and return
 * a new record with the overrides applied.  This is the read-side of
 * the multiplayer pc-edit flow: the EventLog stores each edit as
 * `{ pcId, field, value }`, the materializer aggregates into
 * `pcEdits[pcId][field]`, and this helper merges that map back into the
 * loaded record before render.
 *
 * Supported field keys:
 *
 *   stats.str / stats.dex / stats.con / stats.int / stats.wis / stats.cha
 *   harm
 *   stress
 *   advancements
 *   marks
 *
 * Unknown keys are silently ignored — forward-compatible with future
 * schema additions while keeping the renderer from blowing up on data
 * authored by a newer client.
 *
 * Values that have the wrong shape (e.g. a string where a number is
 * expected) are also ignored.  This is defense-in-depth: peers we
 * don't trust shouldn't be able to corrupt a sheet by sending
 * garbage.
 */

import type { CharacterRecord } from './character-loader';

const STAT_KEYS = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const TOP_NUMBER_KEYS = new Set(['harm', 'stress', 'advancements', 'marks']);

export const HARM_MAX = 4;
export const STRESS_MAX = 4;
export const STAT_MIN = -3;
export const STAT_MAX = 3;

export function applyCharacterEdits(
  record: CharacterRecord,
  edits: Record<string, unknown> | undefined
): CharacterRecord {
  if (!edits) return record;
  const keys = Object.keys(edits);
  if (keys.length === 0) return record;
  const out: CharacterRecord = {
    ...record,
    stats: record.stats ? { ...record.stats } : undefined
  };
  for (const key of keys) {
    const value = edits[key];
    if (key.startsWith('stats.')) {
      const sub = key.slice('stats.'.length);
      if (!STAT_KEYS.has(sub)) continue;
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      const clamped = clamp(value, STAT_MIN, STAT_MAX);
      out.stats = { ...(out.stats ?? {}), [sub]: clamped };
    } else if (TOP_NUMBER_KEYS.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      let clamped = value;
      if (key === 'harm') clamped = clamp(value, 0, HARM_MAX);
      else if (key === 'stress') clamped = clamp(value, 0, STRESS_MAX);
      else clamped = Math.max(0, Math.floor(value));
      (out as Record<string, unknown>)[key] = clamped;
    }
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
