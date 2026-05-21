/**
 * M3a per-paragraph reveal e2e (P2-2 acceptance test from
 * design/redesign-plan.md L437+):
 *
 *   "DM hosts, reveals scene 1 paragraph-by-paragraph; player's
 *    Stage DOM contains paragraphs 1-N only; paragraph N+1's
 *    source text is NOT present in the player's DOM."
 *
 * Threat model framing (project_quire_threat_model): this is a
 * paced-disclosure boundary, not a confidentiality one — the
 * scene markdown lives in the campaign repo and any player can
 * fetch it directly.  The DOM-omission test exists to prevent
 * the ACCIDENTAL spoiler path where a curious player opens the
 * browser inspector and sees text the DM hasn't read aloud yet.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession
} from './helpers';

const SLUG = 'test-camp';

async function openCampaignPeer(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (err) => console.log('[browser pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  return page;
}

async function navigateToIntro(page: Page): Promise<void> {
  await page.evaluate(() => {
    const u = new URL(window.location.href);
    u.searchParams.set('episode', '001-test');
    u.searchParams.set('scene', 'scenes/intro.md');
    history.pushState({}, '', u.pathname + u.search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
}

test.describe('M3a per-paragraph reveal — player DOM omission', () => {
  test('player Stage omits unrevealed block text from the DOM', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');
      await navigateToIntro(host);

      // DM whole-scene reveals first so the player can navigate to
      // the page (R3-A bounces non-coord from unrevealed scenes).
      const revealBtn = host.locator(
        '.reveal-control button:has-text("Reveal to players")'
      );
      await expect(revealBtn).toBeVisible({ timeout: 10000 });
      await revealBtn.click();
      await navigateToIntro(guest);
      await expect(guest.locator('header h1')).toContainText(
        'scenes/intro.md',
        { timeout: 10000 }
      );

      // DM Stage shows every block with a clickable gutter pip.
      // intro.md has 3 top-level blocks: H1 "Intro scene",
      // paragraph "A small room…", and a bullet list ("slow drip"
      // / "rust" / "presence").
      await expect(host.locator('.scene-block-pip').first()).toBeVisible({
        timeout: 10000
      });
      await expect(host.locator('.scene-block-pip')).toHaveCount(3);

      // DM clicks the H1 pip (index 0).  Paced mode engages on
      // the player side: only the H1 is now visible.
      await host.locator('.scene-block-pip').nth(0).click();
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('Intro scene');

      // Paragraph + list text MUST NOT appear in the player DOM
      // — this is the load-bearing claim from redesign-plan.md L437.
      const guestHtmlAfterH1 = await guest
        .locator('quire-stage')
        .innerHTML();
      expect(guestHtmlAfterH1).not.toContain('A small room');
      expect(guestHtmlAfterH1).not.toContain('slow drip');
      expect(guestHtmlAfterH1).not.toContain('rust');

      // DM reveals the paragraph (index 1).
      await host.locator('.scene-block-pip').nth(1).click();
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('A small room');
      // Still no list text — that block remains hidden.
      const guestHtmlAfterPara = await guest
        .locator('quire-stage')
        .innerHTML();
      expect(guestHtmlAfterPara).not.toContain('slow drip');

      // DM reveals the list (index 2).
      await host.locator('.scene-block-pip').nth(2).click();
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('slow drip');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('DM keyboard map: j/k walks pips; Cmd+Enter reveals next; b broadcasts', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');
      await navigateToIntro(host);

      // Whole-scene reveal so guest can navigate (R3-A).
      await host
        .locator('.reveal-control button:has-text("Reveal to players")')
        .click();
      await navigateToIntro(guest);
      await expect(host.locator('.scene-block-pip').first()).toBeVisible({
        timeout: 10000
      });

      // Bring host into focus so window-level keydown handler fires.
      await host.bringToFront();
      await host.evaluate(() => document.body.focus());

      // j focuses first pip via the DM keyboard map.
      await host.keyboard.press('j');
      await expect(host.locator('.scene-block-pip').first()).toBeFocused();

      // j again focuses second pip.
      await host.keyboard.press('j');
      await expect(host.locator('.scene-block-pip').nth(1)).toBeFocused();

      // k goes back to first.
      await host.keyboard.press('k');
      await expect(host.locator('.scene-block-pip').first()).toBeFocused();

      // Cmd+Enter reveals the first unrevealed block.
      const modifier =
        process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
      await host.keyboard.press(modifier);
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('Intro scene');

      // Cmd+Enter again moves to + reveals the next.
      await host.keyboard.press(modifier);
      await expect
        .poll(
          async () => guest.locator('quire-stage').innerHTML(),
          { timeout: 10000 }
        )
        .toContain('A small room');

      // b broadcasts.  Player's broadcastView field updates.
      await host.keyboard.press('b');
      await expect
        .poll(
          async () =>
            guest.evaluate(() => {
              const el = document.querySelector('quire-app') as unknown as {
                sessionView?: { shared?: { broadcastView?: { stagePath?: string } } };
              };
              return el?.sessionView?.shared?.broadcastView?.stagePath ?? '';
            }),
          { timeout: 10000 }
        )
        .toContain('intro.md');

      // ' focuses the DM scratch input (silent regression check
      // — pre-FU-1 this hotkey was broken because the lookup
      // queried light DOM instead of the shadow root).
      await host.evaluate(() => document.body.focus());
      await host.keyboard.press("'");
      await expect(host.locator('dm-scratch textarea')).toBeFocused();
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('Cmd+Enter ignores lapsed pips (does not silently drop reveals)', async ({
    browser
  }) => {
    // Regression: pre-fix, Cmd+Enter found the first pip without
    // aria-pressed=true.  Lapsed pips have no aria-pressed at all,
    // so when every real block was revealed AND a lapsed entry
    // existed, Cmd+Enter would click the lapsed pip and silently
    // drop the stale reveal.  Selector now excludes
    // .scene-block-pip-lapsed.
    const ctx = await browser.newContext();
    try {
      const host = await openCampaignPeer(ctx);
      await hostSession(host, 'DM');
      await navigateToIntro(host);
      // Wait for the scene to load + pips to render before
      // manipulating reveals.
      await expect(host.locator('.scene-block-pip').first()).toBeVisible({
        timeout: 10000
      });
      // Synthesize a lapsed reveal entry by calling
      // QuireApp.toggleBlockReveal with a hash that won't match
      // any current block — and reveal every real block first
      // via real pip clicks.
      const pipCount = await host.locator('.scene-block-pip').count();
      for (let i = 0; i < pipCount; i++) {
        await host.locator('.scene-block-pip').nth(i).click();
      }
      await host.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          toggleBlockReveal: (
            fullScenePath: string,
            blockHash: string
          ) => boolean;
        };
        app.toggleBlockReveal(
          'episodes/001-test/scenes/intro.md',
          'aaaaaaaaaaaaaaaa'
        );
      });
      // Now there's a lapsed strip + all real blocks revealed.
      await expect
        .poll(
          async () =>
            host.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                renderRoot: ParentNode;
              };
              return (
                app?.renderRoot.querySelector('.scene-block-lapsed-strip') !==
                null
              );
            }),
          { timeout: 5000 }
        )
        .toBe(true);
      // Cmd+Enter must be a no-op (every real pip is pressed; the
      // selector excludes lapsed pips so no fallback target exists).
      const lapsedCountBefore = await host
        .locator('.scene-block-pip-lapsed')
        .count();
      await host.evaluate(() => document.body.focus());
      const modifier =
        process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter';
      await host.keyboard.press(modifier);
      // Lapsed pip count is unchanged — Cmd+Enter did not click it.
      // (Brief wait to allow any erroneous render.)
      await host.waitForTimeout(200);
      const lapsedCountAfter = await host
        .locator('.scene-block-pip-lapsed')
        .count();
      expect(lapsedCountAfter).toBe(lapsedCountBefore);
    } finally {
      await ctx.close();
    }
  });
});
