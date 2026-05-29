/**
 * #407 / #417 — magic-arc UI moments, proved in a real browser.
 *
 * The firewall is covered by `magic-arc-firewall.spec.ts` (DM-only data
 * never crosses to the player projection).  This spec exercises the
 * *UI* side of the arc on the PC's OWN player — the things only a
 * browser can see:
 *
 *   A2 — the one-shot "The world tilts." act-break treatment fires at
 *        the moment of Realization, then auto-clears after ~6s,
 *        leaving the steady "The Quiet" card behind.
 *   A4 — the amber "Trying too hard — −2 to casts you reach for"
 *        line appears while tax.active.
 *   A5 — releasing tax (DM clears tax.active) removes the amber line
 *        while the steady casting card stays.
 *
 * Walks a 2-peer setup (DM + 1 player) over the real PeerJS broker.
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

/** Poll until `pcId` has gossiped into this peer's projected state. */
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

/** Poll until `knowsTheyCanCast` is reflected in this peer's pcEdits. */
async function waitKnowsTheyCanCast(
  page: Page,
  pcId: string,
  expected: boolean
): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const app = document.querySelector('quire-app') as unknown as {
            sessionView: {
              filteredShared: {
                pcEdits: Record<string, Record<string, unknown>>;
              };
            };
          };
          return app.sessionView.filteredShared.pcEdits[id]?.knowsTheyCanCast;
        }, pcId),
      { timeout: 20000 }
    )
    .toBe(expected);
}

test.describe('#407 magic-arc UI — realization moment + tax legibility (real browser)', () => {
  test('PC-A sees "The world tilts." at Realization, auto-clears, amber tax stays; release clears tax', async ({
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

      // DM seeds + binds the PC (slot 1).
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

      // Wait for player-A's campaign to load BEFORE claiming the PC.
      // refreshBoundCharacter reads getCurrentCampaign() inside the
      // session subscriber; if the campaign-load is still in-flight
      // when the rename event materializes, `campaign` is null and
      // boundCharacter is left null with no further trigger to re-
      // hydrate.  Polling here closes the race deterministically.
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

      // Player-A claims the PC so the runtime's own-PC resolver
      // (peers[playerA].pcId) gates the #398 reveal correctly.
      await playerA.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { rename: (opts: { pcId: string }) => void };
        };
        app.session.rename({ pcId: pc });
      }, PC);

      await waitPcSynced(playerA, PC);

      // Wait for the rail to have ACTUALLY rendered the bound PC.  The
      // PC's name <h1> is always rendered — its presence proves
      // player-rail's first willUpdate ran with knowsTheyCanCast=false,
      // setting the realization-baseline so the next render sees a
      // genuine false→true transition.  Without this, fast-broker race:
      // DM's Realization event lands before the rail's first render,
      // baseline is captured as already-true, no transition fires.
      await expect(
        playerA.locator('player-rail').locator('h1', { hasText: 'Mei' })
      ).toBeVisible({ timeout: 15000 });
      // Pre-Realization: no casting card on PC-A's rail (silent-player
      // firewall — the player must not even know casting exists yet).
      await expect(playerA.locator('.player-rail-casting')).toHaveCount(0);

      // DM delivers Realization.  This MUST happen after player-A is
      // already watching the PC so the false→true transition fires the
      // one-shot "world tilts" treatment locally.
      await dm.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          appendMarkRealization: (pcId: string) => boolean;
        };
        app.appendMarkRealization(pc);
      }, PC);

      // --- A2: the one-shot act-break treatment ---
      // The moment renders with both the threshold class AND the
      // "The world tilts." line, alongside the steady "The Quiet" card.
      await waitKnowsTheyCanCast(playerA, PC, true);
      const moment = playerA.locator('.player-rail-casting-moment');
      await expect(moment).toBeVisible({ timeout: 10000 });
      await expect(moment).toContainText('The world tilts');
      await expect(
        playerA.locator('.player-rail-casting.player-rail-casting-threshold')
      ).toBeVisible();
      await expect(playerA.locator('.player-rail-casting-known')).toContainText(
        /shape the Quiet/i
      );

      // --- A4: amber tax line is up alongside the moment ---
      // appendMarkRealization sets BOTH knowsTheyCanCast + tax.active
      // per rules.md:174-188, so the amber −2 line is visible.
      const tax = playerA.locator('.player-rail-casting-tax');
      await expect(tax).toBeVisible();
      await expect(tax).toContainText(/Trying too hard/);
      await expect(tax).toContainText('−2');

      // --- A2 cont.: the moment auto-clears after ~6s ---
      // REALIZATION_MOMENT_MS = 6000; give a 5s grace window.  After
      // the timer fires the threshold class drops, the "world tilts"
      // line vanishes, but the steady casting card stays.
      await expect(moment).toBeHidden({ timeout: 11000 });
      await expect(
        playerA.locator('.player-rail-casting.player-rail-casting-threshold')
      ).toHaveCount(0);
      await expect(playerA.locator('.player-rail-casting')).toBeVisible();
      await expect(playerA.locator('.player-rail-casting-known')).toContainText(
        /shape the Quiet/i
      );
      // Tax line is independent of the moment timer — still up.
      await expect(tax).toBeVisible();

      // --- A5: DM releases the tax → amber line clears, card stays ---
      await dm.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          submitPcEdit: (pcId: string, field: string, value: unknown) => boolean;
        };
        app.submitPcEdit(pc, 'tax.active', false);
      }, PC);

      await expect(tax).toBeHidden({ timeout: 10000 });
      await expect(playerA.locator('.player-rail-casting')).toBeVisible();
      await expect(playerA.locator('.player-rail-casting-known')).toContainText(
        /shape the Quiet/i
      );
    } finally {
      await dmCtx.close();
      await aCtx.close();
    }
  });
});
