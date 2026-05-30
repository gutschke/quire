/**
 * Run #19 (2026-05-30) — UX-MH-4 splitter controller.
 *
 * Drives the `--rail-w` / `--aside-w` CSS custom properties on a
 * `<quire-shell>` host based on user drag / keyboard / reset input
 * on the two splitter handles.  Persists the user's last value to
 * localStorage per-campaign.
 *
 * Per visual-splitter-pattern-2026-05-30.md spec:
 *
 *  - Bounds: Rail 240-480 px, Aside 280-560 px.
 *  - Keyboard step: 16 px (Arrow), 64 px (Shift+Arrow), Home/End
 *    snap to min/max, Enter/Space reset to default.
 *  - Double-click reset.
 *  - Pointer-capture during drag; release on `pointerup` +
 *    `pointercancel` + `blur` + `visibilitychange === 'hidden'`
 *    (Safari pointercancel aggression — adversarial corner #2).
 *  - Persistence schema:
 *      key `quire.layout.<campaignSlug>` →
 *        `{"v":1,"shell":{"rail":"320px","aside":"380px"}}`
 *    Bounds-clamp on read (silent fallback to default on
 *    out-of-range / NaN / non-finite — addresses Adversarial P2
 *    MH-4-A localStorage corruption).
 *  - Full ARIA separator pattern set on the handles.
 *
 * The controller is plain JS — no Lit, no decorators — so it can
 * mount once on the host element and own the small pile of drag
 * state without cluttering quire-app.ts.
 */

export interface SplitterAxis {
  /** Which CSS variable on the host to set. */
  cssVar: '--rail-w' | '--aside-w';
  /** Min width in px. */
  min: number;
  /** Max width in px. */
  max: number;
  /** Default width in px when no saved value or saved value out-of-range. */
  defaultPx: number;
}

export const RAIL_AXIS: SplitterAxis = {
  cssVar: '--rail-w',
  min: 240,
  max: 480,
  defaultPx: 320
};

export const ASIDE_AXIS: SplitterAxis = {
  cssVar: '--aside-w',
  min: 280,
  max: 560,
  defaultPx: 380
};

interface PersistedLayoutV1 {
  v: 1;
  shell: { rail?: string; aside?: string };
}

const KEYBOARD_STEP = 16;
const KEYBOARD_STEP_LARGE = 64;

/**
 * Parse a CSS length string like "320px" → 320.  Returns null for
 * non-finite / non-numeric / non-pixel values.  Per Adversarial P2:
 * silent fallback to default; never throw.
 */
