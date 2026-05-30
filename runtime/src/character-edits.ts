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
 *   harm  /  stress  /  advancements  /  marks
 *   Phase B P1c (2026-05-23) additions:
 *     knowsTheyCanCast (bool)
 *     magicPhase (enum)
 *     moneyBand (enum)
 *     tax.active (bool) / tax.sessionsRemaining (uint) / tax.releaseMoment (string ≤200)
 *     threadDebt.rung (enum) / threadDebt.spamCount (uint)
 *     alignmentDrift.marks (uint ≤5) / alignmentDrift.lastUpdated (uint epoch-ms)
 *     markBullets.hardMoment / .learned / .risk / .against / .complication (bool)
 *
 * Unknown keys are silently ignored — forward-compatible with future
 * schema additions while keeping the renderer from blowing up on data
 * authored by a newer client.
 *
 * Values that have the wrong shape (e.g. a string where a number is
 * expected) are also ignored.  This is defense-in-depth: peers we
 * don't trust shouldn't be able to corrupt a sheet by sending
 * garbage.
 *
 * NOT covered yet (defer until a richer edit model lands):
 *   foci / inventory / conditions / languages / skills / tags /
 *   accidentalGrants / advancementHistory — these are arrays; LWW on
 *   the whole array works mechanically but has bad merge semantics
 *   when two peers edit concurrently.  Need add/remove ops.
 */

import type {
  CharacterRecord,
  MagicPhase,
  MoneyBand,
  ThreadDebtRung
} from './character-loader';
import { ADVANCEMENT_CAP } from './character-loader';

const STAT_KEYS = new Set(['str', 'dex', 'con', 'int', 'wis', 'cha']);
const TOP_NUMBER_KEYS = new Set(['harm', 'stress', 'advancements', 'marks']);

export const HARM_MAX = 4;
export const STRESS_MAX = 4;
export const STAT_MIN = -3;
export const STAT_MAX = 3;
/**
 * OP-044 (2026-05-30 run #12): per rules.md:157 "every 5 marks, the
 * PC may take one advancement" — the marks counter is the 0..5
 * accumulator that resets when an advancement is taken.  Cap
 * defensively at 5 so a malformed pc-edit can't push marks above
 * the rules-grounded ceiling.
 */
export const MARKS_MAX = 5;

// Phase B P1c: enums + bullets sets used by the per-field validation.
const MAGIC_PHASES = new Set<MagicPhase>([
  'accidental',
  'realization',
  'tax',
  'free'
]);
const MONEY_BANDS = new Set<MoneyBand>([
  'broke',
  'tight',
  'comfortable',
  'well-off',
  'wealthy'
]);
const THREAD_DEBT_RUNGS = new Set<ThreadDebtRung>([
  'quiet',
  'noticed',
  'watched',
  'pushing-back',
  'hunted'
]);
const MARK_BULLET_KEYS = new Set([
  'hardMoment',
  'learned',
  'risk',
  'against',
  'complication'
]);

/** Phase B P1c: cap on `releaseMoment` text and similar bounded
 *  string fields written via pc-edit.  Same order-of-magnitude as
 *  AccidentalGrant.note. */
const PC_EDIT_TEXT_FIELD_MAX = 200;

/** Task #295 (2026-05-25): cap on the DM's private soft-notes
 *  textarea on accepted PCs.  Generous enough for a few paragraphs
 *  of "remember to..." / "their sister is the antagonist" prose;
 *  bounded so a bug in a future AI-write path can't balloon state.
 *  Mirrors the order-of-magnitude of CHAT_MAX_LENGTH × 4. */
export const DM_NOTES_MAX = 2000;

