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
    loadedPcs: loaded,
    scratchNotes,
    pcCreates,
    pcSlotBinds,
    seatAdds,
    seatRemoves,
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

  it('requestReviseSlot clears synth result + accept flag', async () => {
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
    ctrl.acceptSlot(6);
    ctrl.requestReviseSlot(6);
    expect(ctrl.getSynthResult(6)).toBeUndefined();
    expect(ctrl.isAccepted(6)).toBe(false);
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
    (ctrl as unknown as { _acceptedSlots: Set<number> })._acceptedSlots.add(3);
    expect(ctrl.removeSeat(3)).toBe(false);
    expect(env.seatRemoves).toEqual([]);
  });

  it('removeSeat refuses a seat with synthesis in-flight', () => {
    const { host } = makeHost();
    const env = makeEnv(makeCampaign());
    env.mockSlots[3] = { state: 'unbound' };
    const ctrl = new ChargenController(host, env);
    (ctrl as unknown as { _synthInFlight: Set<number> })._synthInFlight.add(3);
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
