# Visual / Interaction Design — resizable region-divider pattern (UX-MH-4)

**Briefed reads:** `ux-must-haves.md` (UX-MH-4 verbatim),
`runtime/src/ui/shell/quire-shell.ts`,
`runtime/src/ui/styles/quire-app.css.ts`,
`lessons-learned.md` (LL-3 slot-distribution trap),
`runtime/src/quire-app.ts:1842-1855` (current shell wiring).

## Verdict — 2 sentences

Extend `<quire-shell>` to a 7-column grid with two named slots
(`splitter-rail`, `splitter-aside`) that the host fills with
`<button>` handles — this dodges LL-3 (unslotted children don't
lay out) and keeps the grid as the single source of truth, which
absolute-overlay handles cannot do mid-drag. Modal-resize stretch
should be deferred: the resize chrome is trivial but the modal-
internal forms assume fixed widths and would not breathe.

## DOM shape + slot strategy

**Pick: extend the shell to 7 columns; add two named slots.**

Rejected: absolute-overlay handles drift against the grid during
drag (two systems of truth — JS `left:` and CSS-var width — race
on scrollbar-appear and sub-pixel reflow). Rejected: `::part`
style escape doesn't give the host a DOM node for pointer-capture
without leaking a shell-internal ref.

**Shell template (shadow DOM):**

```
grid-template-areas:
  'topbar  topbar  topbar  topbar  topbar'
  'rail    splitR  stage   splitA  aside'
  'dock    dock    dock    dock    dock';
grid-template-columns:
  var(--rail-w,  clamp(260px, 28ch, 320px))
  6px
  minmax(0, 1fr)
  6px
  var(--aside-w, clamp(280px, 30ch, 340px));
```

6 px is the hit-target gutter; the visible rule inside is 1-2 px
(see Visual States). Shell declares `<slot name="splitter-rail">`
and `<slot name="splitter-aside">` inside the gutter areas.

**Host wires the handles** (LL-3 mitigation — these are real
named slots, browser distributes and lays out):

```html
<quire-shell>
  ...existing slots...
  <button slot="splitter-rail"  class="region-splitter" data-axis="rail"></button>
  <button slot="splitter-aside" class="region-splitter" data-axis="aside"></button>
</quire-shell>
```

Host updates `--rail-w` / `--aside-w` as inline style on the
shell during `pointermove`. First paint before any JS = today's
behavior via the `clamp()` fallback.

## Visual states

6 px hit target; 1-2 px visible rule painted via inset shadow so
the box never resizes (drag math would skew).

```
idle      region │ region    1 px hairline, alpha ~0.35
hover     region │█│ region   2 px rule, accent-teal, alpha 1.0
dragging  region │█│ region   + optional 1 px full-height guide
focused   region │█│ region   inherits *:focus-visible ring
at-limit  region │‖│ region   caret glyph points the still-movable way
```

Don't disable at-limit — keyboard users lose the tab-stop reference.

```css
.region-splitter {
  background: transparent; border: 0; padding: 0;
  cursor: col-resize;
  box-shadow: inset 1px 0 0 0
    light-dark(rgba(15,23,42,0.10), rgba(226,232,240,0.10));
  transition: box-shadow var(--motion-hover);
}
.region-splitter:hover,
.region-splitter:focus-visible,
.region-splitter[data-dragging] {
  box-shadow: inset 2px 0 0 0 var(--accent-teal);
}
```

## Behavior spec

| Region | Min | Max | Why |
|---|---|---|---|
| Rail  | 240 px | 480 px | Min = PC-sheet chip row legible. Max = stage ≥ 600 px on a 1440 viewport. |
| Aside | 280 px | 560 px | Min = roster row + chat byline single-line. User's "very narrow" complaint suggests they'll often pull to 400+. |
| Stage | derived | derived | Always `minmax(0, 1fr)` — absorbs only. |

**Keyboard step.** 16 px per Arrow; 64 px per Shift+Arrow. Small
enough that one press is distinguishable from two; large enough
not to require keystroke spam to cross the range.

**Reset to default.** Double-click on the handle. Enter / Space
for keyboard parity (no double-click gesture on keyboard). No
right-click menu — we have zero other custom context menus, not
worth introducing one. Surface discoverability via `title` /
`aria-description`: "Drag to resize. Double-click to reset."

