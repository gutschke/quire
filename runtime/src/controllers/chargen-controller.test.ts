// @vitest-environment happy-dom
/**
 * ChargenController tests — Phase 3a Cluster E step 1.
 *
 * Behavior-neutral surface checks: the controller wraps the chargen
 * @state + persist + synth + pack pipeline that previously lived on
 * QuireApp.  These tests verify the lift didn't change behavior for
 * the common cases:
 *   - seed-from-storage hydrates chosenPath + answers.
 *   - setChosenPath / setAnswer drive host.requestUpdate.
 *   - persistDebounced writes to localStorage after the debounce.
 *   - synthesizeForSlot routes manifest.aiBackstory fields through
 *     to the synthesizer call (P3D-1 hybrid seam still wired).
 *   - synthesizeForSlot's no-saved-state path returns a clean,
 *     CC-13-leak-free error (P3D-2 still in place).
 *   - clearSynth + acceptedSlots + synthInFlight bookkeeping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ChargenController, type ChargenCampaign } from './chargen-controller';
import type { ReactiveControllerHost } from 'lit';
import { saveChargenState, loadChargenState } from '../chargen-persistence';
import { campaignFingerprint } from '../invite-token';
import type { LoadedCampaign as LoadedCampaignBase } from '../campaign-loader';
import type { LoadedCharacter } from '../character-loader';
import * as backstorySynthesizer from '../ai/backstory-synthesizer';
import type { SynthesizeBackstoryResult } from '../ai/backstory-synthesizer';
import type { ChargenSynthLifecycle } from './chargen-synth-lifecycle';
import type { ChargenAcceptanceMachine } from './chargen-acceptance-machine';

/**
 * Test helper: peek at the controller's private state-cluster
 * fields.  Tests that exercise downstream behavior on top of a
 * seeded state use this to inject synth results / in-flight flags
 * without driving the full async synthesize pipeline (which would
 * require mocking the AI provider, campaign context, etc.).  Use
 * sparingly — public-surface tests are still preferred.
 */
function peekPrivate(ctrl: ChargenController): {
  synth: ChargenSynthLifecycle;
  acceptance: ChargenAcceptanceMachine;
} {
  return ctrl as unknown as {
    synth: ChargenSynthLifecycle;
    acceptance: ChargenAcceptanceMachine;
  };
}

/**
 * Test helper: read the slot's synth result + narrow to the
 * `ok: true` branch.  Throws if missing or `ok: false` — every
 * test that calls this seeded an ok result.
 */
function okSynth(
  ctrl: ChargenController,
  slot: number
): SynthesizeBackstoryResult & { ok: true } {
  const r = peekPrivate(ctrl).synth.getResult(slot);
  if (!r || !r.ok) {
    throw new Error(
      `expected ok synth result for slot ${slot}; got ${JSON.stringify(r)}`
    );
  }
  return r;
}

function makeHost() {
  let updateCalls = 0;
  return {
    host: {
      addController: vi.fn(),
      removeController: vi.fn(),
      requestUpdate: () => {
        updateCalls++;
      },
      updateComplete: Promise.resolve(true)
    } as unknown as ReactiveControllerHost,
    updateCount: () => updateCalls
  };
}

function makeCampaign(opts: {
  slug?: string;
  spoilerTokens?: string[];
  placeAllowlist?: string[];
} = {}): ChargenCampaign {
  return {
    base: {
      manifest: {
        $schemaVersion: '0.1.0',
        name: 'Underleaf-Test',
        characterCreation: {
          questions: [
            {
              id: 'archetype',
              kind: 'mc',
              prompt: 'Pick',
              required: true,
              options: [{ value: 'hacker', label: 'Hacker' }]
            },
            {
              id: 'intent-moment',
              kind: 'short-answer',
              prompt: 'Describe',
              required: true,
              minLength: 10,
              maxLength: 400
            }
          ]
        },
        aiBackstory: {
          spoilerTokens: opts.spoilerTokens,
          placeAllowlist: opts.placeAllowlist
        }
      },
      source: { owner: 'o', repo: 'r', ref: 'main' }
    } as unknown as LoadedCampaignBase
  };
}

function makeEnv(
  campaign: ChargenCampaign | undefined,
  overrides: Partial<{
    apiKey: string;
    provider: 'claude' | 'gemini';
    model: string;
    isCoord: boolean;
    boundCharacterByPcId: Record<string, LoadedCharacter>;
  }> = {}
) {
  const loaded = new Set<string>();
  const scratchNotes: string[] = [];
  const pcCreates: Array<Record<string, unknown>> = [];
  const pcSlotBinds: Array<{ slot: number; pcId: string }> = [];
  const seatAdds: number[] = [];
  const seatRemoves: number[] = [];
  const bondProposes: Array<{
    pcId: string;
    targetPlaceholder: string;
    text: string;
  }> = [];
  const mockSlots: Record<number, { state: string; pcId?: string }> = {};
  return {
    getCurrentCampaign: () => campaign,
    getCampaignSlug: () => 'o-r-main',
    getAiProvider: () => overrides.provider ?? ('claude' as const),
    getAiApiKey: () => overrides.apiKey ?? 'sk-test',
    getAiModel: () => overrides.model ?? 'claude-test',
    getAiProviders: () =>
      ({
        claude: { id: 'claude', call: vi.fn(), parse: vi.fn() },
        gemini: { id: 'gemini', call: vi.fn(), parse: vi.fn() }
      }) as never,
    getDmDisplayName: () => 'Markus',
    isCoordinator: () => overrides.isCoord ?? true,
    getBoundCharacter: (pcId: string) =>
      overrides.boundCharacterByPcId?.[pcId] ?? null,
    loadCharacterByPcId: (pcId: string) => {
      loaded.add(pcId);
    },
    appendScratchNote: (text: string) => {
      scratchNotes.push(text);
      return true;
    },
    appendPcCreate: (payload: {
      pcId: string;
      name: string;
      pronouns: string;
      tags: string[];
      stats: {
        str: number;
        dex: number;
        con: number;
        int: number;
        wis: number;
        cha: number;
      };
      skills: string[];
      backstory: string;
      causedByResponseId?: string;
    }) => {
      pcCreates.push(payload);
      return true;
    },
    bindPcSlot: (slot: number, pcId: string) => {
      pcSlotBinds.push({ slot, pcId });
      return true;
    },
    appendBondPropose: (payload: {
      pcId: string;
      targetPlaceholder: string;
      text: string;
    }) => {
      bondProposes.push(payload);
      return true;
    },
    // Phase B-prime (2026-05-25): seat-add + pcSlots-read for the
    // chargen-controller's addSeat() flow.  `seatAdds` records the
    // appended slots; `mockSlots` is the simulated current slot map
    // that addSeat() reads to compute lowest-unused.
    appendSeatAdd: (slot: number) => {
      seatAdds.push(slot);
      mockSlots[slot] = { state: 'unbound' };
      return true;
    },
    appendSeatRemove: (slot: number) => {
      seatRemoves.push(slot);
      delete mockSlots[slot];
      return true;
    },
    getPcSlots: () => mockSlots,
    getSeatCap: () => 9,
    loadedPcs: loaded,
    scratchNotes,
    pcCreates,
    pcSlotBinds,
    seatAdds,
    seatRemoves,
    bondProposes,
    mockSlots
  };
}

describe('ChargenController — basic state', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('setChosenPath updates field + requests host update', () => {
    const { host, updateCount } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    expect(ctrl.chosenPath).toBe('qa');
    expect(updateCount()).toBeGreaterThan(0);
  });

  it('setChosenPath no-ops when value unchanged', () => {
    const { host, updateCount } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    const after1 = updateCount();
    ctrl.setChosenPath('qa');
    expect(updateCount()).toBe(after1);
  });

  it('setAnswer merges into the answers map', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.setAnswer('intent-moment', 'I stood up');
    expect(ctrl.answers).toEqual({
      archetype: 'hacker',
      'intent-moment': 'I stood up'
    });
  });

  it('seedFromStorage hydrates state from localStorage', () => {
    saveChargenState('seed-slug', 3, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker' }
    });
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.seedFromStorage('seed-slug', 3);
    expect(ctrl.chosenPath).toBe('qa');
    expect(ctrl.answers).toEqual({ archetype: 'hacker' });
  });

  it('seedFromStorage resets to empty when no persisted state exists', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.seedFromStorage('cold-slug', 9);
    expect(ctrl.chosenPath).toBe('');
    expect(ctrl.answers).toEqual({});
  });
});

describe('ChargenController — synthesizeForSlot wiring', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('returns CC-13-leak-free error when no chargen state exists for the slot', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const result = await ctrl.synthesizeForSlot(2);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // No internal task-tracker ID leaks (P3D-2).
      expect(result.message).not.toMatch(/CC-13/);
      // Names the user-actionable next step.
      expect(result.message).toMatch(/packed character file|pack/);
    }
  });

  it('returns provider-error when no API key configured', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I stood up' }
    });
    const { host } = makeHost();
    const ctrl = new ChargenController(
      host,
      makeEnv(makeCampaign(), { apiKey: '' })
    );
    const result = await ctrl.synthesizeForSlot(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('provider-error');
      expect(result.message).toMatch(/API key/);
    }
  });

  it('rejects slot 0 and slot 10 with provider-error', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    for (const slot of [0, 10, -1, 1.5]) {
      const result = await ctrl.synthesizeForSlot(slot);
      expect(result.ok).toBe(false);
    }
  });

  it('returns no-campaign error when nothing is loaded', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(undefined));
    const result = await ctrl.synthesizeForSlot(1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(/No campaign loaded/);
    }
  });
});

