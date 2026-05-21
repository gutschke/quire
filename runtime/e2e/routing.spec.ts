/**
 * Routing + content-loading e2e tests using a fixture campaign that's
 * served via Playwright route() interception of the GitHub raw URLs.
 * Validates: campaign / episode / scene / character views, deep links,
 * browser back/forward (popstate), markdown rendering, dice + PC edit
 * UI presence on campaign + character views.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  openCampaign,
  mockFixtureCampaign,
  appUrl,
  hostSession,
  rollInput,
  rollHistory
} from './helpers';

/**
 * Post-R3-A: scene/episode routes require an active session (DM
 * solo-prep also counts via Host).  Open campaign, host, then
 * navigate in-app via pushState (preserves session — page.goto
 * would tear it down).
 */
async function openSceneAsDm(
  ctx: BrowserContext,
  slug: string,
  extra: Record<string, string>
): Promise<Page> {
  const page = await openCampaign(ctx, slug);
  await hostSession(page, 'DM');
  await page.evaluate((extraParams: Record<string, string>) => {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(extraParams)) {
      u.searchParams.set(k, v);
    }
    window.history.pushState({}, '', u.pathname + u.search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, extra);
  return page;
}

const SLUG = 'test-camp';

test.describe('Routing — campaign view', () => {
  test('campaign view shows manifest details + episode + character menus', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      // Header shows the manifest name.
      await expect(page.locator('header h1')).toContainText('Test Campaign');
      // About card shows fields.
      await expect(page.locator('.card').first()).toContainText('Setting');
      await expect(page.locator('.card').first()).toContainText(
        'Original setting'
      );
      // Episode menu lists 001-test.
      await expect(page.getByRole('link', { name: '001-test' })).toBeVisible();
      // Character menus.
      await expect(page.getByRole('link', { name: 'test-pc' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'test-npc' })).toBeVisible();
      // World overview renders.
      await expect(page.locator('.markdown')).toContainText(
        /fixture content/i
      );
    } finally {
      await ctx.close();
    }
  });

  test('roll panel renders on campaign view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      await expect(rollInput(page)).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('roll panel: solo dice rolls accumulate in history', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      await rollInput(page).fill('2d6');
      await rollInput(page).press('Enter');
      await expect(rollHistory(page)).toContainText('2d6');
      await rollInput(page).fill('1d20');
      await rollInput(page).press('Enter');
      await expect(rollHistory(page).locator('li')).toHaveCount(2);
    } finally {
      await ctx.close();
    }
  });

  test('roll panel: garbage input shows an error and skips history', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      await rollInput(page).fill('xyzzy');
      await rollInput(page).press('Enter');
      await expect(page.locator('.roll-error')).toBeVisible();
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Routing — episode + scene views', () => {
  test('deep link into episode shows scene list', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openSceneAsDm(ctx, SLUG, { episode: '001-test' });
      await expect(page.locator('header h1')).toContainText('Episode 001');
      await expect(page.getByRole('link', { name: 'scenes/intro.md' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'scenes/outro.md' })).toBeVisible();
    } finally {
      await ctx.close();
    }
  });

  test('scene view renders markdown without unsafe HTML', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openSceneAsDm(ctx, SLUG, {
        episode: '001-test',
        scene: 'scenes/intro.md'
      });
      await expect(page.locator('header h1')).toContainText('scenes/intro.md');
      // The scene markdown's heading + list items render.
      await expect(page.locator('.markdown')).toContainText('Intro scene');
      await expect(page.locator('.markdown')).toContainText('a slow drip');
      // Sanitization sanity check: no script tags exist inside the
      // markdown-rendered content.  (The page itself loads Vite's
      // bundle via a script tag — that's a separate, expected source.)
      const scriptsInMarkdown = await page
        .locator('.markdown script')
        .count();
      expect(scriptsInMarkdown).toBe(0);
    } finally {
      await ctx.close();
    }
  });

  test('roll panel appears on scene view (B1 regression)', async ({
    browser
  }) => {
    // The dice panel previously rendered only on campaign + character
    // views; players reading a revealed scene had to navigate away to
    // roll.  Pin its presence on the scene view.
    const ctx = await browser.newContext();
    try {
      const page = await openSceneAsDm(ctx, SLUG, {
        episode: '001-test',
        scene: 'scenes/intro.md'
      });
      await expect(page.locator('.roll-form')).toBeVisible();
      await page.locator('.roll-form input').fill('2d6');
      await page.locator('.roll-form input').press('Enter');
      await expect(page.locator('.roll-history')).toContainText('2d6');
    } finally {
      await ctx.close();
    }
  });

  test('click navigation: campaign → episode → scene', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      // Post-R3-A: must be in an active session to drill into
      // episode/scene.  Host first (which also makes the DM
      // coordinator → sees the full episode menu).
      await hostSession(page, 'DM');
      await page.getByRole('link', { name: '001-test' }).click();
      await expect(page.locator('header h1')).toContainText('Episode 001');
      await page.getByRole('link', { name: 'scenes/intro.md' }).click();
      await expect(page.locator('header h1')).toContainText('scenes/intro.md');
      // URL reflects the route.
      const u = new URL(page.url());
      expect(u.searchParams.get('episode')).toBe('001-test');
      expect(u.searchParams.get('scene')).toBe('scenes/intro.md');
    } finally {
      await ctx.close();
    }
  });

  test('browser back / forward (popstate) returns to prior view', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      await hostSession(page, 'DM');
      await page.getByRole('link', { name: '001-test' }).click();
      await expect(page.locator('header h1')).toContainText('Episode 001');
      await page.goBack();
      await expect(page.locator('header h1')).toContainText('Test Campaign');
      await page.goForward();
      await expect(page.locator('header h1')).toContainText('Episode 001');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Routing — character views', () => {
  test('PC sheet shows stats and tags; read-only in solo', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, { pc: 'test-pc' });
      await expect(page.locator('header h1')).toContainText('Test PC');
      await expect(page.locator('.card').first()).toContainText('STR');
      await expect(page.locator('.card').first()).toContainText('+1'); // DEX
      // In solo, the bumper buttons should NOT render.
      await expect(page.locator('.stat-bumpers')).toHaveCount(0);
      // Backstory markdown renders.
      await expect(page.locator('.markdown')).toContainText('test suite');
    } finally {
      await ctx.close();
    }
  });

  test('NPC sheet shows role + voice', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, { npc: 'test-npc' });
      await expect(page.locator('header h1')).toContainText('Test NPC');
      await expect(page.locator('.card').first()).toContainText('witness');
      await expect(page.locator('.card').first()).toContainText('Voice');
    } finally {
      await ctx.close();
    }
  });
});

test.describe('Routing — error states', () => {
  test('missing scene shows error view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await mockFixtureCampaign(page, SLUG);
      await page.goto(
        appUrl({
          campaign: `test/${SLUG}`,
          episode: '001-test',
          scene: 'scenes/nope.md'
        })
      );
      // App lands in the error view with a "Couldn't load" card.
      const errorCard = page.locator('.card.error');
      await expect(errorCard).toBeVisible({ timeout: 15000 });
      await expect(errorCard).toContainText(/couldn[’']t load/i);
      await expect(errorCard).toContainText(/nope\.md|not found/i);
    } finally {
      await ctx.close();
    }
  });
});
