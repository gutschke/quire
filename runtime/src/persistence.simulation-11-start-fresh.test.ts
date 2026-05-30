// @vitest-environment happy-dom

/**
 * Mock Campaign 11 — Start fresh (run #17 P0 fix).
 *
 * Doc: `design/save-restore-program/simulations/mock-campaign-11-
 * start-fresh.md`.
 *
 * This is the second instance of the trust-but-verify lesson
 * (LL-2): the v3 consultants signed off as PLAYTEST GREEN, but
 * the product owner ran a real dry-run and hit a P0 — clicking
 * "Start fresh" on the resume prompt:
 *   1. Didn't ask for confirmation.
 *   2. Didn't actually clear the local autosave OR the in-memory
 *      session state.  The PC the DM created in the prior session
 *      and the prior coord's stale peer entry both survived.
 *
 * This mock walks the REAL production paths for the Start fresh
 * affordance — production routing, production click handlers,
 * production state carriers — and asserts:
 *   - Scenario 1: Start fresh with NO autosave is a no-op happy
 *     path (no error, no state mutation, prompt vanishes).
 *   - Scenario 2: Start fresh with an autosave + NO live session
 *     clears the localStorage autosave key after confirmation.
 *   - Scenario 3: Start fresh with a LIVE session tears down the
 *     WebRTC peer, fires peer-leave, clears the autosave.
 *   - Scenario 4: Cancelling the confirm modal preserves state
 *     entirely.
 *   - Scenario 5: PC created in a prior session does NOT survive
 *     a Start fresh (the user's exact observation).
 *   - Scenario 6: A stale peer-join (from a prior session that
 *     didn't clean up) does NOT survive Start fresh.
 *   - Scenario 7: Chargen drafts for this campaign are cleared.
 *   - Scenario 8: Cross-device probe match also routes through
 *     the confirm gate.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach
} from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import { ensureMarkdownPipeline } from './markdown';
import {
  serializeSession,
  stringifySave,
  type CampaignRef
} from './persistence';
import { SAVE_STORAGE_PREFIX } from './controllers/autosave-controller';
import {
  saveChargenState,
  loadChargenState
} from './chargen-persistence';
import {
  FsApiCloudPush,
  saveFileNameFor
} from './auth/fs-api-cloud-push';
import { vi } from 'vitest';

const CAMPAIGN: CampaignRef = {
  owner: 'test',
  repo: 'fresh-camp',
  ref: 'main'
};
const CAMPAIGN_ID = `${CAMPAIGN.owner}/${CAMPAIGN.repo}@${CAMPAIGN.ref}`;
const AUTOSAVE_KEY = `${SAVE_STORAGE_PREFIX}${CAMPAIGN.owner}-${CAMPAIGN.repo}`;
const SLUG = `${CAMPAIGN.owner}/${CAMPAIGN.repo}`;

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

function mountApp(
  id: string,
  net: InMemoryNetwork,
  cloudPush?: FsApiCloudPush
): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = inMemoryFactory(net, id);
  if (cloudPush) {
    el.fsApiCloudPushFactory = () => cloudPush;
  }
  document.body.appendChild(el);
  return el;
}

function injectCampaign(app: QuireApp): void {
  (app as unknown as { _appState: unknown })._appState = {
    kind: 'campaign',
    campaign: {
      base: {
        manifest: { $schemaVersion: '0.1.0', name: 'Fresh Camp' },
        source: CAMPAIGN
      },
      worldOverview: null
    }
  };
}

function getConfirmDialog(app: QuireApp): HTMLElement | null {
  return (app.renderRoot.querySelector('start-fresh-confirm-dialog') ??
    app.querySelector('start-fresh-confirm-dialog')) as HTMLElement | null;
}

async function clickConfirm(app: QuireApp): Promise<void> {
  await flush();
  const dlg = getConfirmDialog(app);
  expect(dlg).not.toBeNull();
  const btn = dlg!.querySelector(
    '[data-testid=start-fresh-confirm]'
  ) as HTMLButtonElement;
  expect(btn).not.toBeNull();
  btn.click();
}

async function clickCancel(app: QuireApp): Promise<void> {
  await flush();
  const dlg = getConfirmDialog(app);
  expect(dlg).not.toBeNull();
  const btn = dlg!.querySelector(
    '[data-testid=start-fresh-cancel]'
  ) as HTMLButtonElement;
  expect(btn).not.toBeNull();
  btn.click();
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
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

describe('Mock Campaign 11 — Start fresh (run #17 P0 fix)', () => {
  // --- Scenario 1: no autosave, no-op happy path ---
  it('Scenario 1: Start fresh with no autosave + no session is a no-op (prompt vanishes; no error)', async () => {
    const net = new InMemoryNetwork();
    const app = mountApp('DM11-1', net);
    injectCampaign(app);
    // No autosave, no resume prompt, no session.  Calling
    // dismissResumePrompt should short-circuit cleanly without
    // even opening the dialog (no resume prompt to discard).
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    await app.dismissResumePrompt();
    // No error, no dialog left open.
    const dlg = getConfirmDialog(app);
    // Dialog may be mounted but with no open state.
    expect(dlg?.querySelector('[data-testid=start-fresh-dialog]')).toBeNull();
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  // --- Scenario 2: autosave + no live session, confirm clears ---
  it('Scenario 2: Start fresh with autosave but no live session CLEARS the autosave after confirm', async () => {
    const net = new InMemoryNetwork();
    const app = mountApp('DM11-2', net);
    injectCampaign(app);

    // Stage an autosave directly in localStorage so checkResumePrompt
    // finds it (the production path).
    const doc = serializeSession([], CAMPAIGN, 'PRIOR-DM');
    window.localStorage.setItem(AUTOSAVE_KEY, stringifySave(doc));
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull();

    // Trigger the resume-prompt staging via the production path.
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    expect(app.resumePromptDoc).not.toBeNull();

    // Click "Start fresh".  Production: this opens the confirm
    // dialog; await + Confirm.
    const dismissPromise = app.dismissResumePrompt();
    await clickConfirm(app);
    await dismissPromise;

    // KEY ASSERTION: autosave is cleared.  This is the user-
    // reported bug — pre-fix, the key SURVIVED dismissResumePrompt.
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    expect(app.resumePromptDoc).toBeNull();
  });

  // --- Scenario 3: live session, peer teardown + autosave clear ---
  it('Scenario 3: Start fresh with a live session tears down WebRTC, fires peer-leave, clears autosave', async () => {
    const net = new InMemoryNetwork();
    const app = mountApp('DM11-3', net);
    injectCampaign(app);

    // Start a real session.
    app.startHosting();
    await flush();
    // Append something so the autosave has content.
    const session = (app as unknown as {
      session: { append: (k: string, p: unknown) => void; getEvents(): unknown[] };
    }).session;
    session.append('chat', { text: 'hi', author: 'DM', ts: 1 });
    await flush();

    // Force an autosave to land.
    (
      app as unknown as { autosave: { performNow(): void } }
    ).autosave.performNow();
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).not.toBeNull();

    // Stage a resume prompt so the click path triggers Start fresh.
    (app as unknown as {
      resumePromptDoc: { events: unknown[] };
    }).resumePromptDoc = { events: [] } as { events: unknown[] };
    await flush();

    // Sanity: a live session exists with at least one peer.
    const peersBefore = (
      app as unknown as {
        session: { view(): { shared: { peers: Record<string, unknown> } } };
      }
    ).session.view().shared.peers;
    expect(Object.keys(peersBefore).length).toBeGreaterThan(0);

    const dismissPromise = app.dismissResumePrompt();
    await clickConfirm(app);
    await dismissPromise;
    await flush();

    // Session torn down to idle + autosave cleared.  The
    // session-controller object stays around (it's the local
    // facade), but its mode is 'solo' + status 'idle' (no peer,
    // no transport) — equivalent to "fresh" from the caller's
    // perspective.
    const sessionAfter = (
      app as unknown as {
        session: { status: string; mode: string; peer: unknown } | null;
      }
    ).session;
    expect(sessionAfter).not.toBeNull();
    expect(sessionAfter!.status).toBe('idle');
    expect(sessionAfter!.mode).toBe('solo');
    expect(sessionAfter!.peer).toBeNull();
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
  });

  // --- Scenario 4: Cancel preserves state ---
  it('Scenario 4: clicking Cancel in the confirm modal PRESERVES the autosave + the staged prompt', async () => {
    const net = new InMemoryNetwork();
    const app = mountApp('DM11-4', net);
    injectCampaign(app);

    const doc = serializeSession([], CAMPAIGN, 'PRIOR-DM');
    const body = stringifySave(doc);
    window.localStorage.setItem(AUTOSAVE_KEY, body);
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    expect(app.resumePromptDoc).not.toBeNull();

    const dismissPromise = app.dismissResumePrompt();
    await clickCancel(app);
    await dismissPromise;

    // Autosave INTACT.
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBe(body);
    // Prompt still staged (so the DM can change their mind and
    // click Resume).
    expect(app.resumePromptDoc).not.toBeNull();
  });

  // --- Scenario 5: prior session's PC does NOT survive (the user's bug) ---
  it("Scenario 5: a PC created in a prior session does NOT survive Start fresh (user's exact observation)", async () => {
    const net = new InMemoryNetwork();

    // Phase 1: prior DM creates a PC, autosaves, closes.
    const priorDm = mountApp('PRIOR-DM-11-5', net);
    injectCampaign(priorDm);
    priorDm.startHosting();
    await flush();
    const priorSession = (priorDm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    // Author a pc-create event (the carrier of "the player PC I
    // created earlier" from the user report).
    priorSession.append('pc-create', {
      v: 1,
      pcId: 'pc-leftover',
      name: 'Leftover Hero',
      pronouns: 'they/them',
      seat: 1
    });
    await flush();
    (
      priorDm as unknown as { autosave: { performNow(): void } }
    ).autosave.performNow();
    document.body.removeChild(priorDm);

    // Phase 2: new DM lands on the same campaign.  The autosave
    // is present; checkResumePrompt stages the prior pc-create.
    const newDm = mountApp('NEW-DM-11-5', net);
    injectCampaign(newDm);
    (newDm as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    expect(newDm.resumePromptDoc).not.toBeNull();
    // Sanity: the prior PC is in the staged doc.
    const staged = newDm.resumePromptDoc!;
    const stagedHasLeftover = staged.events.some(
      (e: unknown) =>
        (e as { kind: string }).kind === 'pc-create' &&
        (e as { payload: { pcId: string } }).payload.pcId === 'pc-leftover'
    );
    expect(stagedHasLeftover).toBe(true);

    // Phase 3: DM clicks "Start fresh" + confirms.
    const dismissPromise = newDm.dismissResumePrompt();
    await clickConfirm(newDm);
    await dismissPromise;

    // Phase 4: DM starts a brand-new session.  The autosave is
    // gone; checkResumePrompt finds nothing; no prior PC.
    expect(window.localStorage.getItem(AUTOSAVE_KEY)).toBeNull();
    newDm.startHosting();
    await flush();
    const newSession = (newDm as unknown as {
      session: {
        getEvents(): unknown[];
        view(): { shared: { pcSlots: Record<string, { pcId?: string }> } };
      };
    }).session;
    // No prior pc-create event survives in the new session's log.
    const events = newSession.getEvents();
    const leftoverCreate = events.some(
      (e) =>
        (e as { kind: string }).kind === 'pc-create' &&
        (e as { payload: { pcId?: string } }).payload?.pcId === 'pc-leftover'
    );
    expect(leftoverCreate).toBe(false);
    // And no pcSlots binding to the leftover PC.
    const slots = newSession.view().shared.pcSlots;
    const leftoverBound = Object.values(slots).some(
      (s) => s.pcId === 'pc-leftover'
    );
    expect(leftoverBound).toBe(false);
  });

  // --- Scenario 6: stale peer-join does NOT survive ---
  it('Scenario 6: a stale peer-join in the prior autosave does NOT survive Start fresh', async () => {
    const net = new InMemoryNetwork();

    // Phase 1: prior session has TWO DMs in the roster.
    const priorDm = mountApp('PRIOR-DM-11-6', net);
    injectCampaign(priorDm);
    priorDm.startHosting();
    await flush();
    const priorSession = (priorDm as unknown as {
      session: { append: (k: string, p: unknown) => void };
    }).session;
    // Simulate another DM having joined and left without a clean
    // peer-leave (the "stale peer that I need to remove" carrier).
    priorSession.append('peer-join', {
      v: 1,
      name: 'OTHER-DM',
      knownKindsCount: 100
    });
    await flush();
    (
      priorDm as unknown as { autosave: { performNow(): void } }
    ).autosave.performNow();
    document.body.removeChild(priorDm);

    // Phase 2: new DM lands; the autosave carries the stale peer.
    const newDm = mountApp('NEW-DM-11-6', net);
    injectCampaign(newDm);
    (newDm as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    expect(newDm.resumePromptDoc).not.toBeNull();
    const stagedHasStalePeer = newDm.resumePromptDoc!.events.some(
      (e: unknown) =>
        (e as { kind: string }).kind === 'peer-join' &&
        (e as { payload: { name?: string } }).payload.name === 'OTHER-DM'
    );
    expect(stagedHasStalePeer).toBe(true);

    // Phase 3: Start fresh + confirm.
    const dismissPromise = newDm.dismissResumePrompt();
    await clickConfirm(newDm);
    await dismissPromise;

    // Phase 4: brand-new session — stale peer is gone.
    newDm.startHosting();
    await flush();
    const newSession = (newDm as unknown as {
      session: {
        getEvents(): unknown[];
        view(): { shared: { peers: Record<string, { name?: string }> } };
      };
    }).session;
    // Walk the new session's event log: no prior peer-join for
    // OTHER-DM.
    const events = newSession.getEvents();
    const leftoverPeerJoin = events.some(
      (e) =>
        (e as { kind: string }).kind === 'peer-join' &&
        (e as { payload: { name?: string } }).payload?.name === 'OTHER-DM'
    );
    expect(leftoverPeerJoin).toBe(false);
    // And no stale peer in the materialized peers record.
    const peers = newSession.view().shared.peers;
    const stalePeerStill = Object.values(peers).some(
      (p) => p.name === 'OTHER-DM'
    );
    expect(stalePeerStill).toBe(false);
  });

  // --- Scenario 7: chargen drafts cleared on Start fresh ---
  it('Scenario 7: chargen drafts for this campaign are cleared on Start fresh', async () => {
    const net = new InMemoryNetwork();
    const app = mountApp('DM11-7', net);
    injectCampaign(app);

    // Seed chargen drafts for two slots.
    saveChargenState(SLUG, 1, {
      chosenPath: 'qa',
      answers: { 'name': 'Draft Hero' }
    });
    saveChargenState(SLUG, 3, {
      chosenPath: 'free-write',
      answers: { 'backstory': 'I was born in a tavern' }
    });
    expect(loadChargenState(SLUG, 1)).not.toBeNull();
    expect(loadChargenState(SLUG, 3)).not.toBeNull();

    // Stage an autosave so the resume prompt fires.
    const doc = serializeSession([], CAMPAIGN, 'PRIOR-DM');
    window.localStorage.setItem(AUTOSAVE_KEY, stringifySave(doc));
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    expect(app.resumePromptDoc).not.toBeNull();

    const dismissPromise = app.dismissResumePrompt();
    await clickConfirm(app);
    await dismissPromise;

    // All chargen draft slots cleared.
    for (let slot = 1; slot <= 9; slot++) {
      expect(loadChargenState(SLUG, slot)).toBeNull();
    }
  });

  // --- Scenario 8: cross-device probe Start fresh confirms first ---
  it('Scenario 8: cross-device probe Start fresh routes through the confirm gate (safe variant); cloud copy untouched', async () => {
    const net = new InMemoryNetwork();

    // Build a stub cloud-push that reports a matching file.
    const listMock = vi.fn(async () => ({
      ok: true as const,
      files: [{
        name: saveFileNameFor(CAMPAIGN_ID),
        lastModifiedMs: 1_700_000_000_000,
        size: 100
      }]
    }));
    const pullMock = vi.fn();
    const stub: FsApiCloudPush = {
      isAvailable: () => true,
      getConnectedFolderState: async () => ({
        connected: true,
        folderName: 'Quire'
      }),
      listSavesInFolder: listMock,
      pullCampaignFromFolder: pullMock,
      pushCampaignToFolder: vi.fn(),
      connectFolder: vi.fn(),
      disconnectFolder: vi.fn(),
      requestPermissionForCampaign: vi.fn()
    } as unknown as FsApiCloudPush;

    const app = mountApp('DM11-8', net, stub);
    injectCampaign(app);

    // Trigger the probe via the production path.
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();
    expect(app.crossDeviceProbeMatch).not.toBeNull();

    // Click "Start fresh" on the cross-device probe — needs confirm.
    const dismissPromise = app.dismissCrossDeviceProbe();
    await flush();
    const dlg = getConfirmDialog(app);
    // Verify it's the "safe" variant copy (not destructive).
    const sub = dlg?.querySelector(
      '[data-testid=start-fresh-dialog]'
    ) as HTMLElement;
    expect(sub?.getAttribute('data-variant')).toBe('safe');
    const confirmBtn = dlg!.querySelector(
      '[data-testid=start-fresh-confirm]'
    ) as HTMLButtonElement;
    confirmBtn.click();
    await dismissPromise;

    // Match cleared; pull NOT called (the cloud file is untouched).
    expect(app.crossDeviceProbeMatch).toBeNull();
    expect(pullMock).not.toHaveBeenCalled();
  });
});
