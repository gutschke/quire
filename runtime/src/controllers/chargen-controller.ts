/**
 * ChargenController — Lit ReactiveController owning the chargen
 * (character-creation) lifecycle: the player's in-progress answers,
 * the chosen creation path, transient pack-download feedback, the
 * dynamic-import handles for the chargen + DM-review regions, and
 * the end-to-end AI synthesis pipeline.
 *
 * Extracted from `src/quire-app.ts` in Phase 3a Cluster E step 1
 * per the convergent finding from the four-reviewer Phase 2 gate:
 * the chargen flow's host-side surface had grown 4-6 @state fields,
 * 4+ methods, and 2 dynamic-import caches all woven into QuireApp,
 * and the unified DM review surface (P3T-17 ≡ CC-24 ≡ P3U-12 ≡
 * P3E-1) wanted a single seam to consume.  The host contract is
 * deliberately small: anything that's "AI keys", "session", or
 * "campaign loader" stays on QuireApp and is read through the
 * host's getter callbacks.
 *
 * The controller does NOT call out to provider HTTP itself; that
 * still lives in `src/ai/backstory-synthesizer.ts` (the frozen-
 * contract module).  The controller orchestrates: read persisted
 * answers, build player-facing context, dispatch to the synthesizer,
 * cache the result, expose it to the DM-review region.
 *
 * Storage layout: same `quire.chargen.<slug>:slot<N>` localStorage
 * keys used pre-extraction — see `src/chargen-persistence.ts`.
 */

import type { ReactiveController, ReactiveControllerHost } from 'lit';
import type { LoadedCampaign as LoadedCampaignBase } from '../campaign-loader';
import type { LoadedCharacter } from '../character-loader';

/**
 * The host wraps the loader's `LoadedCampaign` to attach a few
 * extra resolved fields (e.g. `worldOverview`).  The controller
 * only reaches into `.base` so we declare a minimal shape here
 * rather than create a circular import on the wrapper type.
 */
export interface ChargenCampaign {
  base: LoadedCampaignBase;
}
import {
  campaignFingerprint,
  encodeInviteToken
} from '../invite-token';
import { routeToSearch } from '../routing';
import { loadChargenState, saveChargenState } from '../chargen-persistence';
import {
  packChargen,
  stringifyChargenPack,
  suggestedPackFilename,
  ChargenPackError
} from '../chargen-pack';
import {
  buildPlayerFacingContext,
  type ContextFile
} from '../ai/campaign-context';
import type { AiProvider as AiProviderImpl } from '../ai/broker';
import type {
  AnsweredQuestion
} from '../ai/backstory-synthesis-prompt';
import type {
  CreationPath,
  CharCreationAnswers
} from '../ui/regions/character-creation';
import type { SynthesizeBackstoryResult } from '../ai/backstory-synthesizer';

// Provider id matches the AiKeyStore vocabulary.
type AiProvider = 'claude' | 'gemini';

/**
 * Host contract — the slice of QuireApp the controller needs
 * read-only access to.  Each capability is a getter callback so the
 * controller always observes the latest state at decision time
 * (avoids stale-snapshot bugs when the host re-renders mid-flight).
 */
export interface ChargenHost {
  /** Resolved campaign, or undefined when nothing is loaded. */
  getCurrentCampaign(): ChargenCampaign | undefined;
  /** Stable campaign slug used as the chargen-persistence key prefix. */
  getCampaignSlug(campaign: ChargenCampaign): string;
  /** Currently-selected AI provider id. */
  getAiProvider(): AiProvider;
  /** API key for the active provider; empty string if unset. */
  getAiApiKey(): string;
  /** Provider model id (e.g., 'claude-sonnet-4-6'). */
  getAiModel(): string;
  /**
   * Map of provider id → provider impl for the synthesizer call.
   * Returning the whole record (rather than pre-resolving) lets the
   * controller keep its dependency surface narrow.
   */
  getAiProviders(): Record<AiProvider, AiProviderImpl>;
  /**
   * Display name of the inviting peer (the DM).  Forwarded to the
   * synthesizer so the AI knows not to reuse it as the PC's name.
   */
  getDmDisplayName(): string;
  /** Coord-gate: synthesize-and-accept paths require coordinator. */
  isCoordinator(): boolean;
  /**
   * Bound-character cache resolver for the P3U-12 display-name
   * lookup.  Returns the loaded character record (with manifest.name)
   * or null when not yet resolved; the controller treats null as
   * "fall back to pcId text".
   */
  getBoundCharacter(pcId: string): LoadedCharacter | null;
  /**
   * Trigger an async fetch of the named character file so a
   * subsequent `getBoundCharacter` resolves.  Idempotent at the
   * host (the host caches in-flight imports).
   */
  loadCharacterByPcId(pcId: string): void;
}

