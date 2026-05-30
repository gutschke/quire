// @vitest-environment happy-dom

/**
 * UX-MH-4 splitter controller — unit tests.
 *
 * Coverage:
 *   - persistence round-trip (read + write + clear)
 *   - bounds clamp (R-H + Adversarial P2 MH-4-A)
 *   - keyboard step (Arrow / Shift+Arrow / Home / End / Enter)
 *   - drag math (rail grows right, aside grows left)
 *   - default values match the spec (240/320/480 + 280/380/560)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  SplitterController,
  readPersistedLayout,
  writePersistedLayout,
  clearPersistedLayout,
  RAIL_AXIS,
  ASIDE_AXIS
} from './splitter-controller';

function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (k) => {
      map.delete(k);
    },
    setItem: (k, v) => {
      map.set(k, v);
    }
  };
}

describe('SplitterController — defaults match the spec', () => {
  it('axes match visual-splitter-pattern-2026-05-30.md', () => {
    expect(RAIL_AXIS.min).toBe(240);
    expect(RAIL_AXIS.max).toBe(480);
    expect(RAIL_AXIS.defaultPx).toBe(320);
    expect(ASIDE_AXIS.min).toBe(280);
    expect(ASIDE_AXIS.max).toBe(560);
    expect(ASIDE_AXIS.defaultPx).toBe(380); // R-H Aside default bump
  });
});

describe('persistence — write + read', () => {
  it('round-trips a normal value', () => {
    const storage = makeStorage();
    writePersistedLayout(storage, 'foo', 360, 420);
    const out = readPersistedLayout(storage, 'foo');
    expect(out).toEqual({ rail: 360, aside: 420 });
  });

  it('returns null for no entry', () => {
    const storage = makeStorage();
    expect(readPersistedLayout(storage, 'never-saved')).toBe(null);
  });

  it('clamps on read: rail < min snaps to min', () => {
    const storage = makeStorage();
    storage.setItem(
      'quire.layout.foo',
      JSON.stringify({ v: 1, shell: { rail: '50px', aside: '420px' } })
    );
    const out = readPersistedLayout(storage, 'foo');
    expect(out?.rail).toBe(RAIL_AXIS.min);
  });

  it('clamps on read: rail > max snaps to max', () => {
    const storage = makeStorage();
    storage.setItem(
      'quire.layout.foo',
      JSON.stringify({ v: 1, shell: { rail: '9999px', aside: '420px' } })
    );
    const out = readPersistedLayout(storage, 'foo');
    expect(out?.rail).toBe(RAIL_AXIS.max);
  });

  it('falls back to default on NaN (Adversarial P2 MH-4-A)', () => {
    const storage = makeStorage();
    storage.setItem(
      'quire.layout.foo',
      JSON.stringify({ v: 1, shell: { rail: 'NaNpx', aside: '420px' } })
    );
    const out = readPersistedLayout(storage, 'foo');
    expect(out?.rail).toBe(RAIL_AXIS.defaultPx);
  });

  it('falls back to default on non-numeric string', () => {
    const storage = makeStorage();
    storage.setItem(
      'quire.layout.foo',
      JSON.stringify({ v: 1, shell: { rail: 'auto', aside: 'auto' } })
    );
    const out = readPersistedLayout(storage, 'foo');
    expect(out).toEqual({
      rail: RAIL_AXIS.defaultPx,
      aside: ASIDE_AXIS.defaultPx
    });
  });

  it('returns null on unknown schema version (forward-compat)', () => {
    const storage = makeStorage();
    storage.setItem(
      'quire.layout.foo',
      JSON.stringify({ v: 2, shell: { rail: '320px' } })
    );
    expect(readPersistedLayout(storage, 'foo')).toBe(null);
  });

  it('returns null on bogus JSON (Adversarial P2 corruption)', () => {
    const storage = makeStorage();
    storage.setItem('quire.layout.foo', '{not json');
    expect(readPersistedLayout(storage, 'foo')).toBe(null);
  });

  it('clear removes the entry', () => {
    const storage = makeStorage();
    writePersistedLayout(storage, 'foo', 350, 400);
    clearPersistedLayout(storage, 'foo');
    expect(readPersistedLayout(storage, 'foo')).toBe(null);
  });
});

describe('SplitterController — apply + load', () => {
  let host: HTMLElement;
  let storage: Storage;
  let slug: string | null;
  let ctrl: SplitterController;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    storage = makeStorage();
    slug = 'campaign-1';
    ctrl = new SplitterController({
      host,
      storage,
      getCampaignSlug: () => slug
    });
  });

  it('loads defaults when nothing is persisted', () => {
    ctrl.loadForCurrentCampaign();
    expect(host.style.getPropertyValue('--rail-w')).toBe('320px');
    expect(host.style.getPropertyValue('--aside-w')).toBe('380px');
  });

  it('loads persisted widths', () => {
    writePersistedLayout(storage, slug as string, 360, 420);
    ctrl.loadForCurrentCampaign();
    expect(host.style.getPropertyValue('--rail-w')).toBe('360px');
    expect(host.style.getPropertyValue('--aside-w')).toBe('420px');
  });

  it('setAxisWidth + clamp', () => {
    ctrl.loadForCurrentCampaign();
    ctrl.setAxisWidth('rail', 100);
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.min);
    ctrl.setAxisWidth('rail', 99999);
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.max);
    ctrl.setAxisWidth('rail', 360);
    expect(ctrl.getRailWidth()).toBe(360);
    expect(host.style.getPropertyValue('--rail-w')).toBe('360px');
  });

  it('resetAxis snaps to default + persists', () => {
    ctrl.loadForCurrentCampaign();
    ctrl.setAxisWidth('rail', 450);
    ctrl.resetAxis('rail');
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.defaultPx);
    const persisted = readPersistedLayout(storage, slug as string);
    expect(persisted?.rail).toBe(RAIL_AXIS.defaultPx);
  });

  it('resetAll clears localStorage', () => {
    ctrl.loadForCurrentCampaign();
    ctrl.setAxisWidth('rail', 450);
    ctrl.setAxisWidth('aside', 500);
    // Persist by mimicking the drag-end flow.
    writePersistedLayout(storage, slug as string, 450, 500);
    ctrl.resetAll();
    expect(readPersistedLayout(storage, slug as string)).toBe(null);
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.defaultPx);
    expect(ctrl.getAsideWidth()).toBe(ASIDE_AXIS.defaultPx);
  });
});

describe('SplitterController — keyboard', () => {
  let host: HTMLElement;
  let ctrl: SplitterController;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ctrl = new SplitterController({
      host,
      storage: makeStorage(),
      getCampaignSlug: () => 'c1'
    });
    ctrl.loadForCurrentCampaign();
  });

  it('Arrow steps 16px', () => {
    const before = ctrl.getRailWidth();
    const e = new KeyboardEvent('keydown', { key: 'ArrowRight' });
    e.preventDefault = vi.fn();
    expect(ctrl.handleKeydown('rail', e)).toBe(true);
    expect(ctrl.getRailWidth()).toBe(before + 16);
  });

  it('Shift+Arrow steps 64px', () => {
    const before = ctrl.getRailWidth();
    const e = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true
    });
    e.preventDefault = vi.fn();
    ctrl.handleKeydown('rail', e);
    expect(ctrl.getRailWidth()).toBe(before + 64);
  });

  it('Home snaps to min', () => {
    const e = new KeyboardEvent('keydown', { key: 'Home' });
    e.preventDefault = vi.fn();
    ctrl.handleKeydown('rail', e);
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.min);
  });

  it('End snaps to max', () => {
    const e = new KeyboardEvent('keydown', { key: 'End' });
    e.preventDefault = vi.fn();
    ctrl.handleKeydown('aside', e);
    expect(ctrl.getAsideWidth()).toBe(ASIDE_AXIS.max);
  });

  it('Enter resets to default', () => {
    ctrl.setAxisWidth('rail', 450);
    const e = new KeyboardEvent('keydown', { key: 'Enter' });
    e.preventDefault = vi.fn();
    ctrl.handleKeydown('rail', e);
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.defaultPx);
  });

  it('Space resets to default (keyboard parity)', () => {
    ctrl.setAxisWidth('aside', 500);
    const e = new KeyboardEvent('keydown', { key: ' ' });
    e.preventDefault = vi.fn();
    ctrl.handleKeydown('aside', e);
    expect(ctrl.getAsideWidth()).toBe(ASIDE_AXIS.defaultPx);
  });

  it('unknown key returns false (no preventDefault)', () => {
    const e = new KeyboardEvent('keydown', { key: 'q' });
    e.preventDefault = vi.fn();
    expect(ctrl.handleKeydown('rail', e)).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });
});

describe('SplitterController — drag math', () => {
  let host: HTMLElement;
  let ctrl: SplitterController;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    ctrl = new SplitterController({
      host,
      storage: makeStorage(),
      getCampaignSlug: () => 'c1'
    });
    ctrl.loadForCurrentCampaign();
  });

  it('rail grows when dragged RIGHT', () => {
    const before = ctrl.getRailWidth();
    const handle = document.createElement('button');
    const pdown = new PointerEvent('pointerdown', {
      pointerId: 1,
      clientX: 100
    });
    ctrl.beginDrag('rail', pdown, handle);
    ctrl.handlePointerMove(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 150 })
    );
    expect(ctrl.getRailWidth()).toBe(before + 50);
    ctrl.endDrag(handle);
    expect(ctrl.isDragging()).toBe(false);
  });

  it('aside grows when dragged LEFT', () => {
    const before = ctrl.getAsideWidth();
    const handle = document.createElement('button');
    const pdown = new PointerEvent('pointerdown', {
      pointerId: 1,
      clientX: 1000
    });
    ctrl.beginDrag('aside', pdown, handle);
    ctrl.handlePointerMove(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 950 })
    );
    expect(ctrl.getAsideWidth()).toBe(before + 50);
    ctrl.endDrag(handle);
  });

  it('drag clamps to bounds during move', () => {
    const handle = document.createElement('button');
    ctrl.setAxisWidth('rail', RAIL_AXIS.max);
    const pdown = new PointerEvent('pointerdown', {
      pointerId: 1,
      clientX: 100
    });
    ctrl.beginDrag('rail', pdown, handle);
    ctrl.handlePointerMove(
      new PointerEvent('pointermove', { pointerId: 1, clientX: 10000 })
    );
    expect(ctrl.getRailWidth()).toBe(RAIL_AXIS.max);
  });
});
