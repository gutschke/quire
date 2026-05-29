// @vitest-environment happy-dom

import { describe, it, expect } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import {
  countAdvancementMarks,
  type LoadedCharacter
} from './character-loader';

function inMemoryFactory(network: InMemoryNetwork, id: string): TransportFactory {
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

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function fakePc(id: string): LoadedCharacter {
  return {
    kind: 'pc',
    id,
    record: {
      $schemaVersion: '0.1.0',
      name: `PC ${id}`,
      stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: -1 },
      harm: 0,
      stress: 0
    },
    source: { owner: 'x', repo: 'y', ref: 'main' }
  };
}

describe('QuireApp pc-edit', () => {
  it('submitPcEdit is a no-op outside an active session', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    expect(app.submitPcEdit('p1', 'stats.str', 2)).toBe(false);
  });

  it('effectiveCharacter returns the base record when no edits', () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    const pc = fakePc('p1');
    expect(app.effectiveCharacter(pc)).toBe(pc.record);
  });

  it('effectiveCharacter merges session pcEdits over the base record', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    expect(app.submitPcEdit('p1', 'stats.str', 3)).toBe(true);
    const merged = app.effectiveCharacter(fakePc('p1'));
    expect(merged.stats?.str).toBe(3);
    expect(merged.stats?.dex).toBe(1);
  });

  it('LWW: a second edit to the same field replaces the first', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    app.submitPcEdit('p1', 'harm', 1);
    app.submitPcEdit('p1', 'harm', 2);
    expect(app.effectiveCharacter(fakePc('p1')).harm).toBe(2);
  });

  it('NPC edits are not exposed via effectiveCharacter overrides', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.startHosting();
    await flush();
    // Even if a pc-edit event is appended with an NPC id, the
    // effectiveCharacter helper only consults overrides for PCs.
    app.submitPcEdit('some-npc', 'harm', 4);
    const npc: LoadedCharacter = {
      kind: 'npc',
      id: 'some-npc',
      record: {
        $schemaVersion: '0.1.0',
        name: 'NPC',
        harm: 0
      },
      source: { owner: 'x', repo: 'y', ref: 'main' }
    };
    expect(app.effectiveCharacter(npc).harm).toBe(0);
  });

  it('edits flow host → guest', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    host.submitPcEdit('p1', 'stats.str', 3);
    await flush();
    expect(guest.effectiveCharacter(fakePc('p1')).stats?.str).toBe(3);
  });

  it('edits flow guest → host', async () => {
    const network = new InMemoryNetwork();
    const host = mountApp(inMemoryFactory(network, 'HOST'));
    host.startHosting();
    await flush();
    const guest = mountApp(inMemoryFactory(network, 'GUEST'));
    guest.joinCodeDraft = 'HOST';
    guest.joinSession();
    await flush();
    guest.submitPcEdit('p1', 'stress', 2);
    await flush();
    expect(host.effectiveCharacter(fakePc('p1')).stress).toBe(2);
  });

  // Review 2026-05-28 — takeAdvancement closes the advancement loop:
  // reset the 5 mark bullets + bump the advancements count (cap 8).
  describe('takeAdvancement (advancement-loop closure)', () => {
    function seedPc(app: QuireApp, pcId: string): void {
      const session = (app as unknown as { session: { append: Function } })
        .session;
      session.append('pc-create', {
        v: 1,
        pcId,
        name: 'Mei',
        pronouns: 'she/her',
        tags: ['a', 'b', 'c'],
        stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
        skills: ['Tech', 'Knowledge'],
        backstory: 'x',
        causedByResponseId: 'syn-1'
      });
    }

    it('resets all 5 mark bullets and bumps advancements by one', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      seedPc(app, 'p1');
      // Tick all 5 bullets + set advancements to 2 via edits.
      for (const k of [
        'hardMoment',
        'learned',
        'risk',
        'against',
        'complication'
      ]) {
        app.submitPcEdit('p1', `markBullets.${k}`, true);
      }
      app.submitPcEdit('p1', 'advancements', 2);
      await flush();
      (app as unknown as { takeAdvancement: (id: string) => void }).takeAdvancement(
        'p1'
      );
      await flush();
      const eff = app.effectiveCharacter(fakePc('p1'));
      expect(eff.advancements).toBe(3);
      const b = (eff.markBullets ?? {}) as Record<string, boolean>;
      expect(
        Object.values(b).filter((v) => v === true).length
      ).toBe(0);
    });

    it('does not exceed the rules.md:166 cap of 8 advancements', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      seedPc(app, 'p1');
      app.submitPcEdit('p1', 'advancements', 8);
      await flush();
      (app as unknown as { takeAdvancement: (id: string) => void }).takeAdvancement(
        'p1'
      );
      await flush();
      expect(app.effectiveCharacter(fakePc('p1')).advancements).toBe(8);
    });

    it('is a no-op for an unknown pcId (not in synthesizedPcs)', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      // No pc-create for 'ghost' → handler bails before emitting edits.
      (app as unknown as { takeAdvancement: (id: string) => void }).takeAdvancement(
        'ghost'
      );
      await flush();
      expect(app.effectiveCharacter(fakePc('ghost')).advancements).toBeUndefined();
    });

    // End-to-end simulated session (TTRPG scenario 1): the loop must
    // CLOSE across a full cycle through the real event log — tick to
    // 5, take the advancement, the derived count resets to 0, then a
    // new cycle accrues without the count ever exceeding 5.  This is
    // the integration the player Rail chip + session-open badge both
    // read (both derive via countAdvancementMarks).
    it('full advancement cycle: 5 marks → take → reset → re-accrue, never exceeds 5', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      seedPc(app, 'p1');
      const take = (app as unknown as {
        takeAdvancement: (id: string) => void;
      }).takeAdvancement.bind(app);
      const marksNow = (): number =>
        countAdvancementMarks(app.effectiveCharacter(fakePc('p1')).markBullets);

      // Cycle 1: the DM ticks all 5 bullets over a few sessions.
      for (const k of [
        'hardMoment',
        'learned',
        'risk',
        'against',
        'complication'
      ]) {
        app.submitPcEdit('p1', `markBullets.${k}`, true);
      }
      await flush();
      expect(marksNow()).toBe(5); // chip → "Advancement ready"

      // DM confirms the advancement at session-open.
      take('p1');
      await flush();
      expect(marksNow()).toBe(0); // chip clears (no more nagging)
      expect(app.effectiveCharacter(fakePc('p1')).advancements).toBe(1);

      // Cycle 2: two more bullets — the count reflects reality and
      // never shows N>5 (the old record.marks bug could have).
      app.submitPcEdit('p1', 'markBullets.hardMoment', true);
      app.submitPcEdit('p1', 'markBullets.learned', true);
      await flush();
      expect(marksNow()).toBe(2); // count is 2 internally; player Rail shows nothing until 5 (#408)
    });
  });

  // Task #295 — appendDmNotesEdit dispatches a pc-edit('dmNotes', …).
  describe('Task #295 — appendDmNotesEdit', () => {
    it('rejects calls outside an active session', () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      expect(app.appendDmNotesEdit('p1', 'note')).toBe(false);
    });

    it('coordinator writes dmNotes; merged record carries the value', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      expect(app.appendDmNotesEdit('p1', 'sister is the antagonist')).toBe(
        true
      );
      const merged = app.effectiveCharacter(fakePc('p1'));
      expect(merged.dmNotes).toBe('sister is the antagonist');
    });

    it('LWW: a second dmNotes write replaces the first', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      app.appendDmNotesEdit('p1', 'first');
      app.appendDmNotesEdit('p1', 'second');
      expect(app.effectiveCharacter(fakePc('p1')).dmNotes).toBe('second');
    });

    it('empty string clears the note', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      app.appendDmNotesEdit('p1', 'something');
      app.appendDmNotesEdit('p1', '');
      expect(app.effectiveCharacter(fakePc('p1')).dmNotes).toBe('');
    });

    it('rejects oversized values (>2000 chars)', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      expect(app.appendDmNotesEdit('p1', 'x'.repeat(2001))).toBe(false);
      expect(app.effectiveCharacter(fakePc('p1')).dmNotes).toBeUndefined();
    });

    it('non-coordinator (player peer) cannot write dmNotes', async () => {
      const network = new InMemoryNetwork();
      const host = mountApp(inMemoryFactory(network, 'HOST'));
      host.startHosting();
      await flush();
      const guest = mountApp(inMemoryFactory(network, 'GUEST'));
      guest.joinCodeDraft = 'HOST';
      guest.joinSession();
      await flush();
      expect(guest.isCoordinator()).toBe(false);
      expect(guest.appendDmNotesEdit('p1', 'sneaky note')).toBe(false);
      // And the host's effective record carries nothing.
      expect(host.effectiveCharacter(fakePc('p1')).dmNotes).toBeUndefined();
    });
  });

  // -----------------------------------------------------------
  // Wave B (2026-05-26) magic-arc DM runtime controls — host
  // method coverage.  Verifier S4: pin the appendMarkRealization
  // 4-event contract so a future refactor of pc-edit field names
  // doesn't silently no-op the Realization beat.
  // -----------------------------------------------------------

  describe('Wave B: magic-arc DM runtime control host methods', () => {
    it('appendMarkRealization emits the 4-field pc-edit batch in order', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      expect(app.appendMarkRealization('p1')).toBe(true);
      const merged = app.effectiveCharacter(fakePc('p1'));
      expect(merged.magicPhase).toBe('realization');
      expect(merged.knowsTheyCanCast).toBe(true);
      expect(merged.tax?.active).toBe(true);
      expect(merged.tax?.sessionsRemaining).toBe(3);
    });

    it('appendMarkRealization is a no-op for non-coord viewers', async () => {
      const net = new InMemoryNetwork();
      const host = mountApp(inMemoryFactory(net, 'HOST'));
      host.startHosting();
      await flush();
      const guest = mountApp(inMemoryFactory(net, 'GUEST'));
      guest.joinCodeDraft = 'HOST';
      guest.joinSession();
      await flush();
      expect(guest.isCoordinator()).toBe(false);
      expect(guest.appendMarkRealization('p1')).toBe(false);
      const merged = host.effectiveCharacter(fakePc('p1'));
      expect(merged.magicPhase).toBeUndefined();
    });

    it('appendAccidentalGrantLog appends to shared state.pcAccidentalGrants', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      expect(
        app.appendAccidentalGrantLog('p1', 'cabinet code came to mind')
      ).toBe(true);
      const grants = app.sessionView!.shared.pcAccidentalGrants.p1;
      expect(grants).toHaveLength(1);
      expect(grants[0].note).toBe('cabinet code came to mind');
    });

    it('appendFocusGrant appends to shared state.pcFoci with active default', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      expect(
        app.appendFocusGrant('p1', { name: 'pattern-sense', domain: 'perception' })
      ).toBe(true);
      const foci = app.sessionView!.shared.pcFoci.p1;
      expect(foci).toHaveLength(1);
      expect(foci[0].name).toBe('pattern-sense');
      expect(foci[0].domain).toBe('perception');
      expect(foci[0].status).toBe('active');
    });

    it('Wave D-prep-3 regression: render-merge unions record.foci + state.pcFoci[pcId]', async () => {
      // Engineering audit caught that no test pins the merge at
      // quire-app.ts:5524 — if one side of the union changes
      // without the other, accidental/foci silently desync.  This
      // test seeds session-state foci via focus-grant + asserts
      // they appear on the renderDmPcDetail view alongside any
      // disk-authored foci.  Replays the canonical merge contract.
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      // Grant 2 foci via session events.
      expect(
        app.appendFocusGrant('p1', {
          name: 'session-focus-1',
          domain: 'perception'
        })
      ).toBe(true);
      expect(
        app.appendFocusGrant('p1', { name: 'session-focus-2' })
      ).toBe(true);
      // Mei has 1 disk-authored focus (set via fakePc below).
      const pc = fakePc('p1');
      pc.record.foci = [{ name: 'disk-focus', status: 'active' }];
      // Render path: hand-roll the merge the way quire-app does.
      const v = app.sessionView!;
      const sessionFoci = v.shared.pcFoci.p1 ?? [];
      const merged = [...(pc.record.foci ?? []), ...sessionFoci];
      expect(merged.map((f) => f.name)).toEqual([
        'disk-focus',
        'session-focus-1',
        'session-focus-2'
      ]);
    });

    it('Wave D-prep-3 regression: render-merge unions record.accidentalGrants + state.pcAccidentalGrants[pcId]', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      expect(app.appendAccidentalGrantLog('p1', 'session-grant-1')).toBe(true);
      expect(app.appendAccidentalGrantLog('p1', 'session-grant-2')).toBe(true);
      const pc = fakePc('p1');
      pc.record.accidentalGrants = [{ ts: 1, note: 'disk-grant' }];
      const v = app.sessionView!;
      const sessionGrants = v.shared.pcAccidentalGrants.p1 ?? [];
      const merged = [...(pc.record.accidentalGrants ?? []), ...sessionGrants];
      expect(merged.map((g) => g.note)).toEqual([
        'disk-grant',
        'session-grant-1',
        'session-grant-2'
      ]);
    });

    it('appendReleaseTax flips tax.active to false + records the moment', async () => {
      const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
      app.startHosting();
      await flush();
      // Set up: activate tax first.
      app.submitPcEdit('p1', 'tax.active', true);
      await flush();
      expect(
        app.appendReleaseTax('p1', 'she let her sister see the trick')
      ).toBe(true);
      const merged = app.effectiveCharacter(fakePc('p1'));
      expect(merged.tax?.active).toBe(false);
      expect(merged.tax?.releaseMoment).toBe(
        'she let her sister see the trick'
      );
    });
  });
});
