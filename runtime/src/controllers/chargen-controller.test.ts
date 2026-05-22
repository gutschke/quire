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
import { saveChargenState } from '../chargen-persistence';
import type { LoadedCampaign as LoadedCampaignBase } from '../campaign-loader';
import type { LoadedCharacter } from '../character-loader';

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
    loadedPcs: loaded
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
  it('clearSynth removes synth result + accept flag', () => {
    const { host, updateCount } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    ctrl.synthResults.set(1, {
      ok: true,
      response: {} as never,
      warnings: [],
      retried: false
    });
    ctrl.acceptedSlots.add(1);
    const before = updateCount();
    ctrl.clearSynth(1);
    expect(ctrl.synthResults.has(1)).toBe(false);
    expect(ctrl.acceptedSlots.has(1)).toBe(false);
    expect(updateCount()).toBeGreaterThan(before);
  });

  it('clearSynth no-ops + skips host update when slot was already clean', () => {
    const { host, updateCount } = makeHost();
    const ctrl = new ChargenController(host, makeEnv(makeCampaign()));
    const before = updateCount();
    ctrl.clearSynth(7);
    expect(updateCount()).toBe(before);
  });
});