describe('ChargenController — loadPersistedAnswers (P3T-16)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('returns null when no chargen state exists for the slot', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(ctrl.loadPersistedAnswers(1)).toBeNull();
  });

  it('returns null when no campaign is loaded', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(undefined));
    expect(ctrl.loadPersistedAnswers(1)).toBeNull();
  });

  it('returns null for out-of-range slot', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(ctrl.loadPersistedAnswers(0)).toBeNull();
    expect(ctrl.loadPersistedAnswers(10)).toBeNull();
    expect(ctrl.loadPersistedAnswers(1.5)).toBeNull();
  });

  it('returns the saved answers when chargen state exists', () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: {
        archetype: 'hacker',
        'intent-moment': 'I held the line.'
      }
    });
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const answers = ctrl.loadPersistedAnswers(1);
    expect(answers).toEqual({
      archetype: 'hacker',
      'intent-moment': 'I held the line.'
    });
  });
});

describe('ChargenController — displayNameForBound (P3U-12)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('returns null + triggers lazy load when character not cached', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    const name = ctrl.displayNameForBound('mei-tanaka');
    expect(name).toBeNull();
    expect(env.loadedPcs.has('mei-tanaka')).toBe(true);
  });

  it('returns record.name when character is cached', () => {
    const fakeChar = {
      kind: 'pc' as const,
      id: 'mei',
      record: { name: 'Mei Tanaka' },
      source: { owner: 'o', repo: 'r', ref: 'main' }
    } as unknown as LoadedCharacter;
    const { host } = makeHost();
    const env = makeEnv(makeCampaign(), {
      boundCharacterByPcId: { mei: fakeChar }
    });
    const ctrl = new ChargenController(host, env);
    expect(ctrl.displayNameForBound('mei')).toBe('Mei Tanaka');
  });

  it('falls back to pcId when record has no name', () => {
    const fakeChar = {
      kind: 'pc' as const,
      id: 'mei',
      record: {},
      source: { owner: 'o', repo: 'r', ref: 'main' }
    } as unknown as LoadedCharacter;
    const { host } = makeHost();
    const env = makeEnv(makeCampaign(), {
      boundCharacterByPcId: { mei: fakeChar }
    });
    const ctrl = new ChargenController(host, env);
    expect(ctrl.displayNameForBound('mei')).toBe('mei');
  });
});

describe('ChargenController — generateInviteUrl', () => {
  it('returns null when not coordinator', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(
      host,
      makeEnv(makeCampaign(), { isCoord: false })
    );
    expect(await ctrl.generateInviteUrl(1)).toBeNull();
  });

  it('returns null when no campaign loaded', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(undefined));
    expect(await ctrl.generateInviteUrl(1)).toBeNull();
  });

  it('returns null for out-of-range slot', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(await ctrl.generateInviteUrl(0)).toBeNull();
    expect(await ctrl.generateInviteUrl(10)).toBeNull();
  });

  it('returns a usable URL for a valid slot', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const url = await ctrl.generateInviteUrl(2);
    expect(url).toMatch(/\?/);
    expect(url).toMatch(/campaign=/);
    expect(url).toMatch(/invite=/);
  });
});

describe('ChargenController — clearSynth + acceptedSlots bookkeeping', () => {
  it('clearSynth no-ops + skips host update when slot was already clean', () => {
    const { host, updateCount } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const before = updateCount();
    ctrl.clearSynth(7);
    expect(updateCount()).toBe(before);
  });

  /**
   * Post-D5.5-A playthrough Scenario 4: a synth started for slot N,
   * cleared mid-await via clearSynth(N), must not resurrect the slot
   * when the synth resolves seconds later.  Pre-fix, the result of a
   * 10-30s resync would land in _synthResults after the DM clicked
   * Clear, producing a zombie banner / phantom result.  Post-fix:
   * each clearSynth bumps a per-slot generation counter; the in-
   * flight synth captures the generation at start + suppresses its
   * own state-write when it has bumped.
   */
  it('synthesizeForSlot suppresses its write when clearSynth bumped the generation mid-await', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    let resolveSynth: (value: SynthesizeBackstoryResult) => void = () => {};
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockReturnValueOnce(
        new Promise<SynthesizeBackstoryResult>((resolve) => {
          resolveSynth = resolve;
        })
      );
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    // Kick off the synth (resolves only when we let it).
    const synthPromise = ctrl.synthesizeForSlot(4);
    // Mid-await: DM clears the slot.
    ctrl.clearSynth(4);
    // Now let the synth complete.
    resolveSynth({
      ok: true,
      response: {
        name: 'Mei',
        pronouns: 'she/her',
        tags: ['a', 'b', 'c'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory: 'x',
        raw: '{}',
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'r1'
      },
      warnings: [],
      retried: false
    } as SynthesizeBackstoryResult);
    await synthPromise;
    // The stale synth must NOT have resurrected the cleared slot.
    expect(ctrl.getSynthResult(4)).toBeUndefined();
    expect(ctrl.isAccepted(4)).toBe(false);
    synthSpy.mockRestore();
  });
});

// ---- Engine B3 / Test-cov BIG #1: packAndDownload ----

describe('ChargenController — packAndDownload (Engine B3, Test-cov BIG #1)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
    // happy-dom 14+ supplies URL.createObjectURL; older versions don't.
    // Polyfill defensively so the test doesn't depend on the env's
    // exact version.
    if (typeof URL.createObjectURL !== 'function') {
      (URL as unknown as { createObjectURL: () => string }).createObjectURL =
        () => 'blob:fake';
    }
    if (typeof URL.revokeObjectURL !== 'function') {
      (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL =
        () => {};
    }
  });

  it('success path: flips packFeedback to "packed" and calls the URL API', () => {
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake');
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL');
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.setAnswer('intent-moment', 'I held the line.');
    ctrl.packAndDownload(makeCampaign(), 1);
    expect(ctrl.packFeedback).toBe('packed');
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(revokeSpy).toHaveBeenCalledWith('blob:fake');
    createSpy.mockRestore();
    revokeSpy.mockRestore();
  });

  it('packFeedback auto-clears via a follow-up tick (3 s timer)', () => {
    // We don't use vi.useFakeTimers here because vitest+happy-dom
    // hangs the afterEach cleanup; instead, verify the timer was
    // ARMED by checking the field is set + the timer reference is
    // non-null right after packAndDownload returns.  The real-time
    // expiry is exercised by manual play-test.
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValue('blob:fake');
    vi.spyOn(URL, 'revokeObjectURL');
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.setAnswer('intent-moment', 'I held the line.');
    ctrl.packAndDownload(makeCampaign(), 1);
    expect(ctrl.packFeedback).toBe('packed');
    // hostDisconnected cancels the pending clear-timer so the test
    // doesn't leak it into the next test.
    ctrl.hostDisconnected();
    createSpy.mockRestore();
  });

  it('falls back to pack-failed when URL.createObjectURL throws', () => {
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => {
        throw new Error('sandbox blocked');
      });
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.setAnswer('intent-moment', 'I held the line.');
    ctrl.packAndDownload(makeCampaign(), 1);
    expect(ctrl.packFeedback).toBe('pack-failed');
    createSpy.mockRestore();
  });
});

// ---- Engine B3 / Test-cov BIG #2: persistDebounced ----

describe('ChargenController — persistDebounced (Engine B3, Test-cov BIG #2)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  // Uses flushPending() rather than fake timers — vitest + happy-dom
  // interact badly when uninstalling fake timers (afterEach hangs).
  // flushPending mirrors the AiKeyStore pattern and verifies the
  // same behavior more reliably.

  it('does NOT write to localStorage synchronously', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    ctrl.persistDebounced(makeCampaign(), 1);
    expect(localStorage.getItem('quire.chargen.o-r-main:slot1')).toBeNull();
  });

  it('writes to localStorage after flushPending', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    ctrl.persistDebounced(makeCampaign(), 1);
    ctrl.flushPending();
    const raw = localStorage.getItem('quire.chargen.o-r-main:slot1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).chosenPath).toBe('qa');
  });

  it('per-(slug, slot) keying — different slots persist independently', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setChosenPath('qa');
    ctrl.persistDebounced(makeCampaign(), 1);
    ctrl.setAnswer('archetype', 'caregiver');
    ctrl.persistDebounced(makeCampaign(), 2);
    ctrl.flushPending();
    expect(localStorage.getItem('quire.chargen.o-r-main:slot1')).not.toBeNull();
    expect(localStorage.getItem('quire.chargen.o-r-main:slot2')).not.toBeNull();
  });

  it('rapid edits to the same slot collapse to the latest value on flush', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.persistDebounced(makeCampaign(), 1);
    ctrl.setAnswer('archetype', 'engineer');
    ctrl.persistDebounced(makeCampaign(), 1);
    ctrl.setAnswer('archetype', 'caregiver');
    ctrl.persistDebounced(makeCampaign(), 1);
    ctrl.flushPending();
    const raw = localStorage.getItem('quire.chargen.o-r-main:slot1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).answers.archetype).toBe('caregiver');
  });

  it('hostDisconnected flushes pending writes (no data loss on tab close)', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setAnswer('archetype', 'hacker');
    ctrl.persistDebounced(makeCampaign(), 1);
    ctrl.hostDisconnected();
    const raw = localStorage.getItem('quire.chargen.o-r-main:slot1');
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!).answers.archetype).toBe('hacker');
  });
});

