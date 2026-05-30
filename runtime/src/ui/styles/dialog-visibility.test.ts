// @vitest-environment node
/**
 * Dialog-visibility regression test.
 *
 * Three light-DOM custom-element dialogs (<cloud-push-consent-dialog>,
 * <start-fresh-confirm-dialog>, <pc-revoke-confirm-dialog>) each
 * render a `*-backdrop` + `*-dialog` class pair into the host's
 * light DOM.  Because they don't use the native <dialog> element,
 * they DEPEND on host CSS to position themselves above the rest of
 * the page — without it the backdrop has `position: static`, no
 * z-index, no centered child, and the user sees nothing happen when
 * the affordance fires.
 *
 * History: shipped run #5/#6 (cloud-consent), run #17 (start-fresh)
 * and run #18 (pc-revoke) with NO matching CSS.  Unit tests
 * asserted the dialog DOM existed + Cancel button got autofocus,
 * but ZERO test asserted the dialog was actually visible on a real
 * page.  User hit the start-fresh case in playtest dry-run — the
 * button "had no effect" because the dialog rendered behind / off
 * the visible viewport.
 *
 * This is a static text check on `quire-app.css.ts` because it runs
 * everywhere, can't false-pass under happy-dom's partial style
 * resolution, and surfaces the bug at PR time without needing a
 * full browser.
 *
 * If you ADD a new light-DOM confirm-dialog element, append its
 * backdrop class name to LIGHT_DOM_DIALOG_BACKDROPS below.  The
 * test will fail until you also add a `position: fixed` rule for
 * the class to `quire-app.css.ts`.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CSS_PATH = path.join(HERE, 'quire-app.css.ts');

/**
 * Classes the runtime renders as the OUTER wrapper of a custom
 * confirm-dialog element.  The class names must each appear in the
 * stylesheet as a selector with a `position: fixed` declaration,
 * otherwise the dialog renders invisibly.
 */
const LIGHT_DOM_DIALOG_BACKDROPS = [
  'cloud-consent-backdrop',
  'start-fresh-backdrop',
  'pc-revoke-backdrop'
] as const;

/**
 * Classes the runtime renders as the INNER dialog body.  These must
 * each appear in the stylesheet (with any declaration block; the
 * test asserts coverage, not specific properties) so the dialog has
 * a background + padding + border instead of unstyled HTML.
 */
const LIGHT_DOM_DIALOG_BODIES = [
  'cloud-consent-dialog',
  'start-fresh-dialog',
  'pc-revoke-dialog'
] as const;

/**
 * Return the body of every CSS rule whose selector list contains
 * the given class name (matched as `.classname` followed by a non-
 * identifier char).  Crude but sufficient for our hand-authored
 * stylesheet; we don't ship a real CSS parser to test time.
 */
function rulesContaining(css: string, className: string): string[] {
  const bodies: string[] = [];
  const needle = `.${className}`;
  let i = 0;
  while (i < css.length) {
    const hit = css.indexOf(needle, i);
    if (hit < 0) break;
    // Reject identifier-prefix collisions: `.start-fresh-backdrop`
    // must not match `.start-fresh-backdrop-foo`.
    const after = css.charCodeAt(hit + needle.length);
    const isIdentCont =
      (after >= 0x30 && after <= 0x39) || // 0-9
      (after >= 0x41 && after <= 0x5a) || // A-Z
      (after >= 0x61 && after <= 0x7a) || // a-z
      after === 0x2d || // -
      after === 0x5f; // _
    if (isIdentCont) {
      i = hit + needle.length;
      continue;
    }
    // Walk forward to the next `{` then capture until the matching
    // `}` at brace-depth 0.  Selectors with commas are fine — we
    // start at the class, but the rule body is whatever is between
    // the first { and its closing }.
    const openBrace = css.indexOf('{', hit);
    if (openBrace < 0) break;
    let depth = 1;
    let j = openBrace + 1;
    while (j < css.length && depth > 0) {
      const ch = css[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    bodies.push(css.slice(openBrace + 1, j - 1));
    i = j;
  }
  return bodies;
}

describe('light-DOM confirm-dialogs are visible (host CSS exists)', () => {
  const cssSource = readFileSync(CSS_PATH, 'utf8');

  for (const cls of LIGHT_DOM_DIALOG_BACKDROPS) {
    it(`.${cls} has a rule with position: fixed`, () => {
      const bodies = rulesContaining(cssSource, cls);
      expect(
        bodies.length,
        `No CSS rule found for .${cls} in quire-app.css.ts. ` +
          `The <${cls.replace('-backdrop', '-dialog')}> custom element ` +
          `renders this class into light DOM and depends on host CSS ` +
          `to make it visible.`
      ).toBeGreaterThan(0);
      const hasFixed = bodies.some((b) => /position:\s*fixed/i.test(b));
      expect(
        hasFixed,
        `.${cls} has CSS rules but none declares position: fixed. ` +
          `Without it the backdrop renders in normal document flow ` +
          `and the dialog will not appear above page content.`
      ).toBe(true);
    });
  }

  for (const cls of LIGHT_DOM_DIALOG_BODIES) {
    it(`.${cls} has at least one rule`, () => {
      const bodies = rulesContaining(cssSource, cls);
      expect(
        bodies.length,
        `No CSS rule found for .${cls} in quire-app.css.ts. ` +
          `Without dialog chrome rules the dialog renders as ` +
          `unstyled HTML even if the backdrop is positioned.`
      ).toBeGreaterThan(0);
    });
  }
});
