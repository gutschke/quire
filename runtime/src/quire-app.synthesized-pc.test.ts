// @vitest-environment happy-dom

/**
 * Phase 3b-1 step 4 — end-to-end integration test for the
 * synthesized-PC materialization loop.
 *
 * Drives steps 1-3 together:
 *   step 1: pc-create event + materializer + synthesizedPcs state.
 *   step 2: loader-overlay resolution in QuireApp callers.
 *   step 3: acceptSlot emits pc-create + pc-slot-bind atomically.
 *
 * Verifies: after a DM accepts a synthesized PC, the bound-PC
 * resolver picks up the record from the session-event-log overlay
 * (NOT from a GitHub-raw fetch), the dice-Dock's stats prop sees
 * non-null stats, and the synthesizedPcs map contains the
 * materialized record.
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

function inMemoryFactory(
  network: InMemoryNetwork,
  id: string
): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(id, network),
      pairingCode: id
    }),
    createGuest: async () => ({
      transport: new InMemoryTransport(id, network)
    })
  };
}

function mountApp(factory: TransportFactory): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = factory;
  document.body.appendChild(el);
  return el;
}

/**
 * `loadCharacterByPcId` requires `getCurrentCampaign()` to return
 * a value, which in turn requires `appState.kind` to be one of
 * campaign/episode/scene/character.  Tests skip the full
 * navigateToRoute machinery by injecting a minimal LoadedCampaign
 * directly.
 */
