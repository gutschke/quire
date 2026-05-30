// @vitest-environment node

import { describe, it, expect } from 'vitest';
import {
  listRecentCampaigns,
  formatCampaignAge,
  formatCampaignSlug
} from './recently-played';
import { stringifySave, serializeSession } from '../persistence';
import { EventLog } from '../core/event-log';
import { SAVE_STORAGE_PREFIX } from './autosave-controller';

class FakeStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function fakeSave(
  owner: string,
  repo: string,
  ref: string,
  savedAt: string,
  eventCount: number
): string {
  const log = new EventLog('test');
  for (let i = 0; i < eventCount; i++) {
    log.append('chat', { text: `e${i}` });
  }
  const doc = serializeSession(log.events(), { owner, repo, ref }, 'test');
  // Pin savedAt deterministically.
  doc.savedAt = savedAt;
  return stringifySave(doc);
}

describe('listRecentCampaigns', () => {
  it('returns an empty list when storage is unavailable', () => {
    expect(listRecentCampaigns(undefined)).toEqual([]);
  });

  it('returns an empty list when no quire.save.* keys exist', () => {
    const s = new FakeStorage();
    s.setItem('other.thing', 'whatever');
    expect(listRecentCampaigns(s)).toEqual([]);
  });

  it('finds one campaign and reports its metadata', () => {
    const s = new FakeStorage();
    s.setItem(
      `${SAVE_STORAGE_PREFIX}gutschke-underleaf`,
      fakeSave('gutschke', 'underleaf', 'main', '2026-04-01T12:00:00Z', 42)
    );
    const result = listRecentCampaigns(s);
    expect(result).toHaveLength(1);
    expect(result[0].campaign).toEqual({
      owner: 'gutschke',
      repo: 'underleaf',
      ref: 'main'
    });
    expect(result[0].savedAt).toBe('2026-04-01T12:00:00Z');
    expect(result[0].eventCount).toBe(42);
    expect(result[0].storageKey).toBe(`${SAVE_STORAGE_PREFIX}gutschke-underleaf`);
  });

  it('sorts results most-recent-first', () => {
    const s = new FakeStorage();
    s.setItem(
      `${SAVE_STORAGE_PREFIX}a-old`,
      fakeSave('a', 'old', 'main', '2026-01-01T00:00:00Z', 1)
    );
    s.setItem(
      `${SAVE_STORAGE_PREFIX}b-new`,
      fakeSave('b', 'new', 'main', '2026-05-01T00:00:00Z', 1)
    );
    s.setItem(
      `${SAVE_STORAGE_PREFIX}c-mid`,
      fakeSave('c', 'mid', 'main', '2026-03-01T00:00:00Z', 1)
    );
    const result = listRecentCampaigns(s);
    expect(result.map((r) => r.campaign.repo)).toEqual(['new', 'mid', 'old']);
  });

  it('caps results at the limit parameter', () => {
    const s = new FakeStorage();
    for (let i = 0; i < 10; i++) {
      const ts = `2026-0${(i % 9) + 1}-01T00:00:00Z`;
      s.setItem(
        `${SAVE_STORAGE_PREFIX}o${i}-r${i}`,
        fakeSave(`o${i}`, `r${i}`, 'main', ts, 1)
      );
    }
    expect(listRecentCampaigns(s, 3)).toHaveLength(3);
    expect(listRecentCampaigns(s, 0)).toHaveLength(0);
  });

  it('skips malformed saves without crashing', () => {
    const s = new FakeStorage();
    s.setItem(`${SAVE_STORAGE_PREFIX}bad`, 'not-json');
    s.setItem(`${SAVE_STORAGE_PREFIX}also-bad`, '{"$schemaVersion":"99.0.0"}');
    s.setItem(
      `${SAVE_STORAGE_PREFIX}good`,
      fakeSave('o', 'r', 'main', '2026-05-01T00:00:00Z', 1)
    );
    const result = listRecentCampaigns(s);
    expect(result).toHaveLength(1);
    expect(result[0].campaign.repo).toBe('r');
  });

  it('ignores non-quire localStorage keys', () => {
    const s = new FakeStorage();
    s.setItem('quire.session.foo', 'something');
    s.setItem('other.app.data', 'something');
    s.setItem(
      `${SAVE_STORAGE_PREFIX}o-r`,
      fakeSave('o', 'r', 'main', '2026-05-01T00:00:00Z', 1)
    );
    const result = listRecentCampaigns(s);
    expect(result).toHaveLength(1);
  });
});

describe('formatCampaignAge', () => {
  const now = new Date('2026-05-29T12:00:00Z');

  it('reports moments-ago for very recent saves', () => {
    expect(formatCampaignAge('2026-05-29T11:59:30Z', now)).toBe('moments ago');
  });

  it('reports minute granularity within the hour', () => {
    expect(formatCampaignAge('2026-05-29T11:30:00Z', now)).toBe('30 minutes ago');
    expect(formatCampaignAge('2026-05-29T11:59:00Z', now)).toBe('1 minute ago');
  });

  it('reports hour granularity within the day', () => {
    expect(formatCampaignAge('2026-05-29T09:00:00Z', now)).toBe('3 hours ago');
    expect(formatCampaignAge('2026-05-29T11:00:00Z', now)).toBe('1 hour ago');
  });

  it('reports day granularity within the week', () => {
    expect(formatCampaignAge('2026-05-28T12:00:00Z', now)).toBe('1 day ago');
    expect(formatCampaignAge('2026-05-25T12:00:00Z', now)).toBe('4 days ago');
  });

  it('reports week granularity for the recent past', () => {
    expect(formatCampaignAge('2026-05-22T12:00:00Z', now)).toBe('1 week ago');
    expect(formatCampaignAge('2026-04-01T12:00:00Z', now)).toBe('8 weeks ago');
  });

  it('reports month granularity for older saves', () => {
    expect(formatCampaignAge('2026-02-01T12:00:00Z', now)).toBe('3 months ago');
    expect(formatCampaignAge('2025-12-01T12:00:00Z', now)).toBe('5 months ago');
  });

  it('reports year granularity for very old saves', () => {
    expect(formatCampaignAge('2024-01-01T00:00:00Z', now)).toBe('2 years ago');
  });

  it('returns "a while ago" for an unparseable input', () => {
    expect(formatCampaignAge('not-a-date', now)).toBe('a while ago');
  });
});

describe('formatCampaignSlug', () => {
  it('returns owner/repo when ref is main', () => {
    expect(
      formatCampaignSlug({ owner: 'gutschke', repo: 'underleaf', ref: 'main' })
    ).toBe('gutschke/underleaf');
  });

  it('returns owner/repo@ref when ref is not main', () => {
    expect(
      formatCampaignSlug({
        owner: 'gutschke',
        repo: 'underleaf',
        ref: 'feature-arc'
      })
    ).toBe('gutschke/underleaf@feature-arc');
  });
});
