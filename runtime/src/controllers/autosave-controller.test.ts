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

describe('AutosaveController — tab-close durability (M2)', () => {
  /**
   * M2 (2026-05-29 save-restore program): the 1.5s debounce window
   * is structurally lost on tab-close pre-fix.  The DM finishes a
   * scene, closes the laptop, and the in-flight save evaporates.
   *
   * Fix is to register a `visibilitychange` listener on
   * `document` (the modern, mobile-reliable signal — `beforeunload`
   * is suppressed on mobile and during a `pagehide`-bypass restore).
   * When `document.visibilityState === 'hidden'` AND a save is
   * pending, flush synchronously via `performNow()` before the
   * browser tears down the tab.
   */

  function makeVisibilityHarness() {
    let state: 'visible' | 'hidden' = 'visible';
    const listeners = new Set<() => void>();
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get() {
        return state;
      }
    });
    const origAdd = document.addEventListener.bind(document);
    const origRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, fn: EventListener) => {
      if (type === 'visibilitychange') listeners.add(fn as () => void);
      return origAdd(type, fn);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, fn: EventListener) => {
      if (type === 'visibilitychange') listeners.delete(fn as () => void);
      return origRemove(type, fn);
    }) as typeof document.removeEventListener;
    return {
      hide() {
        state = 'hidden';
        for (const fn of listeners) fn();
      },
      show() {
        state = 'visible';
        for (const fn of listeners) fn();
      },
      listenerCount: () => listeners.size,
      restore() {
        document.addEventListener = origAdd;
        document.removeEventListener = origRemove;
      }
    };
  }

  it('hostConnected() registers a visibilitychange listener', () => {
    const harness = makeVisibilityHarness();
    try {
      const host = makeHost();
      const c = new AutosaveController(host, () => null);
      c.hostConnected();
      expect(harness.listenerCount()).toBeGreaterThanOrEqual(1);
    } finally {
      harness.restore();
    }
  });

  it('hostDisconnected() removes the visibilitychange listener', () => {
    const harness = makeVisibilityHarness();
    try {
      const host = makeHost();
      const c = new AutosaveController(host, () => null);
      c.hostConnected();
      const after = harness.listenerCount();
      c.hostDisconnected();
      expect(harness.listenerCount()).toBeLessThan(after);
    } finally {
      harness.restore();
    }
  });

  it('visibilitychange → hidden flushes a pending debounced save', () => {
    const harness = makeVisibilityHarness();
    try {
      const host = makeHost();
      const doc = makeDoc('flush', 'me');
      const c = new AutosaveController(host, () => doc);
      c.hostConnected();
      c.schedule();
      // Nothing yet — the debounce hasn't fired.
      expect(
        window.localStorage.getItem(`${SAVE_STORAGE_PREFIX}flush-me`)
      ).toBeNull();
      // Tab goes hidden BEFORE the debounce window completes.
      harness.hide();
      // Save landed synchronously.
      expect(
        window.localStorage.getItem(`${SAVE_STORAGE_PREFIX}flush-me`)
      ).not.toBeNull();
    } finally {
      harness.restore();
    }
  });

  it('visibilitychange → hidden with NO pending save is a no-op', () => {
    const harness = makeVisibilityHarness();
    try {
      const host = makeHost();
      const c = new AutosaveController(host, () => null);
      c.hostConnected();
      harness.hide();
      expect(window.localStorage.length).toBe(0);
    } finally {
      harness.restore();
    }
  });

  it('visibilitychange → visible does NOT flush (only hidden does)', () => {
    const harness = makeVisibilityHarness();
    try {
      const host = makeHost();
      const doc = makeDoc('noflush', 'visible');
      const c = new AutosaveController(host, () => doc);
      c.hostConnected();
      c.schedule();
      // No `hide` — just dispatching the listener with state='visible'.
      harness.show();
      expect(
        window.localStorage.getItem(`${SAVE_STORAGE_PREFIX}noflush-visible`)
      ).toBeNull();
    } finally {
      harness.restore();
    }
  });

  it('after a flush, the pending timer is cleared (no double-write)', async () => {
    const harness = makeVisibilityHarness();
    try {
      const host = makeHost();
      let writes = 0;
      const c = new AutosaveController(host, () => {
        writes++;
        return makeDoc('dbl', 'check');
      });
      c.hostConnected();
      c.schedule();
      harness.hide();
      expect(writes).toBe(1);
      // Wait past the original debounce — the second fire should not happen.
      await waitMs(SAVE_AUTOSAVE_DEBOUNCE_MS + 100);
      expect(writes).toBe(1);
    } finally {
      harness.restore();
    }
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

describe('AutosaveController — persistent-storage request (M5)', () => {
  it('calls navigator.storage.persist() after a successful save', () => {
    const persistMock = vi.fn().mockResolvedValue(true);
    // Stub navigator.storage on globalThis. happy-dom may or may not
    // surface it depending on version; we set it directly.
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...origNavigator,
        storage: { persist: persistMock, estimate: vi.fn() }
      }
    });
    try {
      const doc = makeDoc('owner-a', 'repo-a');
      const c = new AutosaveController(makeHost(), () => doc);
      c.performNow();
      expect(persistMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: origNavigator
      });
    }
  });

  it('only requests persistence once across multiple saves', () => {
    const persistMock = vi.fn().mockResolvedValue(true);
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...origNavigator,
        storage: { persist: persistMock, estimate: vi.fn() }
      }
    });
    try {
      const doc = makeDoc('owner-b', 'repo-b');
      const c = new AutosaveController(makeHost(), () => doc);
      c.performNow();
      c.performNow();
      c.performNow();
      expect(persistMock).toHaveBeenCalledTimes(1);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: origNavigator
      });
    }
  });

  it('survives a missing navigator.storage gracefully', () => {
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: { ...origNavigator, storage: undefined }
    });
    try {
      const doc = makeDoc('owner-c', 'repo-c');
      const c = new AutosaveController(makeHost(), () => doc);
      // Should not throw.
      expect(() => c.performNow()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: origNavigator
      });
    }
  });

  it('survives a persist() that throws synchronously', () => {
    const persistMock = vi.fn(() => {
      throw new Error('blocked');
    });
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...origNavigator,
        storage: { persist: persistMock, estimate: vi.fn() }
      }
    });
    try {
      const doc = makeDoc('owner-d', 'repo-d');
      const c = new AutosaveController(makeHost(), () => doc);
      expect(() => c.performNow()).not.toThrow();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: origNavigator
      });
    }
  });

  it('survives a persist() that returns a rejected promise', async () => {
    const persistMock = vi.fn().mockRejectedValue(new Error('denied'));
    const origNavigator = globalThis.navigator;
    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      value: {
        ...origNavigator,
        storage: { persist: persistMock, estimate: vi.fn() }
      }
    });
    try {
      const doc = makeDoc('owner-e', 'repo-e');
      const c = new AutosaveController(makeHost(), () => doc);
      c.performNow();
      // Let the rejected promise settle; an unhandled rejection
      // would surface as an error in this microtask flush.
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        configurable: true,
        value: origNavigator
      });
    }
  });
});
