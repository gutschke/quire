// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';

function mountApp(): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  document.body.appendChild(el);
  return el;
}

describe('QuireApp dice integration', () => {
  it('adds a roll to history on submit', () => {
    const app = mountApp();
    app.rngForRoll = () => 0.5;
    const roll = app.submitRoll('2d6+1');
    expect(roll).not.toBeNull();
    expect(app.rolls).toHaveLength(1);
    expect(app.rolls[0].total).toBe(roll!.total);
    expect(app.rollDraft).toBe('');
    expect(app.rollError).toBeNull();
  });

  it('records an error on garbage and leaves history empty', () => {
    const app = mountApp();
    const roll = app.submitRoll('not dice');
    expect(roll).toBeNull();
    expect(app.rollError).toMatch(/parse/i);
    expect(app.rolls).toHaveLength(0);
  });

  it('caps history at five most-recent rolls', () => {
    const app = mountApp();
    app.rngForRoll = () => 0.5;
    for (let i = 0; i < 7; i++) {
      app.submitRoll('1d6');
    }
    expect(app.rolls).toHaveLength(5);
  });

  it('newest roll appears first', () => {
    const app = mountApp();
    let n = 0;
    app.rngForRoll = () => {
      n += 0.15;
      return n % 1;
    };
    app.submitRoll('1d6');
    const firstTotal = app.rolls[0].total;
    app.submitRoll('1d20');
    expect(app.rolls[0].command.sides).toBe(20);
    expect(app.rolls[1].command.sides).toBe(6);
    expect(app.rolls[1].total).toBe(firstTotal);
  });
});
