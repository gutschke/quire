/**
 * Campaign context assembly for AI prompts (M3b followup).
 *
 * Closes the S-1 finding from the M3b gate: `wrapUntrusted()` was
 * built but unused, so the AI assistant had no visibility into
 * the actual campaign content.  This module fetches the relevant
 * files for the DM's current view and wraps each one in an
 * untrusted-content block before they go into the prompt.
 *
 * Selection policy (v1 minimum, per project_quire_ai_context_requirements):
 *
 * Current priority — the DM needs every detail of the CURRENT
 *   episode they're running.  We always include:
 *   - `campaign.json` (overall campaign + tone)
 *   - `world/overview.md` (the world bible — light)
 *   - `episodes/<current>/episode.json` (episode manifest)
 *   - all `episodes/<current>/scenes/*.md` files
 *
 * DM-scope extension — when the user toggled "Include DM notes"
 *   we additionally include:
 *   - all `episodes/<current>/dm/*.md` files
 *   - `design/DM-ONLY/*.md` files (campaign-wide notes — antagonist,
 *     world-truths, big-arc).  Heuristic + token budget; load all
 *     for v1 minimum and tighten if it overruns.
 *
 * Earlier-episode / later-episode awareness is deferred to a
 * smarter selection (RAG-style) — for v1, the system prompt
 * tells the AI to acknowledge gaps if asked about other
 * episodes; the in-episode answer quality matters first.
 *
 * Every file's body is run through `wrapUntrusted(content, source)`
 * so the model treats it as data, not instructions.  The
 * UC_CLOSE-sentinel guard on `fetchCampaignFile` (M3b.6) plus the
 * matching guard on `loadCampaign` (M3b.7 unblock) ensure no
 * campaign file can break out of the wrapper.
 */

import { fetchCampaignFile, type CampaignSource } from '../campaign-loader';
import {
  wrapUntrusted,
  validateContextRef,
  type ContextScope
} from './context';

export interface CampaignContextRequest {
  source: CampaignSource;
  /**
   * Episodes to include in the context, in the order they should
   * appear (current episode first for the AI's locality bias).
   * Each entry is either a slug (we'll discover scenes by
   * fetching `episodes/<slug>/episode.json`) OR a slug+scenes
   * pair (we'll skip the manifest fetch and use the given
   * scenes — useful when the caller already has the loaded
   * episode in memory).
   */
  episodes?: Array<{
    slug: string;
    scenes?: string[];
  }>;
  /**
   * PC + NPC ids from `campaign.json`'s `characters` field.  We
   * fetch every character file the manifest lists so the AI
   * knows Yui by name + motivation + stats — not just by scene
   * mentions.  Each id resolves to `characters/pcs/<id>.json` or
   * `characters/npcs/<id>.json`; missing files 404 silently.
   */
  characters?: {
    pcs?: string[];
    npcs?: string[];
  };
  scope: ContextScope;
  signal?: AbortSignal;
}

export interface ContextFile {
  /** Campaign-relative path — fed into the wrapper's `source` attr. */
  path: string;
  /** Raw fetched content (already passed UC_CLOSE check). */
  content: string;
}

/**
 * Concrete list of campaign-wide DM-only files to include when
 * `scope === 'dm'`.  Could be discovered dynamically (directory
 * listing) but raw.githubusercontent.com doesn't list, so we
 * enumerate the well-known ones.  Each file's absence is silent
 * (fetchCampaignFile returns null on 404).
 */
const CAMPAIGN_DM_ONLY_FILES = [
  'design/DM-ONLY/antagonist.md',
  'design/DM-ONLY/big-arc.md',
  'design/DM-ONLY/arc.md',
  'design/DM-ONLY/principles.md',
  'design/DM-ONLY/world-truths.md'
];

const EPISODE_DM_FILES_HINT = [
  'README.md',
  'avionics-realism.md',
  'coincidences.md',
  'cover-stories.md',
  'npcs.md',
  'pacing.md',
  'stakes.md',
  'the-cable.md',
  'the-gate.md'
];

/**
 * Build the campaign-context file list for the current view +
 * scope.  Each entry's `content` is the raw fetched body (the
 * caller wraps with `wrapUntrusted` before injecting into the
 * prompt).  Network errors on a single file are silenced — a
 * missing file doesn't fail the whole context build.
 */