/**
 * Debounce window for the chargen autosave.  Shorter than the
 * play-time autosave (300 ms vs 1500 ms) because the chargen flow
 * has fewer state changes per unit time and the player may close
 * the tab without realizing the autosave is debounced; saving
 * aggressively gives a stronger "your work is safe" guarantee.
 */
const CHARGEN_PERSIST_DEBOUNCE_MS = 300;
const PACK_FEEDBACK_CLEAR_MS = 3000;

export class ChargenController implements ReactiveController {
  /** Player's path selection from chargen step 3.  '' means "not chosen yet". */
  chosenPath: CreationPath | '' = '';

  /** Player's answers keyed by question id. */
  answers: CharCreationAnswers = {};

  /** Transient feedback on the "Pack my character" download. */
  packFeedback: '' | 'packed' | 'pack-failed' = '';

  /**
   * Per-slot AI synthesis result map.  Populated by
   * `synthesizeForSlot`; consumed by the `<chargen-dm-review>`
   * region.  The result shape is the load-bearing frozen contract
   * `SynthesizeBackstoryResult`.
   */
  readonly synthResults = new Map<number, SynthesizeBackstoryResult>();

  /** Slots whose synthesis is currently in-flight (for UI dim/spinner). */
  readonly synthInFlight = new Set<number>();

  /** Slots the DM has accepted (CC-24).  Used by the region for the accept-gate dim. */
  readonly acceptedSlots = new Set<number>();

  /**
   * Code-split: cached dynamic-imports for the chargen surfaces.
   * Same lazy posture as pre-extraction — a regular play session
   * never imports these.
   */
  private chargenRegionLoaded: Promise<void> | null = null;
  private dmReviewRegionLoaded: Promise<void> | null = null;
  private synthesizerLoaded: Promise<
    typeof import('../ai/backstory-synthesizer')
  > | null = null;