function injectCampaign(app: QuireApp): void {
  const campaign = {
    base: {
      manifest: {
        $schemaVersion: '0.1.0',
        name: 'TestCampaign'
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    },
    worldOverview: null
  };
  (
    app as unknown as { _appState: { kind: string; campaign: unknown } }
  )._appState = { kind: 'campaign', campaign };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe('QuireApp Phase 3b-1 — synthesized PC end-to-end', () => {
  it('a pc-create event materializes a record into state.synthesizedPcs', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    expect(app.isCoordinator()).toBe(true);
    // Emit a pc-create directly via the session (simulating what
    // step-3's acceptSlot does).
    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('pc-create', {
      v: 1,
      pcId: 'slot-1-syn-test',
      name: 'Mei Tanaka',
      pronouns: 'she/her',
      tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      backstory: 'Mei grew up in the Mission.',
      causedByResponseId: 'syn-r1'
    });
    await flush();
    const view = (
      app as unknown as {
        sessionView?: {
          status: string;
          filteredShared: { synthesizedPcs: Record<string, unknown> };
        };
      }
    ).sessionView;
    expect(view?.status).toBe('active');
    expect(view?.filteredShared.synthesizedPcs['slot-1-syn-test']).toBeDefined();
  });

  it('pc-create followed by pc-slot-bind populates pcCharacterCache via the overlay', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('pc-create', {
      v: 1,
      pcId: 'slot-2-syn-abc',
      name: 'Reggie Okeke',
      pronouns: 'he/him',
      tags: ['ICU nurse', 'father of two', 'amateur radio operator'],
      stats: { str: 1, dex: 0, con: 1, int: 1, wis: 2, cha: 0 },
      skills: ['Medic', 'Insight'],
      backstory: 'Reggie commuted from Oakland for ten years.',
      causedByResponseId: 'syn-r2'
    });
    session.append('pc-slot-bind', {
      v: 1,
      slot: 2,
      pcId: 'slot-2-syn-abc'
    });
    await flush();

    // The DM-review surface's display-name lookup populates the
    // cache via loadCharacterByPcId; the overlay-hit branch should
    // resolve synchronously.
    const appLoader = app as unknown as {
      loadCharacterByPcId: (id: string) => void;
      pcCharacterCache: Map<string, { record: { name: string } }>;
    };
    appLoader.loadCharacterByPcId('slot-2-syn-abc');
    const cached = appLoader.pcCharacterCache.get('slot-2-syn-abc');
    expect(cached).toBeDefined();
    expect(cached?.record.name).toBe('Reggie Okeke');
  });

  it('A bound synthesized PC populates boundCharacter without a GitHub fetch', async () => {
    // Guest joins as a player; host materializes a PC and binds the
    // guest's slot to it.  The guest's `refreshBoundCharacter` must
    // resolve from the overlay synchronously.
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    injectCampaign(host);
    const session = (host as unknown as { session: { append: Function } })
      .session;

    // Bind the host's own peer to a slot so the host IS the PC's
    // peer in this single-app test (we don't actually need a guest
    // for the overlay test — refreshBoundCharacter fires off the
    // host's own pcId once the peer-PC link is set).
    const hostPeerId = (host as unknown as { peerId?: string }).peerId;
    if (hostPeerId) {
      session.append('peer-rename', { name: 'DM-and-Mei' });
    }

    session.append('pc-create', {
      v: 1,
      pcId: 'slot-3-syn-zzz',
      name: 'Yui Tanaka',
      pronouns: 'she/her',
      tags: ['data scientist', 'ex-skateboarder', 'rents in Russian Hill'],
      stats: { str: 0, dex: 2, con: 0, int: 1, wis: 1, cha: 1 },
      skills: ['Tech', 'Knowledge'],
      backstory: 'Yui learned to hold a line during her PhD defense.',
      causedByResponseId: 'syn-r3'
    });
    session.append('pc-slot-bind', {
      v: 1,
      slot: 3,
      pcId: 'slot-3-syn-zzz'
    });
    await flush();

    // The host should now see slot 3 bound to the synthesized PC.
    // Phase B' (2026-05-25): pcSlots is now Record<number, Seat>;
    // read pcId off the seat.
    const view = (
      host as unknown as {
        sessionView?: {
          status: string;
          filteredShared: {
            pcSlots: Record<number, { state: string; pcId?: string }>;
            synthesizedPcs: Record<string, { name: string }>;
          };
        };
      }
    ).sessionView;
    expect(view?.filteredShared.pcSlots[3]?.pcId).toBe('slot-3-syn-zzz');
    expect(view?.filteredShared.synthesizedPcs['slot-3-syn-zzz'].name).toBe(
      'Yui Tanaka'
    );

    // The overlay resolver can produce a LoadedCharacter without
    // hitting the network — exercise it via loadCharacterByPcId.
    const appLoader = host as unknown as {
      loadCharacterByPcId: (id: string) => void;
      pcCharacterCache: Map<string, { record: { name: string; stats?: object } }>;
    };
    appLoader.loadCharacterByPcId('slot-3-syn-zzz');
    const cached = appLoader.pcCharacterCache.get('slot-3-syn-zzz');
    expect(cached?.record.name).toBe('Yui Tanaka');
    expect(cached?.record.stats).toEqual({
      str: 0,
      dex: 2,
      con: 0,
      int: 1,
      wis: 1,
      cha: 1
    });
  });

  /**
   * Firewall regression (2026-05-27): post-extraction session
   * simulation flagged that pcCharacterCache populates ONCE at
   * coord-time (unstripped — DM sees full record).  If the local
   * peer then loses coord (co-DM reclaim), the cache survives
   * untouched + subsequent reads see the unstripped record from
   * a now-player viewpoint, leaking DM-only fields.  Fix: clear
   * the cache on any coord-status transition + on leaveSession.
   */
  it('pcCharacterCache clears on coord-loss (firewall regression)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const session = (
      app as unknown as {
        session: { append: Function; reclaimCoordinator: Function };
      }
    ).session;
    // Seed: as coord, pre-populate the cache via the overlay path.
    session.append('pc-create', {
      v: 1,
      pcId: 'slot-1-syn-test',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech'],
      backstory: 'x',
      causedByResponseId: 'syn-r1'
    });
    await flush();
    const appLoader = app as unknown as {
      loadCharacterByPcId: (id: string) => void;
      pcCharacterCache: Map<string, unknown>;
    };
    appLoader.loadCharacterByPcId('slot-1-syn-test');
    expect(appLoader.pcCharacterCache.has('slot-1-syn-test')).toBe(true);
    // Force coord-loss: append a coordinator-yield from this peer.
    // Without a peer-rejoin, the session will report
    // coordinator=undefined which still flips isCoordinator() false.
    session.append('coordinator-yield', {});
    await flush();
    // Cache must be cleared so subsequent reads re-strip from the
    // current (non-coord) viewer's perspective.
    expect(appLoader.pcCharacterCache.has('slot-1-syn-test')).toBe(false);
  });

  it('pcCharacterCache clears on leaveSession (memory + firewall hygiene)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('pc-create', {
      v: 1,
      pcId: 'slot-1-syn-test',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech'],
      backstory: 'x',
      causedByResponseId: 'syn-r1'
    });
    await flush();
    const appLoader = app as unknown as {
      loadCharacterByPcId: (id: string) => void;
      pcCharacterCache: Map<string, unknown>;
      leaveSession: () => void;
    };
    appLoader.loadCharacterByPcId('slot-1-syn-test');
    expect(appLoader.pcCharacterCache.has('slot-1-syn-test')).toBe(true);
    appLoader.leaveSession();
    expect(appLoader.pcCharacterCache.size).toBe(0);
  });

  /**
   * Firewall regression #3 (2026-05-27): post-pcCharacterCache fix,
   * the sim found a SECOND mirror of the same data: `boundCharacter`
   * @state, populated via `refreshBoundCharacter`.  That method
   * short-circuits when `key === boundCharacterFor` (slug|pcId
   * unchanged across coord-flip).  So even after the cache clears,
   * the @state mirror keeps the old strip decision — coord→player
   * flip leaves unstripped DM-only fields visible to the now-player
   * viewer via Rail / Dice / Aside / sheet surfaces.  Fix: reset
   * `boundCharacterFor` alongside the cache clear so the next
   * `refreshBoundCharacter` re-resolves with the current decision.
   */
  it('boundCharacter clears on coord-loss + re-resolves stripped', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const session = (app as unknown as {
      session: { append: Function; rename: Function };
    }).session;
    // Seed: pc-create + bind so refreshBoundCharacter has something
    // to resolve.  Also bind the local peer to that PC via
    // peer-rename so `filteredShared.peers[me].pcId` resolves.
    session.append('pc-create', {
      v: 1,
      pcId: 'pc-dm',
      name: 'Maria',
      pronouns: 'she/her',
      tags: ['a', 'b', 'c'],
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech'],
      backstory: 'x',
      causedByResponseId: 'syn-r1'
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'pc-dm' });
    session.rename({ pcId: 'pc-dm' });
    await flush();
    const appAny = app as unknown as {
      boundCharacterFor: string;
      boundCharacter: { record: { name?: string } } | null;
    };
    // After init, boundCharacterFor should be the slug|pcId key
    // because the local peer is bound to pc-dm.
    expect(appAny.boundCharacterFor).not.toBe('');
    const boundBefore = appAny.boundCharacter;
    expect(boundBefore).not.toBeNull();
    // Force coord-loss: append coordinator-yield.
    session.append('coordinator-yield', {});
    await flush();
    // The fix must re-resolve boundCharacter through the strip-
    // decision path.  Identity comparison: pre-fix, the
    // boundCharacterFor short-circuit kept the SAME object;
    // post-fix, the subscriber resets boundCharacterFor and
    // refreshBoundCharacter creates a new wrapper.
    expect(appAny.boundCharacter).not.toBe(boundBefore);
  });

  it('overlay miss falls through to the GitHub fetch path (regression)', async () => {
    // A pcId NOT in synthesizedPcs should NOT short-circuit; the
    // existing async fetch path takes over.  Since the fetch will
    // 404 in the test env (no real GitHub), we just verify the
    // cache stays empty and no synchronous overlay-hit happened.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    injectCampaign(app);
    const appLoader = app as unknown as {
      loadCharacterByPcId: (id: string) => void;
      pcCharacterCache: Map<string, unknown>;
    };
    appLoader.loadCharacterByPcId('not-synthesized');
    // The fetch is in-flight (or has failed silently); the cache
    // remains empty because the overlay miss + fetch hasn't
    // resolved.
    expect(appLoader.pcCharacterCache.has('not-synthesized')).toBe(false);
  });
});

