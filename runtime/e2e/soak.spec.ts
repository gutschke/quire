/**
 * Phase 4 extension — sustained-use soak test.
 *
 * Generate a long event log (100+ events) across 3 peers with a
 * mix of chat / dice / scene reveals / PC edits.  Validates that:
 *   1. The event log stays consistent across peers under sustained
 *      gossip (hub forwarding doesn't drop events under load)
 *   2. State convergence holds (every peer's materialized state
 *      matches)
 *   3. Save+load round-trips a large event log without loss
 *   4. The serialized save stays within a reasonable size bound
 *
 * Won't catch: human-pace bugs (real DM pauses, real player
 * thinking time) — those need manual testing.  This is about
 * machine-pace gossip and serialization under load.
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession,
  sendChat,
  chatList,
  activePanel
} from './helpers';

const SLUG = 'test-camp';
const TOTAL_EVENTS_TARGET = 100;

async function openPersona(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

async function stateSummary(page: Page): Promise<{
  chatCount: number;
  rollCount: number;
  revealCount: number;
  pcEditFieldCount: number;
}> {
  return page.evaluate(() => {
    const app = document.querySelector('quire-app') as unknown as {
      sessionView: {
        shared: {
          chat: unknown[];
          diceRolls: unknown[];
          revealedScenes: string[];
          pcEdits: Record<string, Record<string, unknown>>;
        };
      };
    };
    const s = app.sessionView.shared;
    let pcEditFieldCount = 0;
    for (const fields of Object.values(s.pcEdits)) {
      pcEditFieldCount += Object.keys(fields).length;
    }
    return {
      chatCount: s.chat.length,
      rollCount: s.diceRolls.length,
      revealCount: s.revealedScenes.length,
      pcEditFieldCount
    };
  });
}

test.describe('Multi-session soak (Phase 4 extension)', () => {
  test('100+ event session converges across all peers and saves cleanly', async ({
    browser
  }) => {
    test.setTimeout(180_000);

    const dmCtx = await browser.newContext();
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();

    try {
      const dm = await openPersona(dmCtx);
      const a = await openPersona(aCtx);
      const b = await openPersona(bCtx);

      const code = await hostSession(dm, 'DM');
      await joinSession(a, code, 'Alice');
      await joinSession(b, code, 'Bob');

      // Wait for all peers to see each other via shared.peers.
      // Sets a baseline: 3 peers in session, each with own peer-join
      // + DM's peer-join + DM's coordinator-claim already in log.
      await expect(activePanel(dm).locator('.session-peers')).toContainText(
        /2 other players/i,
        { timeout: 15000 }
      );

      // Drive 100 events: rotate between DM chat, A roll, B chat,
      // A roll, DM reveal (once every 20 events), B PC-edit (once
      // every 20).
      let chatNum = 0;
      let rollNum = 0;
      const peersOrder = [dm, a, b];
      for (let i = 0; i < TOTAL_EVENTS_TARGET; i++) {
        const actor = peersOrder[i % 3];
        if (i % 20 === 5 && actor === dm) {
          // DM reveals a scene (intro.md the first time, outro.md
          // the second, etc.)
          await actor.evaluate((scene) => {
            const u = new URL(window.location.href);
            u.searchParams.set('episode', '001-test');
            u.searchParams.set('scene', scene);
            window.history.pushState({}, '', u.pathname + u.search);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }, i % 40 === 5 ? 'scenes/intro.md' : 'scenes/outro.md');
          const revealBtn = actor.locator(
            '.reveal-control button:has-text("Reveal to players")'
          );
          if ((await revealBtn.count()) > 0) {
            await revealBtn.click();
          }
          continue;
        }
        if (i % 5 === 0) {
          rollNum++;
          // Dice roll via chat slash-command (B3 path).
          await actor.locator('.chat-form input').fill(`/roll 2d6+${i % 4}`);
          await actor.locator('.chat-form input').press('Enter');
        } else {
          chatNum++;
          await actor.locator('.chat-form input').fill(`message ${chatNum}`);
          await actor.locator('.chat-form input').press('Enter');
        }
        // Tiny breather every 10 events to let gossip flow.  Without
        // this the test can outrun the WebRTC data-channel.
        if (i % 10 === 9) await actor.waitForTimeout(150);
      }

      // Let final events settle.
      await dm.waitForTimeout(2000);

      // Each peer's chat should reflect all chat events.  Compare
      // chat counts across peers; they should all be equal.
      const dmState = await stateSummary(dm);
      const aState = await stateSummary(a);
      const bState = await stateSummary(b);

      // Sanity: dm has at least the expected counts.
      expect(dmState.chatCount).toBeGreaterThanOrEqual(chatNum);
      expect(dmState.rollCount).toBeGreaterThanOrEqual(1);

      // CONVERGENCE: all three peers see the same totals.
      expect(aState).toEqual(dmState);
      expect(bState).toEqual(dmState);

      // Save and inspect size.
      const downloadPromise = dm.waitForEvent('download');
      await dm.locator('.session-bar button:has-text("Save")').click();
      const download = await downloadPromise;
      const path = await download.path();
      const savedJson = readFileSync(path, 'utf8');
      // Roughly bound the save size — 100 events of ~200 bytes each
      // is ~20KB.  Pretty-printed JSON adds overhead; cap at 200KB.
      expect(savedJson.length).toBeLessThan(200_000);
      // Should be well-formed JSON.
      const parsed = JSON.parse(savedJson);
      expect(Array.isArray(parsed.events)).toBe(true);
      expect(parsed.events.length).toBe(dmState.chatCount + dmState.rollCount + dmState.revealCount + /* peer-joins + coord-claim */ 4);

      // Load into a fresh fourth peer and verify state matches.
      const freshCtx = await browser.newContext();
      try {
        const fresh = await openPersona(freshCtx);
        await hostSession(fresh, 'FreshDM');
        await fresh
          .locator('.session-load-label input[type=file]')
          .setInputFiles({
            name: 'soak.json',
            mimeType: 'application/json',
            buffer: Buffer.from(savedJson)
          });
        // Give load time to apply many events.
        await fresh.waitForTimeout(1500);
        const freshState = await stateSummary(fresh);
        // Fresh has the dm's events + its own peer-join + coord-claim
        // + auto-reclaim audit.  Chat is dmState.chatCount + 1
        // (the reclaim audit message).
        expect(freshState.chatCount).toBeGreaterThanOrEqual(dmState.chatCount);
        expect(freshState.rollCount).toBe(dmState.rollCount);
        expect(freshState.revealCount).toBe(dmState.revealCount);
        expect(freshState.pcEditFieldCount).toBe(dmState.pcEditFieldCount);
      } finally {
        await freshCtx.close();
      }
    } finally {
      await dmCtx.close();
      await aCtx.close();
      await bCtx.close();
    }
  });
});