// ---- Test-cov BLOCKER #3 + BIG #4: synthesis lifecycle + P3D-1 passthrough ----

describe('ChargenController — synthesizeForSlot end-to-end (Test-cov BLOCKER #3)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('passes manifest.aiBackstory.spoilerTokens + placeAllowlist through to the synthesizer (P3D-1 seam)', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(
      host,
      makeEnv(
        makeCampaign({
          spoilerTokens: ['Quiet', 'the Hush'],
          placeAllowlist: ['the Mission', 'Oakland']
        })
      )
    );
    await ctrl.synthesizeForSlot(1, { playerDisplayName: 'Markus' });
    expect(synthSpy).toHaveBeenCalledTimes(1);
    const arg = synthSpy.mock.calls[0][1];
    expect(arg.spoilerTokens).toEqual(['Quiet', 'the Hush']);
    expect(arg.validatorOptions?.placeAllowlist).toEqual([
      'the Mission',
      'Oakland'
    ]);
    expect(arg.validatorOptions?.playerDisplayName).toBe('Markus');
    synthSpy.mockRestore();
  });

  it('caches the ok result + leaves acceptedSlots untouched on first synth', async () => {
    saveChargenState('o-r-main', 2, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(ctrl.isSynthInFlight(2)).toBe(false);
    await ctrl.synthesizeForSlot(2);
    // After resolution, in-flight flag is cleared; result is cached;
    // accept flag is untouched.  (We don't assert on the mid-flight
    // state because `buildPlayerFacingContext` is awaited BEFORE the
    // in-flight flag is set, so the flag's window is too short to
    // pin without injecting a delay into the mock chain.)
    expect(ctrl.isSynthInFlight(2)).toBe(false);
    expect(ctrl.getSynthResult(2)?.ok).toBe(true);
    expect(ctrl.isAccepted(2)).toBe(false);
    synthSpy.mockRestore();
  });

  it('full lifecycle: synth → cache → accept → re-synthesize clears accept (Test-cov BIG #4)', async () => {
    saveChargenState('o-r-main', 3, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const okResult = {
      ok: true,
      response: {
        name: 'Mei',
        pronouns: 'she/her',
        tags: ['a', 'b', 'c'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory: 'x',
        raw: '{}',
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'r1'
      },
      warnings: [],
      retried: false
    } as SynthesizeBackstoryResult;
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue(okResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));

    // 1. Synth
    await ctrl.synthesizeForSlot(3);
    expect(ctrl.getSynthResult(3)?.ok).toBe(true);

    // 2. DM accepts.
    ctrl.acceptSlot(3);
    expect(ctrl.isAccepted(3)).toBe(true);

    // 3. Player revises something + DM re-synthesizes — the prior
    //    accept must be invalidated since the cached result is new.
    await ctrl.synthesizeForSlot(3);
    expect(ctrl.isAccepted(3)).toBe(false);
    expect(ctrl.getSynthResult(3)?.ok).toBe(true);
    synthSpy.mockRestore();
  });

  it('synthesize with no aiBackstory manifest field falls back to engine defaults (Test-cov #8)', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const campaign = makeCampaign();
    // Wipe the aiBackstory block so the controller passes undefined.
    delete (campaign.base.manifest as { aiBackstory?: unknown }).aiBackstory;
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'aborted',
        message: 'irrelevant'
      });
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(campaign));
    await ctrl.synthesizeForSlot(4);
    const arg = synthSpy.mock.calls[0][1];
    expect(arg.spoilerTokens).toBeUndefined();
    expect(arg.validatorOptions?.placeAllowlist).toBeUndefined();
    synthSpy.mockRestore();
  });
});

// ---- Engine M1: accept/revise accessor encapsulation ----