export async function buildCampaignContext(
  req: CampaignContextRequest
): Promise<ContextFile[]> {
  // Discover scene lists for any episode whose scenes weren't
  // supplied inline.  This is an extra round-trip per episode
  // but parallelizable; a 50-episode campaign at ~50 ms / fetch
  // round-trip = ~50 ms total wall-clock (Promise.all).
  const resolvedEpisodes = await Promise.all(
    (req.episodes ?? []).map(async (ep) => {
      if (ep.scenes) return ep;
      const manifestPath = `episodes/${ep.slug}/episode.json`;
      try {
        const text = await fetchCampaignFile(req.source, manifestPath, {
          signal: req.signal
        });
        if (!text) return { slug: ep.slug, scenes: [] };
        const parsed = JSON.parse(text) as { scenes?: unknown };
        const scenes = Array.isArray(parsed.scenes)
          ? parsed.scenes.filter((s): s is string => typeof s === 'string')
          : [];
        return { slug: ep.slug, scenes };
      } catch {
        return { slug: ep.slug, scenes: [] };
      }
    })
  );
  const refs: string[] = ['campaign.json', 'world/overview.md'];
  for (const ep of resolvedEpisodes) {
    refs.push(`episodes/${ep.slug}/episode.json`);
    for (const scenePath of ep.scenes ?? []) {
      refs.push(`episodes/${ep.slug}/${scenePath}`);
    }
    if (req.scope === 'dm') {
      for (const dmFile of EPISODE_DM_FILES_HINT) {
        refs.push(`episodes/${ep.slug}/dm/${dmFile}`);
      }
    }
  }
  for (const pcId of req.characters?.pcs ?? []) {
    refs.push(`characters/pcs/${pcId}.json`);
  }
  for (const npcId of req.characters?.npcs ?? []) {
    refs.push(`characters/npcs/${npcId}.json`);
  }
  if (req.scope === 'dm') {
    for (const ref of CAMPAIGN_DM_ONLY_FILES) refs.push(ref);
  }
  // De-dupe — the inline-scenes path may overlap with the
  // discovery path when an episode was loaded in memory AND
  // appears in the campaign manifest.
  const seen = new Set<string>();
  const dedupedRefs = refs.filter((r) => {
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });
  // Validate every ref BEFORE fetching — keeps the fail-closed
  // story aligned with the broker's pre-flight check.  A
  // path-shape problem here means a build mistake in the caller,
  // not a network event.
  const safeRefs = dedupedRefs.filter(
    (r) => validateContextRef(r, req.scope).ok
  );
  // Fetch in parallel; tolerate per-file 404 / network errors.
  const fetches = await Promise.all(
    safeRefs.map(async (path) => {
      try {
        const content = await fetchCampaignFile(req.source, path, {
          signal: req.signal
        });
        if (content === null) return null;
        return { path, content };
      } catch {
        return null;
      }
    })
  );
  return fetches.filter((f): f is ContextFile => f !== null);
}

/**
 * CC-18 (M4 char-creation): build a campaign context guaranteed
 * NEVER to include `dm/*.md` files.  The type signature physically
 * prevents a caller from passing `scope: 'dm'` (the parameter is
 * omitted from the request shape), so the player-facing AI synthesis
 * path cannot leak DM-only material into a backstory or other
 * player-facing output — even if the calling code is the DM and would
 * be permitted DM scope in the play-time path.
 *
 * Load-bearing for the magic-realization arc in Underleaf and any
 * other campaign whose design depends on gradual discovery.  See
 * memory `project-quire-ai-player-facing-scope` for the full
 * threat-model justification.
 *
 * This is the FIRST line of defense.  The forbidden-token post-check
 * (CC-20) is the second, and the DM approval gate (CC-24) is the
 * third.  Defense in depth.
 */
export function buildPlayerFacingContext(
  req: Omit<CampaignContextRequest, 'scope'>
): Promise<ContextFile[]> {
  return buildCampaignContext({ ...req, scope: 'public' });
}

/**
 * Concatenate fetched files into a single wrapped-untrusted block
 * suitable for prepending to the user's prompt.  Empty input
 * returns the empty string so the caller can unconditionally
 * `${this.buildContextBlock(files)}\n\n${user}`.
 */
export function wrapCampaignContext(files: ContextFile[]): string {
  if (files.length === 0) return '';
  const wrapped = files.map((f) => wrapUntrusted(f.content, f.path));
  return wrapped.join('\n\n');
}
