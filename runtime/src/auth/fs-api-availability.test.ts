/**
 * File System Access API availability detection — unit tests.
 *
 * These tests are pure: every case constructs a synthetic
 * `FsApiEnv` and asserts the verdict.  No globals are mutated.
 */

import { describe, expect, it } from 'vitest';
import {
  getAvailabilityVerdict,
  isFileSystemAccessAvailable,
  type FsApiEnv
} from './fs-api-availability';

const CHROME_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const EDGE_DESKTOP =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';
const SAFARI_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15';
const FIREFOX_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const SAFARI_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1';
const FIREFOX_IOS =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/121.0 Mobile/15E148 Safari/605.1.15';

function envWith(opts: {
  api?: boolean;
  ua?: string;
}): FsApiEnv {
  return {
    userAgent: opts.ua,
    showDirectoryPicker: opts.api ? () => Promise.resolve({}) : undefined
  };
}

describe('isFileSystemAccessAvailable', () => {
  it('returns true when window.showDirectoryPicker is callable', () => {
    expect(
      isFileSystemAccessAvailable(envWith({ api: true, ua: CHROME_DESKTOP }))
    ).toBe(true);
  });

  it('returns false when window.showDirectoryPicker is missing', () => {
    expect(
      isFileSystemAccessAvailable(envWith({ api: false, ua: SAFARI_DESKTOP }))
    ).toBe(false);
  });

  it('returns false when showDirectoryPicker is present but not a function', () => {
    expect(
      isFileSystemAccessAvailable({
        userAgent: CHROME_DESKTOP,
        showDirectoryPicker: 'not-a-function'
      })
    ).toBe(false);
  });
});

describe('getAvailabilityVerdict — API present, desktop', () => {
  it('Chrome desktop → available', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: true, ua: CHROME_DESKTOP }))
    ).toEqual({ available: true });
  });

  it('Edge desktop → available', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: true, ua: EDGE_DESKTOP }))
    ).toEqual({ available: true });
  });
});

describe('getAvailabilityVerdict — API present, mobile (future-proof)', () => {
  it('Chrome Android with API present → still mobile reason (OS sync model)', () => {
    // The day Chrome on Android exposes showDirectoryPicker, we
    // STILL want to route the user to the OAuth Drive path
    // because their phone doesn't have Drive Desktop running.
    expect(
      getAvailabilityVerdict(envWith({ api: true, ua: CHROME_ANDROID }))
    ).toEqual({ available: false, reason: 'mobile' });
  });
});

describe('getAvailabilityVerdict — API missing, browser identified', () => {
  it('Safari desktop → safari reason', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: SAFARI_DESKTOP }))
    ).toEqual({ available: false, reason: 'safari' });
  });

  it('Firefox desktop → firefox reason', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: FIREFOX_DESKTOP }))
    ).toEqual({ available: false, reason: 'firefox' });
  });

  it('Safari iOS → mobile reason (mobile wins over safari)', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: SAFARI_IOS }))
    ).toEqual({ available: false, reason: 'mobile' });
  });

  it('Firefox iOS → mobile reason (mobile wins over firefox)', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: FIREFOX_IOS }))
    ).toEqual({ available: false, reason: 'mobile' });
  });

  it('Chrome Android without API → mobile reason', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: CHROME_ANDROID }))
    ).toEqual({ available: false, reason: 'mobile' });
  });
});

describe('getAvailabilityVerdict — API missing, browser unknown', () => {
  it('empty UA → no-api reason', () => {
    expect(getAvailabilityVerdict(envWith({ api: false }))).toEqual({
      available: false,
      reason: 'no-api'
    });
  });

  it('unrecognized UA → no-api reason', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: 'NotABrowser/1.0' }))
    ).toEqual({ available: false, reason: 'no-api' });
  });
});

describe('Safari UA exclusion against Chromium', () => {
  it('Chrome UA (contains "Safari") is NOT classified as safari when API missing', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: CHROME_DESKTOP }))
    ).toEqual({ available: false, reason: 'no-api' });
  });

  it('Edge UA (contains "Safari" + "Edg/") is NOT classified as safari when API missing', () => {
    expect(
      getAvailabilityVerdict(envWith({ api: false, ua: EDGE_DESKTOP }))
    ).toEqual({ available: false, reason: 'no-api' });
  });
});

describe('defaults — SSR / non-browser', () => {
  it('with no env passed, falls back to defaultEnv (no globals → no-api)', () => {
    // In vitest's node env, neither `window` nor a useful
    // `navigator.userAgent` will surface — should fall through
    // to `no-api` without throwing.
    const verdict = getAvailabilityVerdict();
    expect(verdict.available).toBe(false);
    if (!verdict.available) {
      // Vitest happy-dom env *may* expose a navigator; we just
      // assert the verdict is a recognized shape.
      expect(['no-api', 'mobile', 'safari', 'firefox']).toContain(
        verdict.reason
      );
    }
  });
});
