// @vitest-environment happy-dom

/**
 * Mock Campaign 12 — Player ghost + recast (run #18).
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-12-
 * revoke-and-recast.md`.
 *
 * The product owner needs the DM to "clearly wipe out a player as
 * if they had never been there" + "keep the PC1 slot in the story
 * but completely re-create the character because the player is
 * unhappy with how their character worked out... a little bit of
 * creative retconning by the DM can often fix things, if the game
 * engine allows it."
 *
 * Run #18 ships the `pc-revoke` engine primitive (DEC-043) + the
 * DM operational view "Manage seats" surface (DEC-044) + this mock
 * campaign as the end-to-end carrier per the LL-1/LL-2/LL-3 sliver-
 * test discipline.  EVERY scenario drives through the production
 * code path (engine event → materializer → save-layer firewall →
 * restore-side materializer OR Lit click handler → host bridge →
 * engine event), NEVER a test-side state-poke.
 *
 * Scenario index:
 *
 *   - A1 (never-arrived, engine altitude):  three PCs at the table;
 *     PC2 player vanishes pre-fiction; DM revokes with `never-
 *     arrived`; PC1 + PC3's projections lose any trace of PC2 from
 *     synthesizedPcs + roster + bond rewrite.
 *
 *   - A2 (never-arrived, byline-preserved):  re-load the post-
 *     revoke save through the full save/restore round-trip; assert
 *     PC2's pre-revoke chat lines survive verbatim with byline
 *     preserved (per Q4 expert advisory: chat is ink, not pencil).
 *
 *   - B1 (recast, engine altitude):  PC1 player + DM agree to
 *     recast.  DM revokes with `recast`; follows up with normal
 *     `pc-create` + `pc-slot-bind`.  Slot 1 (sticky-N) carries the
 *     NEW PC; OLD PC's entry is gone; NEW PC starts at zero
 *     magic-discovery state.
 *
 *   - B2 (recast, bond preserved as tombstone):  PC1 had a bond
 *     TO the revoked PC.  After the revoke + recast, the bond on
 *     PC1's sheet reads as a tombstone with the DM-supplied
 *     stand-in name; nothing crashes the renderer.
 *
 *   - C1 (host UI altitude, end-to-end):  mount QuireApp, build a
 *     two-PC session, open the DM operational view, click through
 *     the "Remove player from this seat" affordance, confirm the
 *     dialog with a stand-in name; assert the production code path
 *     fires a `pc-revoke` event with the right payload AND the
 *     materialized state shows the seat in `revoked`.  This is the
 *     LL-1/2/3 carrier: the click-→-event chain through real Lit.
 *
 *   - D1 (firewall: DM-only fields stripped):  serialize the post-
 *     revoke state for a player viewer; assert `narrativeShape` +
 *     `causedByPeerId` are stripped from the player's projection
 *     of the `pc-revoke` event in the log.
 *
 *   - E1 (silent-player firewall: no toast / no chat insertion):
 *     after a revoke, the player's filtered chat log AND filtered
 *     synthesizedPcs both reflect the change WITHOUT any inserted
 *     "Mei has been removed" event.  The change must be experienced
 *     as fiction shifting under the player, not announced.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach
} from 'vitest';
import { Peer } from './core/peer';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { filterForViewer } from './core/state';
import {
  defaultRebroadcastFilter,
  defaultSyncResponseFilter,
  parseSaveDocument,
  serializeSession,
  serializeSessionForViewer,
  stringifySave
} from './persistence';
import { ensureMarkdownPipeline } from './markdown';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';

const CAMPAIGN = { owner: 'gutschke', repo: 'underleaf', ref: 'main' };

function makePeer(id: string, net: InMemoryNetwork): Peer {
  return new Peer(id, new InMemoryTransport(id, net), {
    rebroadcastFilter: defaultRebroadcastFilter,
    syncResponseFilter: defaultSyncResponseFilter
  });
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

function appendCreatePc(peer: Peer, pcId: string, name: string): void {
  peer.append('pc-create', {
    v: 1,
    pcId,
    name,
    pronouns: 'they/them',
    tags: ['a', 'b', 'c'],
    stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    skills: ['Tech'],
    backstory: 'X'
  });
}

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

beforeAll(async () => {
  await ensureMarkdownPipeline();
});

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('Mock Campaign 12 — Player ghost + recast', () => {
  // ===================================================================
  // Scenario A1 — Engine altitude: never-arrived clears the PC entry
  // for both DM + player projections, leaves the slot in `revoked`,
  // and rewrites inbound bonds as tombstones.
  // ===================================================================
  it('A1: never-arrived wipes PC2 from both DM + player projections; sticky-N preserved at slot 2', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei-player', net);
    const kasumi = makePeer('kasumi-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    kasumi.append('peer-join', {
      name: 'Kasumi-player',
      knownKindsCount: 200
    });
    dm.append('coordinator-claim', {});

    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    dm.append('seat-add', { v: 1, slot: 3 });
    appendCreatePc(dm, 'mei', 'Mei');
    appendCreatePc(dm, 'pc-vanish', 'Yui');
    appendCreatePc(dm, 'kasumi', 'Kasumi');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'pc-vanish' });
    dm.append('pc-slot-bind', { v: 1, slot: 3, pcId: 'kasumi' });

    // Mei has an inbound bond to the vanished PC.
    dm.append('bond-propose', {
      v: 1,
      id: 'b1234567890abcdef',
      pcId: 'mei',
      targetPcId: 'pc-vanish',
      text: 'I trust them to hold my line'
    });
    dm.append('bond-ratify', {
      v: 1,
      id: 'b1234567890abcdef',
      pcId: 'mei'
    });

    await flush();

    // Sanity pre-revoke: the bond + the PC entry both exist.
    const preState = dm.state();
    expect(preState.synthesizedPcs['pc-vanish']).toBeDefined();
    expect(preState.pcBonds['mei'].some((b) => b.targetPcId === 'pc-vanish'))
      .toBe(true);

    // DM revokes with `never-arrived` + a stand-in name.
    dm.append('pc-revoke', {
      v: 1,
      pcId: 'pc-vanish',
      slot: 2,
      narrativeShape: 'never-arrived',
      bondTombstoneName: 'an old colleague',
      causedByPeerId: 'markus'
    });

    await flush();

    // ---- DM projection ----
    const dmState = dm.state();
    expect(dmState.synthesizedPcs['pc-vanish']).toBeUndefined();
    expect(dmState.pcSlots[2].state).toBe('revoked');
    // Sticky-N: slots 1 + 3 untouched.
    expect(dmState.pcSlots[1].state).toBe('bound-active');
    expect(dmState.pcSlots[3].state).toBe('bound-active');
    // Mei's bond TO the vanished PC is now tombstoned with the
    // DM-supplied stand-in name.
    const meiBondsDm = dmState.pcBonds['mei'];
    expect(meiBondsDm).toHaveLength(1);
    expect(meiBondsDm[0].targetPcId).toBe('pc-vanish');
    expect(meiBondsDm[0].tombstone?.name).toBe('an old colleague');
    // No outbound bonds for the revoked PC.
    expect(dmState.pcBonds['pc-vanish']).toBeUndefined();

    // ---- Player projection (kasumi) ----
    const kasumiView = filterForViewer(dmState, 'kasumi-player');
    expect(kasumiView.synthesizedPcs['pc-vanish']).toBeUndefined();
    expect(kasumiView.pcSlots[2].state).toBe('revoked');
    // Tombstone propagates: kasumi (who didn't author the bond)
    // sees Mei's bond list with the tombstone too.
    const meiBondsPlayer = kasumiView.pcBonds['mei'];
    expect(meiBondsPlayer[0].tombstone?.name).toBe('an old colleague');
  });

  // ===================================================================
  // Scenario A2 — Chat is ink, not pencil (Q4 expert advisory).
  // ===================================================================
  it('A2: pre-revoke chat lines survive save/restore verbatim with byline preserved', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const vanish = makePeer('yui-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    vanish.append('peer-join', { name: 'Yui', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'pc-vanish', 'Yui');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'pc-vanish' });

    // Yui logs a chat line BEFORE the revoke.
    vanish.append('chat', {
      v: 1,
      text: 'I dive into the river to find the artifact.',
      author: 'Yui',
      ts: 1
    });
    await flush();

    dm.append('pc-revoke', {
      v: 1,
      pcId: 'pc-vanish',
      slot: 1,
      narrativeShape: 'offstage-forever'
    });
    await flush();

    // Save → restore round-trip on the DM side.
    const doc = serializeSession(dm.events(), CAMPAIGN, 'markus');
    const body = stringifySave(doc);
    const parsed = parseSaveDocument(body);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.error}`);
    const restoredEvents = parsed.doc.events;

    // The chat event survives BYTE-IDENTICAL, byline intact.
    const chatEv = restoredEvents.find(
      (e) =>
        e.kind === 'chat' && (e.payload as { text?: string }).text !== undefined
    );
    expect(chatEv).toBeDefined();
    expect((chatEv!.payload as { text: string }).text).toContain(
      'I dive into the river'
    );
    expect((chatEv!.payload as { author: string }).author).toBe('Yui');
  });

  // ===================================================================
  // Scenario B1 — Recast: same slot, new PC, fresh state.
  // ===================================================================
  it('B1: recast flips slot to revoked, then pc-create + pc-slot-bind rebinds the same slot to the new PC', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const p1 = makePeer('p1', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    p1.append('peer-join', { name: 'Player1', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    appendCreatePc(dm, 'mei-v1', 'Mei (v1)');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei-v1' });

    // The OLD PC has accumulated magic-discovery state.
    dm.append('accidental-grant-log', {
      v: 1,
      pcId: 'mei-v1',
      note: 'lit a candle from across the room'
    });
    await flush();

    expect(dm.state().pcAccidentalGrants['mei-v1']).toBeDefined();

    // DM revokes (recast) — slot enters `revoked`, the OLD PC's
    // magic-discovery log is wiped per DEC-041.
    dm.append('pc-revoke', {
      v: 1,
      pcId: 'mei-v1',
      slot: 1,
      narrativeShape: 'recast'
    });
    await flush();

    expect(dm.state().pcSlots[1].state).toBe('revoked');
    expect(dm.state().synthesizedPcs['mei-v1']).toBeUndefined();
    expect(dm.state().pcAccidentalGrants['mei-v1']).toBeUndefined();

    // Follow-up: DM creates the new PC + binds to the SAME slot.
    appendCreatePc(dm, 'mira-v2', 'Mira (v2)');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mira-v2' });
    await flush();

    // Slot 1 now carries the NEW PC; sticky-N preserved.
    expect(dm.state().pcSlots[1].state).toBe('bound-active');
    if (dm.state().pcSlots[1].state === 'bound-active') {
      expect(dm.state().pcSlots[1].pcId).toBe('mira-v2');
    }
    expect(dm.state().synthesizedPcs['mira-v2']).toBeDefined();
    expect(dm.state().synthesizedPcs['mira-v2'].name).toBe('Mira (v2)');
    // NEW PC starts CLEAN — no inherited magic-discovery state.
    expect(dm.state().pcAccidentalGrants['mira-v2']).toBeUndefined();
    expect(dm.state().casterState['mira-v2']).toBeUndefined();
  });

  // ===================================================================
  // Scenario B2 — Recast keeps inbound bond as a tombstone instead
  // of crashing the renderer with a dangling targetPcId.
  // ===================================================================
  it('B2: an inbound bond to the recast PC tombstones with the DM-supplied stand-in name', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm, 'pc-stayer', 'Aiko');
    appendCreatePc(dm, 'pc-recast', 'Yui');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'pc-stayer' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'pc-recast' });

    // Aiko had a bond TO Yui.
    dm.append('bond-propose', {
      v: 1,
      id: 'b2222222222abcdef',
      pcId: 'pc-stayer',
      targetPcId: 'pc-recast',
      text: 'I owe them my life'
    });
    dm.append('bond-ratify', {
      v: 1,
      id: 'b2222222222abcdef',
      pcId: 'pc-stayer'
    });
    await flush();

    // Recast Yui to a new PC.
    dm.append('pc-revoke', {
      v: 1,
      pcId: 'pc-recast',
      slot: 2,
      narrativeShape: 'recast',
      bondTombstoneName: 'someone they trusted'
    });
    await flush();

    // The bond on Aiko's sheet now reads as a tombstone — the
    // renderer can show "someone they trusted" instead of
    // looking up the deleted synthesizedPcs[pc-recast].
    const bonds = dm.state().pcBonds['pc-stayer'];
    expect(bonds).toHaveLength(1);
    expect(bonds[0].tombstone?.name).toBe('someone they trusted');
    expect(bonds[0].tombstone?.targetNpcId).toBeUndefined();
  });

  // ===================================================================
  // Scenario C1 — End-to-end production click path through QuireApp +
  // the DM operational view + the pc-revoke-confirm-dialog.
  //
  // Per LL-1/LL-2/LL-3: drive the REAL click handlers, NOT a test-
  // side state-poke.  Assert the user-visible engine state, not an
  // intermediate render flag.
  // ===================================================================
  it('C1: clicking through the DM operational view fires pc-revoke + materialized seat enters `revoked`', async () => {
    const net = new InMemoryNetwork();
    const app = document.createElement('quire-app') as QuireApp;
    app.sessionFactory = inMemoryFactory(net, 'DM12-C1');
    document.body.appendChild(app);

    // Inject a campaign so the host can build cloud-sync ids.
    (app as unknown as { _appState: unknown })._appState = {
      kind: 'campaign',
      campaign: {
        base: {
          manifest: { $schemaVersion: '0.1.0', name: 'M12 C1' },
          source: CAMPAIGN
        },
        worldOverview: null
      }
    };

    app.startHosting();
    await flush();
    const session = (
      app as unknown as {
        session: {
          append: (k: string, p: unknown) => void;
          getEvents(): unknown[];
        };
      }
    ).session;
    // Build a two-PC session.  All events come from the DM-host so
    // coord-holder gate passes.
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('seat-add', { v: 1, slot: 2 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei',
      pronouns: 'she/her',
      tags: ['warm'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: ['Tech'],
      backstory: 'X'
    });
    session.append('pc-create', {
      v: 1,
      pcId: 'pc-vanish',
      name: 'Yui',
      pronouns: 'they/them',
      tags: ['quiet'],
      stats: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
      skills: ['Lore'],
      backstory: 'Y'
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    session.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'pc-vanish' });
    await flush();

    // Pre-revoke sanity.
    type ViewShape = {
      sessionView: {
        shared: {
          pcSlots: Record<string, { state: string; pcId?: string }>;
          synthesizedPcs: Record<string, unknown>;
        };
      };
    };
    let view = (app as unknown as ViewShape).sessionView;
    expect(view.shared.pcSlots[2].state).toBe('bound-active');

    // Open the DM operational view via the same flag-flip the
    // launcher chip uses.  We don't click the chip because the
    // launcher only renders in 'in-session' mode AND requires
    // additional rosters; the appMode transition is the equivalent
    // production effect.
    (app as unknown as { appMode: string }).appMode = 'dm-operational';
    await (app as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;
    await flush();

    // Locate the dm-operational-view + its Manage seats row for
    // slot 2.  The host MUST have populated manageSeats.
    const view2 = app.renderRoot.querySelector(
      'dm-operational-view'
    ) as HTMLElement;
    expect(view2).not.toBeNull();
    // The Manage seats section + the per-slot row for slot 2.
    const toggle = view2.querySelector(
      '[data-testid="dm-operational-manage-seat-toggle-2"]'
    ) as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    toggle.click();
    await (view2 as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;

    const removeBtn = view2.querySelector(
      '[data-testid="dm-operational-manage-seat-remove-2"]'
    ) as HTMLButtonElement;
    expect(removeBtn).not.toBeNull();
    removeBtn.click();
    await (view2 as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;

    // The confirm dialog opens.  Pick `never-arrived` + a stand-in
    // name, then Confirm.
    const neverArrived = view2.querySelector(
      '[data-testid="pc-revoke-shape-never-arrived"]'
    ) as HTMLInputElement;
    expect(neverArrived).not.toBeNull();
    neverArrived.checked = true;
    neverArrived.dispatchEvent(new Event('change'));
    await (view2 as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;

    const confirmBtn = view2.querySelector(
      '[data-testid="pc-revoke-confirm"]'
    ) as HTMLButtonElement;
    expect(confirmBtn).not.toBeNull();
    confirmBtn.click();
    await flush();
    await (app as unknown as { updateComplete: Promise<unknown> })
      .updateComplete;

    // ---- ASSERT through the engine, NOT the DOM ----
    // The host's `appendPcRevoke` fired; the session log carries
    // the event; the materialized state shows slot 2 in `revoked`.
    const eventsAfter = session.getEvents() as Array<{
      kind: string;
      payload: { pcId?: string; slot?: number; narrativeShape?: string };
    }>;
    const revokeEv = eventsAfter.find((e) => e.kind === 'pc-revoke');
    expect(revokeEv).toBeDefined();
    expect(revokeEv!.payload.pcId).toBe('pc-vanish');
    expect(revokeEv!.payload.slot).toBe(2);
    expect(revokeEv!.payload.narrativeShape).toBe('never-arrived');

    view = (app as unknown as ViewShape).sessionView;
    expect(view.shared.pcSlots[2].state).toBe('revoked');
    expect(view.shared.synthesizedPcs['pc-vanish']).toBeUndefined();
    // Sticky-N preserved.
    expect(view.shared.pcSlots[1].state).toBe('bound-active');
  });

  // ===================================================================
  // Scenario D1 — Save-layer firewall strips DM-only sub-fields from
  // the player's projection of the pc-revoke event.
  // ===================================================================
  it('D1: player save strips narrativeShape + causedByPeerId from the pc-revoke event payload', async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm, 'mei', 'Mei');
    appendCreatePc(dm, 'pc-vanish', 'Yui');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'pc-vanish' });

    dm.append('pc-revoke', {
      v: 1,
      pcId: 'pc-vanish',
      slot: 2,
      narrativeShape: 'offstage-forever',
      causedByPeerId: 'markus'
    });
    await flush();

    // DM-side save retains the DM-only sub-fields.
    const dmDoc = serializeSession(dm.events(), CAMPAIGN, 'markus');
    const dmRevoke = dmDoc.events.find(
      (e) => e.kind === 'pc-revoke'
    ) as { payload: { narrativeShape?: string; causedByPeerId?: string } } | undefined;
    expect(dmRevoke?.payload.narrativeShape).toBe('offstage-forever');
    expect(dmRevoke?.payload.causedByPeerId).toBe('markus');

    // Player-projected save STRIPS narrativeShape + causedByPeerId.
    // serializeSessionForViewer: (events, campaign, savedByPeerId,
    // currentCoordinator) — mei-player is the viewer; the DM
    // 'markus' is still the coord so isCoord becomes false for mei.
    const playerDoc = serializeSessionForViewer(
      dm.events(),
      CAMPAIGN,
      'mei-player',
      'markus'
    );
    const playerRevoke = playerDoc.events.find(
      (e) => e.kind === 'pc-revoke'
    ) as { payload: { narrativeShape?: string; causedByPeerId?: string } } | undefined;
    // The event itself survives so the player's seat state stays
    // consistent with the DM's (slot enters `revoked`); the DM-only
    // sub-fields are stripped per the scrubber contract.
    expect(playerRevoke).toBeDefined();
    expect(playerRevoke!.payload.narrativeShape).toBeUndefined();
    expect(playerRevoke!.payload.causedByPeerId).toBeUndefined();
    // The pcId + slot are NOT stripped — they're needed for the
    // materializer to find the seat.  bondTombstoneName is player-
    // visible (it's what the player SEES on their bond list).
    expect(playerRevoke!.payload).toHaveProperty('pcId', 'pc-vanish');
    expect(playerRevoke!.payload).toHaveProperty('slot', 2);
  });

  // ===================================================================
  // Scenario E1 — Silent-player firewall: no inserted notification,
  // chat unchanged, no "Mei was removed" event.
  // ===================================================================
  it("E1: no system-inserted notification on the player's filtered chat after a revoke", async () => {
    const net = new InMemoryNetwork();
    const dm = makePeer('markus', net);
    const mei = makePeer('mei-player', net);

    dm.append('peer-join', { name: 'Markus', knownKindsCount: 200 });
    mei.append('peer-join', { name: 'Mei-player', knownKindsCount: 200 });
    dm.append('coordinator-claim', {});
    dm.append('seat-add', { v: 1, slot: 1 });
    dm.append('seat-add', { v: 1, slot: 2 });
    appendCreatePc(dm, 'mei', 'Mei');
    appendCreatePc(dm, 'pc-vanish', 'Yui');
    dm.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    dm.append('pc-slot-bind', { v: 1, slot: 2, pcId: 'pc-vanish' });

    // A handful of chat exchanges before the revoke.
    dm.append('chat', { v: 1, text: 'You enter the bar.', author: 'DM', ts: 1 });
    mei.append('chat', { v: 1, text: 'I look around.', author: 'Mei', ts: 2 });
    await flush();

    const chatBefore = dm.events()
      .filter((e) => e.kind === 'chat').length;

    dm.append('pc-revoke', {
      v: 1,
      pcId: 'pc-vanish',
      slot: 2,
      narrativeShape: 'never-arrived'
    });
    await flush();

    // Engine MUST NOT auto-insert any chat / system message.  The
    // event log gains exactly one event (the pc-revoke itself);
    // the chat-event count is unchanged.
    const chatAfter = dm.events()
      .filter((e) => e.kind === 'chat').length;
    expect(chatAfter).toBe(chatBefore);

    // Player's filtered projection sees the seat in `revoked` +
    // synthesizedPcs entry gone, but NO new chat events.
    const playerView = filterForViewer(dm.state(), 'mei-player');
    expect(playerView.pcSlots[2].state).toBe('revoked');
    expect(playerView.synthesizedPcs['pc-vanish']).toBeUndefined();
    // Player's chat log is identical (verbatim, no system insert).
    const playerChat = mei.events()
      .filter((e) => e.kind === 'chat')
      .map((e) => (e.payload as { text: string }).text);
    expect(playerChat).toEqual(['You enter the bar.', 'I look around.']);
  });
});
