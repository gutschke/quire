/**
 * Real-browser probe — pc-revoke dialog visibility (R-J, run #19).
 *
 * The dialog lives as a slotted child of `<dm-operational-view>`,
 * which is gated on `appMode === 'dm-operational'`.  Sibling-dialog
 * probes in `dialog-visibility.spec.ts` can't reach this dialog at
 * page-load time because dm-operational-view isn't in the DOM yet.
 *
 * This spec mounts the dialog standalone in a fresh document so we
 * exercise the same `open(spec)` API the production path uses, with
 * the same visibility assertion (backdrop fills the viewport).
 * Matches the d5d1a9c Playwright probe pattern.
 */

import { test, expect } from '@playwright/test';

test.describe('pc-revoke-confirm-dialog visibility (Run #19 R-J)', () => {
  test('backdrop fills the viewport after open()', async ({ page }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      // Import the dialog module so the custom element is defined.
      await import('/src/ui/regions/pc-revoke-confirm-dialog.ts');
      const el = document.createElement(
        'pc-revoke-confirm-dialog'
      ) as HTMLElement & {
        open: (s: object) => Promise<unknown>;
      };
      document.body.appendChild(el);
      void el.open({
        slot: 1,
        pcId: 'mei',
        pcDisplayName: 'Mei',
        inboundBondSourceDisplayNames: [],
        availableNpcs: [],
        variant: 'remove-player'
      });
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => setTimeout(r, 50));
      const backdrop = el.querySelector(
        '.pc-revoke-backdrop'
      ) as HTMLElement | null;
      if (!backdrop) {
        return { error: 'no backdrop' as const };
      }
      const dialog = backdrop.querySelector(
        '.pc-revoke-dialog'
      ) as HTMLElement | null;
      const br = backdrop.getBoundingClientRect();
      const dr = dialog ? dialog.getBoundingClientRect() : null;
      return {
        backdrop: { w: br.width, h: br.height },
        dialog: dr ? { w: dr.width, h: dr.height } : null,
        viewport: { w: window.innerWidth, h: window.innerHeight }
      };
    });
    if ('error' in result) {
      throw new Error(`pc-revoke probe: ${result.error}`);
    }
    expect(
      result.backdrop.w,
      'pc-revoke backdrop width should fill viewport'
    ).toBeGreaterThanOrEqual(result.viewport.w * 0.95);
    expect(
      result.backdrop.h,
      'pc-revoke backdrop height should fill viewport'
    ).toBeGreaterThanOrEqual(result.viewport.h * 0.95);
    expect(result.dialog).not.toBeNull();
    expect(result.dialog!.w).toBeGreaterThan(0);
    expect(result.dialog!.h).toBeGreaterThan(0);
  });
});