**Viewport shrink past `rail-min + ~400 + aside-min`.** Squeeze
the stage first (`minmax(0, 1fr)` permits it). Below 1100 px the
existing media query hides the Aside; the user is outside the
designed viewport. Saved widths persist; on re-widen they
re-apply. Store user's value verbatim; clamp ONLY at render-time
via the `clamp()` wrapping `var()` — never write a clamped value
back.

## A11y spec

```html
<button role="separator" aria-orientation="vertical"
        aria-controls="region-rail region-stage"
        aria-valuemin="240" aria-valuemax="480" aria-valuenow="320"
        aria-label="Resize sidebar" tabindex="0"></button>
```

Shell slot containers get `id="region-rail|stage|aside"`;
`aria-controls` resolves into the shadow root in modern browsers.

**Keyboard:** Arrow ±16, Shift+Arrow ±64, Home/End snap to
min/max, Enter/Space reset.

**Screen reader.** Silent during pointer-drag (announcing every
pixel is abusive). `aria-valuenow` updates per keyboard step
(each IS a discrete user gesture) and once on `pointerup` for
mouse drags.

## Persistence schema

Key: `quire.layout.<campaignSlug>` (matches `quire.save.<owner>-<repo>`
convention; slug already threaded via
`currentCampaignSlugForPersistence()`).

```json
{
  "v": 1,
  "shell": { "rail": "320px", "aside": "380px" }
}
```

Forward-compat:
- `v` mandatory; unknown `v` falls back to defaults (no throw).
- Widths are CSS length strings (not numbers) so future units
  (`ch`, `%`, `fr`) need no migration.
- `shell` namespace leaves room for `modal: {…}` (stretch) and
  future tabbed-region splits without breaking v1 readers.
- Readers clamp at load to current `[min, viewport - other-mins]`
  — but write user's verbatim choice, not the clamped value.

## Modal-resize stretch — defer

The native chrome is ~1 h (`<dialog>` + `resize: both` +
`overflow: auto`). The real cost is the modal-internal forms:
`grid-template-columns: minmax(7rem, auto) 1fr` (css.ts:185,
:219), pinset `auto 1fr 2fr` (:905), fixed-width textareas across
retire / revise / quickgen. Making the dialog wider while the
form stays 16 rem wide is the embarrassment outcome. Real cost:
1 h chrome + 4-6 h per modal to convert to `auto-flow` / subgrid
patterns that breathe.

Per user "less important and can be deprioritized if too
disruptive" — this qualifies. Park as UX-MH-4-stretch; revisit
after the splitter ships and see whether the underlying "aside
too narrow" complaint persists once the shell-level fix is live.

## Adversarial corners

1. **Pointer-capture loss.** `setPointerCapture` is mandatory;
   without it a fast drag past the window edge orphans the drag
   state. On `pointercancel` (DevTools, blur, touch interrupt)
   release capture and commit the last valid width.
2. **Safari pointer-cancel aggression.** Also listen for `blur`
   on the handle and `document.visibilitychange`; treat as
   "commit and release."
3. **Scrollbar appearance shifts Aside content width** by ~15 px
   on classic scrollbars. Accept; if it surfaces as a complaint,
   add `scrollbar-gutter: stable` on `.area-aside`.
4. **Touch hit target** (6 px) is below WCAG 2.5.5. Under
   `@media (pointer: coarse)` widen the hit gutter to 24 px;
   visible rule unchanged. Desktop-first is the stated posture
   but this keeps tablets non-broken.
5. **Persisted value > viewport after resize.** Clamp at
   render-time only (CSS `clamp()` around `var()`); never
   overwrite the stored value. User widens window → original
   intent returns.
6. **`@media (max-width: 1100px)` collapse.** Aside slot and
   its splitter-aside slot both disappear naturally with the
   grid area; reappear with the saved width on re-widen.

## Open product calls

1. **Aside default.** Current `clamp(280px, 30ch, 340px)` may
   itself be the bug behind the user's "very narrow" complaint.
   Recommend bumping default to 380 px; keeps the splitter as
   polish rather than the only fix.
2. **"Reset all panel widths" escape valve** for the hosed-both-
   panels case — surface in the DM operational view "Layout"
   subsection (parity with where Start fresh lives). Per-handle
   double-click covers the common path; this is a minor backup.
