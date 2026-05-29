/**
 * #396 / #401 / #408 / #417 — advancement-loop UI proof in a real browser.
 *
 * Player-rail rules:
 *   D1 — Below 5 ticked advancement-mark bullets the rail shows
 *        NOTHING for advancement (prime directive: no progress meter
 *        to grind; the DM holds the precise count on the wrap sheet).
 *   D2 — At 5 ticked bullets the rail surfaces a single line:
 *        "✦ Advancement ready — pick one with your DM between
 *        sessions."
 *
 * Drives DM + 1 player over the real PeerJS broker; DM ticks bullets
 * via pc-edit events; player's rail polls reflect them.
 *
 * (D3 — "Advancement taken — reset marks" affordance — lives in the
 * wrap/carryover surface; covered separately if/when needed.)
 */

import {
  test,
  expect,
  type BrowserContext,
  type Page
} from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession
} from './helpers';

const SLUG = 'test-camp';
const PC = 'pc-mei';
const MARK_KEYS = [
  'hardMoment',
  'learned',
  'risk',
  'against',
  'complication'
] as const;

async function openCampaignPeer(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (err) =>
    console.log('[browser pageerror]', err.message)
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  return page;
}

async function waitPcSynced(page: Page, pcId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const app = document.querySelector('quire-app') as unknown as {
            sessionView?: {
              filteredShared?: { synthesizedPcs?: Record<string, unknown> };
            };
          };
          return Boolean(app.sessionView?.filteredShared?.synthesizedPcs?.[id]);
        }, pcId),
      { timeout: 20000 }
    )
    .toBe(true);
}

test.describe('advancement arc — player rail (real browser)', () => {
  test('D1: no meter below 5 marks; D2: "✦ Advancement ready" surfaces exactly at 5', async ({
    browser
  }) => {
    test.setTimeout(120_000);
    const dmCtx = await browser.newContext();
    const aCtx = await browser.newContext();
    try {
      const dm = await openCampaignPeer(dmCtx);
      const playerA = await openCampaignPeer(aCtx);

      const code = await hostSession(dm, 'DM');
      await joinSession(playerA, code, 'Player-A');

      // DM seeds + binds the PC.
      await dm.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { append: (kind: string, payload: unknown) => void };
        };
        app.session.append('seat-add', { v: 1, slot: 1 });
        app.session.append('pc-create', {
          v: 1,
          pcId: pc,
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
          skills: ['Tech'],
          backstory: 'public backstory'
        });
        app.session.append('pc-slot-bind', { v: 1, slot: 1, pcId: pc });
      }, PC);

      // Wait for the campaign to finish loading on player-A before the
      // rename event materializes (see [[boundCharacter race]] in
      // task #419 — without this, refreshBoundCharacter races the
      // async campaign-load and leaves boundCharacter null).
      await expect
        .poll(
          async () =>
            playerA.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                getCurrentCampaign?: () => unknown;
              };
              return Boolean(app.getCurrentCampaign?.());
            }),
          { timeout: 20000 }
        )
        .toBe(true);

      // Player-A claims the PC.
      await playerA.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { rename: (opts: { pcId: string }) => void };
        };
        app.session.rename({ pcId: pc });
      }, PC);

      await waitPcSynced(playerA, PC);
      await expect(
        playerA.locator('player-rail').locator('h1', { hasText: 'Mei' })
      ).toBeVisible({ timeout: 15000 });

      // --- D1: pre-marks → no chip ---
      await expect(
        playerA.locator('.player-rail-advancement-ready')
      ).toHaveCount(0);

      // DM ticks 4 of the 5 mark bullets — still below threshold.
      for (let i = 0; i < 4; i++) {
        await dm.evaluate(
          ({ pc, key }) => {
            const app = document.querySelector('quire-app') as unknown as {
              submitPcEdit: (
                pcId: string,
                field: string,
                value: unknown
              ) => boolean;
            };
            app.submitPcEdit(pc, `markBullets.${key}`, true);
          },
          { pc: PC, key: MARK_KEYS[i] }
        );
      }
      // Wait for the 4th mark to materialize on player-A's projection.
      await expect
        .poll(
          async () =>
            playerA.evaluate((pc) => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  filteredShared: {
                    pcEdits: Record<string, Record<string, unknown>>;
                  };
                };
              };
              const e = app.sessionView.filteredShared.pcEdits[pc] ?? {};
              return (
                (e['markBullets.against'] === true ? 1 : 0) +
                (e['markBullets.hardMoment'] === true ? 1 : 0) +
                (e['markBullets.learned'] === true ? 1 : 0) +
                (e['markBullets.risk'] === true ? 1 : 0)
              );
            }, PC),
          { timeout: 15000 }
        )
        .toBe(4);

      // --- D1: still no chip at 4/5 (the "no meter to grind" rule) ---
      await expect(
        playerA.locator('.player-rail-advancement-ready')
      ).toHaveCount(0);

      // DM ticks the 5th — threshold crossed.
      await dm.evaluate(
        ({ pc, key }) => {
          const app = document.querySelector('quire-app') as unknown as {
            submitPcEdit: (
              pcId: string,
              field: string,
              value: unknown
            ) => boolean;
          };
          app.submitPcEdit(pc, `markBullets.${key}`, true);
        },
        { pc: PC, key: MARK_KEYS[4] }
      );

      // --- D2: chip appears at exactly 5, with the prime-directive copy ---
      const chip = playerA.locator('.player-rail-advancement-ready');
      await expect(chip).toBeVisible({ timeout: 15000 });
      await expect(chip).toContainText(/Advancement ready/);
      await expect(chip).toContainText(/pick one with your DM/);
      // No numeric tally on the player side (prime directive: growth is
      // felt in fiction, not counted on the sheet).
      await expect(chip).not.toContainText(/5\/5/);
      await expect(chip).not.toContainText(/Growth:/);
    } finally {
      await dmCtx.close();
      await aCtx.close();
    }
  });
});
