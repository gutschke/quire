import { describe, it, expect } from 'vitest';
import {
  parseDiceCommand,
  rollDice,
  formatRoll,
  type DiceCommand,
  type DiceRoll
} from './dice';

function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('parseDiceCommand', () => {
  it('parses bare 2d6', () => {
    const cmd = parseDiceCommand('2d6');
    expect(cmd).toEqual<DiceCommand>({
      count: 2,
      sides: 6,
      modifier: 0,
      note: undefined
    });
  });

  it('parses 2d6+1', () => {
    expect(parseDiceCommand('2d6+1')).toEqual<DiceCommand>({
      count: 2,
      sides: 6,
      modifier: 1,
      note: undefined
    });
  });

  it('parses 2d6-2', () => {
    expect(parseDiceCommand('2d6-2')).toEqual<DiceCommand>({
      count: 2,
      sides: 6,
      modifier: -2,
      note: undefined
    });
  });

  it('parses 1d20', () => {
    expect(parseDiceCommand('1d20')).toEqual<DiceCommand>({
      count: 1,
      sides: 20,
      modifier: 0,
      note: undefined
    });
  });

  it('parses a stat keyword and attaches it to note', () => {
    const cmd = parseDiceCommand('2d6+1 stress');
    expect(cmd?.note).toBe('stress');
    expect(cmd?.modifier).toBe(1);
  });

  it('tolerates whitespace around tokens', () => {
    expect(parseDiceCommand('  2d6 + 1  ')).toEqual<DiceCommand>({
      count: 2,
      sides: 6,
      modifier: 1,
      note: undefined
    });
  });

  it('strips a leading /roll', () => {
    expect(parseDiceCommand('/roll 2d6+1')).toEqual<DiceCommand>({
      count: 2,
      sides: 6,
      modifier: 1,
      note: undefined
    });
  });

  it('strips a leading /r as the short alias', () => {
    expect(parseDiceCommand('/r 1d20')).toEqual<DiceCommand>({
      count: 1,
      sides: 20,
      modifier: 0,
      note: undefined
    });
  });

  it('rejects nonsense', () => {
    expect(parseDiceCommand('hello')).toBeNull();
    expect(parseDiceCommand('')).toBeNull();
    expect(parseDiceCommand('2x6')).toBeNull();
  });

  it('rejects zero or negative counts', () => {
    expect(parseDiceCommand('0d6')).toBeNull();
    expect(parseDiceCommand('-1d6')).toBeNull();
  });

  it('rejects absurd dice counts (DoS guard)', () => {
    expect(parseDiceCommand('1000d6')).toBeNull();
    expect(parseDiceCommand('1d10000')).toBeNull();
  });
});

describe('rollDice', () => {
  it('returns count rolls each in [1, sides]', () => {
    const roll = rollDice(
      { count: 4, sides: 6, modifier: 0, note: undefined },
      Math.random
    );
    expect(roll.rolls).toHaveLength(4);
    for (const v of roll.rolls) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
    }
  });

  it('sums rolls + modifier into total', () => {
    const roll = rollDice(
      { count: 2, sides: 6, modifier: 3, note: undefined },
      seededRng(42)
    );
    const sum = roll.rolls.reduce((a, b) => a + b, 0);
    expect(roll.total).toBe(sum + 3);
    expect(roll.modifier).toBe(3);
  });

  it('classifies 2d6 outcome by Quire tiers', () => {
    // Fully determined via custom rng:
    const sevenPlus = rollDice(
      { count: 2, sides: 6, modifier: 0, note: undefined },
      () => 0.99 // both dice => 6
    );
    expect(sevenPlus.tier).toBe('strong'); // 12 ≥ 10 → strong hit

    const partial = rollDice(
      { count: 2, sides: 6, modifier: 0, note: undefined },
      seededRng(7)
    );
    expect(['miss', 'partial', 'strong']).toContain(partial.tier);

    const miss = rollDice(
      { count: 2, sides: 6, modifier: 0, note: undefined },
      () => 0 // both dice => 1, total 2
    );
    expect(miss.tier).toBe('miss');
  });

  it('does not assign a tier for non-2d6 commands', () => {
    const r = rollDice(
      { count: 1, sides: 20, modifier: 0, note: undefined },
      () => 0.5
    );
    expect(r.tier).toBeUndefined();
  });

  it('is deterministic given the same rng', () => {
    const cmd: DiceCommand = {
      count: 3,
      sides: 6,
      modifier: 0,
      note: undefined
    };
    const a = rollDice(cmd, seededRng(99));
    const b = rollDice(cmd, seededRng(99));
    expect(a.rolls).toEqual(b.rolls);
    expect(a.total).toBe(b.total);
  });
});

describe('formatRoll', () => {
  it('shows individual dice, modifier, and total', () => {
    const roll: DiceRoll = {
      command: { count: 2, sides: 6, modifier: 1, note: undefined },
      rolls: [4, 5],
      modifier: 1,
      total: 10,
      tier: 'strong'
    };
    const out = formatRoll(roll);
    expect(out).toContain('2d6+1');
    expect(out).toContain('[4, 5]');
    expect(out).toContain('= 10');
    expect(out).toContain('strong');
  });

  it('omits +0 modifier', () => {
    const roll: DiceRoll = {
      command: { count: 2, sides: 6, modifier: 0, note: undefined },
      rolls: [3, 3],
      modifier: 0,
      total: 6,
      tier: 'miss'
    };
    expect(formatRoll(roll)).toContain('2d6');
    expect(formatRoll(roll)).not.toContain('+0');
  });

  it('shows negative modifier with a minus sign', () => {
    const roll: DiceRoll = {
      command: { count: 2, sides: 6, modifier: -2, note: undefined },
      rolls: [3, 4],
      modifier: -2,
      total: 5,
      tier: 'miss'
    };
    expect(formatRoll(roll)).toContain('2d6-2');
  });

  it('includes the note if present', () => {
    const roll: DiceRoll = {
      command: { count: 2, sides: 6, modifier: 0, note: 'stress' },
      rolls: [2, 5],
      modifier: 0,
      total: 7,
      tier: 'partial'
    };
    expect(formatRoll(roll)).toContain('stress');
  });
});