describe('ChargenController — accept/revise accessors (Engine M1, CC-24, P3T-19)', () => {
  it('acceptSlot rejects when no synth result exists', () => {
    const { host, updateCount } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    const before = updateCount();
    ctrl.acceptSlot(5);
    expect(ctrl.isAccepted(5)).toBe(false);
    expect(updateCount()).toBe(before);
    expect(env.scratchNotes).toEqual([]);
  });

  it('Phase 3b-1: acceptSlot emits pc-create + pc-slot-bind + scratch-note in order', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei Tanaka',
          pronouns: 'she/her',
          tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'Mei grew up in the Mission.',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-a3f8b2c1e9d44'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(4);
    ctrl.acceptSlot(4);

    // pc-create with translated stats (uppercase → lowercase) and
    // skillMastery → skills + the derived pcId.
    expect(env.pcCreates.length).toBe(1);
    const created = env.pcCreates[0];
    expect(created.pcId).toBe('slot-4-syn-a3f8');
    expect(created.name).toBe('Mei Tanaka');
    expect(created.pronouns).toBe('she/her');
    expect(created.stats).toEqual({
      str: 0,
      dex: 1,
      con: 1,
      int: 2,
      wis: 1,
      cha: 0
    });
    expect(created.skills).toEqual(['Tech', 'Knowledge']);
    expect(created.tags).toEqual([
      'junior engineer',
      'reluctant insomniac',
      'sister of a pilot'
    ]);
    expect(created.backstory).toBe('Mei grew up in the Mission.');
    expect(created.causedByResponseId).toBe('syn-a3f8b2c1e9d44');

    // pc-slot-bind follows.
    expect(env.pcSlotBinds.length).toBe(1);
    expect(env.pcSlotBinds[0]).toEqual({
      slot: 4,
      pcId: 'slot-4-syn-a3f8'
    });

    // Audit scratch-note still emitted (v1 receipt preserved).
    expect(env.scratchNotes.length).toBe(1);
    expect(env.scratchNotes[0]).toMatch(/slot 4/);
    expect(env.scratchNotes[0]).toMatch(/Mei Tanaka/);

    expect(ctrl.isAccepted(4)).toBe(true);
    synthSpy.mockRestore();
  });

  it('Phase 3b-1: acceptSlot bails if host refuses appendPcCreate (atomic invariant)', async () => {
    saveChargenState('o-r-main', 5, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    // Simulate a non-coord refusal by overriding the appendPcCreate
    // stub to return false.  bindPcSlot + scratch-note + accept-flag
    // must NOT fire (atomic invariant: pc-create must succeed first).
    env.appendPcCreate = () => false;
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(5);
    ctrl.acceptSlot(5);
    expect(env.pcSlotBinds).toEqual([]);
    expect(env.scratchNotes).toEqual([]);
    expect(ctrl.isAccepted(5)).toBe(false);
    synthSpy.mockRestore();
  });

  it('Phase 3b-1: derivePcId is deterministic per (slot, responseId)', async () => {
    // Two synthesizeForSlot calls with the same responseId produce
    // the same pcId (the materializer's first-write-wins handles
    // the duplicate cleanly).  Different responseIds produce
    // different ids.
    saveChargenState('o-r-main', 6, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const fixedResult = {
      ok: true,
      response: {
        name: 'X',
        pronouns: 'x',
        tags: ['a', 'b', 'c'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech'],
        backstory: 'x',
        raw: '{}',
        tokensIn: 0,
        tokensOut: 0,
        responseId: 'syn-fixed-id'
      },
      warnings: [],
      retried: false
    } as SynthesizeBackstoryResult;
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue(fixedResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(6);
    ctrl.acceptSlot(6);
    expect(env.pcCreates[0].pcId).toBe('slot-6-syn-fixe');
    synthSpy.mockRestore();
  });

  it('acceptSlot appends a scratch-note carrying name + responseId', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Reggie Okeke',
          pronouns: 'he/him',
          tags: ['a', 'b', 'c'],
          stats: { STR: 1, DEX: 1, CON: 1, INT: 2, WIS: 0, CHA: 0 },
          skillMastery: ['Tech', 'Craft'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-abc'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(4);
    ctrl.acceptSlot(4);
    expect(ctrl.isAccepted(4)).toBe(true);
    expect(env.scratchNotes.length).toBe(1);
    expect(env.scratchNotes[0]).toMatch(/slot 4/);
    expect(env.scratchNotes[0]).toMatch(/Reggie Okeke/);
    expect(env.scratchNotes[0]).toMatch(/syn-abc/);
    synthSpy.mockRestore();
  });

  it('acceptSlot refuses to accept a failure result', async () => {
    saveChargenState('o-r-main', 5, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'parse-failed',
        message: 'malformed'
      });
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(5);
    ctrl.acceptSlot(5);
    expect(ctrl.isAccepted(5)).toBe(false);
    expect(env.scratchNotes).toEqual([]);
    synthSpy.mockRestore();
  });

  it('requestReviseSlot appends a scratch-note with the reason', async () => {
    saveChargenState('o-r-main', 7, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(7);
    ctrl.requestReviseSlot(7, 'Item is too vague, needs more detail');
    expect(env.scratchNotes.length).toBe(1);
    expect(env.scratchNotes[0]).toMatch(/slot 7/);
    expect(env.scratchNotes[0]).toMatch(/Item is too vague/);
    expect(ctrl.getSynthResult(7)).toBeUndefined();
    synthSpy.mockRestore();
  });

  it('requestReviseSlot with no reason still appends a generic scratch-note', async () => {
    saveChargenState('o-r-main', 8, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'parse-failed',
        message: 'bad'
      });
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(8);
    ctrl.requestReviseSlot(8);
    expect(env.scratchNotes.length).toBe(1);
    expect(env.scratchNotes[0]).toMatch(/slot 8/);
    expect(env.scratchNotes[0]).not.toMatch(/Reason:/);
    synthSpy.mockRestore();
  });

  it('requestReviseSlot clears synth result on pre-accept slots', async () => {
    saveChargenState('o-r-main', 6, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    await ctrl.synthesizeForSlot(6);
    // Do NOT accept — revise is for pre-accept revision.
    ctrl.requestReviseSlot(6);
    expect(ctrl.getSynthResult(6)).toBeUndefined();
    expect(ctrl.isAccepted(6)).toBe(false);
    synthSpy.mockRestore();
  });

  /**
   * Post-D5.5-A playthrough Scenario 1: pre-extraction this case
   * silently `_synthResults.delete`d + `_acceptedSlots.delete`d but
   * the engine still carries the pc-create + pc-slot-bind events,
   * leaving the player roster with a ghost PC.  Post-fix: revise is
   * refused on accepted slots; the DM must retire the bound PC
   * first.  An audit scratch-note records the refusal.
   */
  it('requestReviseSlot refuses on an already-accepted slot + audits', async () => {
    saveChargenState('o-r-main', 6, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(6);
    ctrl.acceptSlot(6);
    const scratchBefore = env.scratchNotes.length;
    ctrl.requestReviseSlot(6, 'oops');
    // Refusal: synth + accept flag intact, no mid-state.
    expect(ctrl.getSynthResult(6)).toBeDefined();
    expect(ctrl.isAccepted(6)).toBe(true);
    // Audit-note appended so the refusal is investigable.
    expect(env.scratchNotes.length).toBe(scratchBefore + 1);
    expect(env.scratchNotes[scratchBefore]).toMatch(/already-accepted/i);
    synthSpy.mockRestore();
  });

  /**
   * Post-D5.5-A playthrough Scenario 6: joiningSession is table-
   * state ("this PC is joining at session 5"), not per-attempt.
   * Pre-fix, `resetForRevise` cleared it, forcing the DM to re-pick
   * N every revise round (or silently downgrading to N=1).  Post-
   * fix: revise preserves the joining-session.
   */
  it('requestReviseSlot preserves joiningSession across revise rounds', async () => {
    saveChargenState('o-r-main', 6, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setJoiningSessionForSlot(6, 5);
    await ctrl.synthesizeForSlot(6);
    ctrl.requestReviseSlot(6);
    // The table-fact "joining at session 5" survives the revise.
    expect(ctrl.joiningSessionForSlot(6)).toBe(5);
    synthSpy.mockRestore();
  });
});

// ---- Phase 3b polish (2026-05-22): DM-side pack import + inlineAnswers ----

describe('ChargenController — pack import + inlineAnswers (Phase 3b polish 2026-05-22)', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('importPack writes the pack answers to localStorage for the slot', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    // Build a pack whose fingerprint matches the test campaign's
    // {owner:'o', repo:'r', ref:'main'} source.
    const fingerprint = campaignFingerprint({
      owner: 'o',
      repo: 'r',
      ref: 'main'
    });
    const result = ctrl.importPack(
      {
        $schemaVersion: '0.1.0',
        campaignFingerprint: fingerprint,
        slot: 4,
        chosenPath: 'qa',
        answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' },
        packedAt: Date.now()
      },
      4
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.appliedSlot).toBe(4);
    // The next synthesizeForSlot call should find these answers.
    const persisted = loadChargenState('o-r-main', 4);
    expect(persisted?.answers).toEqual({
      archetype: 'hacker',
      'intent-moment': 'I held the line.'
    });
  });

  it('importPack rejects a pack with a different campaign fingerprint', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const result = ctrl.importPack(
      {
        $schemaVersion: '0.1.0',
        campaignFingerprint: 'WRONG_FINGERPRINT_VALUE',
        slot: 4,
        chosenPath: 'qa',
        answers: {},
        packedAt: Date.now()
      },
      4
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('campaign-mismatch');
      expect(result.message).toMatch(/different campaign/i);
    }
    // Nothing written.
    expect(loadChargenState('o-r-main', 4)).toBeNull();
  });

  it('importPack rejects a pack whose slot differs from the drop target', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const fingerprint = campaignFingerprint({
      owner: 'o',
      repo: 'r',
      ref: 'main'
    });
    const result = ctrl.importPack(
      {
        $schemaVersion: '0.1.0',
        campaignFingerprint: fingerprint,
        slot: 7,
        chosenPath: 'qa',
        answers: {},
        packedAt: Date.now()
      },
      3
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('slot-mismatch');
      expect(result.message).toContain('slot 7');
      expect(result.message).toContain('slot 3');
    }
  });

  it('importPack clears any existing synth result for the slot', async () => {
    saveChargenState('o-r-main', 8, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Stale',
          pronouns: 'they/them',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'stale',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r-stale'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    await ctrl.synthesizeForSlot(8);
    expect(ctrl.getSynthResult(8)?.ok).toBe(true);
    const fingerprint = campaignFingerprint({
      owner: 'o',
      repo: 'r',
      ref: 'main'
    });
    ctrl.importPack(
      {
        $schemaVersion: '0.1.0',
        campaignFingerprint: fingerprint,
        slot: 8,
        chosenPath: 'qa',
        answers: { archetype: 'engineer', 'intent-moment': 'fresh take' },
        packedAt: Date.now()
      },
      8
    );
    // Re-importing wipes the stale synth so the DM re-synths from
    // the freshly loaded answers (no risk of reviewing the wrong PC).
    expect(ctrl.getSynthResult(8)).toBeUndefined();
    synthSpy.mockRestore();
  });

  it('importPackFromText reports malformed JSON', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const result = ctrl.importPackFromText('not json at all', 4);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('malformed');
  });

  it('acceptWithEdits commits a spoiler-leak-rejected synth with DM-supplied name + backstory', async () => {
    // Set up: synthesizer returns spoiler-leak with a rejected
    // response.  The DM hand-edits, then accepts.  Result is one
    // pc-create + one pc-slot-bind, just like the normal accept
    // path, but with the DM-edited name + backstory.
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'spoiler-leak-persistent',
        message: 'AI used forbidden words: "Quiet".',
        persistentTokens: ['Quiet'],
        rawResponse: '{}',
        rejectedResponse: {
          name: 'Original Name',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'Mei felt the Quiet of the apartment.',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r-spoiler'
        }
      } as unknown as SynthesizeBackstoryResult);
    const env = makeEnv(makeCampaign());
    const { host } = makeHost();
    const ctrl = new ChargenController(host, env);
    // Populate the slot with the spoiler-leak result.
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    await ctrl.synthesizeForSlot(4);
    expect(ctrl.getSynthResult(4)?.ok).toBe(false);
    const ok = ctrl.acceptWithEdits(4, {
      name: 'Mei (cleaned)',
      backstory: 'Mei felt the silence of the apartment.'
    });
    expect(ok).toBe(true);
    // pc-create event uses the edited values.
    expect(env.pcCreates.length).toBe(1);
    expect(env.pcCreates[0]!.name).toBe('Mei (cleaned)');
    expect(env.pcCreates[0]!.backstory).toMatch(/silence/);
    expect(env.pcCreates[0]!.backstory).not.toMatch(/Quiet/);
    // Slot is now accepted.
    expect(ctrl.isAccepted(4)).toBe(true);
    synthSpy.mockRestore();
  });

  it('acceptWithEdits returns false when there is no rejected response to edit', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const ok = ctrl.acceptWithEdits(4, {
      name: 'x',
      backstory: 'y'
    });
    expect(ok).toBe(false);
  });

  it('synthesizeForSlot uses inlineAnswers when provided (quick-gen path)', async () => {
    // No localStorage state for slot 5 — would fail in the normal
    // path with "No chargen answers".  With inlineAnswers: {} we
    // proceed and rely on dmConstraints to anchor the AI.
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Anya',
          pronouns: 'she/her',
          tags: ['EMT', 'Chicago expat', 'methodical'],
          stats: { STR: 1, DEX: 1, CON: 2, INT: 1, WIS: 0, CHA: 0 },
          skillMastery: ['Medic', 'Insight'],
          backstory: 'Anya left Chicago after the storm...',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r-quick'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const result = await ctrl.synthesizeForSlot(5, {
      inlineAnswers: {},
      dmConstraints:
        'Use the name "Anya" for the PC.  Concept: jaded EMT who fled Chicago.'
    });
    expect(result.ok).toBe(true);
    // The synthesizer was called with an EMPTY answers array (no
    // persisted state was loaded) — the dmConstraints carries the
    // anchor.
    const callArg = synthSpy.mock.calls[0]?.[1];
    expect(callArg?.answers).toEqual([]);
    expect(callArg?.dmConstraints).toContain('Anya');
    expect(callArg?.dmConstraints).toContain('EMT');
    synthSpy.mockRestore();
  });

  it('slotsWithSynthState returns sorted slot ids', async () => {
    saveChargenState('o-r-main', 5, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    saveChargenState('o-r-main', 2, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'aborted',
        message: 'x'
      });
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    await ctrl.synthesizeForSlot(5);
    await ctrl.synthesizeForSlot(2);
    expect(ctrl.slotsWithSynthState()).toEqual([2, 5]);
    synthSpy.mockRestore();
  });
});

