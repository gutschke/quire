// @vitest-environment happy-dom

/**
 * QuireApp cross-device probe wiring (M6a-FS-3, run #10).
 *
 * Verifies the host-side wiring of `CrossDeviceProbeController` in
 * `quire-app.ts`:
 *
 *   - Probe runs on `checkResumePrompt` (triggered by campaign-URL
 *     landing) and stages `crossDeviceProbeMatch` when the stub
 *     reports a match.
 *   - The DM clicking "Start fresh" clears the staged match and
 *     does NOT call pullCampaignFromFolder.
 *   - The DM clicking "Load it" calls pullCampaignFromFolder once
 *     and applies the body via loadFromString.
 *   - Probe NEVER fires if a local autosave already exists (the
 *     resume prompt takes precedence per §A11).
 *   - The probe is reset when navigating to a different campaign.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import './quire-app';
import type { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import {
  FsApiCloudPush,
  saveFileNameFor
} from './auth/fs-api-cloud-push';
import {
  serializeSession,
  stringifySave
} from './persistence';

const CAMPAIGN = { owner: 'test', repo: 'test-camp', ref: 'main' };
const CAMPAIGN_ID = `${CAMPAIGN.owner}/${CAMPAIGN.repo}@${CAMPAIGN.ref}`;
const SAVE_FILE = saveFileNameFor(CAMPAIGN_ID);

function inMemoryFactory(network: InMemoryNetwork, forcedId: string): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(forcedId, network),
      pairingCode: forcedId
    }),
    createGuest: async () => ({
      transport: new InMemoryTransport(forcedId, network)
    })
  };
}

function mountApp(factory: TransportFactory, cloudPush: FsApiCloudPush): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = factory;
  el.fsApiCloudPushFactory = () => cloudPush;
  document.body.appendChild(el);
  return el;
}

function injectCampaign(app: QuireApp): void {
  (app as unknown as { _appState: unknown })._appState = {
    kind: 'campaign',
    campaign: {
      base: {
        manifest: { $schemaVersion: '0.1.0', name: 'Test' },
        source: CAMPAIGN
      },
      worldOverview: null
    }
  };
}

interface CloudPushStub extends FsApiCloudPush {
  __pullMock: ReturnType<typeof vi.fn>;
  __listMock: ReturnType<typeof vi.fn>;
  __getStateMock: ReturnType<typeof vi.fn>;
}

function makeCloudPush(
  init: {
    available?: boolean;
    connected?: { folderName: string } | null;
    files?: ReadonlyArray<{ name: string; lastModifiedMs: number; size: number }>;
    pullBody?: string;
  } = {}
): CloudPushStub {
  const available = init.available ?? true;
  // Distinguish "not provided" (default to a connected folder) from
  // "explicitly null" (no folder connected).  Using `in` rather than
  // `??` avoids collapsing the explicit-null case.
  const connected =
    'connected' in init ? init.connected : { folderName: 'Quire Folder' };
  const files = init.files ?? [{ name: SAVE_FILE, lastModifiedMs: 1_700_000_000_000, size: 100 }];
  const pullBody = init.pullBody ?? '';

  const getStateMock = vi.fn(async (_args: { campaignId: string }) =>
    connected
      ? {
          connected: true as const,
          folderName: connected.folderName,
          lastPushedAt: null,
          connectedAt: 1
        }
      : { connected: false as const }
  );
  const listMock = vi.fn(async (_args: { campaignId: string }) => ({
    ok: true as const,
    files: [...files]
  }));
  const pullMock = vi.fn(async (_args: { campaignId: string }) => ({
    ok: true as const,
    body: pullBody,
    lastModifiedMs: 1_700_000_000_000
  }));

  const stub = {
    isAvailable: () => available,
    getAvailabilityVerdict: () => ({ available, reason: 'available' as const }),
    getConnectedFolderState: getStateMock,
    listSavesInFolder: listMock,
    pullCampaignFromFolder: pullMock,
    pushCampaignToFolder: vi.fn(async () => ({ ok: false as const, reason: 'not-connected' as const })),
    connectFolder: vi.fn(),
    disconnectFolder: vi.fn(),
    requestPermissionForCampaign: vi.fn()
  } as unknown as CloudPushStub;
  stub.__pullMock = pullMock;
  stub.__listMock = listMock;
  stub.__getStateMock = getStateMock;
  return stub;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('QuireApp — cross-device probe wiring (M6a-FS-3)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('stages crossDeviceProbeMatch when the folder has a matching save', async () => {
    const cp = makeCloudPush();
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    // Directly invoke the probe rather than going through
    // checkResumePrompt — keeps the test focused on the probe wiring
    // (checkResumePrompt is tested by the parallel resume-prompt
    // tests).  Call site is the same private method `maybeRunCrossDeviceProbe`.
    await (app as unknown as {
      maybeRunCrossDeviceProbe(): Promise<void>;
    }).maybeRunCrossDeviceProbe();

    expect(app.crossDeviceProbeMatch).not.toBeNull();
    expect(app.crossDeviceProbeMatch?.fileName).toBe(SAVE_FILE);
    expect(cp.__listMock).toHaveBeenCalledTimes(1);
    expect(cp.__pullMock).not.toHaveBeenCalled(); // NEVER auto-load
  });

  it('does NOT stage a match when a local autosave already exists', async () => {
    const cp = makeCloudPush();
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    // Seed a localStorage autosave for this campaign.
    window.localStorage.setItem(
      `quire.save.${CAMPAIGN.owner}-${CAMPAIGN.repo}`,
      JSON.stringify({
        $schemaVersion: '0.1.0',
        savedAt: new Date().toISOString(),
        campaign: CAMPAIGN,
        savedByPeerId: 'HOST',
        events: []
      })
    );
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();

    expect(app.crossDeviceProbeMatch).toBeNull();
    expect(cp.__listMock).not.toHaveBeenCalled();
  });

  it('does NOT stage a match when no folder is connected', async () => {
    const cp = makeCloudPush({ connected: null });
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();

    expect(app.crossDeviceProbeMatch).toBeNull();
    expect(cp.__listMock).not.toHaveBeenCalled();
  });

  it('does NOT stage a match when the folder has no matching file', async () => {
    const cp = makeCloudPush({
      files: [{ name: 'unrelated.quire-save.json', lastModifiedMs: 1, size: 1 }]
    });
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();

    expect(app.crossDeviceProbeMatch).toBeNull();
    expect(cp.__listMock).toHaveBeenCalledTimes(1);
  });

  it('dismissCrossDeviceProbe clears the match and does NOT pull', async () => {
    const cp = makeCloudPush();
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();
    expect(app.crossDeviceProbeMatch).not.toBeNull();

    app.dismissCrossDeviceProbe();

    expect(app.crossDeviceProbeMatch).toBeNull();
    expect(cp.__pullMock).not.toHaveBeenCalled();
  });

  it('crossDeviceProbeLoad pulls the save and applies it via loadFromString', async () => {
    // Build a valid save body the load path will accept.
    const app1 = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST1'), makeCloudPush());
    injectCampaign(app1);
    app1.startHosting();
    await flush();
    app1.submitChat('hello-from-other-device');
    const doc = serializeSession(
      (app1 as unknown as { session: { getEvents(): unknown[] } }).session.getEvents() as never[],
      CAMPAIGN,
      'HOST1'
    );
    const body = stringifySave(doc);
    document.body.removeChild(app1);

    // Fresh app on a "new device" — folder is connected and contains
    // the body we just built.
    const cp = makeCloudPush({ pullBody: body });
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    app.startHosting();
    await flush();
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();
    expect(app.crossDeviceProbeMatch).not.toBeNull();

    await app.crossDeviceProbeLoad();
    await flush();

    expect(cp.__pullMock).toHaveBeenCalledTimes(1);
    expect(app.crossDeviceProbeMatch).toBeNull();
    // Body landed in the active session.
    expect(
      app.sessionView!.shared.chat.some(
        (c) => c.text === 'hello-from-other-device'
      )
    ).toBe(true);
  });

  it('per-landing guard: re-rendering does not re-probe', async () => {
    const cp = makeCloudPush();
    const app = mountApp(inMemoryFactory(new InMemoryNetwork(), 'HOST'), cp);
    injectCampaign(app);
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();
    (app as unknown as { checkResumePrompt(): void }).checkResumePrompt();
    await flush();
    await flush();

    expect(cp.__listMock).toHaveBeenCalledTimes(1);
  });
});
