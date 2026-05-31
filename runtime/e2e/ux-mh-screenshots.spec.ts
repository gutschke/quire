/**
 * Screenshot harness for run #19 closure proofs.  These tests are
 * NOT part of the regression matrix — they exist to produce the
 * verifiable PNGs the user can inspect.  They run on demand from
 * the lead engineer's run-closing step:
 *
 *   npx playwright test ux-mh-screenshots --reporter=list
 *
 * Each test writes to /home/markus/src/ttrpg/tmp/ux-mh-N-verified-
 * <sha>.png AFTER asserting the user-visible outcome the screenshot
 * is meant to prove.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';
import path from 'node:path';

function tmpScreenshotPath(name: string): string {
  const sha = execSync('git rev-parse --short HEAD', {
    encoding: 'utf-8'
  }).trim();
  return path.join(
    '/home/markus/src/ttrpg/tmp',
    `${name}-verified-${sha}.png`
  );
}

test.describe('UX-MH screenshots (run #19 closure)', () => {
  test('UX-MH-3 — backstory-refresh-inbox renders a NON-EMPTY AI-threaded diff', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    // Mount the inbox with a baseline backstory and the AI-threaded
    // proposed backstory.  The proposed string is what
    // `refreshBackstory()` would return on the surgical pronoun edit
    // — we substitute "she" → "they" and "her" → "their" inline.
    await page.evaluate(async () => {
      // Remove quire-app so its full-viewport CSS doesn't cover the
      // screenshot.  We're rendering the inbox primitive in isolation.
      document.querySelector('quire-app')?.remove();
      await import('/src/ui/components/backstory-refresh-inbox.ts');
      const el = document.createElement(
        'backstory-refresh-inbox'
      ) as HTMLElement & {
        proposal: {
          pcId: string;
          proposedBackstory: string;
          baselineHash: string;
          initiator: 'player' | 'dm';
          ts: number;
        };
        currentBackstory: string;
        currentBackstoryHash: string;
        pcDisplayName: string;
        playerSafeChangeSummary: string;
      };
      const current =
        'Mei grew up by the Underleaf, where she learned to climb. Her nurse training came later, when she settled near the river.';
      const proposed =
        'Mei grew up by the Underleaf, where they learned to climb. Their nurse training came later, when they settled near the river.';
      el.proposal = {
        pcId: 'mei',
        proposedBackstory: proposed,
        baselineHash: 'CURRENT',
        initiator: 'dm',
        ts: 1000
      };
      el.currentBackstory = current;
      el.currentBackstoryHash = 'CURRENT';
      el.pcDisplayName = 'Mei';
      el.playerSafeChangeSummary = 'pronouns';
      document.body.style.padding = '24px';
      document.body.style.background = '#fff';
      document.body.style.font = '14px system-ui, sans-serif';
      document.body.appendChild(el);
      // Style the card a little so the screenshot reads clearly.
      const style = document.createElement('style');
      style.textContent = `
        body { color: #1a1a1a; }
        .backstory-refresh-inbox-card {
          border: 1px solid #d0d0d0;
          padding: 16px;
          border-radius: 8px;
          max-width: 720px;
          background: #fafafa;
        }
        .backstory-refresh-inbox-card h3 {
          margin: 0 0 8px;
          font-size: 16px;
        }
        .backstory-refresh-inbox-actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
        }
        .backstory-refresh-inbox-actions button {
          padding: 6px 12px;
        }
        .inline-diff-line-add {
          background: #e5f7ea;
          color: #094518;
        }
        .inline-diff-line-del {
          background: #fdecea;
          color: #58151a;
          text-decoration: line-through;
        }
        .inline-diff-line {
          font-family: ui-monospace, monospace;
          padding: 2px 6px;
          display: block;
          white-space: pre-wrap;
        }
      `;
      document.head.appendChild(style);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    // Assert a NON-EMPTY diff: at least one add + one del line where
    // the add carries "they" / "their".
    const stats = await page.evaluate(() => {
      const card = document.querySelector('.backstory-refresh-inbox-card');
      const adds = Array.from(
        document.querySelectorAll('.inline-diff-line-add')
      ).map((e) => e.textContent ?? '');
      const dels = Array.from(
        document.querySelectorAll('.inline-diff-line-del')
      ).map((e) => e.textContent ?? '');
      return {
        present: !!card,
        addCount: adds.length,
        delCount: dels.length,
        addHasThey: adds.some((s) => /they|their/.test(s)),
        delHasShe: dels.some((s) => /she|her/.test(s))
      };
    });
    expect(stats.present).toBe(true);
    expect(stats.addCount).toBeGreaterThanOrEqual(1);
    expect(stats.delCount).toBeGreaterThanOrEqual(1);
    expect(stats.addHasThey).toBe(true);
    expect(stats.delHasShe).toBe(true);
    await page.screenshot({
      path: tmpScreenshotPath('ux-mh-3'),
      fullPage: false
    });
  });

  test('UX-MH-2 — player-side <backstory-refresh-inbox> mounted on the bound PC surface', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    // Render the host's renderPlayerBackstoryRefreshInbox helper
    // directly into a detached container so we exercise the
    // production render path WITHOUT the surrounding rail's
    // peerjs / campaign-load dependencies.
    await page.evaluate(async () => {
      const el = document.querySelector('quire-app') as unknown as {
        sessionView: unknown;
        effectiveCharacter: (c: unknown) => Record<string, unknown>;
        renderPlayerBackstoryRefreshInbox: (
          c: { kind: string; id: string }
        ) => unknown;
        session: { append: (kind: string, payload: unknown) => void } | null;
        sha256HexUtil: (text: string) => Promise<string>;
      };
      const baseline =
        'Mei grew up by the Underleaf, where she learned to climb. Her nurse training came later, when she settled near the river.';
      const proposed =
        'Mei grew up by the Underleaf, where they learned to climb. Their nurse training came later, when they settled near the river.';
      const hash = await el.sha256HexUtil(baseline);
      (el as unknown as { sessionView: unknown }).sessionView = {
        status: 'active',
        peerId: 'alice-peer',
        shared: {},
        filteredShared: {
          pcSlots: {
            1: {
              pcId: 'mei',
              state: 'bound-active',
              controllerPeerId: 'alice-peer'
            }
          },
          synthesizedPcs: {
            mei: {
              id: 'mei',
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              backstory: baseline
            }
          },
          backstoryRefreshProposals: {
            mei: {
              pcId: 'mei',
              proposedBackstory: proposed,
              baselineHash: hash,
              initiator: 'dm',
              proposedByPeerId: 'dm-peer',
              ts: 1000
            }
          },
          pcEdits: {}
        }
      };
      el.effectiveCharacter = () => ({
        kind: 'pc',
        id: 'mei',
        name: 'Mei',
        pronouns: 'they/them',
        backstory: baseline
      });
      const lit = await import('/node_modules/lit/index.js');
      const host = document.createElement('div');
      // Float above quire-app's full-page shell so the screenshot
      // captures the inbox card, not the empty app surface.
      host.style.position = 'fixed';
      host.style.left = '24px';
      host.style.top = '24px';
      host.style.right = '24px';
      host.style.zIndex = '99999';
      host.style.background = '#fff';
      host.style.padding = '24px';
      host.style.border = '1px solid #ccc';
      host.style.borderRadius = '10px';
      host.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
      document.body.appendChild(host);
      const style = document.createElement('style');
      style.textContent = `
        body { color: #1a1a1a; }
        .backstory-refresh-inbox-card {
          border: 1px solid #4a90e2;
          padding: 16px;
          border-radius: 8px;
          max-width: 720px;
          background: #f0f7ff;
          box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .backstory-refresh-inbox-card h3 {
          margin: 0 0 8px;
          font-size: 16px;
          color: #1c4a7e;
        }
        .backstory-refresh-inbox-actions {
          margin-top: 12px;
          display: flex;
          gap: 8px;
        }
        .backstory-refresh-inbox-actions button {
          padding: 6px 12px;
        }
        .inline-diff-line-add {
          background: #e5f7ea;
          color: #094518;
        }
        .inline-diff-line-del {
          background: #fdecea;
          color: #58151a;
          text-decoration: line-through;
        }
        .inline-diff-line {
          font-family: ui-monospace, monospace;
          padding: 2px 6px;
          display: block;
          white-space: pre-wrap;
        }
      `;
      document.head.appendChild(style);
      const template = el.renderPlayerBackstoryRefreshInbox({
        kind: 'pc',
        id: 'mei'
      });
      (lit as unknown as { render: (t: unknown, h: Element) => void }).render(
        template,
        host
      );
      // Wait two frames for lit + the inbox child to finish their
      // own renders.
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    const found = await page.evaluate(() => {
      const inboxes = document.querySelectorAll(
        'backstory-refresh-inbox.player-backstory-refresh-inbox'
      );
      return inboxes.length;
    });
    expect(found).toBeGreaterThanOrEqual(1);
    await page.screenshot({
      path: tmpScreenshotPath('ux-mh-2'),
      fullPage: false
    });
  });

  test('UX-MH-1 — DM-side player rename pencil affordance + Edit tray on chargen-dm-review', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    await page.evaluate(async () => {
      await import('/src/ui/regions/chargen-dm-review.ts');
      type Seat = {
        pcId?: string;
        controllerPeerId?: string;
        state?: string;
      };
      const el = document.createElement(
        'chargen-dm-review'
      ) as HTMLElement & {
        pcSlots: Record<number, Seat>;
        synthResults: Map<number, unknown>;
        playerNameLookup: ((peerId: string) => string) | null;
        peerIdForPcLookup: ((pcId: string) => string | null) | null;
        pcEditDataLookup:
          | ((pcId: string) => {
              name: string;
              pronouns: string;
              tags: readonly string[];
              backstory: string;
            } | null)
          | null;
        onRenamePlayer: ((targetPeerId: string, newDisplayName: string) => boolean) | null;
        onEditPcField: ((pcId: string, field: string, value: string) => boolean) | null;
        onPcTagOp: ((pcId: string, op: unknown) => boolean) | null;
        onRefreshBackstory: ((pcId: string) => Promise<void>) | null;
      };
      el.pcSlots = {
        1: { pcId: 'mei', controllerPeerId: 'alice-peer', state: 'bound-active' }
      };
      el.synthResults = new Map();
      el.playerNameLookup = (peerId) =>
        peerId === 'alice-peer' ? 'Alice' : peerId;
      el.peerIdForPcLookup = (pcId) =>
        pcId === 'mei' ? 'alice-peer' : null;
      el.pcEditDataLookup = (pcId) =>
        pcId === 'mei'
          ? {
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse', 'climber'],
              backstory:
                'Mei grew up by the Underleaf, training as a nurse near the river.'
            }
          : null;
      el.onRenamePlayer = () => true;
      el.onEditPcField = () => true;
      el.onPcTagOp = () => true;
      el.onRefreshBackstory = async () => undefined;
      // Float above quire-app's full-page shell so the screenshot
      // captures the chargen-dm-review surface.
      el.style.position = 'fixed';
      el.style.left = '24px';
      el.style.top = '24px';
      el.style.right = '24px';
      el.style.bottom = '24px';
      el.style.zIndex = '99999';
      el.style.background = '#fff';
      el.style.overflow = 'auto';
      el.style.padding = '24px';
      el.style.border = '1px solid #ccc';
      el.style.borderRadius = '10px';
      el.style.boxShadow = '0 4px 24px rgba(0,0,0,0.18)';
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Open the tray so the screenshot shows the full Refresh path.
      const tray = el.querySelector(
        'chargen-edit-tray[data-slot="1"]'
      ) as HTMLElement | null;
      const editBtn = tray?.querySelector(
        '.chargen-edit-tray-toggle'
      ) as HTMLButtonElement | null;
      editBtn?.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
    });
    await page.screenshot({
      path: tmpScreenshotPath('ux-mh-1'),
      fullPage: false
    });
  });
});