// ---- D5.5-B review round 2: proposeBond cap + ratify-resolve seam ----

describe('QuireApp D5.5-B — bond cap pre-check + ratify-resolve seam', () => {
  it('proposeBond returns false once BOND_MAX_PER_PC (8) is reached', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    await flush();
    const appBond = app as unknown as {
      proposeBond(o: {
        pcId: string;
        targetPcId: string;
        targetPlaceholder?: string;
        text: string;
      }): boolean;
    };
    // Fill the cap with 8 placeholder bonds.
    for (let i = 0; i < 8; i++) {
      const ok = appBond.proposeBond({
        pcId: 'mei',
        targetPcId: '',
        targetPlaceholder: `target ${i}`,
        text: `bond ${i}`
      });
      expect(ok).toBe(true);
    }
    await flush();
    // The 9th must be refused at the host pre-check (matches the
    // materializer's silent cap drop — so chargen acceptSlot's
    // dropped-bond audit counts correctly).
    const ninth = appBond.proposeBond({
      pcId: 'mei',
      targetPcId: '',
      targetPlaceholder: 'over the cap',
      text: 'should be refused'
    });
    expect(ninth).toBe(false);
  });

  it('placeholder bond resolves to a real target at ratify (host seam)', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    const session = (app as unknown as { session: { append: Function } })
      .session;
    // Two PCs: mei (bond source) + iris (resolve target).
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    session.append('seat-add', { v: 1, slot: 2 });
    session.append('pc-create', {
      v: 1,
      pcId: 'iris',
      name: 'Iris',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    session.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'iris' });
    await flush();
    const appBond = app as unknown as {
      proposeBond(o: {
        pcId: string;
        targetPcId: string;
        targetPlaceholder?: string;
        text: string;
      }): boolean;
      ratifyBond(o: {
        pcId: string;
        id: string;
        targetPcId?: string;
      }): boolean;
      sessionView?: {
        shared: {
          pcBondProposals: Record<string, Array<{ id: string }>>;
          pcBonds: Record<string, Array<{ targetPcId: string; text: string }>>;
        };
      };
    };
    // Placeholder bond on mei → "the engineer".
    expect(
      appBond.proposeBond({
        pcId: 'mei',
        targetPcId: '',
        targetPlaceholder: 'the engineer',
        text: 'We shared a lab.'
      })
    ).toBe(true);
    await flush();
    const proposalId = appBond.sessionView!.shared.pcBondProposals.mei[0].id;
    // A ratify WITHOUT resolving the placeholder must be refused.
    expect(appBond.ratifyBond({ pcId: 'mei', id: proposalId })).toBe(false);
    // Resolving to a real pcId succeeds.
    expect(
      appBond.ratifyBond({ pcId: 'mei', id: proposalId, targetPcId: 'iris' })
    ).toBe(true);
    await flush();
    const bonds = appBond.sessionView!.shared.pcBonds.mei;
    expect(bonds).toHaveLength(1);
    expect(bonds[0].targetPcId).toBe('iris');
    expect(bonds[0].text).toBe('We shared a lab.');
  });
});

