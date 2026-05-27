/**
 * WRAP-LAZY (2026-05-27 holistic-review): barrel module that
 * pulls every region used by the wrap-mode + open-mode workflow
 * into a single lazy chunk.  QuireApp's session-subscriber
 * dynamic-imports this barrel the first time `appMode` is
 * `'session-wrap-marks'` or `'session-open'`; before then, the
 * regions live in their own chunk and don't ship in the main
 * bundle.
 *
 * Per the post-D3 holistic-review architecture punch list:
 * "Five wrap-direction regions ~25 KB ONLY a DM-coord in
 * wrap/open mode ever touches.  Predicted ~25 KB main shrink."
 *
 * Side-effect imports register the custom elements at chunk-load
 * time; the host renders them by tag name (`<wrap-stepper>`
 * etc.) so no value-import gymnastics are needed.  The one
 * exception is `buildWrapMarksEntries` — a pure helper that the
 * host calls — re-exported here so the host's lazy code-path
 * picks it up alongside the regions.
 */

import './session-wrap-marks';
import './session-digest';
import './wrap-stepper';
import './diff-review-stage';
import './session-open-stage';

export { buildWrapMarksEntries } from './session-wrap-marks';