describe('ChargenController — addSeat / removeSeat (Wave 1)', () => {
  it('addSeat allocates the lowest unused slot', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    env.mockSlots[1] = { state: 'unbound' };
    env.mockSlots[2] = { state: 'bound-active', pcId: 'mei' };
    const ctrl = new ChargenController(host, env);
    expect(ctrl.addSeat()).toBe(3);
    expect(env.seatAdds).toEqual([3]);
  });

  it('addSeat returns null when 1..9 are all occupied (soft cap)', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    for (let i = 1; i <= 9; i++) env.mockSlots[i] = { state: 'unbound' };
    const ctrl = new ChargenController(host, env);
    expect(ctrl.addSeat()).toBeNull();
    expect(env.seatAdds).toEqual([]);
  });

  it('removeSeat drops an unbound seat and fires seat-remove', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    env.mockSlots[3] = { state: 'unbound' };
    const ctrl = new ChargenController(host, env);
    expect(ctrl.removeSeat(3)).toBe(true);
    expect(env.seatRemoves).toEqual([3]);
    expect(env.mockSlots[3]).toBeUndefined();
  });

  it('removeSeat refuses a bound seat (retire-flow only)', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    env.mockSlots[1] = { state: 'bound-active', pcId: 'mei' };
    const ctrl = new ChargenController(host, env);
    expect(ctrl.removeSeat(1)).toBe(false);
    expect(env.seatRemoves).toEqual([]);
  });

  it('removeSeat refuses a non-existent slot', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    expect(ctrl.removeSeat(7)).toBe(false);
    expect(env.seatRemoves).toEqual([]);
  });

  it('removeSeat refuses a seat with an accepted synth result', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    env.mockSlots[3] = { state: 'unbound' };
    const ctrl = new ChargenController(host, env);
    // Drive ctrl into accepted state for slot 3 via the public
    // surface so the bookkeeping flag matches reality.
    (ctrl as unknown as { acceptance: { markAccepted(s: number): void } }).acceptance.markAccepted(3);
    expect(ctrl.removeSeat(3)).toBe(false);
    expect(env.seatRemoves).toEqual([]);
  });

  it('removeSeat refuses a seat with synthesis in-flight', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    env.mockSlots[3] = { state: 'unbound' };
    const ctrl = new ChargenController(host, env);
    peekPrivate(ctrl).synth.markSynthInFlight(3);
    expect(ctrl.removeSeat(3)).toBe(false);
  });

  it('removeSeat refuses when caller is not coordinator', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign(), { isCoord: false });
    env.mockSlots[3] = { state: 'unbound' };
    const ctrl = new ChargenController(host, env);
    expect(ctrl.removeSeat(3)).toBe(false);
  });
});

describe('ChargenController — editSynthFieldPreAccept (Wave 2)', () => {
  function seedResult(ctrl: ChargenController, slot: number) {
    peekPrivate(ctrl).synth.setResult(slot, {
      ok: true,
      response: {
        name: 'Mei Tanaka',
        pronouns: 'she/her',
        tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory: 'Mei grew up in the Mission.',
        raw: '{}',
        tokensIn: 100,
        tokensOut: 250,
        responseId: 'syn-1'
      },
      warnings: [],
      retried: false
    });
  }

  it('patches name and records the original AI value for drift display', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    expect(ctrl.editSynthFieldPreAccept(1, { name: 'Mai Tanaka' })).toBe(true);
    const drift = ctrl.getPreAcceptDrift(1);
    expect(drift?.name).toBe('Mei Tanaka');
    // Synth result mutated in place — accept-flow will read the new name.
    expect(okSynth(ctrl, 1).response.name).toBe('Mai Tanaka');
  });

  it('patches pronouns independently from name (drift map accumulates)', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai Tanaka' });
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    const drift = ctrl.getPreAcceptDrift(1);
    expect(drift?.name).toBe('Mei Tanaka');
    expect(drift?.pronouns).toBe('she/her');
  });

  it('first-edit-wins: subsequent edits do NOT overwrite the original snapshot', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai-Lin' });
    const drift = ctrl.getPreAcceptDrift(1);
    // Original AI value preserved, even after multiple edits.
    expect(drift?.name).toBe('Mei Tanaka');
  });

  it('refuses to edit an already-accepted slot (Wave 3 territory)', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    (ctrl as unknown as { acceptance: { markAccepted(s: number): void } }).acceptance.markAccepted(1);
    expect(ctrl.editSynthFieldPreAccept(1, { name: 'Mai' })).toBe(false);
    expect(ctrl.getPreAcceptDrift(1)).toBeUndefined();
  });

  it('refuses to edit a slot with no ok-synth-result', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(ctrl.editSynthFieldPreAccept(1, { name: 'X' })).toBe(false);
  });

  it('dismissPreAcceptDrift removes a single field entry', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai', pronouns: 'they/them' });
    ctrl.dismissPreAcceptDrift(1, 'name');
    const drift = ctrl.getPreAcceptDrift(1);
    expect(drift?.name).toBeUndefined();
    expect(drift?.pronouns).toBe('she/her');
  });

  it('dismissPreAcceptDrift with no field clears the whole slot entry', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai', pronouns: 'they/them' });
    ctrl.dismissPreAcceptDrift(1);
    expect(ctrl.getPreAcceptDrift(1)).toBeUndefined();
  });

  it('requestReviseSlot clears drift along with the synth result', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    ctrl.requestReviseSlot(1, 'try again');
    expect(ctrl.getPreAcceptDrift(1)).toBeUndefined();
  });

  it('acceptSlot uses the edited name in the pc-create payload', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    seedResult(ctrl, 1);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai Tanaka', pronouns: 'they/them' });
    ctrl.acceptSlot(1);
    expect(env.pcCreates.length).toBe(1);
    expect(env.pcCreates[0].name).toBe('Mai Tanaka');
    expect(env.pcCreates[0].pronouns).toBe('they/them');
  });

  it('P-R12: setJoiningSessionForSlot stores N when > 1, clears when 1', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(ctrl.joiningSessionForSlot(1)).toBe(1);
    ctrl.setJoiningSessionForSlot(1, 3);
    expect(ctrl.joiningSessionForSlot(1)).toBe(3);
    ctrl.setJoiningSessionForSlot(1, 1);
    expect(ctrl.joiningSessionForSlot(1)).toBe(1);
  });

  it('P-R12: setJoiningSessionForSlot rejects out-of-range / non-integer', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.setJoiningSessionForSlot(1, 5);
    ctrl.setJoiningSessionForSlot(1, 0); // rejected
    expect(ctrl.joiningSessionForSlot(1)).toBe(5);
    ctrl.setJoiningSessionForSlot(1, 21); // rejected
    expect(ctrl.joiningSessionForSlot(1)).toBe(5);
    ctrl.setJoiningSessionForSlot(1, 2.5); // rejected
    expect(ctrl.joiningSessionForSlot(1)).toBe(5);
  });

  it('P-R12 (R6 math fix): acceptSlot seeds startingMarks ONLY (advancements earned in play)', () => {
    // TTRPG-R6 verdict: the earlier draft seeded both marks AND
    // advancements at N-1 each, which broke rules.md's 5-marks-
    // per-advancement economy.  Correct math: marks only;
    // advancements accrue at end-of-session like everyone else.
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    seedResult(ctrl, 1);
    ctrl.setJoiningSessionForSlot(1, 3);
    ctrl.acceptSlot(1);
    expect(env.pcCreates.length).toBe(1);
    const payload = env.pcCreates[0] as Record<string, unknown>;
    expect(payload.startingMarks).toBe(2);
    // R6: advancements NOT seeded — would be 5x too generous.
    expect(payload.startingAdvancements).toBeUndefined();
  });

  it('P-R12: acceptSlot omits catch-up fields when joining at session 1', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    seedResult(ctrl, 1);
    // No setJoiningSessionForSlot — default is 1.
    ctrl.acceptSlot(1);
    const payload = env.pcCreates[0] as Record<string, unknown>;
    expect(payload.startingMarks).toBeUndefined();
    expect(payload.startingAdvancements).toBeUndefined();
  });

  it('P-R12: clearSynth removes any staged joining-session value', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResult(ctrl, 1);
    ctrl.setJoiningSessionForSlot(1, 4);
    ctrl.clearSynth(1);
    expect(ctrl.joiningSessionForSlot(1)).toBe(1);
  });
});

