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
   * The current AppState's view, distilled to what affects
   * context selection.  Pass `episode` when in any
   * episode/scene/character view; leave undefined for idle/home.
   */
  episode?: {
    slug: string;
    /** All scene paths for this episode (from episode manifest). */
    scenes: string[];
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
  const refs: string[] = ['campaign.json', 'world/overview.md'];
  if (req.episode) {
    refs.push(`episodes/${req.episode.slug}/episode.json`);
    for (const scenePath of req.episode.scenes) {
      refs.push(`episodes/${req.episode.slug}/${scenePath}`);
    }
    if (req.scope === 'dm') {
      for (const dmFile of EPISODE_DM_FILES_HINT) {
        refs.push(`episodes/${req.episode.slug}/dm/${dmFile}`);
      }
    }
  }
  if (req.scope === 'dm') {
    for (const ref of CAMPAIGN_DM_ONLY_FILES) refs.push(ref);
  }
  // Validate every ref BEFORE fetching — keeps the fail-closed
  // story aligned with the broker's pre-flight check.  A
  // path-shape problem here means a build mistake in the caller,
  // not a network event.
  const safeRefs = refs.filter((r) => validateContextRef(r, req.scope).ok);
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
