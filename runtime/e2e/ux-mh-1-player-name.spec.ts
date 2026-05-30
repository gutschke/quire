/**
 * Real-browser probe — UX-MH-1: player display name beside PC name.
 *
 * Per LL-3 discipline: this loads the runtime in Chromium and
 * asserts the user-visible outcome (`Player: …` text rendered next
 * to the PC name in chargen-dm-review).  Smaller than a full session
 * — drives the chargen-dm-review element directly via its props.
 *
 * Run #19 (2026-05-30) — UX-MH-1 closure proof.
 */

import { test, expect } from '@playwright/test';

test.describe('UX-MH-1 — player name beside PC name', () => {
  test('chargen-dm-review renders "Player: …" line when playerNameLookup resolves', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      // Mount a standalone chargen-dm-review with the props that
      // exercise the player-name line.  Reuses the production
      // component contract; nothing simulates the render directly.
      await import('/src/ui/regions/chargen-dm-review.ts');
      const el = document.createElement('chargen-dm-review') as HTMLElement & {
        playerNameLookup: ((pcId: string) => string | null) | null;
        pcSlots: Record<number, { pcId?: string; controllerPeerId?: string }>;
        synthResults: Map<number, unknown>;
      };
      el.pcSlots = {
        1: { pcId: 'mei', controllerPeerId: 'alice' }
      };
      el.playerNameLookup = (pcId: string) =>
        pcId === 'mei' ? 'Alice' : null;
      // Seed a minimal "ok" synth result so the synth-ok block renders
      // (where the player-name line is appended).
      el.synthResults = new Map([
        [
          1,
          {
            ok: true,
            response: {
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              stats: { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 },
              skillMastery: []
            },
            warnings: [],
            retried: false
          }
        ]
      ]);
      document.body.appendChild(el);
      // Wait for two paints.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const line = el.querySelector('.chargen-dm-review-player-name');
      return {
        present: !!line,
        text: line?.textContent?.trim() ?? null
      };
    });
    expect(result.present, 'player-name line not rendered').toBe(true);
    expect(result.text).toContain('Player: Alice');
  });
});
