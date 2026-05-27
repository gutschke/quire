// @vitest-environment happy-dom

/**
 * Wave C2 (2026-05-26) integration tests: chargen-dm-review
 * mount-gate behavior.
 *
 * Pre-fix, the 3,339-LOC <chargen-dm-review> region permanently
 * mounted in the DM Aside even after every PC was bound and
 * accepted.  UX expert called it "the largest cognitive-load
 * drain in the cockpit."  Post-fix, the region mounts ONLY when
 * `isChargenActive` returns true (unbound seat OR pending synth).
 *
 * These tests exercise the gate end-to-end at the host level
 * (the controller-level test covers `hasPendingSynth` in
 * isolation).  When the gate fails open silently the cockpit
 * grows back the un-needed surface; when it fails closed silently
 * the DM loses access to chargen mid-session.  Both are real
 * regressions; pin both.
 */

import { describe, it, expect } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import { type TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';

function inMemoryFactory(
  network: InMemoryNetwork,
  forcedId: string
): TransportFactory {
  return {
    createHost: async () => {
      const transport = new InMemoryTransport(forcedId, network);
      return { transport, pairingCode: forcedId };
    },
    createGuest: async () => {
      const transport = new InMemoryTransport(forcedId, network);
      return { transport };
    }
  };
}

function mountApp(factory: TransportFactory): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = factory;
  document.body.appendChild(el);
  return el;
}

/**
 * Inject a minimal campaign so the render dispatch reaches
 * renderCampaign → renderDmAside.  Without this the app stays in
 * 'idle' state and dm-aside / chargen-dm-review never get a
 * render attempt.
 */
function injectCampaign(app: QuireApp): void {
  (app as unknown as { _appState: unknown })._appState = {
    kind: 'campaign',
    campaign: {
      base: {
        manifest: { $schemaVersion: '0.1.0', name: 'Test' },
        source: { owner: 'test', repo: 'test-camp', ref: 'main' }
      },
      worldOverview: null
    }
  };
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

/**
 * Wait long enough for the chargen-dm-review lazy import +
 * customElements.define to complete.  Empirically a few macrotask
 * cycles suffice; tests poll within a 500ms budget so a slow
 * environment doesn't flake.
 */
async function flushChargenLazyImport(app: QuireApp): Promise<void> {
  for (let i = 0; i < 50; i++) {
    await flush();
    await app.updateComplete;
    if (
      customElements.get('chargen-dm-review') &&
      app.shadowRoot?.querySelector('chargen-dm-review')
    ) {
      return;
    }
    if (customElements.get('chargen-dm-review')) {
      // Element defined but not yet in DOM — bump the parent
      // render so the gate re-evaluates with the lazy load done.
      app.requestUpdate();
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('QuireApp Wave C2 chargen-dm-review mount gate', () => {
  it('mounts chargen-dm-review when an unbound seat exists', async () => {
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.displayNameDraft = 'DM';
    injectCampaign(app);
    await app.startHosting();
    await flush();
    // Add an unbound seat via the same path the DM uses (⊕ /
    // F1 hotkey both call chargen.addSeat()).
    const slot = (app as unknown as { chargen: { addSeat: () => number | null } })
      .chargen.addSeat();
    expect(slot).not.toBeNull();
    await flushChargenLazyImport(app);
    // Gate should be open — chargen-dm-review present in DOM.
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).not.toBeNull();
  });

  it('unmounts chargen-dm-review when no unbound seat AND no pending synth', async () => {
    // No seat ever added.  filteredShared.pcSlots is empty.
    // hasPendingSynth() is false (no in-flight, no results).
    // Gate should be closed — chargen-dm-review absent.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.displayNameDraft = 'DM';
    injectCampaign(app);
    await app.startHosting();
    await flush();
    await app.updateComplete;
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).toBeNull();
  });

  it('chargen-dm-review re-mounts when DM adds a new seat post-chargen (Wave C2 re-entry path)', async () => {
    // Simulates the "Resume chargen" scenario: chargen done,
    // session in progress, DM adds a late-joining player.
    // dm-roster-strip's ⊕ button (or F1 hotkey) → chargen.addSeat()
    // creates an unbound seat → gate flips open → re-mount.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.displayNameDraft = 'DM';
    injectCampaign(app);
    await app.startHosting();
    await flush();
    await app.updateComplete;
    // Phase 1: no chargen surface.
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).toBeNull();
    // Phase 2: DM adds a seat (the re-entry verb).
    (app as unknown as { chargen: { addSeat: () => number | null } })
      .chargen.addSeat();
    await flushChargenLazyImport(app);
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).not.toBeNull();
  });

  it('chargen-dm-review remains mounted while a synth result is pending acceptance', async () => {
    // Synth-result exists + slot NOT in acceptedSlots → gate open
    // even if every seat happens to be bound-active (e.g., the
    // synth shipped and is waiting for the DM to accept).
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.displayNameDraft = 'DM';
    injectCampaign(app);
    await app.startHosting();
    await flush();
    // No seat exists — start from chargen-closed baseline.
    await app.updateComplete;
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).toBeNull();
    // Inject a pending synth result via the controller (the
    // production path goes through synthesizeForSlot; this is a
    // unit-style poke at the same internal map).
    const ctrl = (
      app as unknown as { chargen: unknown }
    ).chargen as unknown as { _synthResults: Map<number, unknown> };
    // Inject a minimally-renderable synth result.  The chargen-
    // dm-review surface reads `synth.response.stats` for the
    // party-stats nudge — needs the full stat block to avoid
    // crashing during render.
    ctrl._synthResults.set(1, {
      ok: true,
      response: {
        name: 'Test',
        pronouns: 'they/them',
        tags: ['a', 'b', 'c'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech'],
        backstory: 'x',
        raw: '{}',
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'r-test'
      },
      warnings: [],
      retried: false
    } as unknown);
    app.requestUpdate();
    await flushChargenLazyImport(app);
    // Gate now open because hasPendingSynth() is true.
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).not.toBeNull();
  });

  it('dm-aside (pinned-NPC aide) ALWAYS mounts for the coord — independent of chargen-dm-review', async () => {
    // Wave C4 + C2 together: dm-aside is now only pinned-NPC
    // management, mounts unconditionally for the coord.
    // chargen-dm-review is gated separately.  Verify the two
    // surfaces are decoupled.
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'));
    app.displayNameDraft = 'DM';
    injectCampaign(app);
    await app.startHosting();
    await flush();
    await app.updateComplete;
    // dm-aside present (regardless of chargen state).
    expect(app.shadowRoot?.querySelector('dm-aside') ?? null).not.toBeNull();
    // chargen-dm-review absent (no chargen activity).
    expect(app.shadowRoot?.querySelector('chargen-dm-review') ?? null).toBeNull();
  });
});
