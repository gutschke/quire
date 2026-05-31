/**
 * Real-browser probe — UX-MH-3: backstory-refresh proposal +
 * inline-diff inbox card.
 *
 * Per LL-3: this loads the runtime in Chromium and asserts that
 * the inbox-card component renders the unified diff + DM header
 * copy + Accept/Reject/Try again actions.  Does NOT exercise the
 * AI module (a live network call would be flaky); the AI surface
 * is unit-tested in src/ai/backstory-refresher.test.ts.
 *
 * Run #19 (2026-05-30) — UX-MH-3 closure proof.  Phase 9 extends the
 * spec with an integration test that mounts <chargen-dm-review>
 * and asserts the DM-side "↻ Refresh backstory" click path fires
 * the host's onRefreshBackstory callback with the right pcId.
 */

import { test, expect } from '@playwright/test';

test.describe('UX-MH-3 — backstory refresh inbox card', () => {
  test('inline-diff renders +/- hunks for a surgical edit', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/components/inline-diff.ts');
      const el = document.createElement('inline-diff') as HTMLElement & {
        baseline: string;
        proposed: string;
      };
      el.baseline = 'Mei.\nShe trained as a nurse.\nShe climbs.';
      el.proposed = 'Mei.\nThey trained as a nurse.\nThey climb.';
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const lines = el.querySelectorAll('.inline-diff-line');
      const adds = el.querySelectorAll('.inline-diff-line-add');
      const dels = el.querySelectorAll('.inline-diff-line-del');
      const sames = el.querySelectorAll('.inline-diff-line-same');
      return {
        totalLines: lines.length,
        addCount: adds.length,
        delCount: dels.length,
        sameCount: sames.length,
        firstSameText: sames[0]?.textContent?.trim() ?? null
      };
    });
    expect(result.addCount).toBeGreaterThanOrEqual(2);
    expect(result.delCount).toBeGreaterThanOrEqual(2);
    expect(result.sameCount).toBeGreaterThanOrEqual(1);
    expect(result.firstSameText).toContain('Mei.');
  });

  test('backstory-refresh-inbox renders DM-initiated header verbatim', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
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
      el.proposal = {
        pcId: 'mei',
        proposedBackstory: 'Mei (they/them) grew up by the Underleaf.',
        baselineHash: 'CURRENT',
        initiator: 'dm',
        ts: 0
      };
      el.currentBackstory = 'Mei grew up by the Underleaf.';
      el.currentBackstoryHash = 'CURRENT';
      el.pcDisplayName = 'Mei';
      el.playerSafeChangeSummary = 'pronouns';
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const card = el.querySelector('.backstory-refresh-inbox-card');
      const text = card?.textContent ?? '';
      return {
        present: !!card,
        hasHeader: text.includes('Your DM has a backstory suggestion'),
        hasBody: text.includes('Mei'),
        hasAccept: !!el.querySelector('.backstory-refresh-inbox-accept'),
        hasReject: !!el.querySelector('.backstory-refresh-inbox-reject'),
        hasTryAgain: !!el.querySelector('.backstory-refresh-inbox-try-again')
      };
    });
    expect(result.present).toBe(true);
    expect(result.hasHeader).toBe(true);
    expect(result.hasBody).toBe(true);
    expect(result.hasAccept).toBe(true);
    expect(result.hasReject).toBe(true);
    expect(result.hasTryAgain).toBe(true);
  });

  test('DM opens the per-row tray inside chargen-dm-review and clicks "↻ Refresh backstory" → host onRefreshBackstory fires with the right pcId', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/regions/chargen-dm-review.ts');
      type Seat = { pcId?: string; controllerPeerId?: string; state?: string };
      const el = document.createElement('chargen-dm-review') as HTMLElement & {
        pcSlots: Record<number, Seat>;
        synthResults: Map<number, unknown>;
        pcEditDataLookup:
          | ((pcId: string) => {
              name: string;
              pronouns: string;
              tags: readonly string[];
              backstory: string;
            } | null)
          | null;
        onRefreshBackstory: ((pcId: string) => Promise<void>) | null;
      };
      el.pcSlots = {
        1: { pcId: 'mei', controllerPeerId: 'alice', state: 'bound-active' }
      };
      el.synthResults = new Map();
      el.pcEditDataLookup = (pcId) =>
        pcId === 'mei'
          ? {
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              backstory: 'Mei grew up by the Underleaf.'
            }
          : null;
      const captured: string[] = [];
      el.onRefreshBackstory = async (pcId) => {
        captured.push(pcId);
      };
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const tray = el.querySelector(
        'chargen-edit-tray[data-slot="1"]'
      ) as HTMLElement | null;
      if (!tray) return { stage: 'no-tray', captured };
      const editBtn = tray.querySelector(
        '.chargen-edit-tray-toggle'
      ) as HTMLButtonElement | null;
      if (!editBtn) return { stage: 'no-edit-btn', captured };
      editBtn.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const refreshBtn = tray.querySelector(
        '.chargen-edit-tray-refresh'
      ) as HTMLButtonElement | null;
      if (!refreshBtn) return { stage: 'no-refresh-btn', captured };
      refreshBtn.click();
      // The callback is async — wait one microtask + paint.
      await Promise.resolve();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return { stage: 'committed', captured };
    });
    expect(result.stage).toBe('committed');
    expect(result.captured).toEqual(['mei']);
  });

  test('refreshBackstoryForPc actually calls the AI refresher module and emits a proposal whose proposedBackstory is the AI output (NOT a no-op of the current backstory)', async ({
    page
  }) => {
    // Run #19 final integration — proves the proof line:
    //   "I change a pronoun... the AI returns a diff showing just the
    //    pronoun substitutions threaded through the existing prose."
    //
    // We swap the provider's `callStructured` with a deterministic
    // fake so the real `refreshBackstory()` AI module runs without
    // a network call.  The production path (refreshBackstoryForPc →
    // refreshBackstory → spoiler-check pipeline → emit) executes
    // unchanged — only the underlying provider response is mocked.
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      type AppShape = {
        aiProvider: 'claude' | 'gemini';
        aiProviders: Record<
          string,
          {
            id: string;
            callStructured: (
              req: unknown,
              schema: unknown
            ) => Promise<unknown>;
          }
        >;
        setAiApiKey: (key: string, provider?: string) => void;
        refreshBackstoryForPc: (pcId: string) => Promise<void>;
        pcCharacterCache: Map<string, { record: Record<string, unknown> }>;
        getCurrentCampaign?: () => unknown;
        sessionView: {
          status: string;
          peerId?: string;
          filteredShared?: {
            synthesizedPcs?: Record<string, Record<string, unknown>>;
            backstoryRefreshProposals?: Record<string, unknown>;
            pcSlots?: Record<number, unknown>;
          };
        };
      };
      const el = document.querySelector('quire-app') as unknown as AppShape;
      if (!el) return { stage: 'no-quire-app', emitted: null };
      // Stub the provider with a deterministic fake — the production
      // refreshBackstory orchestration still drives the call.  We
      // return a "threaded pronoun" backstory that's a SURGICAL edit
      // of the baseline (NOT identical).
      const fakeRefreshed =
        'Mei (they/them) grew up by the Underleaf, training as a nurse.';
      let captured: {
        system?: string;
        user?: string;
      } | null = null;
      el.aiProviders[el.aiProvider] = {
        id: el.aiProvider,
        callStructured: async (req: unknown) => {
          const r = req as { systemPrompt: string; prompt: string };
          captured = { system: r.systemPrompt, user: r.prompt };
          return {
            ok: true as const,
            value: { backstory: fakeRefreshed },
            raw: JSON.stringify({ backstory: fakeRefreshed }),
            tokensIn: 100,
            tokensOut: 50,
            responseId: 'resp-test-1'
          };
        }
      };
      el.setAiApiKey('test-key-for-e2e');
      // Seed a campaign + bound PC + session so refreshBackstoryForPc
      // has all its preconditions met.  We synthesize a minimal
      // sessionView + pcCharacterCache so the host's data-lookup +
      // coord gate pass; we don't go through real peerjs.  The
      // production code path under test is the host's branch from
      // "DM clicks Refresh" through to the AI module's invocation.
      const fakeCampaign = {
        base: {
          source: { kind: 'github', owner: 'test', repo: 'fake', ref: 'main' },
          manifest: {
            name: 'Fake',
            episodes: [],
            characters: [],
            aiBackstory: { spoilerTokens: [] }
          }
        }
      };
      (el as unknown as { getCurrentCampaign: () => unknown }).getCurrentCampaign =
        () => fakeCampaign;
      // Install a synthetic sessionView (coord-only, single PC).
      const view = {
        status: 'active' as const,
        peerId: 'dm-peer',
        shared: {
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
              pronouns: 'she/her',
              tags: ['nurse'],
              backstory: 'Mei grew up by the Underleaf.'
            }
          },
          backstoryRefreshProposals: {},
          coordHolders: new Set(['dm-peer']),
          pcEdits: { mei: { pronouns: 'they/them' } }
        },
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
              pronouns: 'she/her',
              tags: ['nurse'],
              backstory: 'Mei grew up by the Underleaf.'
            }
          },
          backstoryRefreshProposals: {} as Record<string, unknown>,
          pcEdits: {
            mei: { pronouns: 'they/them' }
          } as Record<string, unknown>
        }
      };
      (el as unknown as { sessionView: unknown }).sessionView = view;
      // Capture session.append calls so we can assert on the emitted
      // backstory-refresh-proposal payload.
      const appended: Array<{ kind: string; payload: unknown }> = [];
      (el as unknown as {
        session: { append: (kind: string, payload: unknown) => void } | null;
      }).session = {
        append: (kind: string, payload: unknown) => {
          appended.push({ kind, payload });
        }
      };
      // Force coord-positive (the appState route here is solo, but
      // refreshBackstoryForPc gates on isCoordinator() — we stub).
      (el as unknown as {
        isCoordinator: () => boolean;
      }).isCoordinator = () => true;
      // Drive the production click-path.
      await el.refreshBackstoryForPc('mei');
      await new Promise((r) => setTimeout(r, 50));
      const proposal = appended.find(
        (a) => a.kind === 'backstory-refresh-proposal'
      );
      return {
        stage: 'committed',
        appendedKinds: appended.map((a) => a.kind),
        emitted: proposal?.payload as
          | { proposedBackstory?: string; baselineHash?: string; initiator?: string }
          | undefined,
        captured: captured as { system?: string; user?: string } | null,
        baselineCurrent: 'Mei grew up by the Underleaf.'
      };
    });
    expect(result.stage).toBe('committed');
    expect(result.appendedKinds).toContain('backstory-refresh-proposal');
    expect(result.emitted).toBeDefined();
    // The PROOF LINE: proposed !== current.  No more no-op stubs.
    expect(result.emitted?.proposedBackstory).not.toBe(result.baselineCurrent);
    expect(result.emitted?.proposedBackstory).toContain('they/them');
    expect(result.emitted?.initiator).toBe('dm');
    // Defense-in-depth: the AI prompt MUST carry the pronouns delta
    // (player-visible only) AND MUST NOT carry any DM-side reason
    // narrative (R-G + Adversarial P1 #4).
    expect(result.captured?.user).toBeDefined();
    expect(result.captured?.user).toContain('Pronouns:');
    expect(result.captured?.user).toContain('she/her');
    expect(result.captured?.user).toContain('they/them');
    expect(result.captured?.user?.toLowerCase()).not.toMatch(
      /(why|reason|because|the dm)/
    );
  });

  test('refresh-backstory button is DISABLED with "AI not configured" reason when no API key is set', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      const el = document.querySelector('quire-app') as unknown as {
        aiProvider: string;
        setAiApiKey: (key: string) => void;
      };
      // Clear API key for the active provider.
      el.setAiApiKey('');
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Read the host's disabled-reason via the property the tray
      // would see.  Accessing the private method directly so the
      // assertion holds even without a mounted region.
      const reason = (el as unknown as {
        refreshBackstoryDisabledReasonForHost: () => string | null;
      }).refreshBackstoryDisabledReasonForHost();
      return { reason, provider: el.aiProvider };
    });
    expect(result.reason).toBeTruthy();
    expect(result.reason).toMatch(/AI not configured/i);
    expect(result.reason).toContain(result.provider);
  });
});
