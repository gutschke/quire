/**
 * M3b gate-exit acceptance test (redesign-plan.md L441).
 *
 * Locks the load-bearing dual-card claim from M3b.5:
 *   - DM Stage shows BOTH the safe + DM-only halves of an AI response.
 *   - Player view shows NEITHER (the AI panel is DM-only via
 *     showAiPanel; players never see the rendered cards).
 *   - The DM-only text MUST NOT appear in the player's DOM under
 *     any code path.
 *   - The smuggled-marker variant (safe carries `<dm-only>Y</dm-only>`
 *     in literal text) renders as visible literal text after the
 *     markdown sanitize step — not as an active element that
 *     could leak the wrapped content into a DM-only stream.
 *
 * Drives the AI panel by stubbing `aiProviders.claude` so the
 * test doesn't make real network calls.  The mock returns the
 * structured JSON shape that the broker's Anthropic parse step
 * expects.
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
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  return page;
}

/**
 * Inject a stub provider into the host page's QuireApp that
 * returns the supplied {safe, dmOnly} pair.  Mirrors the
 * structured contract from src/ai/providers/anthropic.ts so the
 * broker's parse step sees JSON it can validate.
 */
async function stubAiProvider(
  page: Page,
  payload: { safe: string; dmOnly: string }
): Promise<void> {
  await page.evaluate((p) => {
    const app = document.querySelector('quire-app') as unknown as {
      aiProviders: Record<string, unknown>;
    };
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        call: async () => ({
          raw: JSON.stringify({
            safe: p.safe,
            dmOnly: p.dmOnly,
            sources: []
          }),
          tokensIn: 20,
          tokensOut: 30,
          responseId: 'test-resp-1'
        }),
        parse: (raw: string) => {
          try {
            return JSON.parse(raw);
          } catch {
            return null;
          }
        }
      }
    };
  }, payload);
}

async function setApiKey(page: Page, key: string): Promise<void> {
  await page.evaluate((k) => {
    const app = document.querySelector('quire-app') as unknown as {
      setAiApiKey: (key: string) => void;
    };
    app.setAiApiKey(k);
  }, key);
}

async function submitAiPrompt(page: Page, prompt: string): Promise<void> {
  await page.evaluate(async (p) => {
    const app = document.querySelector('quire-app') as unknown as {
      submitAiPrompt: (prompt: string) => Promise<unknown>;
    };
    await app.submitAiPrompt(p);
  }, prompt);
}

test.describe('M3b AI content safety — dual-card DOM separation', () => {
  test('DM view contains both safe + DM-only; player view contains neither', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');

      // The DM is the only one with an AI key + panel.  Stub the
      // provider so the test is hermetic.
      await setApiKey(host, 'sk-fake');
      await stubAiProvider(host, {
        safe: 'PUBLIC_PROSE_LINE',
        dmOnly: 'SECRET_DM_LINE'
      });
      await submitAiPrompt(host, 'describe the scene');

      // DM Stage contains both halves rendered as dual cards.
      await expect(host.locator('.ai-card-safe')).toContainText(
        'PUBLIC_PROSE_LINE',
        { timeout: 10000 }
      );
      await expect(host.locator('.ai-card-dm')).toContainText(
        'SECRET_DM_LINE'
      );

      // Player DOM contains NEITHER — the AI panel isn't rendered
      // for non-coord viewers (showAiPanel gates on isCoordinator).
      // Both the safe AND the DM-only line are dm-aide-internal
      // until the DM explicitly shares (via "Share to chat" or
      // copy/paste); the player's complete innerHTML is checked.
      const guestHtml = await guest.locator('quire-app').innerHTML();
      expect(guestHtml).not.toContain('PUBLIC_PROSE_LINE');
      expect(guestHtml).not.toContain('SECRET_DM_LINE');
      // ai-panel itself isn't in the player's DOM at all.
      expect(await guest.locator('ai-panel').count()).toBe(0);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });

  test('smuggled <dm-only> marker in safe text renders as literal text after sanitize', async ({
    browser
  }) => {
    // The hostile pattern: a malicious / confused model returns
    // dmOnly content INSIDE the safe field, wrapped in something
    // that looks like an XML/HTML tag (`<dm-only>...</dm-only>`).
    // The renderer must show this as visible literal characters
    // (so the DM sees the leak and can flag the response) — NEVER
    // strip the wrapper and execute, NEVER hide the wrapped
    // content from the safe card.
    const hostCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const code = await hostSession(host, 'DM');
      void code; // single peer; no guest needed for this check
      await setApiKey(host, 'sk-fake');
      await stubAiProvider(host, {
        safe: 'OPENING_LINE <dm-only>SMUGGLED_SECRET</dm-only> CLOSING_LINE',
        dmOnly: ''
      });
      await submitAiPrompt(host, 'describe');

      // The safe card contains the visible smuggle attempt as
      // text — including the literal SMUGGLED_SECRET that the
      // model tried to wrap.  The point of this test is that
      // the renderer doesn't recognize <dm-only> as a special
      // tag (it isn't one) AND doesn't execute it as live HTML
      // (DOMPurify strips unknown tags, leaving their text
      // children).  Either way the DM SEES the smuggle attempt
      // in their safe card and can hit Reject.
      const safeText = await host.locator('.ai-card-safe').innerText();
      expect(safeText).toContain('OPENING_LINE');
      expect(safeText).toContain('CLOSING_LINE');
      // The smuggled secret text DOES appear — as literal prose,
      // not as a working tag.  The DM sees the leak and can
      // decide what to do.
      expect(safeText).toContain('SMUGGLED_SECRET');

      // No actual <dm-only> element exists in the DOM — DOMPurify
      // strips unknown tag names, keeping their text content.
      // (We assert via querySelector rather than innerHTML to
      // avoid false-positives from the text rendering.)
      const dmOnlyEl = await host
        .locator('.ai-card-safe dm-only, .ai-card-safe DM-ONLY')
        .count();
      expect(dmOnlyEl).toBe(0);
    } finally {
      await hostCtx.close();
    }
  });
});
