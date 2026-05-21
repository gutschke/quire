/**
 * AI panel e2e — both providers exercised with page.route() so no real
 * API keys are needed.  Verifies provider switching, response display,
 * error handling, and share-to-chat behavior.
 */

import { test, expect, type Page } from '@playwright/test';
import { openApp, aiPanel, hostSession, chatList, soloPanel } from './helpers';

const CLAUDE_HOST = 'api.anthropic.com';
const GEMINI_HOST = 'generativelanguage.googleapis.com';

async function mockClaude(
  page: Page,
  respond: (req: { user: string; system?: string }) => Promise<{
    status?: number;
    body?: unknown;
    delayMs?: number;
  }>
): Promise<void> {
  await page.route(`**/${CLAUDE_HOST}/v1/messages`, async (route) => {
    const json = JSON.parse(route.request().postData() ?? '{}');
    const user =
      Array.isArray(json.messages) && json.messages[0]
        ? String(json.messages[0].content ?? '')
        : '';
    const result = await respond({ user, system: json.system });
    if (result.delayMs) await new Promise((r) => setTimeout(r, result.delayMs));
    await route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        result.body ?? {
          content: [{ type: 'text', text: 'mocked response' }]
        }
      )
    });
  });
}

async function mockGemini(
  page: Page,
  respond: (req: { user: string; system?: string }) => Promise<{
    status?: number;
    body?: unknown;
  }>
): Promise<void> {
  await page.route(`**/${GEMINI_HOST}/**`, async (route) => {
    const json = JSON.parse(route.request().postData() ?? '{}');
    const user =
      Array.isArray(json.contents) &&
      json.contents[0] &&
      Array.isArray(json.contents[0].parts) &&
      json.contents[0].parts[0]
        ? String(json.contents[0].parts[0].text ?? '')
        : '';
    const system = json.systemInstruction?.parts?.[0]?.text;
    const result = await respond({ user, system });
    await route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        result.body ?? {
          candidates: [
            {
              content: { parts: [{ text: 'mocked gemini' }] },
              finishReason: 'STOP'
            }
          ]
        }
      )
    });
  });
}

async function configureAi(
  page: Page,
  provider: 'claude' | 'gemini',
  key: string
): Promise<void> {
  // Settings auto-show when no key is set, but once a key exists they
  // collapse to the prompt-only view.  Toggle them open so we can
  // reach the provider radio and the (per-provider) key field.
  const toggle = aiPanel(page).getByRole('button', {
    name: /(show|settings)/i
  });
  const settingsVisible = await aiPanel(page).locator('.ai-settings').isVisible();
  if (!settingsVisible) await toggle.click();
  await aiPanel(page)
    .locator('input[type=radio][name=ai-provider]')
    .nth(provider === 'claude' ? 0 : 1)
    .check();
  await aiPanel(page).locator('input[type=password]').fill(key);
}

async function askAi(page: Page, prompt: string): Promise<void> {
  await aiPanel(page).locator('.ai-form textarea').fill(prompt);
  await aiPanel(page).getByRole('button', { name: /^ask$/i }).click();
}

test.describe('AI panel — Claude (mocked)', () => {
  test('happy path: prompt → response shown in panel', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await mockClaude(page, async () => ({
        body: {
          content: [{ type: 'text', text: 'the cabin smells like sleep.' }]
        }
      }));
      await configureAi(page, 'claude', 'sk-ant-fake');
      await askAi(page, 'describe the cabin');
      await expect(aiPanel(page).locator('.ai-response')).toContainText(
        'the cabin smells like sleep'
      );
    } finally {
      await ctx.close();
    }
  });

  test('error path: API 500 surfaces as a panel error', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await mockClaude(page, async () => ({
        status: 500,
        body: { error: { message: 'upstream blew up' } }
      }));
      await configureAi(page, 'claude', 'sk-ant-fake');
      await askAi(page, 'hello');
      await expect(aiPanel(page).locator('.ai-error')).toBeVisible();
      await expect(aiPanel(page).locator('.ai-error')).toContainText(/500/);
    } finally {
      await ctx.close();
    }
  });

  test('share-to-chat posts response into the active session', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const hostPage = await openApp(hostCtx);
      const guestPage = await openApp(guestCtx);

      await mockClaude(hostPage, async () => ({
        body: { content: [{ type: 'text', text: 'mocked DM aside' }] }
      }));
      await configureAi(hostPage, 'claude', 'sk-ant-fake');

      const code = await hostSession(hostPage, 'DM');
      // Guest joins.
      await soloPanel(guestPage).locator('input.session-name').fill('Player');
      await soloPanel(guestPage).locator('input.session-code').fill(code);
      await soloPanel(guestPage)
        .getByRole('button', { name: /^join$/i })
        .click();
      await expect(
        guestPage.locator('.session-bar.session-active')
      ).toBeVisible({ timeout: 30000 });

      await askAi(hostPage, 'describe the cabin');
      await expect(hostPage.locator('.ai-response')).toContainText(
        'mocked DM aside'
      );
      await hostPage
        .locator('.ai-response')
        .getByRole('button', { name: /share to chat/i })
        .click();
      await expect(chatList(hostPage)).toContainText('[AI] mocked DM aside');
      await expect(chatList(guestPage)).toContainText(
        '[AI] mocked DM aside',
        { timeout: 10000 }
      );
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});

test.describe('AI panel — Gemini (mocked)', () => {
  test('happy path: prompt → response shown in panel', async ({ browser }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await mockGemini(page, async () => ({
        body: {
          candidates: [
            {
              content: { parts: [{ text: 'gemini observation' }] },
              finishReason: 'STOP'
            }
          ]
        }
      }));
      await configureAi(page, 'gemini', 'AIza-fake');
      await askAi(page, 'describe the cabin');
      await expect(aiPanel(page).locator('.ai-response')).toContainText(
        'gemini observation'
      );
    } finally {
      await ctx.close();
    }
  });

  test('safety-blocked response surfaces a readable error', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      await mockGemini(page, async () => ({
        body: {
          candidates: [{ finishReason: 'SAFETY' }]
        }
      }));
      await configureAi(page, 'gemini', 'AIza-fake');
      await askAi(page, 'risky prompt');
      await expect(aiPanel(page).locator('.ai-error')).toContainText(
        /SAFETY|declined/
      );
    } finally {
      await ctx.close();
    }
  });

  test('provider switch routes the request to the correct endpoint', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const page = await openApp(ctx);
      let claudeCalls = 0;
      let geminiCalls = 0;
      await mockClaude(page, async () => {
        claudeCalls++;
        return { body: { content: [{ type: 'text', text: 'claude ack' }] } };
      });
      await mockGemini(page, async () => {
        geminiCalls++;
        return {
          body: {
            candidates: [
              {
                content: { parts: [{ text: 'gemini ack' }] },
                finishReason: 'STOP'
              }
            ]
          }
        };
      });

      await configureAi(page, 'claude', 'sk-ant-fake');
      await askAi(page, 'hello');
      await expect(aiPanel(page).locator('.ai-response')).toContainText(
        'claude ack'
      );
      expect(claudeCalls).toBe(1);
      expect(geminiCalls).toBe(0);

      await configureAi(page, 'gemini', 'AIza-fake');
      await askAi(page, 'hello again');
      await expect(aiPanel(page).locator('.ai-response')).toContainText(
        'gemini ack'
      );
      expect(claudeCalls).toBe(1);
      expect(geminiCalls).toBe(1);
    } finally {
      await ctx.close();
    }
  });
});
