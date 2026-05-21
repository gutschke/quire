/**
 * Phase 4 — multi-session continuity.
 *
 * The headline scenario: DM and player play through Session 1,
 * DM saves to a JSON file, everyone closes their browsers, comes
 * back next week, DM loads the save, reclaims coordinator, players
 * rejoin, session continues with new events on top of the prior
 * history.
 *
 * Also covers the supported "sick-DM-handoff" scenario: the
 * original DM is offline next week, a trusted player loads the
 * save and reclaims coordinator (deliberate action with audit
 * trail visible to all peers).
 */

import { test, expect, type BrowserContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession,
  soloPanel,
  activePanel,
  chatList,
  sendChat
} from './helpers';

const SLUG = 'test-camp';

async function openPersona(context: BrowserContext) {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

test.describe('Multi-session continuity (Phase 4)', () => {
  test('save session 1 → reopen → load → reclaim → continue session 2', async ({
    browser
  }) => {
    test.setTimeout(120_000);

    // ----- SESSION 1 -----
    const dmCtx1 = await browser.newContext();
    const playerCtx1 = await browser.newContext();
    let savedJson: string;

    try {
      const dm1 = await openPersona(dmCtx1);
      const player1 = await openPersona(playerCtx1);

      const code1 = await hostSession(dm1, 'DM');
      await joinSession(player1, code1, 'Yui');

      // Build some session-1 state.
      await sendChat(dm1, 'session 1 opening message');
      await sendChat(player1, "Yui's first line");
      await expect(chatList(dm1)).toContainText('session 1 opening message');
      await expect(chatList(player1)).toContainText("Yui's first line");

      // DM saves.  Read the download into memory BEFORE closing
      // the context — the temp file is cleaned up at context
      // teardown.
      const downloadPromise = dm1.waitForEvent('download');
      await dm1.locator('.session-bar button:has-text("Save")').click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      savedJson = readFileSync(downloadPath, 'utf8');
      expect(savedJson).toContain('session 1 opening message');
      expect(savedJson).toContain("Yui's first line");
    } finally {
      await dmCtx1.close();
      await playerCtx1.close();
    }

    // ----- SESSION 2 (next week) -----
    const dmCtx2 = await browser.newContext();
    const playerCtx2 = await browser.newContext();

    try {
      const dm2 = await openPersona(dmCtx2);
      const player2 = await openPersona(playerCtx2);

      // DM hosts a fresh session.
      const code2 = await hostSession(dm2, 'DM');
      expect(code2).toMatch(/^[A-Z2-9]+$/);

      // DM loads the saved file.  setInputFiles drives the
      // hidden file <input> in the session bar's Load label.
      await dm2.locator('.session-load-label input[type=file]').setInputFiles({
        name: 'session1.json',
        mimeType: 'application/json',
        buffer: Buffer.from(savedJson)
      });
      // Allow apply to settle.
      await dm2.waitForTimeout(500);

      // Session-1 chat should now be visible to DM2.
      await expect(chatList(dm2)).toContainText(
        'session 1 opening message',
        { timeout: 5000 }
      );

      // Host-loads-save: DM2 is unambiguously coordinator after
      // load (either their own coord-claim won the causal-order
      // tiebreak, or auto-reclaim kicked in to override the
      // session-1 coord-claim).  Either path is fine; we assert
      // by peerId equivalence to be deterministic.  When auto-
      // reclaim fired, an audit chat entry is also present.
      await expect
        .poll(
          async () =>
            await dm2.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  peerId: string;
                  shared: { coordinator: string | undefined };
                };
              };
              return app.sessionView.shared.coordinator ===
                app.sessionView.peerId;
            }),
          { timeout: 5000 }
        )
        .toBe(true);

      // Player joins the new session.
      await joinSession(player2, code2, 'Yui');

      // Player sees session-1 state replicated via gossip.  The
      // audit message only appears when DM2's load actually
      // triggered an auto-reclaim (only when the causal tiebreak
      // landed in old-DM's favor) — non-deterministic, so we
      // don't assert it here.
      await expect(chatList(player2)).toContainText('session 1 opening message', {
        timeout: 15000
      });
      await expect(chatList(player2)).toContainText("Yui's first line", {
        timeout: 5000
      });

      // Session 2 continues with new events.
      await sendChat(dm2, 'and now session 2 begins');
      await expect(chatList(player2)).toContainText('and now session 2 begins', {
        timeout: 10000
      });
    } finally {
      await dmCtx2.close();
      await playerCtx2.close();
    }
  });

  test('sick-DM handoff: a different peer can reclaim and continue', async ({
    browser
  }) => {
    test.setTimeout(120_000);

    // Session 1 — original DM saves
    const dmCtx1 = await browser.newContext();
    let savedJson: string;
    try {
      const dm1 = await openPersona(dmCtx1);
      await hostSession(dm1, 'Original DM');
      await sendChat(dm1, 'campaign setup');
      const downloadPromise = dm1.waitForEvent('download');
      await dm1.locator('.session-bar button:has-text("Save")').click();
      const dl = await downloadPromise;
      savedJson = readFileSync(await dl.path(), 'utf8');
    } finally {
      await dmCtx1.close();
    }
    expect(savedJson!).toBeTruthy();

    // Session 2 — a DIFFERENT peer takes over (sick-DM scenario).
    // The original DM doesn't have to be the one who reclaims.
    const substituteCtx = await browser.newContext();
    try {
      const sub = await openPersona(substituteCtx);
      const code = await hostSession(sub, 'Substitute');
      await sub
        .locator('.session-load-label input[type=file]')
        .setInputFiles({
          name: 'session1.json',
          mimeType: 'application/json',
          buffer: Buffer.from(savedJson)
        });
      await sub.waitForTimeout(500);
      await expect(chatList(sub)).toContainText('campaign setup', {
        timeout: 5000
      });
      // Substitute is now the host of session 2 — they are
      // unambiguously coordinator (either via their own claim
      // winning the causal tiebreak, or via auto-reclaim if the
      // old DM's claim sorted ahead).  Assert by peerId, not by
      // audit chat (which only appears when reclaim was needed).
      await expect
        .poll(
          async () =>
            await sub.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  peerId: string;
                  shared: { coordinator: string | undefined };
                };
              };
              return app.sessionView.shared.coordinator ===
                app.sessionView.peerId;
            }),
          { timeout: 5000 }
        )
        .toBe(true);
      // Substitute can now reveal scenes (coordinator powers).
      await sub.evaluate(() => {
        const u = new URL(window.location.href);
        u.searchParams.set('episode', '001-test');
        u.searchParams.set('scene', 'scenes/intro.md');
        window.history.pushState({}, '', u.pathname + u.search);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      const revealBtn = sub.locator(
        '.reveal-control button:has-text("Reveal to players")'
      );
      await expect(revealBtn).toBeVisible({ timeout: 10000 });
      await revealBtn.click();
      // Reveal landed in shared state — coordinator-gated reveal worked.
      await expect
        .poll(
          async () =>
            await sub.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: { shared: { revealedScenes: string[] } };
              };
              return app.sessionView.shared.revealedScenes.length;
            }),
          { timeout: 5000 }
        )
        .toBeGreaterThan(0);
    } finally {
      await substituteCtx.close();
    }
  });

  test('cross-campaign load is refused (no merge)', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openPersona(ctx);
      await hostSession(page, 'DM');
      // Inject a save that references a different campaign.
      const wrongCampaignSave = JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: new Date().toISOString(),
        campaign: { owner: 'other', repo: 'different', ref: 'main' },
        savedByPeerId: 'whoever',
        events: []
      });
      await page.locator('.session-load-label input[type=file]').setInputFiles({
        name: 'wrong.json',
        mimeType: 'application/json',
        buffer: Buffer.from(wrongCampaignSave)
      });
      await page.waitForTimeout(500);
      await expect(page.locator('.save-status.save-error')).toContainText(
        /other\/different/,
        { timeout: 5000 }
      );
    } finally {
      await ctx.close();
    }
  });

  test('malformed save shows clear error, app stays usable', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openPersona(ctx);
      await hostSession(page, 'DM');
      await page
        .locator('.session-load-label input[type=file]')
        .setInputFiles({
          name: 'broken.json',
          mimeType: 'application/json',
          buffer: Buffer.from('not valid json')
        });
      await page.waitForTimeout(500);
      await expect(page.locator('.save-status.save-error')).toBeVisible({
        timeout: 5000
      });
      // Session is still active and usable.
      await expect(activePanel(page)).toBeVisible();
      await sendChat(page, 'still works');
      await expect(chatList(page)).toContainText('still works', {
        timeout: 5000
      });
    } finally {
      await ctx.close();
    }
  });
});