export function applyCharacterEdits(
  record: CharacterRecord,
  edits: Record<string, unknown> | undefined
): CharacterRecord {
  if (!edits) return record;
  const keys = Object.keys(edits);
  if (keys.length === 0) return record;
  // Phase B P1c+ (regression-fix 2026-05-23): originally cloned
  // tax / threadDebt / alignmentDrift / markBullets up-front for
  // sub-field writes — but that introduced `tax: undefined`,
  // `threadDebt: undefined`, etc. KEYS on EVERY effective-character
  // record, even when the source didn't have them.  Downstream
  // consumers that do `'tax' in record` or iterate `Object.keys`
  // saw new keys, which surfaced as a render-breaking regression
  // when the user loaded a packed character on the deployed build
  // 75792d5.  Fix: clone only `stats` up-front (existed before);
  // clone the object sub-fields LAZILY only when an edit actually
  // writes into them (the per-key branches below check first).
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
      // OP-044: clamp advancements + marks to their rules-grounded
      // ceilings (8 and 5 respectively per rules.md:157,166).  The
      // render layer self-protects via `>= ADVANCEMENT_CAP` chips
      // but the engine accepting over-cap values is a latent defect.
      else if (key === 'advancements') {
        clamped = clamp(Math.floor(value), 0, ADVANCEMENT_CAP);
      } else if (key === 'marks') {
        clamped = clamp(Math.floor(value), 0, MARKS_MAX);
      } else clamped = Math.max(0, Math.floor(value));
      (out as unknown as Record<string, unknown>)[key] = clamped;
    } else if (key === 'knowsTheyCanCast') {
      if (typeof value !== 'boolean') continue;
      out.knowsTheyCanCast = value;
    } else if (key === 'magicPhase') {
      if (typeof value !== 'string') continue;
      if (!MAGIC_PHASES.has(value as MagicPhase)) continue;
      out.magicPhase = value as MagicPhase;
    } else if (key === 'moneyBand') {
      if (typeof value !== 'string') continue;
      if (!MONEY_BANDS.has(value as MoneyBand)) continue;
      out.moneyBand = value as MoneyBand;
    } else if (key.startsWith('tax.')) {
      const sub = key.slice('tax.'.length);
      // Lazy-clone: only when this edit actually writes a valid
      // value.  Avoids creating `tax: {active: false}` on every
      // record that has no tax field at all.
      if (sub === 'active' && typeof value === 'boolean') {
        out.tax = { ...(out.tax ?? { active: false }), active: value };
      } else if (
        sub === 'sessionsRemaining' &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        out.tax = {
          ...(out.tax ?? { active: false }),
          sessionsRemaining: Math.max(0, Math.floor(value))
        };
      } else if (
        sub === 'releaseMoment' &&
        typeof value === 'string' &&
        value.length <= PC_EDIT_TEXT_FIELD_MAX
      ) {
        out.tax = {
          ...(out.tax ?? { active: false }),
          releaseMoment: value
        };
      }
    } else if (key.startsWith('threadDebt.')) {
      const sub = key.slice('threadDebt.'.length);
      if (sub === 'rung' && typeof value === 'string') {
        if (THREAD_DEBT_RUNGS.has(value as ThreadDebtRung)) {
          out.threadDebt = {
            ...(out.threadDebt ?? { rung: 'quiet' }),
            rung: value as ThreadDebtRung
          };
        }
      } else if (
        sub === 'spamCount' &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        out.threadDebt = {
          ...(out.threadDebt ?? { rung: 'quiet' }),
          spamCount: Math.max(0, Math.floor(value))
        };
      }
    } else if (key.startsWith('alignmentDrift.')) {
      const sub = key.slice('alignmentDrift.'.length);
      if (
        sub === 'marks' &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        out.alignmentDrift = {
          ...(out.alignmentDrift ?? { marks: 0 }),
          marks: clamp(value, 0, 5)
        };
      } else if (
        sub === 'lastUpdated' &&
        typeof value === 'number' &&
        Number.isFinite(value)
      ) {
        out.alignmentDrift = {
          ...(out.alignmentDrift ?? { marks: 0 }),
          lastUpdated: Math.max(0, Math.floor(value))
        };
      }
    } else if (key.startsWith('markBullets.')) {
      const sub = key.slice('markBullets.'.length);
      if (!MARK_BULLET_KEYS.has(sub)) continue;
      if (typeof value !== 'boolean') continue;
      out.markBullets = { ...(out.markBullets ?? {}), [sub]: value };
    } else if (key === 'dmNotes') {
      // Task #295: DM-private soft-notes.  Free-text string; capped
      // at DM_NOTES_MAX chars so the materialized state stays
      // bounded.  Empty string is a valid edit (clears the notes);
      // null / non-string values are ignored.  The viewer-scope
      // projection in core/state.ts wipes this overlay from the
      // player-bound pcEdits, mirroring the same wipe applied to
      // synthesizedPcs[*].dmNotes — defense-in-depth so a player
      // peer never sees the DM's private text.
      if (typeof value !== 'string') continue;
      if (value.length > DM_NOTES_MAX) continue;
      out.dmNotes = value;
    }
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Math.round(n)));
}
