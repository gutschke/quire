/**
 * #398 / #417 — magic-arc spoiler firewall, proven over REAL WebRTC.
 *
 * The firewall is well-covered at the in-memory unit/fuzz/lint layer
 * (player-rail-firewall, state.firewall-fuzz, the allowlist ratchet),
 * but nothing proved it over the real PeerJS gossip + projection path
 * until now (the senior-QA review flagged this as the top risk).
 *
 * This drives 3 real browser peers through the real broker:
 *   - DM seeds a synthesized PC, binds it, player-A claims it, the DM
 *     marks Realization (knowsTheyCanCast + tax.active) and plants two
 *     DM-only free-text sentinels (dmNotes + tax.releaseMoment).
 *   - player-A (the PC's OWN player) must see the curated #398 slice
 *     (knowsTheyCanCast + tax.active) but NOT the DM-only sentinels nor
 *     magicPhase.
 *   - player-B (another player) must see NONE of PC-A's realization,
 *     and the projection must contain NO DM-only sentinel anywhere.
 *
 * The DM's authoring gestures are scripted via the app's public seams
 * (session.append / host methods); the transport, gossip, and
 * filterForViewer projection are all REAL.
 */

import {
  test,
  expect,
  type BrowserContext,
  type Page
} from '@playwright/test';
import { mockFixtureCampaign, campaignUrl, hostSession, joinSession } from './helpers';

const SLUG = 'test-camp';
const PC = 'pc-mei';

async function openCampaignPeer(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  page.on('pageerror', (err) =>
    console.log('[browser pageerror]', err.message)
  );
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[browser console]', msg.text());
  });
  await mockFixtureCampaign(page, SLUG);
  await page.goto(campaignUrl(SLUG));
  return page;
}

/** Poll until `pcId` has gossiped into this peer's projected state. */
async function waitPcSynced(page: Page, pcId: string): Promise<void> {
  await expect
    .poll(
      async () =>
        page.evaluate((id) => {
          const app = document.querySelector('quire-app') as unknown as {
            sessionView?: {
              filteredShared?: { synthesizedPcs?: Record<string, unknown> };
            };
          };
          return Boolean(app.sessionView?.filteredShared?.synthesizedPcs?.[id]);
        }, pcId),
      { timeout: 20000 }
    )
    .toBe(true);
}

test.describe('#398 magic-arc firewall — live multi-peer (real WebRTC)', () => {
  test('realized PC reveals only the curated slice to its OWN player; no DM-only leak to others or the projection', async ({
    browser
  }) => {
    test.setTimeout(120_000);
    const dmCtx = await browser.newContext();
    const aCtx = await browser.newContext();
    const bCtx = await browser.newContext();
    try {
      const dm = await openCampaignPeer(dmCtx);
      const playerA = await openCampaignPeer(aCtx);
      const playerB = await openCampaignPeer(bCtx);

      const code = await hostSession(dm, 'DM');
      await joinSession(playerA, code, 'Player-A');
      await joinSession(playerB, code, 'Player-B');

      // DM seeds + binds a synthesized PC (slot 1).
      await dm.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { append: (kind: string, payload: unknown) => void };
        };
        app.session.append('seat-add', { v: 1, slot: 1 });
        app.session.append('pc-create', {
          v: 1,
          pcId: pc,
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
          skills: ['Tech'],
          backstory: 'public backstory'
        });
        app.session.append('pc-slot-bind', { v: 1, slot: 1, pcId: pc });
      }, PC);

      // player-A claims the PC (sets peers[playerA].pcId — the runtime's
      // own-PC resolver, which #398 scopes the reveal to).
      await playerA.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          session: { rename: (opts: { pcId: string }) => void };
        };
        app.session.rename({ pcId: pc });
      }, PC);

      // DM delivers Realization + plants DM-only free-text sentinels.
      await dm.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          appendMarkRealization: (pcId: string) => boolean;
          appendDmNotesEdit: (pcId: string, value: string) => boolean;
          submitPcEdit: (pcId: string, field: string, value: unknown) => boolean;
        };
        app.appendMarkRealization(pc);
        app.appendDmNotesEdit(pc, 'DM_SECRET_notes_leak');
        app.submitPcEdit(pc, 'tax.releaseMoment', 'DM_SECRET_release_leak');
      }, PC);

      await waitPcSynced(playerA, PC);
      await waitPcSynced(playerB, PC);

      // Wait until player-A's OWN projection has the realization synced.
      await expect
        .poll(
          async () =>
            playerA.evaluate((pc) => {
              const app = document.querySelector('quire-app') as unknown as {
                sessionView: {
                  filteredShared: {
                    pcEdits: Record<string, Record<string, unknown>>;
                  };
                };
              };
              return (
                app.sessionView.filteredShared.pcEdits[pc]?.knowsTheyCanCast ===
                true
              );
            }, PC),
          { timeout: 20000 }
        )
        .toBe(true);

      // --- player-A (OWN realized PC): curated slice present, no DM-only leak ---
      const aView = await playerA.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView: {
            filteredShared: {
              pcEdits: Record<string, Record<string, unknown>>;
            };
          };
        };
        const fs = app.sessionView.filteredShared;
        return {
          edits: fs.pcEdits[pc] ?? {},
          json: JSON.stringify(fs)
        };
      }, PC);
      expect(aView.edits.knowsTheyCanCast).toBe(true);
      expect(aView.edits['tax.active']).toBe(true);
      // Arc-meta + DM-only free text are NOT in the curated slice:
      expect(aView.edits.magicPhase).toBeUndefined();
      expect(aView.edits['tax.releaseMoment']).toBeUndefined();
      expect(aView.json).not.toContain('DM_SECRET_');

      // --- player-B (another player): sees NONE of A's realization, no DM-only ---
      const bView = await playerB.evaluate((pc) => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView: {
            filteredShared: {
              pcEdits: Record<string, Record<string, unknown>>;
              synthesizedPcs: Record<string, Record<string, unknown>>;
            };
          };
        };
        const fs = app.sessionView.filteredShared;
        return {
          edits: fs.pcEdits[pc] ?? {},
          rec: fs.synthesizedPcs[pc] ?? {},
          json: JSON.stringify(fs)
        };
      }, PC);
      // PC-B must NOT learn PC-A realized (per-PC arc):
      expect(bView.edits.knowsTheyCanCast).toBeUndefined();
      expect(bView.edits['tax.active']).toBeUndefined();
      // Base record fully stripped:
      expect('magicPhase' in bView.rec).toBe(false);
      expect('knowsTheyCanCast' in bView.rec).toBe(false);
      expect('tax' in bView.rec).toBe(false);
      expect('dmNotes' in bView.rec).toBe(false);
      // The load-bearing check: no DM-only free text anywhere in B's projection.
      expect(bView.json).not.toContain('DM_SECRET_');

      // --- DM (coord) sanity: the test actually planted the secrets ---
      const dmHasSecret = await dm.evaluate(() => {
        const app = document.querySelector('quire-app') as unknown as {
          sessionView: { shared: unknown };
        };
        return JSON.stringify(app.sessionView.shared).includes('DM_SECRET_');
      });
      expect(dmHasSecret).toBe(true);
    } finally {
      await dmCtx.close();
      await aCtx.close();
      await bCtx.close();
    }
  });
});
