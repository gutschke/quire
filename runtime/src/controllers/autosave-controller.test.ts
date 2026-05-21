import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AutosaveController,
  SAVE_STORAGE_PREFIX,
  SAVE_AUTOSAVE_DEBOUNCE_MS,
  SAVE_QUOTA_REFUSE_BYTES
} from './autosave-controller';
import { stringifySave, type SaveDocument } from '../persistence';

function makeHost() {
  return {
    requestUpdate: vi.fn(),
    addController: vi.fn(),
    removeController: vi.fn(),
    updateComplete: Promise.resolve(true)
  };
}

import { EventLog } from '../core/event-log';

function makeDoc(
  owner = 'gutschke',
  repo = 'underleaf',
  payload: unknown = {}
): SaveDocument {
  const log = new EventLog('alice');
  log.append('peer-join', payload);
  return {
    $schemaVersion: '0.1.0',
    savedAt: '2026-05-21T00:00:00Z',
    campaign: { owner, repo, ref: 'main' },
    savedByPeerId: 'alice',
    events: [...log.events()]
  };
}

beforeEach(() => {
  try { window.localStorage?.clear(); } catch {}
});

/* Promise-based debounce wait to keep happy-dom and real timers happy
 * — using vi.useFakeTimers() in this environment confuses the
 * teardown lifecycle.  Wall-clock waits are acceptable for a single
 * debounce-window test. */
function waitMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('AutosaveController — basics', () => {
  it('registers itself with the host on construction', () => {
    const host = makeHost();
    new AutosaveController(host, () => null);
    expect(host.addController).toHaveBeenCalledTimes(1);
  });

  it('schedule() debounces; only one save lands within the window', async () => {
    const host = makeHost();
    const doc = makeDoc();
    const c = new AutosaveController(host, () => doc);
    c.schedule();
    c.schedule();
    c.schedule();
    expect(
      window.localStorage.getItem(`${SAVE_STORAGE_PREFIX}gutschke-underleaf`)
    ).toBeNull();
    await waitMs(SAVE_AUTOSAVE_DEBOUNCE_MS + 100);
    const stored = window.localStorage.getItem(
      `${SAVE_STORAGE_PREFIX}gutschke-underleaf`
    );
    expect(stored).not.toBeNull();
  });

  it('performNow() bypasses the debounce', () => {
    const host = makeHost();
    const doc = makeDoc();
    const c = new AutosaveController(host, () => doc);
    c.performNow();
    const stored = window.localStorage.getItem(
      `${SAVE_STORAGE_PREFIX}gutschke-underleaf`
    );
    expect(stored).not.toBeNull();
  });

  it('performNow() is a no-op when buildDoc returns null', () => {
    const host = makeHost();
    const c = new AutosaveController(host, () => null);
    c.performNow();
    // No keys were written
    expect(window.localStorage.length).toBe(0);
  });

  it('cancelPending() removes the scheduled save', async () => {
    const host = makeHost();
    const doc = makeDoc();
    const c = new AutosaveController(host, () => doc);
    c.schedule();
    c.cancelPending();
    await waitMs(SAVE_AUTOSAVE_DEBOUNCE_MS + 100);
    expect(window.localStorage.length).toBe(0);
  });

  it('hostDisconnected() cancels pending saves', async () => {
    const host = makeHost();
    const doc = makeDoc();
    const c = new AutosaveController(host, () => doc);
    c.schedule();
    c.hostDisconnected();
    await waitMs(SAVE_AUTOSAVE_DEBOUNCE_MS + 100);
    expect(window.localStorage.length).toBe(0);
  });
});

describe('AutosaveController — quota handling', () => {
  it('refuses saves above the REFUSE cap (silent — no write)', () => {
    const host = makeHost();
    // Inflate the JSON by stuffing one event with a huge payload.
    const bigDoc = makeDoc('gutschke', 'underleaf', {
      x: 'a'.repeat(SAVE_QUOTA_REFUSE_BYTES + 100)
    });
    const c = new AutosaveController(host, () => bigDoc);
    c.performNow();
    expect(window.localStorage.length).toBe(0);
  });

  it('warns once at the WARN cap then keeps writing without re-warning', () => {
    const host = makeHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Just above WARN, well below REFUSE — fits within the spread.
    const doc = makeDoc('gutschke', 'underleaf', { x: 'a'.repeat(1_500_000) });
    const c = new AutosaveController(host, () => doc);
    c.performNow();
    c.performNow();
    c.performNow();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('resetQuotaWarning() un-arms the warn-once flag', () => {
    const host = makeHost();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = makeDoc('gutschke', 'underleaf', { x: 'a'.repeat(1_500_000) });
    const c = new AutosaveController(host, () => doc);
    c.performNow();
    c.resetQuotaWarning();
    c.performNow();
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('AutosaveController — checkResume', () => {
  it('returns null when no autosave exists for the campaign', () => {
    const host = makeHost();
    const c = new AutosaveController(host, () => null);
    expect(c.checkResume({ owner: 'x', repo: 'y' })).toBeNull();
  });

  it('returns the parsed SaveDocument when an autosave is present', () => {
    const doc = makeDoc('foo', 'bar');
    window.localStorage.setItem(
      `${SAVE_STORAGE_PREFIX}foo-bar`,
      stringifySave(doc)
    );
    const c = new AutosaveController(makeHost(), () => null);
    const resumed = c.checkResume({ owner: 'foo', repo: 'bar' });
    expect(resumed).not.toBeNull();
    expect(resumed?.campaign.owner).toBe('foo');
  });

  it('returns null on parse failure (garbage stored)', () => {
    window.localStorage.setItem(`${SAVE_STORAGE_PREFIX}foo-bar`, 'not json');
    const c = new AutosaveController(makeHost(), () => null);
    expect(c.checkResume({ owner: 'foo', repo: 'bar' })).toBeNull();
  });
});

describe('AutosaveController — storage key convention', () => {
  it('keys by campaign owner-repo (matches pre-extraction behavior)', () => {
    const doc = makeDoc('quire-org', 'sample-campaign');
    const c = new AutosaveController(makeHost(), () => doc);
    c.performNow();
    const expectedKey = `${SAVE_STORAGE_PREFIX}quire-org-sample-campaign`;
    expect(window.localStorage.getItem(expectedKey)).not.toBeNull();
  });
});