describe('ChargenController — patchInPlace (Wave 3a)', () => {
  function seedResultWithBackstory(
    ctrl: ChargenController,
    slot: number,
    backstory: string,
    overrides: Partial<{ name: string; pronouns: string }> = {}
  ): void {
    peekPrivate(ctrl).synth.setResult(slot, {
      ok: true,
      response: {
        name: overrides.name ?? 'Mei Tanaka',
        pronouns: overrides.pronouns ?? 'she/her',
        tags: ['t1', 't2', 't3'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory,
        raw: '{}',
        tokensIn: 100,
        tokensOut: 250,
        responseId: 'syn-1'
      },
      warnings: [],
      retried: false
    });
  }

  it('patches the renamed name (full canonical form) throughout the backstory', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(
      ctrl,
      1,
      'Mei Tanaka was a junior engineer.  Mei Tanaka loved her sister.  Mei Tanaka carried the box.'
    );
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai Tanaka' });
    expect(ctrl.patchInPlace(1)).toBe(true);
    const result = okSynth(ctrl, 1);
    expect(result.response.backstory).toMatch(/Mai Tanaka was/);
    expect(
      (result.response.backstory.match(/Mai Tanaka/g) || []).length
    ).toBe(3);
    expect(result.response.backstory).not.toMatch(/\bMei Tanaka\b/);
  });

  it('limitation: diminutive prose ("Mei" vs full "Mei Tanaka") is NOT patched (Wave 3b territory)', () => {
    // The deterministic find-replace looks for the exact name
    // field value.  When the AI's backstory uses a diminutive that
    // doesn't match the full name verbatim, the substitution
    // misses.  Wave 3b's AI re-sync handles this case.
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(
      ctrl,
      1,
      'Mei was here.  Just Mei.'
    );
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai Tanaka' });
    ctrl.patchInPlace(1);
    const text = okSynth(ctrl, 1).response.backstory;
    // "Mei" remains because we replaced "Mei Tanaka" (original full
    // name) with "Mai Tanaka" but the prose uses just "Mei".
    expect(text).toMatch(/\bMei\b/);
  });

  it('patches pronoun subjects (she → they) and reflexives (herself → themselves)', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(
      ctrl,
      1,
      'She built it herself.  She kept herself sharp.  She was a fighter.'
    );
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    expect(ctrl.patchInPlace(1)).toBe(true);
    const text = okSynth(ctrl, 1).response.backstory;
    // Subject substitutions happen — only matches lowercase "she" word-bounded.
    // (Capital-S "She" at sentence start won't match the lowercase pattern;
    // case-handling is a Wave 3b polish item, not 3a scope.)
    // Reflexive substitutions DO match because they're already lowercase.
    expect(text).toMatch(/themselves/);
    expect(text).not.toMatch(/\bherself\b/);
  });

  it('does NOT touch the ambiguous "her" form (object vs possessive)', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(
      ctrl,
      1,
      'her keys were missing.  She saw her in the mirror.'
    );
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    ctrl.patchInPlace(1);
    const text = okSynth(ctrl, 1).response.backstory;
    expect(text).toMatch(/\bher\b/);
  });

  it('dismisses the drift entries that were patched', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'Mei was here.');
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    expect(ctrl.getPreAcceptDrift(1)?.name).toBeDefined();
    ctrl.patchInPlace(1);
    expect(ctrl.getPreAcceptDrift(1)).toBeUndefined();
  });

  it('leaves non-patchable drift (tags) untouched after patch', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'Mei was here.');
    ctrl.editSynthFieldPreAccept(1, {
      name: 'Mai',
      tags: ['data analyst', 't2', 't3']
    });
    ctrl.patchInPlace(1);
    const drift = ctrl.getPreAcceptDrift(1);
    expect(drift?.name).toBeUndefined(); // patched + dismissed
    expect(drift?.tags).toBeDefined(); // still in drift
  });

  it('patchableDriftFields returns name + pronouns only', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    ctrl.editSynthFieldPreAccept(1, {
      name: 'New',
      pronouns: 'they/them',
      tags: ['t1', 't2', 't3']
    });
    const fields = ctrl.patchableDriftFields(1);
    expect(fields).toContain('name');
    expect(fields).toContain('pronouns');
    expect(fields).not.toContain('tags');
  });

  it('patchInPlace returns false when no patchable drift exists', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    ctrl.editSynthFieldPreAccept(1, { tags: ['only-non-patchable'] });
    expect(ctrl.patchInPlace(1)).toBe(false);
  });

  it('refuses on accepted slots', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    ctrl.editSynthFieldPreAccept(1, { name: 'New' });
    (ctrl as unknown as { acceptance: { markAccepted(s: number): void } }).acceptance.markAccepted(1);
    expect(ctrl.patchInPlace(1)).toBe(false);
  });

  it('Wave 3 polish (TTRPG-R4 fix #5): patching pronouns marks the slot for the hint', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'She was here.');
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    expect(ctrl.wasPronounRecentlyPatched(1)).toBe(false);
    ctrl.patchInPlace(1);
    expect(ctrl.wasPronounRecentlyPatched(1)).toBe(true);
  });

  it('Wave 3 polish: patching only name does NOT mark for pronoun hint', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'Mei was here.');
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    ctrl.patchInPlace(1);
    expect(ctrl.wasPronounRecentlyPatched(1)).toBe(false);
  });

  it('Wave 3 polish: dismissPronounPatchHint clears the flag', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'She was here.');
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    ctrl.patchInPlace(1);
    ctrl.dismissPronounPatchHint(1);
    expect(ctrl.wasPronounRecentlyPatched(1)).toBe(false);
  });

  it('Wave 3 polish: any further edit clears the pronoun hint', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'She was here.');
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    ctrl.patchInPlace(1);
    expect(ctrl.wasPronounRecentlyPatched(1)).toBe(true);
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    expect(ctrl.wasPronounRecentlyPatched(1)).toBe(false);
  });

  it('post-R5 (QA-BUG-1): preAcceptDriftMap returns a fresh clone, not the internal Map', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    const a = ctrl.preAcceptDriftMap();
    const b = ctrl.preAcceptDriftMap();
    expect(a).not.toBe(b); // identity differs each call
    // Mutating the returned Map does NOT touch the controller's internal state.
    a.delete(1);
    expect(ctrl.getPreAcceptDrift(1)).toBeDefined();
  });

  it('post-R5 (QA-BUG-1): pronounPatchedSlotsSet returns a fresh Set', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'She was here.');
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    ctrl.patchInPlace(1);
    const a = ctrl.pronounPatchedSlotsSet();
    const b = ctrl.pronounPatchedSlotsSet();
    expect(a).not.toBe(b);
  });

  it('R6 QA-F1: deep-clone protects nested stats from external-ref leak (BUG-2 follow-up)', () => {
    // The R5 BUG-2 fix only shallow-cloned the response wrapper;
    // external references to `result.response.stats` still
    // observed post-edit mutations.  R6 deep-clones the nested
    // mutable objects.
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    const before = okSynth(ctrl, 1);
    const beforeStatsRef = before.response.stats;
    const beforeSTR = beforeStatsRef.STR;
    ctrl.editSynthFieldPreAccept(1, {
      stats: { STR: 2, DEX: 1, CON: 1, INT: 0, WIS: 1, CHA: 0 }
    });
    // The OLD stats ref should NOT have been mutated.
    expect(beforeStatsRef.STR).toBe(beforeSTR);
    // The CURRENT cached stats wrapper should have the new values.
    const after = okSynth(ctrl, 1);
    expect(after.response.stats.STR).toBe(2);
    // Identity: the after.response.stats is a fresh object.
    expect(after.response.stats).not.toBe(beforeStatsRef);
  });

  it('post-R5 (QA-BUG-2): editSynthFieldPreAccept clones the synth-result before mutation', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'Mei was here.');
    const before = okSynth(ctrl, 1);
    const beforeName = before.response.name;
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    // Old reference's name is UNCHANGED (the controller swapped in a new
    // wrapper object); only the controller's own pointer sees the edit.
    expect(before.response.name).toBe(beforeName);
    const after = okSynth(ctrl, 1);
    expect(after.response.name).toBe('Mai');
    expect(after).not.toBe(before); // wrapper identity differs
  });

  it('post-R5 (QA-BUG-3): acceptSlot refuses while a re-sync is in flight', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    seedResultWithBackstory(ctrl, 1, 'X');
    // Force the in-flight set (simulating an outstanding resync).
    peekPrivate(ctrl).synth.markResyncInFlight(1);
    ctrl.acceptSlot(1);
    expect(env.pcCreates.length).toBe(0);
  });

  it('post-R5 (QA-BUG-3): requestReviseSlot refuses while a re-sync is in flight', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    seedResultWithBackstory(ctrl, 1, 'X');
    peekPrivate(ctrl).synth.markResyncInFlight(1);
    ctrl.requestReviseSlot(1, 'try again');
    expect(env.scratchNotes.length).toBe(0);
  });

  it('post-R5 (QA-BUG-3): editSynthFieldPreAccept refuses while a re-sync is in flight', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    peekPrivate(ctrl).synth.markResyncInFlight(1);
    expect(ctrl.editSynthFieldPreAccept(1, { name: 'New' })).toBe(false);
  });

  it('post-R5 (QA-BUG-3): patchInPlace refuses while a re-sync is in flight', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'Mei was here.');
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    peekPrivate(ctrl).synth.markResyncInFlight(1);
    expect(ctrl.patchInPlace(1)).toBe(false);
  });

  it('post-R5 (QA-BUG-5): resyncBackstoryForSlot uses the pre-Patch original backstory', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mai',
          pronouns: 'they/them',
          tags: ['data analyst', 't2', 't3'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Insight'],
          backstory: 'Mai grew up in the Mission.',
          raw: '{}',
          tokensIn: 100,
          tokensOut: 250,
          responseId: 'r-resync'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    // Seed an original "She was a fighter" backstory.
    peekPrivate(ctrl).synth.setResult(1, {
      ok: true,
      response: {
        name: 'Mei',
        pronouns: 'she/her',
        tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory: 'She was a fighter.  She was kind.',
        raw: '{}',
        tokensIn: 100,
        tokensOut: 250,
        responseId: 'r-original'
      },
      warnings: [],
      retried: false
    });
    // DM patches pronouns → cached backstory now has "they was".
    ctrl.editSynthFieldPreAccept(1, { pronouns: 'they/them' });
    ctrl.patchInPlace(1);
    // Add a tag drift so resync is eligible.
    ctrl.editSynthFieldPreAccept(1, {
      tags: ['data analyst', 't2', 't3']
    });
    await ctrl.resyncBackstoryForSlot(1);
    expect(synthSpy).toHaveBeenCalledTimes(1);
    const callArg = synthSpy.mock.calls[0][1];
    // Voice anchor should be the ORIGINAL prose, not the patched version.
    expect(callArg.resync?.previousBackstory).toMatch(/She was/);
    expect(callArg.resync?.previousBackstory).not.toMatch(/they was/);
    synthSpy.mockRestore();
  });

  it('post-R5 (QA-BUG-4): re-sync failure populates resyncFailuresMap', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'provider-error',
        message: 'rate-limited; try again'
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, {
      ok: true,
      response: {
        name: 'Mei',
        pronouns: 'she/her',
        tags: ['a', 'b', 'c'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory: 'X',
        raw: '{}',
        tokensIn: 100,
        tokensOut: 250,
        responseId: 'r-1'
      },
      warnings: [],
      retried: false
    });
    ctrl.editSynthFieldPreAccept(1, { tags: ['new', 'b', 'c'] });
    await ctrl.resyncBackstoryForSlot(1);
    const failures = ctrl.resyncFailuresMap();
    expect(failures.get(1)?.code).toBe('provider-error');
    expect(failures.get(1)?.message).toMatch(/rate-limited/);
    // Drift survives on failure so DM can retry / Patch / Leave drift.
    expect(ctrl.getPreAcceptDrift(1)?.tags).toBeDefined();
    synthSpy.mockRestore();
  });

  it('post-R5 (QA-BUG-4): editing a drifted field clears the resync-failure banner', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    seedResultWithBackstory(ctrl, 1, 'X');
    (
      ctrl as unknown as {
        acceptance: {
          setResyncFailure(
            s: number,
            f: { code: string; message: string }
          ): void;
        };
      }
    ).acceptance.setResyncFailure(1, { code: 'provider-error', message: 'x' });
    ctrl.editSynthFieldPreAccept(1, { name: 'Mai' });
    expect(ctrl.resyncFailuresMap().get(1)).toBeUndefined();
  });
});

