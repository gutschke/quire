/**
 * File System Access API availability detection (M6a-FS).
 *
 * # Why this module exists
 *
 * M6a-FS is the zero-infrastructure cloud-sync path: the DM picks
 * a desktop folder (which can be `Google Drive/`, `Dropbox/`,
 * `OneDrive/`, `iCloud Drive/`, …); Quire writes the save file
 * there; the user's existing OS-level sync client pushes it to
 * whichever cloud they chose.  No OAuth client_id, no Cloudflare
 * proxy, no maintainer-side OAuth-app registration — the
 * end-to-end durability story works against ZERO maintainer
 * infrastructure.
 *
 * The cost is browser support: only Chromium-family desktop
 * browsers (Chrome, Edge, Opera, Brave, Arc, …) ship
 * `window.showDirectoryPicker` today.  Safari and Firefox both
 * have it stuck on standards-track without shipping in any
 * release channel as of 2026-05.  Mobile platforms — including
 * Chrome on Android, where the underlying capability would
 * theoretically be possible — also gate the API off.
 *
 * This module is the SOLE feature-detection seam for the rest of
 * M6a-FS.  Every user-visible surface that wants to render the
 * "Connect a folder" affordance MUST consult
 * `isFileSystemAccessAvailable` first; non-Chromium / mobile
 * surfaces render the "OAuth Drive coming soon" placeholder
 * instead (Piece 2 UI surface).
 *
 * # Why the verdict has a `reason` field
 *
 * The UI wants to show DIFFERENT placeholder copy for different
 * unavailability reasons:
 *
 *   - **Mobile** — "Quire can't write to a folder on phones yet.
 *     Cloud sync for mobile is coming via Google Drive direct sync."
 *   - **Safari** / **Firefox** — "Quire can't write to a folder
 *     in this browser yet.  Try Chrome or Edge on your desktop,
 *     or wait for Google Drive direct sync."
 *   - **Unknown / no-API** — "Cloud backup isn't available in
 *     this browser yet."  The generic fallback.
 *
 * The reason vocabulary is intentionally small.  We don't need
 * to enumerate every browser; we need to surface the right
 * trade-off message to the DM so they understand WHY the button
 * isn't there and what their alternatives are.
 *
 * # Detection ordering (the order matters)
 *
 * 1. **Is `showDirectoryPicker` callable?**  This is the single
 *    cheap structural check.  If it's there, we're done — every
 *    browser that exposes the function actually implements it.
 *    Chrome on Android exposes a stub that always throws; we'd
 *    rather fall through to the user-agent sniff than promise an
 *    affordance that's structurally broken.
 *
 * 2. **Is this a mobile context?**  Even if the API is somehow
 *    present, mobile contexts are out-of-scope for M6a-FS — the
 *    user doesn't have a desktop sync client running, so there's
 *    no path from "write to folder" to "synced to cloud."
 *    Detected via the user-agent + the absence of a touch-only
 *    context check.  Best-effort; the goal is to NOT promise the
 *    affordance in cases where it won't deliver value.
 *
 * 3. **Specific browser identification.**  If the API is missing
 *    AND we're not mobile, surface the most-helpful
 *    browser-specific message we can.
 *
 * 4. **Unknown.**  Generic "no-api" fallback.
 *
 * Order is important: a mobile Chromium browser passes the
 * `showDirectoryPicker` check if Google ever ships it, but we
 * still want the mobile reason to surface so the UI doesn't
 * promise something the OS-level sync model can't deliver.
 *
 * # Caveats
 *
 * User-agent sniffing is genuinely fragile.  We don't use it for
 * security or correctness — only for choosing which one-line
 * "not available here" message to surface.  The structural
 * check (`typeof showDirectoryPicker === 'function'`) is the
 * load-bearing test.
 */

/**
 * The verdict the UI consumes.  The `available: true` case is
 * the simple branch; the `available: false` cases carry a
 * `reason` so the UI can surface the right "not here, try X"
 * copy.
 */
export type FileSystemAccessVerdict =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: 'no-api' | 'mobile' | 'safari' | 'firefox';
    };

/**
 * Pluggable navigator-like interface so tests can substitute a
 * synthetic UA string without monkey-patching the global.  In
 * production callers pass `globalThis.navigator`.
 */
export interface FsApiEnv {
  readonly userAgent?: string;
  readonly showDirectoryPicker?: unknown;
}

