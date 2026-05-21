/**
 * Accessibility scans via axe-core on each major view.  We fail on
 * any 'critical' or 'serious' violations — incomplete-color-contrast
 * issues at lighter severities are still surfaced in the report but
 * don't block the test, so a designer-led pass can address them
 * later.
 */

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { openApp } from './helpers';
import {
  openCampaign,
  mockFixtureCampaign,
  campaignUrl
} from './helpers';

const SLUG = 'test-camp';

async function expectNoSeriousA11y(page: import('@playwright/test').Page) {
  const results = await new AxeBuilder({ page })
    // Scan everything reachable from the document; we don't restrict
    // scope because the app's content is inside the Lit shadow root
    // which axe-core handles natively.
    .analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious'
  );
  if (blocking.length) {
    console.log(
      'axe blocking violations:',
      JSON.stringify(
        blocking.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length })),
        null,
        2
      )
    );
  }
  expect(blocking).toEqual([]);
}

test.describe('Accessibility — major views', () => {
  test('home / idle view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });

  test('campaign view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG);
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });

  test('episode view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, { episode: '001-test' });
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });

  test('scene view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, {
        episode: '001-test',
        scene: 'scenes/intro.md'
      });
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });

  test('PC character sheet', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, { pc: 'test-pc' });
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });

  test('NPC character sheet', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openCampaign(ctx, SLUG, { npc: 'test-npc' });
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });

  test('error view', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await ctx.newPage();
      await page.route(
        '**/raw.githubusercontent.com/**',
        async (route) => {
          await route.fulfill({ status: 404, body: '' });
        }
      );
      await page.goto(campaignUrl('nonsense'));
      await page.locator('.card.error').waitFor({ timeout: 15000 });
      await expectNoSeriousA11y(page);
    } finally {
      await ctx.close();
    }
  });
});
