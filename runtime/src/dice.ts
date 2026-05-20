/**
 * Dice helper for Quire's 2d6 (+stat) resolution and arbitrary side dice.
 *
 * Commands accepted by the parser:
 *
 *   2d6
 *   2d6+1
 *   2d6-2
 *   1d20
 *   2d6+1 stress           (anything after the dice string is a note)
 *   /roll 2d6+1
 *   /r 2d6+1               (short alias)
 *
 * The 2d6 path is the canonical Quire resolution; rollDice attaches a
 * Quire tier (miss / partial / strong) only when the command is exactly
 * 2d6 (+ modifier). Other dice are just totaled.
 */

export type DiceTier = 'miss' | 'partial' | 'strong';

export interface DiceCommand {
  count: number;
  sides: number;
  modifier: number;
  note: string | undefined;
}

export interface DiceRoll {
  command: DiceCommand;
  rolls: number[];
  modifier: number;
  total: number;
  tier?: DiceTier;
}

const MAX_COUNT = 100;
const MAX_SIDES = 1000;

const DICE_RE = /^(\d+)d(\d+)\s*(?:([+-])\s*(\d+))?(?:\s+(.+))?$/i;

export function parseDiceCommand(raw: string): DiceCommand | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (/^\/(?:roll|r)\b/i.test(s)) {
    s = s.replace(/^\/(?:roll|r)\s*/i, '');
  }
  if (!s) return null;
  s = s.replace(/\s*([+-])\s*/g, '$1');
  const m = DICE_RE.exec(s);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  const sides = parseInt(m[2], 10);
  const sign = m[3] === '-' ? -1 : 1;
  const modVal = m[4] ? parseInt(m[4], 10) : 0;
  const noteRaw = m[5]?.trim();
  if (count <= 0 || sides <= 1) return null;
  if (count > MAX_COUNT || sides > MAX_SIDES) return null;
  return {
    count,
    sides,
    modifier: sign * modVal,
    note: noteRaw && noteRaw.length > 0 ? noteRaw : undefined
  };
}

export function rollDice(
  command: DiceCommand,
  rng: () => number = Math.random
): DiceRoll {
  const rolls: number[] = [];
  for (let i = 0; i < command.count; i++) {
    const r = Math.floor(rng() * command.sides) + 1;
    rolls.push(r);
  }
  const sum = rolls.reduce((a, b) => a + b, 0);
  const total = sum + command.modifier;
  const tier =
    command.count === 2 && command.sides === 6 ? tierFor(total) : undefined;
  return { command, rolls, modifier: command.modifier, total, tier };
}

function tierFor(total: number): DiceTier {
  if (total >= 10) return 'strong';
  if (total >= 7) return 'partial';
  return 'miss';
}

export function formatCommand(cmd: DiceCommand): string {
  const mod =
    cmd.modifier === 0
      ? ''
      : cmd.modifier > 0
        ? `+${cmd.modifier}`
        : `${cmd.modifier}`;
  return `${cmd.count}d${cmd.sides}${mod}`;
}

export function formatRoll(roll: DiceRoll): string {
  const head = formatCommand(roll.command);
  const dice = `[${roll.rolls.join(', ')}]`;
  const note = roll.command.note ? ` (${roll.command.note})` : '';
  const tier = roll.tier ? ` — ${roll.tier}` : '';
  return `${head}${note}: ${dice} = ${roll.total}${tier}`;
}