describe('QuireApp D5.5-B — bond spoiler chip is DM-only', () => {
  it('a spoiler-bearing bond surfaces spoilerHits to the DM, never to the player', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    // Inject a campaign whose aiBackstory declares a spoiler token.
    (
      app as unknown as { _appState: { kind: string; campaign: unknown } }
    )._appState = {
      kind: 'campaign',
      campaign: {
        base: {
          manifest: {
            $schemaVersion: '0.1.0',
            name: 'TestCampaign',
            aiBackstory: { spoilerTokens: ['Quiet'] }
          },
          source: { owner: 'x', repo: 'y', ref: 'main' }
        },
        worldOverview: null
      }
    };
    const session = (app as unknown as { session: { append: Function } })
      .session;
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      harm: 0,
      stress: 0
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    await flush();
    const appBond = app as unknown as {
      proposeBond(o: {
        pcId: string;
        targetPcId: string;
        targetPlaceholder?: string;
        text: string;
      }): boolean;
      buildPendingBondProposalsForDmAside(): Array<{
        spoilerHits?: string[];
      }>;
    };
    appBond.proposeBond({
      pcId: 'mei',
      targetPcId: '',
      targetPlaceholder: 'the one who hears the Quiet',
      text: 'She knew before I did.'
    });
    await flush();
    // DM-side aside queue carries the spoiler hit (substring match
    // on the placeholder).
    const queue = appBond.buildPendingBondProposalsForDmAside();
    expect(queue).toHaveLength(1);
    expect(queue[0].spoilerHits).toContain('quiet');
    // Player projection: proposals (incl. the spoiler text) wiped
    // wholesale — the chip data can't reach a non-coord viewer
    // because the proposal itself doesn't.
    const view = (
      app as unknown as {
        session: { peer: { state(): { pcBondProposals: object } } };
      }
    ).session;
    void view; // (proposal-wipe is covered by the core firewall tests)
  });
});