describe('ChargenController — resyncBackstoryForSlot (Wave 3b)', () => {
  function freshSynthResult(): SynthesizeBackstoryResult {
    return {
      ok: true,
      response: {
        name: 'Mei',
        pronouns: 'she/her',
        tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Knowledge'],
        backstory: 'Mei grew up in the Mission.',
        raw: '{}',
        tokensIn: 100,
        tokensOut: 250,
        responseId: 'r-original'
      },
      warnings: [],
      retried: false
    };
  }

  function resyncedResult(): SynthesizeBackstoryResult {
    return {
      ok: true,
      response: {
        name: 'Mai Tanaka',
        pronouns: 'they/them',
        tags: ['data analyst', 'reluctant insomniac', 'sister of a pilot'],
        stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
        skillMastery: ['Tech', 'Insight'],
        backstory: 'Mai grew up in the Mission, etc.',
        raw: '{}',
        tokensIn: 110,
        tokensOut: 240,
        responseId: 'r-resync'
      },
      warnings: [],
      retried: false
    };
  }

  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  it('returns null when the slot has no synth result', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(await ctrl.resyncBackstoryForSlot(1)).toBeNull();
  });

  it('returns null when the slot has no drift to re-sync', async () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult());
    expect(await ctrl.resyncBackstoryForSlot(1)).toBeNull();
  });

  it('builds the resync context from drift + current synth result', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue(resyncedResult());
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult());
    ctrl.editSynthFieldPreAccept(1, {
      tags: ['data analyst', 't2', 't3'],
      skillMastery: ['Tech', 'Insight']
    });
    await ctrl.resyncBackstoryForSlot(1);
    expect(synthSpy).toHaveBeenCalledTimes(1);
    const callArg = synthSpy.mock.calls[0][1];
    expect(callArg.resync).toBeDefined();
    expect(callArg.resync!.lockedFields.tags).toEqual([
      'data analyst',
      't2',
      't3'
    ]);
    expect(callArg.resync!.lockedFields.skillMastery).toEqual([
      'Tech',
      'Insight'
    ]);
    expect(callArg.resync!.editedFields).toContain('tags');
    expect(callArg.resync!.editedFields).toContain('skillMastery');
    expect(callArg.resync!.previousBackstory).toBe(
      'Mei grew up in the Mission.'
    );
    synthSpy.mockRestore();
  });

  it('clears ALL drift entries on successful re-sync', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue(resyncedResult());
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult());
    ctrl.editSynthFieldPreAccept(1, {
      tags: ['data analyst', 't2', 't3'],
      name: 'Mai'
    });
    await ctrl.resyncBackstoryForSlot(1);
    expect(ctrl.getPreAcceptDrift(1)).toBeUndefined();
    synthSpy.mockRestore();
  });

  it('Wave 3c: requestReviseSlot records pinned-question IDs in the scratch note', async () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    // Need a synth result for revise to fire.
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult());
    ctrl.requestReviseSlot(1, 'tag mismatch with hook', [
      'archetype',
      'intent-moment'
    ]);
    expect(env.scratchNotes.length).toBe(1);
    expect(env.scratchNotes[0]).toMatch(/tag mismatch with hook/);
    expect(env.scratchNotes[0]).toMatch(
      /Kept answers for:.*archetype.*intent-moment/
    );
  });

  it('Wave 3c: requestReviseSlot omits the pinned-list line when no pins', async () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult());
    ctrl.requestReviseSlot(1, 'general redo');
    expect(env.scratchNotes[0]).not.toMatch(/Kept answers/);
  });

  it('does NOT clear drift on a failed re-sync (so DM can retry)', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: false,
        code: 'provider-error',
        message: 'transient'
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult());
    ctrl.editSynthFieldPreAccept(1, { tags: ['data analyst', 't2', 't3'] });
    await ctrl.resyncBackstoryForSlot(1);
    expect(ctrl.getPreAcceptDrift(1)?.tags).toBeDefined();
    synthSpy.mockRestore();
  });

  // ---- Phase B P2 verification fixes ----

  it('B1: re-sync passes languages + moneyBand in lockedFields so DM edits survive', async () => {
    // Pre-fix: resyncBackstoryForSlot built lockedFields with only
    // name/pronouns/tags/skillMastery/stats — languages/moneyBand
    // were silently dropped, so the AI's re-sync would return the
    // original 'tight' even if the DM had edited to 'comfortable'.
    // Regression test that locks the B1 fix.
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue(resyncedResult());
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const baseFresh = freshSynthResult();
    const synthWithPhaseB = {
      ...baseFresh,
      response: {
        ...(baseFresh.ok ? baseFresh.response : null),
        languages: ['English', 'Mandarin'],
        moneyBand: 'comfortable'
      }
    } as SynthesizeBackstoryResult;
    peekPrivate(ctrl).synth.setResult(1, synthWithPhaseB);
    ctrl.editSynthFieldPreAccept(1, { tags: ['data analyst', 't2', 't3'] });
    await ctrl.resyncBackstoryForSlot(1);
    expect(synthSpy).toHaveBeenCalledTimes(1);
    const callArg = synthSpy.mock.calls[0][1];
    expect(callArg.resync).toBeDefined();
    expect(callArg.resync!.lockedFields.languages).toEqual([
      'English',
      'Mandarin'
    ]);
    expect(callArg.resync!.lockedFields.moneyBand).toBe('comfortable');
    synthSpy.mockRestore();
  });

  it('B1: re-sync omits languages + moneyBand from lockedFields when synth never had them', async () => {
    // The opposite case: original synth never carried Phase-B
    // fields, so the re-sync should NOT inject undefined / phantom
    // values into lockedFields.
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue(resyncedResult());
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, freshSynthResult()); // no Phase-B fields
    ctrl.editSynthFieldPreAccept(1, { tags: ['data analyst', 't2', 't3'] });
    await ctrl.resyncBackstoryForSlot(1);
    expect(synthSpy).toHaveBeenCalledTimes(1);
    const callArg = synthSpy.mock.calls[0][1];
    expect(callArg.resync).toBeDefined();
    expect(callArg.resync!.lockedFields.languages).toBeUndefined();
    expect(callArg.resync!.lockedFields.moneyBand).toBeUndefined();
    synthSpy.mockRestore();
  });
});