function parsePxLength(s: unknown): number | null {
  if (typeof s !== 'string') return null;
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*px\s*$/.exec(s);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Clamp a value to `[axis.min, axis.max]`.  Falls back to
 * axis.defaultPx when input is null / non-finite.
 */
function clampToAxis(value: number | null, axis: SplitterAxis): number {
  if (value === null || !Number.isFinite(value)) return axis.defaultPx;
  if (value < axis.min) return axis.min;
  if (value > axis.max) return axis.max;
  return value;
}

/**
 * Read persisted layout for a campaign slug.  Returns `null` when
 * no entry exists OR when the stored value is structurally bogus.
 * Clamps each axis at read-time (per visual designer spec); writes
 * the user's verbatim value (never clamped).
 */
export function readPersistedLayout(
  storage: Storage,
  campaignSlug: string
): { rail: number; aside: number } | null {
  if (campaignSlug.length === 0) return null;
  const raw = storage.getItem(`quire.layout.${campaignSlug}`);
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Partial<PersistedLayoutV1>;
  if (p.v !== 1) return null;
  const shell = p.shell;
  if (!shell || typeof shell !== 'object') return null;
  const rail = clampToAxis(parsePxLength(shell.rail), RAIL_AXIS);
  const aside = clampToAxis(parsePxLength(shell.aside), ASIDE_AXIS);
  return { rail, aside };
}

/**
 * Persist the user's verbatim layout values (no clamp on write).
 */
export function writePersistedLayout(
  storage: Storage,
  campaignSlug: string,
  rail: number,
  aside: number
): void {
  if (campaignSlug.length === 0) return;
  const doc: PersistedLayoutV1 = {
    v: 1,
    shell: { rail: `${rail}px`, aside: `${aside}px` }
  };
  storage.setItem(`quire.layout.${campaignSlug}`, JSON.stringify(doc));
}

/**
 * Clear the persisted layout for a campaign — invoked by the DM
 * operational view's "Reset all panel widths" affordance.
 */
export function clearPersistedLayout(
  storage: Storage,
  campaignSlug: string
): void {
  if (campaignSlug.length === 0) return;
  storage.removeItem(`quire.layout.${campaignSlug}`);
}

export interface SplitterControllerOptions {
  /** The `<quire-shell>` host whose CSS variables we set. */
  host: HTMLElement;
  /** Storage object for persistence (defaults to localStorage). */
  storage?: Storage;
  /** Get the current campaign slug; null when no campaign loaded. */
  getCampaignSlug: () => string | null;
}

export class SplitterController {
  private host: HTMLElement;
  private storage: Storage;
  private getCampaignSlug: () => string | null;
  private rail = RAIL_AXIS.defaultPx;
  private aside = ASIDE_AXIS.defaultPx;
  /** Per-handle pointer-capture state. */
  private dragging: 'rail' | 'aside' | null = null;
  private dragStartX = 0;
  private dragStartWidth = 0;

  constructor(opts: SplitterControllerOptions) {
    this.host = opts.host;
    this.storage = opts.storage ?? localStorage;
    this.getCampaignSlug = opts.getCampaignSlug;
  }

  /**
   * Read persisted widths for the current campaign + apply.  Idempotent
   * — re-call after a campaign change to load that campaign's widths.
   */
  loadForCurrentCampaign(): void {
    const slug = this.getCampaignSlug();
    if (slug === null) {
      this.rail = RAIL_AXIS.defaultPx;
      this.aside = ASIDE_AXIS.defaultPx;
    } else {
      const persisted = readPersistedLayout(this.storage, slug);
      if (persisted) {
        this.rail = persisted.rail;
        this.aside = persisted.aside;
      } else {
        this.rail = RAIL_AXIS.defaultPx;
        this.aside = ASIDE_AXIS.defaultPx;
      }
    }
    this.applyToHost();
  }

  /** Current rail width in px. */
  getRailWidth(): number {
    return this.rail;
  }

  /** Current aside width in px. */
  getAsideWidth(): number {
    return this.aside;
  }

  /** Write the current widths to the host's CSS variables. */
  private applyToHost(): void {
    this.host.style.setProperty(RAIL_AXIS.cssVar, `${this.rail}px`);
    this.host.style.setProperty(ASIDE_AXIS.cssVar, `${this.aside}px`);
  }

  /** Save the current widths to localStorage for the active campaign. */
  private persist(): void {
    const slug = this.getCampaignSlug();
    if (slug === null) return;
    writePersistedLayout(this.storage, slug, this.rail, this.aside);
  }

  /** Reset the named axis to its default + persist + re-apply. */
  resetAxis(which: 'rail' | 'aside'): void {
    if (which === 'rail') this.rail = RAIL_AXIS.defaultPx;
    else this.aside = ASIDE_AXIS.defaultPx;
    this.applyToHost();
    this.persist();
  }

  /** Reset BOTH axes (the DM operational view's affordance). */
  resetAll(): void {
    this.rail = RAIL_AXIS.defaultPx;
    this.aside = ASIDE_AXIS.defaultPx;
    this.applyToHost();
    const slug = this.getCampaignSlug();
    if (slug !== null) clearPersistedLayout(this.storage, slug);
  }

  /** Set an axis to an absolute width (clamped to bounds). */
  setAxisWidth(which: 'rail' | 'aside', px: number): void {
    const axis = which === 'rail' ? RAIL_AXIS : ASIDE_AXIS;
    const clamped = clampToAxis(px, axis);
    if (which === 'rail') this.rail = clamped;
    else this.aside = clamped;
    this.applyToHost();
  }

  /** Keyboard handler — Arrow / Shift+Arrow / Home / End / Enter / Space. */
  handleKeydown(which: 'rail' | 'aside', e: KeyboardEvent): boolean {
    const axis = which === 'rail' ? RAIL_AXIS : ASIDE_AXIS;
    const current = which === 'rail' ? this.rail : this.aside;
    let next: number | null = null;
    switch (e.key) {
      case 'ArrowLeft':
        next = current - (e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP);
        break;
      case 'ArrowRight':
        next = current + (e.shiftKey ? KEYBOARD_STEP_LARGE : KEYBOARD_STEP);
        break;
      case 'Home':
        next = axis.min;
        break;
      case 'End':
        next = axis.max;
        break;
      case 'Enter':
      case ' ':
      case 'Spacebar':
        next = axis.defaultPx;
        break;
      default:
        return false;
    }
    e.preventDefault();
    this.setAxisWidth(which, next);
    this.persist();
    return true;
  }

  /** Begin a pointer drag on the named axis. */
  beginDrag(which: 'rail' | 'aside', e: PointerEvent, handle: Element): void {
    this.dragging = which;
    this.dragStartX = e.clientX;
    this.dragStartWidth = which === 'rail' ? this.rail : this.aside;
    if ('setPointerCapture' in handle) {
      try {
        (handle as Element & { setPointerCapture(id: number): void }).setPointerCapture(
          e.pointerId
        );
      } catch {
        // Some happy-dom shims lack setPointerCapture; ignore.
      }
    }
    handle.setAttribute('data-dragging', 'true');
  }

  /** Pointer move during a drag. */
  handlePointerMove(e: PointerEvent): void {
    if (this.dragging === null) return;
    const delta = e.clientX - this.dragStartX;
    // Rail grows when dragged RIGHT; Aside grows when dragged LEFT.
    const rawWidth =
      this.dragging === 'rail'
        ? this.dragStartWidth + delta
        : this.dragStartWidth - delta;
    this.setAxisWidth(this.dragging, rawWidth);
  }

  /** End the active drag (pointer up / cancel / blur / visibilitychange). */
  endDrag(handle?: Element): void {
    if (this.dragging === null) return;
    if (handle) handle.removeAttribute('data-dragging');
    this.dragging = null;
    this.persist();
  }

  /** True if a drag is in flight (test helper). */
  isDragging(): boolean {
    return this.dragging !== null;
  }
}
