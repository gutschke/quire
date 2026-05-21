/**
 * R3-C: a player who arrives at play.quire.games (no URL params)
 * and enters a join code should be brought into the full campaign
 * experience.  Before this fix, they'd land on "No campaign loaded"
 * even after joining successfully.
 *
 * Mechanism: the host's peer-join event embeds the campaign
 * reference; the guest's app subscribes to sessionView.shared.campaign
 * and triggers a campaign load + navigation as soon as it learns.
 */

import { test, expect } from '@playwright/test';
import {
  openCampaign,
  appUrl,
  campaignUrl,
  mockFixtureCampaign,
  hostSession,
  soloPanel,
  activePanel
} from './helpers';

const SLUG = 'test-camp';

test.describe('R3-C — guest joining without campaign URL discovers it via session', () => {
  test('player at play.quire.games + code → auto-loads campaign', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      // DM opens campaign normally + hosts.
      const dm = await openCampaign(hostCtx, SLUG);
      const code = await hostSession(dm, 'DM');

      // Player opens play.quire.games root — no campaign URL param.
      const guest = await guestCtx.newPage();
      // We still need to mock the GitHub fetch the guest will
      // eventually attempt (after they learn the campaign).
      await mockFixtureCampaign(guest, SLUG);
      await guest.goto(appUrl({})); // root, no params
      await guest.locator('.session-bar').first().waitFor();

      // Guest fills name + code, joins.
      await soloPanel(guest).locator('input.session-name').fill('Player');
      await soloPanel(guest).locator('input.session-code').fill(code);
      await soloPanel(guest).getByRole('button', { name: /^join$/i }).click();
      await expect(activePanel(guest)).toBeVisible({ timeout: 30000 });

      // After join, the host's peer-join event arrives carrying the
      // campaign info.  Guest should auto-load and navigate to the
      // campaign view (header h1 has the campaign name).
      await expect(guest.locator('header h1')).toContainText(
        'Test Campaign',
        { timeout: 15000 }
      );
      // URL should now reflect the campaign too.
      await expect.poll(() => new URL(guest.url()).searchParams.get('campaign'), {
        timeout: 5000
      }).toBe(`test/${SLUG}`);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('guest with explicit ?campaign= URL still works (no override)', async ({
    browser
  }) => {
    // Guest who DOES open a campaign URL should not be disrupted by
    // the campaign-from-event auto-load.
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const dm = await openCampaign(hostCtx, SLUG);
      const code = await hostSession(dm, 'DM');

      const guest = await openCampaign(guestCtx, SLUG);
      await soloPanel(guest).locator('input.session-name').fill('Player');
      await soloPanel(guest).locator('input.session-code').fill(code);
      await soloPanel(guest).getByRole('button', { name: /^join$/i }).click();
      await expect(activePanel(guest)).toBeVisible({ timeout: 30000 });

      // Still on the campaign view.  Not bounced around.
      await expect(guest.locator('header h1')).toContainText('Test Campaign');
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
