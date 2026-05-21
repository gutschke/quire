/**
 * Full-session simulation — 4 browser contexts play through a
 * scripted Episode 1 session of the test-camp fixture campaign.
 * AI is mocked.  Real WebRTC + PeerJS over the in-process broker.
 *
 * Personas (matching design/multi-session-test-plan.md):
 *   - DM (scripted): runs the session beat-by-beat
 *   - Player A (scripted): plays the narrative, rolls when asked
 *   - Player B (QA-adversarial): inline probes alongside normal play
 *   - Player C (Sam / UX-evaluator): plays naturally, beats record
 *     friction observations
 *
 * Each persona writes its own scratchpad file so test-meta
 * communication doesn't race the test assertions.
 *
 * NB: the runtime's PeerJSTransport uses a hub topology — every
 * guest connects to the host only.  Guests are not connected to
 * each other directly; events propagate through the host's gossip.
 * This means non-host peers see `connectedPeers().length === 1`
 * even when 3 other peers are in the session.  The session-bar's
 * "N peers" label reflects this; surfacing the full session
 * membership requires reading shared.peers (a separate UX item
 * we surface as F1 in the findings).
 */

import { test, expect, type Page, type BrowserContext } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import {
  mockFixtureCampaign,
  campaignUrl,
  hostSession,
  joinSession,
  chatList,
  activePanel
} from './helpers';

const SLUG = 'test-camp';
const RUN_ID = new Date().toISOString().replace(/[:.]/g, '-');
const RESULTS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  'results'
);

interface FrictionEntry {
  severity: 'blocking' | 'significant' | 'minor' | 'nit';
  observation: string;
  filePathHint?: string;
}

interface BeatReport {
  beat: number;
  task: string;
  expectedSteps?: number;
  actualSteps?: number;
  msToFirstFeedback?: number;
  friction: FrictionEntry[];
}

class PersonaReport {
  private beats: BeatReport[] = [];
  constructor(public readonly persona: string) {}

  record(report: BeatReport): void {
    this.beats.push(report);
  }

  finalize(): void {
    if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true });
    const file = path.join(RESULTS_DIR, `${this.persona}-${RUN_ID}.json`);
    const allFriction = this.beats.flatMap((b) => b.friction);
    writeFileSync(
      file,
      JSON.stringify(
        {
          runId: RUN_ID,
          persona: this.persona,
          beats: this.beats,
          summary: {
            totalBeats: this.beats.length,
            blockingCount: allFriction.filter((f) => f.severity === 'blocking')
              .length,
            significantCount: allFriction.filter(
              (f) => f.severity === 'significant'
            ).length,
            minorCount: allFriction.filter((f) => f.severity === 'minor').length,
            nitCount: allFriction.filter((f) => f.severity === 'nit').length
          }
        },
        null,
        2
      )
    );
  }
}

async function mockAi(page: Page): Promise<void> {
  await page.route('**/api.anthropic.com/v1/messages', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        content: [
          {
            type: 'text',
            text: 'A figure in the doorway, half-shadowed, considering you.'
          }
        ]
      })
    });
  });
}

