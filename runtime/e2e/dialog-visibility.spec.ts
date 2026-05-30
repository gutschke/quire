/**
 * Real-browser dialog-visibility regression.
 *
 * History (LL-3): the three custom-element confirm-dialogs
 * (<cloud-push-consent-dialog>, <start-fresh-confirm-dialog>,
 * <pc-revoke-confirm-dialog>) shipped in three different runs each
 * with a different flavor of "the test passed but the user couldn't
 * see the dialog":
 *
 *  c20702f (run #18 hotfix v1): added CSS rules for the `*-backdrop`
 *    + `*-dialog` class names — happy-dom unit tests asserted DOM
 *    structure but never asserted visibility.  CSS shipped, dialog
 *    still invisible.
 *
 *  d5d1a9c (run #18 hotfix v2): root cause was <quire-shell> only
 *    declared NAMED slots; the dialogs were authored as children of
 *    <quire-shell> with no slot= attribute, so they sat in light DOM
 *    but were never distributed to any slot.  rect was 0×0 even with
 *    position: fixed; inset: 0.  Moved out as siblings of
 *    <quire-shell> so position: fixed escapes to viewport.
 *
 * The static-text test in src/ui/styles/dialog-visibility.test.ts
 * catches the CSS-rule-missing flavor.  This spec catches the
 * runtime-layout flavor by actually loading the runtime in
 * Chromium, opening each dialog programmatically, and asserting
 * the backdrop's bounding rect fills the viewport.
 *
 * Why "open programmatically": the dialogs need their host's
 * `open(spec)` method called — that's the production path for
 * mounting them.  We don't need to drive the full resume-prompt
 * UX (autosave seeding, navigation, button click chain); the
 * visibility property is about how the dialog renders ONCE its
 * open() returns, not about whether the routing fires.  Routing
 * is asserted by mock-campaign tests at the engine layer.
 *
 * If a future custom-element confirm-dialog is added, register its
 * element tag name in DIALOGS_TO_PROBE below.
 */

import { test, expect, type Page } from '@playwright/test';

const DIALOGS_TO_PROBE: Array<{
  tag: string;
  spec: object;
  backdropClass: string;
  dialogClass: string;
}> = [
  {
    tag: 'start-fresh-confirm-dialog',
    spec: {
      campaignName: 'Visibility Test',
      campaignSlug: 'test/visibility',
      eventCount: 5,
      variant: 'destructive'
    },
    backdropClass: 'start-fresh-backdrop',
    dialogClass: 'start-fresh-dialog'
  },
  {
    tag: 'cloud-push-consent-dialog',
    spec: {
      title: 'Test consent',
      body: ['paragraph one', 'paragraph two'],
      cancelLabel: 'Cancel',
      acknowledgeLabel: 'OK'
    },
    backdropClass: 'cloud-consent-backdrop',
    dialogClass: 'cloud-consent-dialog'
  },
  // Run #19 (2026-05-30, R-J): pc-revoke dialog probe per synthesis
  // doc lives in `pc-revoke-dialog-visibility.spec.ts` — that
  // dialog is a child of <dm-operational-view> which is gated on
  // appMode; the bare probe pattern here would fail because the
  // dialog isn't in the DOM at page-load time.  Kept as a comment
  // here so future maintainers see the cross-reference.
];

async function probeDialog(
  page: Page,
  tag: string,
  spec: object,
  backdropClass: string,
  dialogClass: string
): Promise<{
  backdrop: { w: number; h: number };
  dialog: { w: number; h: number } | null;
  viewport: { w: number; h: number };
}> {
  return page.evaluate(
    async ({ tag, spec, backdropClass, dialogClass }) => {
      const app = document.querySelector('quire-app') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const sr = app.shadowRoot;
      // The dialog MUST be reachable from the QuireApp shadow root —
      // if it isn't, the test's failure mode is the slot-distribution
      // bug from d5d1a9c (the dialog was a child of <quire-shell>
      // without a slot= attribute and therefore not in any rendered
      // tree).
      const dlg = sr.querySelector(tag) as (HTMLElement & {
        open?: (s: object) => Promise<unknown>;
      }) | null;
      if (!dlg) throw new Error(`${tag} not found in quire-app shadow root`);
      if (typeof dlg.open !== 'function') {
        throw new Error(`${tag} has no open() method`);
      }
      // Fire-and-forget the open promise.
      void dlg.open(spec);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Give Lit one extra microtask in case of update queuing.
      await new Promise((r) => setTimeout(r, 50));
      const backdrop = dlg.querySelector(`.${backdropClass}`) as HTMLElement | null;
      if (!backdrop) {
        throw new Error(
          `${tag}: .${backdropClass} not rendered after open() (` +
            `dialog.isOpen probably false, or template returned nothing)`
        );
      }
      const dialogEl = backdrop.querySelector(`.${dialogClass}`) as HTMLElement | null;
      const br = backdrop.getBoundingClientRect();
      const dr = dialogEl ? dialogEl.getBoundingClientRect() : null;
      return {
        backdrop: { w: br.width, h: br.height },
        dialog: dr ? { w: dr.width, h: dr.height } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight }
      };
    },
    { tag, spec, backdropClass, dialogClass }
  );
}

test.describe('confirm-dialog visibility in a real browser', () => {
  test.beforeEach(async ({ page }) => {
    // No campaign, no broker, no autosave seeding — we just need the
    // app shell to mount so the dialog custom elements exist.  Use a
    // benign about:blank-ish URL on the dev server.
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    // Wait a tick for QuireApp's initial render to settle so all four
    // overlay siblings (<quire-help-overlay>, the three confirm-
    // dialogs) are present in the shadow root.
    await page.waitForTimeout(300);
  });

  for (const { tag, spec, backdropClass, dialogClass } of DIALOGS_TO_PROBE) {
    test(`<${tag}> backdrop fills the viewport after open()`, async ({ page }) => {
      const probe = await probeDialog(page, tag, spec, backdropClass, dialogClass);

      // The backdrop must fill (or nearly fill) the viewport.  We
      // accept anything ≥95% to tolerate sub-pixel rounding /
      // scrollbar gutters.  The historical failure was 0×0, so a
      // ≥95% threshold is generous and still catches it.
      expect(
        probe.backdrop.w,
        `${tag}: backdrop width ${probe.backdrop.w} should fill viewport ${probe.viewport.w}.`
      ).toBeGreaterThanOrEqual(probe.viewport.w * 0.95);
      expect(
        probe.backdrop.h,
        `${tag}: backdrop height ${probe.backdrop.h} should fill viewport ${probe.viewport.h}.`
      ).toBeGreaterThanOrEqual(probe.viewport.h * 0.95);

      // The inner dialog must have non-zero dimensions — without this
      // check, a 0×0 dialog inside a full-viewport backdrop would
      // still pass the backdrop assertion above.
      expect(probe.dialog, `${tag}: .${dialogClass} did not render`).not.toBeNull();
      expect(probe.dialog!.w, `${tag}: dialog width should be > 0`).toBeGreaterThan(100);
      expect(probe.dialog!.h, `${tag}: dialog height should be > 0`).toBeGreaterThan(50);
    });
  }
});