  /** Per-slot debounced persist timers; one per (slug, slot) pair. */
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private packFeedbackTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly host: ReactiveControllerHost,
    private readonly env: ChargenHost
  ) {
    host.addController(this);
  }

  hostConnected(): void {
    /* no-op — state seeds on the chargen-route navigation. */
  }

  hostDisconnected(): void {
    // Flush any pending persist timers so a tab close mid-typing
    // doesn't lose the last <300 ms.  Same discipline as
    // AiKeyStore.hostDisconnected.
    for (const timer of this.persistTimers.values()) clearTimeout(timer);
    this.persistTimers.clear();
    if (this.packFeedbackTimer) {
      clearTimeout(this.packFeedbackTimer);
      this.packFeedbackTimer = null;
    }
  }

  // ---- setters that re-render the host ----

  setChosenPath(path: CreationPath | ''): void {
    if (this.chosenPath === path) return;
    this.chosenPath = path;
    this.host.requestUpdate();
  }

  setAnswer(id: string, value: string): void {
    if (this.answers[id] === value) return;
    this.answers = { ...this.answers, [id]: value };
    this.host.requestUpdate();
  }

  /**
   * Replace the entire answers map (used by `seedFromStorage`).
   * Use sparingly; prefer `setAnswer` for per-keystroke writes.
   */
  setAnswers(answers: CharCreationAnswers): void {
    this.answers = answers;
    this.host.requestUpdate();
  }

  // ---- chargen-route seeding ----

  /**
   * Seed the in-memory chargen state from localStorage for the
   * given campaign+slot.  Called by the chargen-route loader in
   * QuireApp when the player visits an `?invite=` URL.  When no
   * persisted state exists (first visit, or different device),
   * resets to empty.
   */
  seedFromStorage(slug: string, slot: number): void {
    const resumed = loadChargenState(slug, slot);
    if (resumed) {
      this.chosenPath = resumed.chosenPath;
      this.answers = resumed.answers;
    } else {
      this.chosenPath = '';
      this.answers = {};
    }
    this.host.requestUpdate();
  }

  /**
   * Debounced persist of the current chargen state.  Per-slot
   * (slug+slot) timer so concurrent edits to different slots don't
   * stomp each other.
   */
  persistDebounced(campaign: ChargenCampaign, slot: number): void {
    const slug = this.env.getCampaignSlug(campaign);
    const key = `${slug}:${slot}`;
    const existing = this.persistTimers.get(key);
    if (existing) clearTimeout(existing);
    this.persistTimers.set(
      key,
      setTimeout(() => {
        this.persistTimers.delete(key);
        saveChargenState(slug, slot, {
          chosenPath: this.chosenPath,
          answers: this.answers
        });
      }, CHARGEN_PERSIST_DEBOUNCE_MS)
    );
  }

  // ---- pack + download (CC-10) ----

  packAndDownload(campaign: ChargenCampaign, slot: number): void {
    try {
      const fingerprint = campaignFingerprint(campaign.base.source);
      const doc = packChargen({
        campaignFingerprint: fingerprint,
        slot,
        chosenPath: this.chosenPath,
        answers: this.answers
      });
      const json = stringifyChargenPack(doc);
      const filename = suggestedPackFilename(
        doc,
        this.env.getCampaignSlug(campaign)
      );
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      this.packFeedback = 'packed';
    } catch (e) {
      if (
        e instanceof ChargenPackError ||
        e instanceof Error // includes URL.createObjectURL failures in sandboxed envs
      ) {
        this.packFeedback = 'pack-failed';
      } else {
        throw e;
      }
    }
    this.host.requestUpdate();
    // Auto-clear feedback after 3 seconds so the next interaction
    // doesn't see stale text.
    if (this.packFeedbackTimer) clearTimeout(this.packFeedbackTimer);
    this.packFeedbackTimer = setTimeout(() => {
      this.packFeedbackTimer = null;
      if (
        this.packFeedback === 'packed' ||
        this.packFeedback === 'pack-failed'
      ) {
        this.packFeedback = '';
        this.host.requestUpdate();
      }
    }, PACK_FEEDBACK_CLEAR_MS);
  }

  // ---- invite URL (CC-12) ----

  generateInviteUrl(slot: number): Promise<string | null> {
    if (!this.env.isCoordinator()) return Promise.resolve(null);
    const campaign = this.env.getCurrentCampaign();
    if (!campaign) return Promise.resolve(null);
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
      return Promise.resolve(null);
    }
    try {
      const fingerprint = campaignFingerprint(campaign.base.source);
      const token = encodeInviteToken({
        slot,
        issuedAt: Date.now(),
        campaignFingerprint: fingerprint
      });
      const search = routeToSearch({
        kind: 'character-creation',
        slug: this.env.getCampaignSlug(campaign),
        inviteToken: token
      });
      return Promise.resolve(
        `${window.location.origin}${window.location.pathname}${search}`
      );
    } catch {
      return Promise.resolve(null);
    }
  }

  // ---- code-split helpers ----

  loadChargenRegion(): Promise<void> {
    if (this.chargenRegionLoaded) return this.chargenRegionLoaded;
    this.chargenRegionLoaded = import(
      '../ui/regions/character-creation'
    ).then(() => undefined);
    return this.chargenRegionLoaded;
  }

  loadDmReviewRegion(): Promise<void> {
    // Step 2 of Cluster E adds the actual `<chargen-dm-review>`
    // region module; stub the import for the step-1 commit so the
    // type checker has a load-bearing signature.  Replaced with a
    // real dynamic import in step 2.
    return this.dmReviewRegionLoaded ?? Promise.resolve();
  }

  private loadSynthesizerModule(): Promise<
    typeof import('../ai/backstory-synthesizer')
  > {
    if (!this.synthesizerLoaded) {
      this.synthesizerLoaded = import('../ai/backstory-synthesizer');
    }
    return this.synthesizerLoaded;
  }

  // ---- end-to-end AI synthesis (CC-17 + CC-19 + CC-20 + CC-21 + CC-23) ----

  /**
   * End-to-end backstory synthesis for one slot.  Mirrors the
   * pre-extraction `quire-app.synthesizeBackstoryForSlot` verbatim,
   * but reads its dependencies via the host getters.  Returns the
   * frozen-contract `SynthesizeBackstoryResult` so the DM-review
   * region can consume the typed shape directly (no lossy adapter).
   */
  async synthesizeForSlot(
    slot: number,
    options: { playerDisplayName?: string; dmConstraints?: string } = {}
  ): Promise<SynthesizeBackstoryResult> {
    const campaign = this.env.getCurrentCampaign();
    if (!campaign) {
      return {
        ok: false,
        code: 'provider-error',
        message: 'No campaign loaded; cannot synthesize.'
      };
    }
    if (!Number.isInteger(slot) || slot < 1 || slot > 9) {
      return {
        ok: false,
        code: 'provider-error',
        message: `Slot ${slot} is out of range [1, 9].`
      };
    }
    const slug = this.env.getCampaignSlug(campaign);
    const persisted = loadChargenState(slug, slot);
    if (!persisted) {
      return {
        ok: false,
        code: 'provider-error',
        message:
          `No chargen answers for slot ${slot} on this device.  ` +
          `Ask the player to send you their packed character file ` +
          `from the end of their invite flow (or load the pack from ` +
          `disk if they already sent it), then try again.`
      };
    }
    const provider = this.env.getAiProvider();
    const apiKey = this.env.getAiApiKey();
    if (!apiKey) {
      return {
        ok: false,
        code: 'provider-error',
        message: `No API key configured for provider "${provider}".`
      };
    }
    const declared =
      campaign.base.manifest.characterCreation?.questions ?? [];
    const answers: AnsweredQuestion[] = [];
    for (const q of declared) {
      const a = persisted.answers[q.id];
      if (a !== undefined && a !== '') {
        answers.push({ question: q, answer: a });
      }
    }
    let context: ContextFile[];
    try {
      context = await buildPlayerFacingContext({
        source: campaign.base.source,
        episodes: (campaign.base.manifest.episodes ?? []).map((slug) => ({
          slug
        })),
        characters: campaign.base.manifest.characters
      });
    } catch (e) {
      return {
        ok: false,
        code: 'provider-error',
        message: `Failed to build campaign context: ${(e as Error).message}`
      };
    }
    // P3D-1 hybrid seam: campaign-declared spoiler tokens + place
    // allowlist flow from `aiBackstory` in the manifest through to
    // the synthesizer.
    const aiBackstory = campaign.base.manifest.aiBackstory;
    const spoilerTokens = aiBackstory?.spoilerTokens;
    const placeAllowlist = aiBackstory?.placeAllowlist;
    this.synthInFlight.add(slot);
    this.host.requestUpdate();
    try {
      const mod = await this.loadSynthesizerModule();
      const result = await mod.synthesizeBackstory(
        this.env.getAiProviders()[provider],
        {
          campaignContext: context,
          dmConstraints: options.dmConstraints ?? '',
          playerDisplayName: options.playerDisplayName ?? '',
          answers,
          apiKey,
          model: this.env.getAiModel(),
          spoilerTokens,
          validatorOptions: {
            playerDisplayName: options.playerDisplayName,
            placeAllowlist
          }
        }
      );
      this.synthResults.set(slot, result);
      // Re-synthesizing clears any prior accept for the same slot —
      // accepting the OLD result and then re-synthesizing would
      // otherwise leave the accept stale.
      this.acceptedSlots.delete(slot);
      return result;
    } finally {
      this.synthInFlight.delete(slot);
      this.host.requestUpdate();
    }
  }

  /** Forget a slot's synthesis state (DM rejected or wants to start over). */
  clearSynth(slot: number): void {
    const had = this.synthResults.has(slot) || this.acceptedSlots.has(slot);
    this.synthResults.delete(slot);
    this.acceptedSlots.delete(slot);
    if (had) this.host.requestUpdate();
  }

  // ---- display-name resolution (P3U-12) ----

  /**
   * Return the display name for the PC bound to a slot, or null if
   * the character file hasn't loaded yet.  The DM-review region
   * shows this in place of the raw pcId (UX P3U-12).  Triggers a
   * lazy load when the cache is cold so a subsequent re-render
   * shows the resolved name.
   */
  displayNameForBound(pcId: string): string | null {
    const loaded = this.env.getBoundCharacter(pcId);
    if (loaded) {
      // LoadedCharacter.record is the raw character JSON; `name` is
      // the canonical display field (every PC json has it).
      const name = loaded.record?.name;
      return typeof name === 'string' && name.length > 0 ? name : pcId;
    }
    this.env.loadCharacterByPcId(pcId);
    return null;
  }
}