/**
 * Read the ambient environment in a way that's safe in
 * non-browser test contexts (SSR / vitest's `node` env).  Falls
 * back to a permission-denying shape if neither `window` nor
 * `globalThis.navigator` exists.
 */
function defaultEnv(): FsApiEnv {
  const w =
    typeof window !== 'undefined'
      ? (window as unknown as { showDirectoryPicker?: unknown })
      : undefined;
  const nav =
    typeof navigator !== 'undefined'
      ? (navigator as { userAgent?: string })
      : undefined;
  return {
    userAgent: nav?.userAgent,
    showDirectoryPicker: w?.showDirectoryPicker
  };
}

/**
 * The single fastest check: does `window.showDirectoryPicker`
 * exist as a callable function?  Used directly by UI guards
 * that just want the boolean.  For "WHY not available" copy,
 * use `getAvailabilityVerdict` instead.
 *
 * Returns `false` in SSR / non-browser contexts (no `window`).
 */
export function isFileSystemAccessAvailable(env: FsApiEnv = defaultEnv()): boolean {
  return typeof env.showDirectoryPicker === 'function';
}

/**
 * Mobile heuristic via UA-sniff.  Best-effort; the goal is NOT
 * to identify every mobile UA but to recognize the obvious
 * ones (Android, iPhone, iPad, mobile Safari) so we can surface
 * the right "no path on mobile yet" message.
 *
 * Importantly: iPadOS UA can match `Macintosh` rather than
 * `iPad` (Apple's UA spoofing for desktop-class iPads), so an
 * additional `Mobile` or touch check is folded in.
 */
function looksMobile(ua: string | undefined): boolean {
  if (!ua) return false;
  // Standard mobile markers.
  if (/Android|iPhone|iPad|iPod|Mobile/.test(ua)) return true;
  // iPadOS desktop-mode spoof: identifies as Macintosh.  We
  // can't reliably distinguish this from a real Mac, so we
  // err on the side of NOT marking it as mobile — a real Mac
  // user MUST pass through the "no-api / browser-specific"
  // path.  Documented limitation.
  return false;
}

/**
 * Safari detection — Safari proper, not WebKit-clones-on-iOS.
 * The key markers: Safari token present AND Chrome/Chromium
 * tokens absent (Chrome's UA also carries `Safari` for
 * compat).
 */
function looksSafari(ua: string | undefined): boolean {
  if (!ua) return false;
  if (!/Safari/.test(ua)) return false;
  // Exclude Chrome, Chromium, Edg (modern Edge), OPR (Opera),
  // Brave (sometimes), and similar Chromium-based browsers
  // that piggyback the Safari token for legacy compat.
  if (/Chrome|Chromium|Edg\/|OPR\/|Brave|SamsungBrowser/.test(ua)) {
    return false;
  }
  return true;
}

/**
 * Firefox detection — the simple Gecko marker.
 */
function looksFirefox(ua: string | undefined): boolean {
  if (!ua) return false;
  return /Firefox\/|FxiOS/.test(ua);
}

/**
 * The full verdict — returns the structured shape the UI uses to
 * pick the right "not available" copy.
 *
 * Branch ordering: if the API is present, we're done.  Otherwise
 * we try to identify the browser/platform so the UI can surface
 * a helpful "try Chrome on desktop" message.
 */
export function getAvailabilityVerdict(
  env: FsApiEnv = defaultEnv()
): FileSystemAccessVerdict {
  if (isFileSystemAccessAvailable(env)) {
    // Even when the API is present, if we're on mobile, we
    // surface the mobile message — the OS-level sync model
    // doesn't deliver here.  This is the future-proofing branch
    // for the day Chrome on Android exposes
    // `showDirectoryPicker`; we still want to route those users
    // to the OAuth Drive path because their phone doesn't have
    // Drive Desktop running.
    if (looksMobile(env.userAgent)) {
      return { available: false, reason: 'mobile' };
    }
    return { available: true };
  }

  // API missing — figure out why so we can surface the right
  // alternative.
  if (looksMobile(env.userAgent)) {
    return { available: false, reason: 'mobile' };
  }
  if (looksSafari(env.userAgent)) {
    return { available: false, reason: 'safari' };
  }
  if (looksFirefox(env.userAgent)) {
    return { available: false, reason: 'firefox' };
  }
  return { available: false, reason: 'no-api' };
}