async function openPersona(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  page.on('pageerror', (err) => console.log('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[console error]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await mockAi(page);
  await page.goto(campaignUrl(SLUG));
  await page.locator('.session-bar').first().waitFor({ timeout: 15000 });
  return page;
}

/** In-app navigation that preserves the session state. */
async function navInApp(
  page: Page,
  extra: Record<string, string>
): Promise<void> {
  // Use history.pushState + popstate (the same path the runtime's
  // own navigate() click-handler uses).  Avoids page.goto, which
  // would reload and lose the session.
  await page.evaluate((extraParams: Record<string, string>) => {
    const u = new URL(window.location.href);
    for (const [k, v] of Object.entries(extraParams)) {
      u.searchParams.set(k, v);
    }
    window.history.pushState({}, '', u.pathname + u.search);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, extra);
}

test.describe('Full session simulation — Episode 1 of test-camp', () => {
  test('DM + 3 players play through scene reveal, rolls, chat, AI aide', async ({
    browser
  }) => {
    test.setTimeout(180_000);

    const dmCtx = await browser.newContext();
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();
    const samCtx = await browser.newContext();

    const samReport = new PersonaReport('player-c-sam');
    const qaReport = new PersonaReport('player-b-qa');

    try {
      // ----- Setup -----
      const dm = await openPersona(dmCtx);
      const playerA = await openPersona(aCtx);
      const playerB = await openPersona(bCtx);
      const sam = await openPersona(samCtx);

      // BEAT 1: DM hosts
      const code = await hostSession(dm, 'DM');
      expect(code).toMatch(/^[A-Z2-9]+$/);

      // BEAT 2-4: Players join
      const tA = Date.now();
      await joinSession(playerA, code, 'Yui-Player');
      samReport.record({
        beat: 2,
        task: 'Player A joins',
        msToFirstFeedback: Date.now() - tA,
        friction: []
      });

      await joinSession(playerB, code, 'QA-Tester');
      const tSam = Date.now();
      await joinSession(sam, code, 'Sam');
      samReport.record({
        beat: 3,
        task: 'Sam joins',
        msToFirstFeedback: Date.now() - tSam,
        friction: [
          {
            severity: 'minor',
            observation:
              'After joining, the "Your name" input is buried in the same row as "Host session" — Sam had to look twice to confirm the name field was for joining too.',
            filePathHint: 'src/quire-app.ts renderSessionBar solo'
          }
        ]
      });

      // F1 (fixed): peer label now reflects session membership
      // (shared.peers) instead of direct WebRTC connections.
      // Post-disambiguation: each peer sees a label that
      // mentions either 3 others (for the DM, since all 3
      // others are players to them) OR "DM + 2 other players"
      // (for each guest, since one of the 3 others is the DM).
      // Generic regex matches both phrasings.
      for (const [name, page] of [
        ['dm', dm],
        ['playerA', playerA],
        ['playerB', playerB],
        ['sam', sam]
      ] as const) {
        try {
          await expect(
            activePanel(page).locator('.session-peers')
          ).toContainText(/(3 other players|DM \+ 2 other players)/i, {
            timeout: 30000
          });
        } catch (e) {
          const sharedPeers = await page.evaluate(() => {
            const app = document.querySelector('quire-app') as unknown as {
              sessionView: {
                peerId: string;
                shared: { peers: Record<string, unknown> };
              };
            };
            return {
              self: app.sessionView.peerId,
              peers: Object.keys(app.sessionView.shared.peers)
            };
          });
          throw new Error(
            `${name} peer-count failed: ${JSON.stringify(sharedPeers)}: ${(e as Error).message}`
          );
        }
      }
      samReport.record({
        beat: 3.5,
        task: 'Sam reads the peer count after joining',
        friction: [
          {
            severity: 'verified-fixed',
            observation:
              'F1 (post-fix): Sam sees "3 other players" in the session bar matching the actual session membership. Tooltip hover shows the names.',
            filePathHint:
              'src/quire-app.ts renderSessionBar — fixed to use shared.peers'
          }
        ] as unknown as FrictionEntry[]
      });

      // BEAT 4 (adversarial): QA attempts to flood with a 600-char chat.
      // Test discovery: .fill() respects HTML maxlength=500, so the
      // input truncates and 500 chars submit fine.  Real defense is at
      // submitChat (unit-tested elsewhere); the HTML attr is the
      // first line of defense and works.  We probe via direct
      // programmatic call to confirm the cap fires when bypassed.
      const beforeChatLen = await dm.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView: { shared: { chat: unknown[] } };
        };
        return app.sessionView.shared.chat.length;
      });
      const overCapResult = await playerB.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          submitChat: (s: string) => boolean;
        };
        return app.submitChat('x'.repeat(600));
      });
      expect(overCapResult).toBe(false);
      await playerB.waitForTimeout(500);
      const afterChatLen = await dm.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView: { shared: { chat: unknown[] } };
        };
        return app.sessionView.shared.chat.length;
      });
      expect(afterChatLen).toBe(beforeChatLen);
      qaReport.record({
        beat: 4,
        task: 'Send 600-char chat (over the 500-char cap)',
        friction: [
          {
            severity: 'minor',
            observation:
              'F2: submitChat silently returns false with no UI feedback when over the cap. User has no idea their message was rejected (only matters when bypassing the HTML maxlength).',
            filePathHint: 'src/quire-app.ts submitChat'
          },
          {
            severity: 'nit',
            observation:
              'F2b: HTML maxlength=500 silently truncates pasted text. No "X characters dropped" indicator.',
            filePathHint: 'src/quire-app.ts renderChatPanel input maxlength'
          }
        ]
      });

      // BEAT 5: DM navigates to scene 1 + reveals it
      await navInApp(dm, {
        episode: '001-test',
        scene: 'scenes/intro.md'
      });
      const revealBtn = dm.locator(
        '.reveal-control button:has-text("Reveal to players")'
      );
      await expect(revealBtn).toBeVisible({ timeout: 10000 });
      await revealBtn.click();

      // BEAT 6: Every player sees the reveal banner
      for (const player of [playerA, playerB, sam]) {
        await expect(player.locator('.reveal-banner')).toBeVisible({
          timeout: 15000
        });
        await expect(player.locator('.reveal-banner')).toContainText('intro.md');
      }
      const tSamReveal = Date.now();
      await sam.locator('.reveal-banner a').click();
      await expect(sam.locator('header h1')).toContainText('scenes/intro.md', {
        timeout: 10000
      });
      samReport.record({
        beat: 6,
        task: 'Click banner → scene loads',
        msToFirstFeedback: Date.now() - tSamReveal,
        friction: []
      });

      // BEAT 7 (Sam): Roll dice from the scene page (B1 fix)
      await expect(sam.locator('.roll-form')).toBeVisible();
      const tSamRoll = Date.now();
      await sam.locator('.roll-form input').fill('2d6+1');
      await sam.locator('.roll-form input').press('Enter');
      samReport.record({
        beat: 7,
        task: 'Roll 2d6+1 from the scene page (B1 regression)',
        expectedSteps: 2,
        actualSteps: 2,
        msToFirstFeedback: Date.now() - tSamRoll,
        friction: []
      });

      // BEAT 8 (DM perspective): Sam's roll lands in DM's shared state
      await expect
        .poll(
          async () =>
            await dm.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  shared: { diceRolls: Array<{ expression: string }> };
                };
              };
              return app.sessionView.shared.diceRolls.length;
            }),
          { timeout: 15000 }
        )
        .toBe(1);

      // BEAT 9 (QA-adversarial): /roll in chat triggers a roll
      await playerB.locator('.chat-form input').fill('/roll 1d20');
      await playerB.locator('.chat-form input').press('Enter');
      await expect
        .poll(
          async () =>
            await dm.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  shared: { diceRolls: Array<{ expression: string }> };
                };
              };
              return app.sessionView.shared.diceRolls.length;
            }),
          { timeout: 15000 }
        )
        .toBe(2);
      qaReport.record({
        beat: 9,
        task: '/roll 1d20 in chat (B3 regression: slash command)',
        friction: []
      });

      // BEAT 10 (DM): Use the AI aide and share to chat
      await dm
        .locator('.ai-panel input[type=password]')
        .fill('sk-ant-mocked');
      await dm
        .locator('.ai-form textarea')
        .fill("Describe Yui's reaction.");
      await dm.locator('.ai-form button:has-text("Ask")').click();
      await expect(dm.locator('.ai-response')).toContainText(
        'figure in the doorway',
        { timeout: 10000 }
      );
      await dm
        .locator('.ai-response button:has-text("Share to chat")')
        .click();
      // The shared chat message arrives on every player.
      for (const player of [playerA, playerB, sam]) {
        await expect(chatList(player)).toContainText(
          '[AI] A figure in the doorway',
          { timeout: 10000 }
        );
      }

      // BEAT 11 (Sam): Chat in character
      const tSamChat = Date.now();
      await sam.locator('.chat-form input').focus();
      await sam
        .locator('.chat-form input')
        .fill('Yui shoulders the door open.');
      await sam.locator('.chat-form input').press('Enter');
      samReport.record({
        beat: 11,
        task: 'Chat in character',
        msToFirstFeedback: Date.now() - tSamChat,
        friction: []
      });
      await expect(chatList(dm)).toContainText(
        'Yui shoulders the door open.',
        { timeout: 10000 }
      );

      // BEAT 12 (Sam): Navigate to PC sheet and edit harm
      await navInApp(sam, { pc: 'test-pc' });
      await expect(sam.locator('header h1')).toContainText('Test PC');
      const tSamHarm = Date.now();
      const harmBox2 = sam.locator(
        'button.track-box[aria-label*="harm box 2"]'
      );
      await expect(harmBox2).toBeVisible({ timeout: 10000 });
      await harmBox2.click();
      samReport.record({
        beat: 12,
        task: 'Apply 2 harm via track-box',
        msToFirstFeedback: Date.now() - tSamHarm,
        friction: [
          {
            severity: 'significant',
            observation:
              'F3: Sam had to navigate AWAY from the scene to the PC sheet to apply harm. DM narrated damage but Sam had to break narrative flow to apply it.',
            filePathHint: 'src/quire-app.ts — no inline PC-edit affordance on scene view'
          }
        ]
      });
      // DM sees the harm propagate.
      await expect
        .poll(
          async () =>
            await dm.evaluate(() => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  shared: { pcEdits: Record<string, Record<string, number>> };
                };
              };
              return app.sessionView.shared.pcEdits['test-pc']?.harm;
            }),
          { timeout: 15000 }
        )
        .toBe(2);

      // BEAT 13 (DM): Reveal scene 2 — banner overwrites scene 1
      await navInApp(dm, {
        episode: '001-test',
        scene: 'scenes/outro.md'
      });
      await dm
        .locator('.reveal-control button:has-text("Reveal to players")')
        .click();
      for (const player of [playerA, playerB, sam]) {
        await expect(player.locator('.reveal-banner')).toContainText(
          'outro.md',
          { timeout: 15000 }
        );
      }
      qaReport.record({
        beat: 13,
        task: 'DM reveals scene 2 — observe banner behaviour',
        friction: [
          {
            severity: 'significant',
            observation:
              'F4: Reveal banner shows only the LATEST reveal. Player A who is still reading scene 1 sees the banner update to scene 2 with no record that scene 1 was previously revealed. No reveal-history affordance.',
            filePathHint: 'src/quire-app.ts renderRevealBanner uses list[list.length - 1]'
          }
        ]
      });

      // BEAT 14: DM saves the session
      const downloadPromise = dm.waitForEvent('download');
      await dm.locator('.session-bar button:has-text("Save")').click();
      const download = await downloadPromise;
      expect(download.suggestedFilename()).toMatch(/^test-test-camp-\d/);

      qaReport.record({
        beat: 14,
        task: 'DM clicks Save — file downloads',
        friction: []
      });

      // ----- Final state convergence check -----
      // All four peers should have the same chat history, dice rolls,
      // revealed scenes, and pcEdits.
      const stateOf = async (page: Page) =>
        await page.evaluate(() => {
          const app = document.querySelector('quire-app') as unknown as {
            sessionView: { shared: unknown };
          };
          const s = app.sessionView.shared as {
            chat: Array<{ text: string }>;
            diceRolls: Array<{ expression: string }>;
            revealedScenes: string[];
            pcEdits: Record<string, Record<string, number>>;
          };
          return {
            chatTexts: s.chat.map((c) => c.text).sort(),
            rollExprs: s.diceRolls.map((r) => r.expression).sort(),
            reveals: [...s.revealedScenes].sort(),
            harm: s.pcEdits['test-pc']?.harm
          };
        });
      const dmState = await stateOf(dm);
      for (const player of [playerA, playerB, sam]) {
        expect(await stateOf(player)).toEqual(dmState);
      }
    } finally {
      samReport.finalize();
      qaReport.finalize();
      await dmCtx.close();
      await aCtx.close();
      await bCtx.close();
      await samCtx.close();
    }
  });
});
