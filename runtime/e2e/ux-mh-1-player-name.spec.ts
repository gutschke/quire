/**
 * Real-browser probe — UX-MH-1: player display name beside PC name +
 * DM-side rename affordance.
 *
 * Per LL-3 discipline: this loads the runtime in Chromium and
 * asserts the user-visible outcome (`Player: …` text rendered next
 * to the PC name in chargen-dm-review).  Smaller than a full session
 * — drives the chargen-dm-review element directly via its props.
 *
 * Run #19 (2026-05-30) — UX-MH-1 closure proof.  Phase 9 extends the
 * spec with the integrated DM-side click-to-edit affordance: the
 * pencil-affordance button renders only when `onRenamePlayer` +
 * `peerIdForPcLookup` are wired; clicking it swaps the line into an
 * input; pressing Enter emits the rename callback with the resolved
 * peerId + new name.
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

  test('DM clicks the pencil affordance, types a new name, presses Enter → onRenamePlayer fires with the resolved peerId', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/regions/chargen-dm-review.ts');
      type Seat = { pcId?: string; controllerPeerId?: string; state?: string };
      const el = document.createElement('chargen-dm-review') as HTMLElement & {
        playerNameLookup: ((pcId: string) => string | null) | null;
        peerIdForPcLookup: ((pcId: string) => string | null) | null;
        onRenamePlayer:
          | ((targetPeerId: string, newDisplayName: string) => boolean)
          | null;
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
      };
      el.pcSlots = {
        1: { pcId: 'mei', controllerPeerId: 'alice-peer', state: 'bound-active' }
      };
      el.playerNameLookup = (pcId: string) =>
        pcId === 'mei' ? 'Alice' : null;
      el.peerIdForPcLookup = (pcId: string) =>
        pcId === 'mei' ? 'alice-peer' : null;
      // Provide data lookup so the bound-seat-tray renders (parent
      // contract: tray-wrap mounts only when data is available).
      el.pcEditDataLookup = (pcId: string) =>
        pcId === 'mei'
          ? {
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              backstory: 'Mei grew up by the Underleaf.'
            }
          : null;
      let captured: { targetPeerId: string; newDisplayName: string } | null =
        null;
      el.onRenamePlayer = (targetPeerId, newDisplayName) => {
        captured = { targetPeerId, newDisplayName };
        return true;
      };
      // No synth result needed — the bound-seat-tray renders for any
      // bound-active seat with data.
      el.synthResults = new Map();
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Pencil button is the editable variant of the player-name line.
      const pencil = el.querySelector(
        '.chargen-dm-review-player-name-editable'
      ) as HTMLButtonElement | null;
      if (!pencil) return { stage: 'no-pencil', captured };
      pencil.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const input = el.querySelector(
        '.chargen-dm-review-player-name-input'
      ) as HTMLInputElement | null;
      if (!input) return { stage: 'no-input', captured };
      input.value = 'Alicia';
      const enter = new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true
      });
      input.dispatchEvent(enter);
      return { stage: 'committed', captured };
    });
    expect(result.stage).toBe('committed');
    expect(result.captured).toEqual({
      targetPeerId: 'alice-peer',
      newDisplayName: 'Alicia'
    });
  });
});
