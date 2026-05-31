/**
 * Real-browser probe — UX-MH-3: backstory-refresh proposal +
 * inline-diff inbox card.
 *
 * Per LL-3: this loads the runtime in Chromium and asserts that
 * the inbox-card component renders the unified diff + DM header
 * copy + Accept/Reject/Try again actions.  Does NOT exercise the
 * AI module (a live network call would be flaky); the AI surface
 * is unit-tested in src/ai/backstory-refresher.test.ts.
 *
 * Run #19 (2026-05-30) — UX-MH-3 closure proof.  Phase 9 extends the
 * spec with an integration test that mounts <chargen-dm-review>
 * and asserts the DM-side "↻ Refresh backstory" click path fires
 * the host's onRefreshBackstory callback with the right pcId.
 */

import { test, expect } from '@playwright/test';

test.describe('UX-MH-3 — backstory refresh inbox card', () => {
  test('inline-diff renders +/- hunks for a surgical edit', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/components/inline-diff.ts');
      const el = document.createElement('inline-diff') as HTMLElement & {
        baseline: string;
        proposed: string;
      };
      el.baseline = 'Mei.\nShe trained as a nurse.\nShe climbs.';
      el.proposed = 'Mei.\nThey trained as a nurse.\nThey climb.';
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const lines = el.querySelectorAll('.inline-diff-line');
      const adds = el.querySelectorAll('.inline-diff-line-add');
      const dels = el.querySelectorAll('.inline-diff-line-del');
      const sames = el.querySelectorAll('.inline-diff-line-same');
      return {
        totalLines: lines.length,
        addCount: adds.length,
        delCount: dels.length,
        sameCount: sames.length,
        firstSameText: sames[0]?.textContent?.trim() ?? null
      };
    });
    expect(result.addCount).toBeGreaterThanOrEqual(2);
    expect(result.delCount).toBeGreaterThanOrEqual(2);
    expect(result.sameCount).toBeGreaterThanOrEqual(1);
    expect(result.firstSameText).toContain('Mei.');
  });

  test('backstory-refresh-inbox renders DM-initiated header verbatim', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/components/backstory-refresh-inbox.ts');
      const el = document.createElement(
        'backstory-refresh-inbox'
      ) as HTMLElement & {
        proposal: {
          pcId: string;
          proposedBackstory: string;
          baselineHash: string;
          initiator: 'player' | 'dm';
          ts: number;
        };
        currentBackstory: string;
        currentBackstoryHash: string;
        pcDisplayName: string;
        playerSafeChangeSummary: string;
      };
      el.proposal = {
        pcId: 'mei',
        proposedBackstory: 'Mei (they/them) grew up by the Underleaf.',
        baselineHash: 'CURRENT',
        initiator: 'dm',
        ts: 0
      };
      el.currentBackstory = 'Mei grew up by the Underleaf.';
      el.currentBackstoryHash = 'CURRENT';
      el.pcDisplayName = 'Mei';
      el.playerSafeChangeSummary = 'pronouns';
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const card = el.querySelector('.backstory-refresh-inbox-card');
      const text = card?.textContent ?? '';
      return {
        present: !!card,
        hasHeader: text.includes('Your DM has a backstory suggestion'),
        hasBody: text.includes('Mei'),
        hasAccept: !!el.querySelector('.backstory-refresh-inbox-accept'),
        hasReject: !!el.querySelector('.backstory-refresh-inbox-reject'),
        hasTryAgain: !!el.querySelector('.backstory-refresh-inbox-try-again')
      };
    });
    expect(result.present).toBe(true);
    expect(result.hasHeader).toBe(true);
    expect(result.hasBody).toBe(true);
    expect(result.hasAccept).toBe(true);
    expect(result.hasReject).toBe(true);
    expect(result.hasTryAgain).toBe(true);
  });

  test('DM opens the per-row tray inside chargen-dm-review and clicks "↻ Refresh backstory" → host onRefreshBackstory fires with the right pcId', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/regions/chargen-dm-review.ts');
      type Seat = { pcId?: string; controllerPeerId?: string; state?: string };
      const el = document.createElement('chargen-dm-review') as HTMLElement & {
        pcSlots: Record<number, Seat>;
        synthResults: Map<number, unknown>;
        pcEditDataLookup:
          | ((pcId: string) => {
              name: string;
              pronouns: string;
              tags: readonly string[];
              backstory: string;
            } | null)
          | null;
        onRefreshBackstory: ((pcId: string) => Promise<void>) | null;
      };
      el.pcSlots = {
        1: { pcId: 'mei', controllerPeerId: 'alice', state: 'bound-active' }
      };
      el.synthResults = new Map();
      el.pcEditDataLookup = (pcId) =>
        pcId === 'mei'
          ? {
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              backstory: 'Mei grew up by the Underleaf.'
            }
          : null;
      const captured: string[] = [];
      el.onRefreshBackstory = async (pcId) => {
        captured.push(pcId);
      };
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const tray = el.querySelector(
        'chargen-edit-tray[data-slot="1"]'
      ) as HTMLElement | null;
      if (!tray) return { stage: 'no-tray', captured };
      const editBtn = tray.querySelector(
        '.chargen-edit-tray-toggle'
      ) as HTMLButtonElement | null;
      if (!editBtn) return { stage: 'no-edit-btn', captured };
      editBtn.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const refreshBtn = tray.querySelector(
        '.chargen-edit-tray-refresh'
      ) as HTMLButtonElement | null;
      if (!refreshBtn) return { stage: 'no-refresh-btn', captured };
      refreshBtn.click();
      // The callback is async — wait one microtask + paint.
      await Promise.resolve();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return { stage: 'committed', captured };
    });
    expect(result.stage).toBe('committed');
    expect(result.captured).toEqual(['mei']);
  });
});