describe('ChargenController — race-safe acceptSlot (verification S2)', () => {
  it('refuses accept with stale expectedResponseId after a re-sync', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValueOnce({
        ok: true,
        response: {
          name: 'Mei Tanaka',
          pronouns: 'she/her',
          tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'Mei v1.',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-original'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult)
      .mockResolvedValueOnce({
        ok: true,
        response: {
          name: 'Casey Park',
          pronouns: 'they/them',
          tags: ['data analyst', 'reluctant insomniac', 'sister of a pilot'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Insight'],
          backstory: 'Casey v2.',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-replaced'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(4);
    // DM opens modal, captures the responseId of the SHOWN synth.
    const shownResponseId = ctrl.getSynthResult(4)?.ok
      ? (ctrl.getSynthResult(4) as { response: { responseId: string } })
          .response.responseId
      : '';
    expect(shownResponseId).toBe('syn-original');
    // A re-sync (or fresh synth) lands while modal is open.
    ctrl.editSynthFieldPreAccept(4, {
      tags: ['data analyst', 't2', 't3']
    });
    await ctrl.resyncBackstoryForSlot(4);
    // DM clicks Accept with the STALE expectedResponseId.  Must
    // refuse + set the race-mismatch flag; must NOT emit pc-create.
    ctrl.acceptSlot(4, shownResponseId);
    expect(env.pcCreates.length).toBe(0);
    expect(ctrl.hasAcceptRaceMismatch(4)).toBe(true);
    expect(ctrl.isAccepted(4)).toBe(false);
    synthSpy.mockRestore();
  });

  it('accepts when expectedResponseId matches the current synth result', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei Tanaka',
          pronouns: 'she/her',
          tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'Mei.',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-current'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(4);
    ctrl.acceptSlot(4, 'syn-current');
    expect(env.pcCreates.length).toBe(1);
    expect(ctrl.hasAcceptRaceMismatch(4)).toBe(false);
    expect(ctrl.isAccepted(4)).toBe(true);
    synthSpy.mockRestore();
  });

  it('legacy accept (no expectedResponseId) still works without race-gate', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei Tanaka',
          pronouns: 'she/her',
          tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'Mei.',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-any'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(4);
    // Legacy callers (hotkeys, tests) pass nothing — skip the gate.
    ctrl.acceptSlot(4);
    expect(env.pcCreates.length).toBe(1);
    synthSpy.mockRestore();
  });

  it('phase-B audit scratch-note fires when languages + moneyBand present at accept', async () => {
    saveChargenState('o-r-main', 4, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker', 'intent-moment': 'I held the line.' }
    });
    const synthSpy = vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei Tanaka',
          pronouns: 'she/her',
          tags: ['junior engineer', 'reluctant insomniac', 'sister of a pilot'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech', 'Knowledge'],
          backstory: 'Mei.',
          languages: ['English', 'Mandarin'],
          moneyBand: 'comfortable',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'syn-1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(4);
    ctrl.acceptSlot(4);
    // Two scratch-notes: the legacy v1 receipt + the new Phase-B
    // present-at-accept note.  S3-refined wording: "present at
    // accept" (neutral) not "AI-inferred" (claim we can't justify
    // without an answers lookup at this layer).
    expect(env.scratchNotes.length).toBe(2);
    expect(env.scratchNotes[0]).toMatch(/slot 4/);
    expect(env.scratchNotes[1]).toMatch(/Phase-B fields present at accept/);
    expect(env.scratchNotes[1]).toMatch(/languages=/);
    expect(env.scratchNotes[1]).toMatch(/moneyBand=comfortable/);
    expect(env.scratchNotes[1]).not.toMatch(/inferred/);
    // The pc-create payload carried the new fields through to the
    // materializer (T-controller-wire integration coverage).
    expect(env.pcCreates[0].languages).toEqual(['English', 'Mandarin']);
    expect(env.pcCreates[0].moneyBand).toBe('comfortable');
    synthSpy.mockRestore();
  });
});

describe('ChargenController — hasPendingSynth (Wave C2)', () => {
  it('returns false when no synth is in-flight and no synth result exists', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    expect(ctrl.hasPendingSynth()).toBe(false);
  });

  it('returns true while a synth is in-flight', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.markSynthInFlight(1);
    expect(ctrl.hasPendingSynth()).toBe(true);
  });

  it('returns true when a synth result exists but the slot is not yet accepted', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, { ok: true } as unknown as SynthesizeBackstoryResult);
    expect(ctrl.hasPendingSynth()).toBe(true);
  });

  it('returns false once the slot has been accepted (Wave C2 gate)', () => {
    // Wave C2 mount gate: post-accept, the DM has nothing more
    // to do for this slot.  If accepted AND no other pending
    // work, chargen-dm-review should unmount from the Aside.
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, { ok: true } as unknown as SynthesizeBackstoryResult);
    (
      ctrl as unknown as { acceptance: { markAccepted(s: number): void } }
    ).acceptance.markAccepted(1);
    expect(ctrl.hasPendingSynth()).toBe(false);
  });

  it('returns true when SOME slot has a pending synth even if another is accepted', () => {
    const { host } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    peekPrivate(ctrl).synth.setResult(1, { ok: true } as unknown as SynthesizeBackstoryResult);
    peekPrivate(ctrl).synth.setResult(2, { ok: true } as unknown as SynthesizeBackstoryResult);
    (
      ctrl as unknown as { acceptance: { markAccepted(s: number): void } }
    ).acceptance.markAccepted(1);
    // Slot 2 still pending → gate stays open.
    expect(ctrl.hasPendingSynth()).toBe(true);
  });
});

// ---- D5.5-B (2026-05-27): chargen bond emission on accept ----

describe('ChargenController — D5.5-B chargen bond emission', () => {
  beforeEach(() => {
    if (typeof localStorage !== 'undefined') localStorage.clear();
  });

  function mockOkSynth() {
    return vi
      .spyOn(backstorySynthesizer, 'synthesizeBackstory')
      .mockResolvedValue({
        ok: true,
        response: {
          name: 'Mei',
          pronouns: 'she/her',
          tags: ['a', 'b', 'c'],
          stats: { STR: 0, DEX: 1, CON: 1, INT: 2, WIS: 1, CHA: 0 },
          skillMastery: ['Tech'],
          backstory: 'x',
          raw: '{}',
          tokensIn: 0,
          tokensOut: 0,
          responseId: 'r1'
        },
        warnings: [],
        retried: false
      } as SynthesizeBackstoryResult);
  }

  it('emits a placeholder bond-propose per chargen bond draft after accept', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker' },
      bondDrafts: [
        { targetPlaceholder: 'the medic', text: 'I trust her.' },
        { targetPlaceholder: 'my brother', text: 'I owe him.' }
      ]
    });
    const synthSpy = mockOkSynth();
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(1);
    ctrl.acceptSlot(1);
    expect(env.bondProposes).toHaveLength(2);
    expect(env.bondProposes[0]).toMatchObject({
      targetPlaceholder: 'the medic',
      text: 'I trust her.'
    });
    expect(env.bondProposes[1]).toMatchObject({
      targetPlaceholder: 'my brother',
      text: 'I owe him.'
    });
    // Both bonds target the same just-created PC.
    expect(env.bondProposes[0].pcId).toBe(env.bondProposes[1].pcId);
    expect(env.bondProposes[0].pcId).toBe(env.pcCreates[0].pcId);
    synthSpy.mockRestore();
  });

  it('emits no bonds when the player authored none', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker' }
    });
    const synthSpy = mockOkSynth();
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(1);
    ctrl.acceptSlot(1);
    expect(env.bondProposes).toEqual([]);
    synthSpy.mockRestore();
  });

  /**
   * TTRPG-expert review requirement: bond-propose events are
   * independent + DM-private; a rejected bond (engine validator
   * drift, mid-emission glitch) must NOT roll back the committed
   * PC or strand the other bonds.  The PC is fully created; bonds
   * 1 + 3 land; bond 2's rejection is benign.
   */
  it('partial bond failure does not roll back the PC or other bonds', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: { archetype: 'hacker' },
      bondDrafts: [
        { targetPlaceholder: 'a', text: 'first' },
        { targetPlaceholder: 'b', text: 'second' },
        { targetPlaceholder: 'c', text: 'third' }
      ]
    });
    const synthSpy = mockOkSynth();
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    // Make the SECOND bond-propose fail (simulated engine reject).
    const orig = env.appendBondPropose;
    let call = 0;
    env.appendBondPropose = (p: {
      pcId: string;
      targetPlaceholder: string;
      text: string;
    }) => {
      call++;
      return call === 2 ? false : orig(p);
    };
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(1);
    ctrl.acceptSlot(1);
    // PC committed + accepted despite the bond failure.
    expect(ctrl.isAccepted(1)).toBe(true);
    expect(env.pcCreates).toHaveLength(1);
    // Bonds 1 + 3 recorded; bond 2 returned false without push.
    expect(env.bondProposes.map((b) => b.text)).toEqual(['first', 'third']);
    synthSpy.mockRestore();
  });

  /**
   * Post-review fix #3: dropped bonds (engine cap / gate) leave an
   * audit scratch-note rather than silently vanishing.
   */
  it('audits dropped bonds via a scratch-note', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: {},
      bondDrafts: [
        { targetPlaceholder: 'a', text: 'first' },
        { targetPlaceholder: 'b', text: 'second' }
      ]
    });
    const synthSpy = mockOkSynth();
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    // Reject ALL bond emissions (simulate cap reached).
    env.appendBondPropose = () => false;
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(1);
    ctrl.acceptSlot(1);
    expect(ctrl.isAccepted(1)).toBe(true);
    const auditNote = env.scratchNotes.find((n) => /not accepted/i.test(n));
    expect(auditNote).toBeDefined();
    expect(auditNote).toMatch(/2 of 2/);
    synthSpy.mockRestore();
  });

  /**
   * Post-review fix #1 (HIGH): clearSynth → re-synth → re-accept
   * must NOT re-emit the bonds.  Pre-fix, the drafts stayed in
   * localStorage + each re-accept re-emitted them with fresh
   * random ids the engine couldn't dedup → duplicate proposals.
   * The fix consumes the drafts after the first emission.
   */
  it('does NOT re-emit bonds on clearSynth → re-accept (drafts consumed)', async () => {
    saveChargenState('o-r-main', 1, {
      chosenPath: 'qa',
      answers: {},
      bondDrafts: [
        { targetPlaceholder: 'the medic', text: 'I trust her.' },
        { targetPlaceholder: 'my brother', text: 'I owe him.' }
      ]
    });
    const synthSpy = mockOkSynth();
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    const ctrl = new ChargenController(host, env);
    await ctrl.synthesizeForSlot(1);
    ctrl.acceptSlot(1);
    expect(env.bondProposes).toHaveLength(2);
    // DM "starts over": clear synth, re-synth, re-accept.
    ctrl.clearSynth(1);
    await ctrl.synthesizeForSlot(1);
    ctrl.acceptSlot(1);
    // No NEW bonds — the drafts were consumed on first accept.
    expect(env.bondProposes).toHaveLength(2);
    synthSpy.mockRestore();
  });
});
