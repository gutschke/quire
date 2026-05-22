/**
 * M3c.7 acceptance e2e — AI write API end-to-end.
 *
 * Three scenarios from design/m3c-ai-write-api.md §Phase 5:
 *   1. ai-cast-spam — Timmy-5-spells; Apply-All lands a batch of
 *      pc-edit + dice-roll + caster-state-set events.
 *   2. ai-hard-gate — AI proposes harm box 3 transition;
 *      Apply-All applies everything else; the gated entry waits
 *      for explicit "Accept this change."
 *   3. ai-cross-pc-gate — AI proposes pc-edit on a peer's bound
 *      PC; gated; explicit accept lands.
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

interface StubArgs {
  safe: string;
  dmOnly?: string;
  stateUpdates?: Array<Record<string, unknown>>;
}

async function stubAiProvider(page: Page, args: StubArgs): Promise<void> {
  await page.evaluate((a) => {
    const app = document.querySelector('quire-app') as unknown as {
      aiProviders: Record<string, unknown>;
    };
    app.aiProviders = {
      ...app.aiProviders,
      claude: {
        id: 'claude',
        call: async () => ({
          raw: JSON.stringify({
            safe: a.safe,
            dmOnly: a.dmOnly ?? '',
            sources: [],
            stateUpdates: a.stateUpdates ?? []
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
  }, args);
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

async function getAppState(
  page: Page
): Promise<{
  events: Array<{ kind: string; payload?: Record<string, unknown> }>;
  pcEdits: Record<string, Record<string, unknown>>;
  casterState: Record<string, unknown>;
  diceRolls: Array<{ expression: string }>;
}> {
  return page.evaluate(() => {
    const app = document.querySelector('quire-app') as unknown as {
      sessionView?: {
        shared?: {
          pcEdits?: Record<string, Record<string, unknown>>;
          casterState?: Record<string, unknown>;
          diceRolls?: Array<{ expression: string }>;
        };
      };
    };
    const sessionAny = (
      app as unknown as {
        session?: { getEvents: () => Array<{ kind: string; payload?: unknown }> };
      }
    ).session;
    const events =
      sessionAny?.getEvents()?.map((e) => ({
        kind: e.kind,
        payload: (e.payload as Record<string, unknown>) ?? undefined
      })) ?? [];
    return {
      events,
      pcEdits: app.sessionView?.shared?.pcEdits ?? {},
      casterState: app.sessionView?.shared?.casterState ?? {},
      diceRolls: app.sessionView?.shared?.diceRolls ?? []
    };
  });
}

test.describe('M3c AI write API — DM accept-gate', () => {
  test('cast-spam: Apply All lands pc-edit + dice-roll + caster-state-set in one batch', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const host = await openCampaignPeer(ctx);
      await hostSession(host, 'DM');
      await setApiKey(host, 'sk-fake');
      // Bind the host to a PC so cross-PC gating doesn't fire on
      // the host's own PC edits.
      await host.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { append: (kind: string, payload: unknown) => void };
        };
        app.session.append('peer-rename', { pcId: 'timmy' });
      });
      await stubAiProvider(host, {
        safe: 'Timmy weaves five quick castings…',
        dmOnly: 'Per L141: third+ cast in a scene; consider a stress check.',
        stateUpdates: [
          {
            kind: 'pc-edit',
            pcId: 'timmy',
            field: 'stress',
            delta: 1,
            reason: 'Frayed cast'
          },
          {
            kind: 'dice-roll',
            purpose: 'coin toss',
            expression: '2d6+2',
            modifierBreakdown: 'Timmy WIS +0 + Costly cast +2'
          },
          {
            kind: 'caster-state-set',
            pcId: 'timmy',
            ladderState: 'noticed',
            reason: 'the lights flicker — only Timmy notices',
            spamCount: 3
          }
        ]
      });
      await submitAiPrompt(host, "Timmy casts 5 spells affecting the coin toss");

      // Strip renders.
      await expect(host.locator('.ai-write-strip')).toBeVisible({
        timeout: 10000
      });
      await expect(host.locator('.ai-write-entry')).toHaveCount(3);

      // Apply All.
      await host.locator('.ai-write-apply-all').click();

      // Verify all 3 state-updates landed PLUS the preceding ai-accept.
      await expect
        .poll(
          async () => {
            const s = await getAppState(host);
            return s.events.filter(
              (e) =>
                e.kind === 'pc-edit' ||
                e.kind === 'dice-roll' ||
                e.kind === 'caster-state-set' ||
                e.kind === 'ai-accept'
            ).length;
          },
          { timeout: 10000 }
        )
        .toBeGreaterThanOrEqual(4);

      const state = await getAppState(host);
      expect(state.pcEdits['timmy']?.stress).toBe(1);
      expect(state.casterState['timmy']).toMatchObject({
        ladderState: 'noticed',
        spamCount: 3
      });
      // Audit chain: ai-accept came BEFORE the pc-edit / caster-state-set.
      const acceptIdx = state.events.findIndex((e) => e.kind === 'ai-accept');
      const pcEditIdx = state.events.findIndex((e) => e.kind === 'pc-edit');
      expect(acceptIdx).toBeGreaterThanOrEqual(0);
      expect(acceptIdx).toBeLessThan(pcEditIdx);
    } finally {
      await ctx.close();
    }
  });

  test('hard-gate: harm box 3 transition stays pending until explicit accept', async ({
    browser
  }) => {
    const ctx = await browser.newContext();
    try {
      const host = await openCampaignPeer(ctx);
      await hostSession(host, 'DM');
      await setApiKey(host, 'sk-fake');
      // Bring harm to 2 via DM-direct edit so the AI proposal's +1
      // would transition to 3.
      await host.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { append: (kind: string, payload: unknown) => void };
        };
        app.session.append('peer-rename', { pcId: 'yui' });
        app.session.append('pc-edit', {
          pcId: 'yui',
          field: 'harm',
          value: 2
        });
      });
      await stubAiProvider(host, {
        safe: '',
        dmOnly: 'Hard-hitting consequence.',
        stateUpdates: [
          {
            kind: 'pc-edit',
            pcId: 'yui',
            field: 'harm',
            delta: 1,
            reason: 'crushed by the cargo door'
          }
        ]
      });
      await submitAiPrompt(host, 'apply harm');
      await expect(host.locator('.ai-write-strip')).toBeVisible({
        timeout: 10000
      });
      // The hard-gated entry shows with its own accept button.
      await expect(host.locator('.ai-write-accept-one')).toHaveCount(1);
      // Apply All button is still shown but the gated entry doesn't apply.
      // (When the ONLY entry is hard-gated, hasUnapplied is true but
      // applyAll lands nothing.)
      const beforeAcceptHarm = await host.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView?: { shared?: { pcEdits?: Record<string, { harm?: number }> } };
        };
        return app.sessionView?.shared?.pcEdits?.yui?.harm ?? -1;
      });
      expect(beforeAcceptHarm).toBe(2); // still 2

      // Now explicit accept.
      await host.locator('.ai-write-accept-one').click();
      await expect
        .poll(
          async () => {
            const app = await host.evaluate(() => {
              const a = document.querySelector('quire-app') as unknown as {
                sessionView?: {
                  shared?: {
                    pcEdits?: Record<string, { harm?: number }>;
                  };
                };
              };
              return a.sessionView?.shared?.pcEdits?.yui?.harm ?? -1;
            });
            return app;
          },
          { timeout: 5000 }
        )
        .toBe(3);
    } finally {
      await ctx.close();
    }
  });

  test('cross-PC gate: AI pc-edit on another peer\'s bound PC is hard-gated', async ({
    browser
  }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    try {
      const host = await openCampaignPeer(hostCtx);
      const guest = await openCampaignPeer(guestCtx);
      const code = await hostSession(host, 'DM');
      await joinSession(guest, code, 'Player');
      // DM binds to alice; guest binds to bob.
      await host.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { append: (kind: string, payload: unknown) => void };
        };
        app.session.append('peer-rename', { pcId: 'alice' });
      });
      await guest.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { append: (kind: string, payload: unknown) => void };
        };
        app.session.append('peer-rename', { pcId: 'bob' });
      });
      await setApiKey(host, 'sk-fake');
      // DM-direct AI prompt → AI proposes a pc-edit on bob.
      await stubAiProvider(host, {
        safe: '',
        dmOnly: 'Bob takes some stress.',
        stateUpdates: [
          {
            kind: 'pc-edit',
            pcId: 'bob',
            field: 'stress',
            delta: 1,
            reason: 'something happens to bob'
          }
        ]
      });
      await submitAiPrompt(host, 'edit bob');
      await expect(host.locator('.ai-write-strip')).toBeVisible({
        timeout: 10000
      });
      // The cross-PC entry is hard-gated.
      await expect(host.locator('.ai-write-accept-one')).toHaveCount(1);
      // Explicit accept lands it.
      await host.locator('.ai-write-accept-one').click();
      await expect
        .poll(
          async () =>
            host.evaluate(() => {
              const a = document.querySelector('quire-app') as unknown as {
                sessionView?: {
                  shared?: {
                    pcEdits?: Record<string, { stress?: number }>;
                  };
                };
              };
              return a.sessionView?.shared?.pcEdits?.bob?.stress ?? -1;
            }),
          { timeout: 5000 }
        )
        .toBe(1);
    } finally {
      await hostCtx.close();
      await guestCtx.close();
    }
  });
});
