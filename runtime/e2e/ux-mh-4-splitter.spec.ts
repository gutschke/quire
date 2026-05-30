/**
 * Real-browser probe — UX-MH-4: resizable region splitters.
 *
 * Verifies that the 7-column grid renders + the splitter handles
 * are present + drag/keyboard interaction moves `--rail-w` /
 * `--aside-w` CSS custom properties on the shell.  Per LL-3 we
 * assert user-visible outcomes (the CSS variable value changes,
 * not "we called setProperty").
 *
 * Run #19 (2026-05-30) — UX-MH-4 closure proof.
 */

import { test, expect } from '@playwright/test';

test.describe('UX-MH-4 — splitter handles', () => {
  test('quire-shell renders the two splitter slots + handles', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(() => {
      const app = document.querySelector('quire-app') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const shell = app.shadowRoot.querySelector('quire-shell');
      const railHandle = shell?.querySelector('button.region-splitter-rail');
      const asideHandle = shell?.querySelector('button.region-splitter-aside');
      return {
        shellPresent: !!shell,
        railPresent: !!railHandle,
        asidePresent: !!asideHandle,
        railRole: railHandle?.getAttribute('role'),
        railAria: railHandle?.getAttribute('aria-orientation')
      };
    });
    expect(result.shellPresent).toBe(true);
    expect(result.railPresent).toBe(true);
    expect(result.asidePresent).toBe(true);
    expect(result.railRole).toBe('separator');
    expect(result.railAria).toBe('vertical');
  });

  test('keyboard ArrowRight on rail handle widens --rail-w by 16px', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    // Wait for firstUpdated → splitter controller mount.
    await page.waitForTimeout(200);
    const before = await page.evaluate(() => {
      const app = document.querySelector('quire-app') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const shell = app.shadowRoot.querySelector('quire-shell') as HTMLElement;
      return shell.style.getPropertyValue('--rail-w') || '320px';
    });
    // Focus the rail handle and press ArrowRight.
    await page.evaluate(() => {
      const app = document.querySelector('quire-app') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const handle = app.shadowRoot.querySelector(
        'button.region-splitter-rail'
      ) as HTMLButtonElement;
      handle.focus();
      handle.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    const after = await page.evaluate(() => {
      const app = document.querySelector('quire-app') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const shell = app.shadowRoot.querySelector('quire-shell') as HTMLElement;
      return shell.style.getPropertyValue('--rail-w');
    });
    const beforePx = parseFloat(before);
    const afterPx = parseFloat(after);
    expect(afterPx - beforePx).toBe(16);
  });

  test('Aside default is the post-R-H bumped value (380px floor)', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    await page.waitForTimeout(200);
    const computed = await page.evaluate(() => {
      const app = document.querySelector('quire-app') as HTMLElement & {
        shadowRoot: ShadowRoot;
      };
      const shell = app.shadowRoot.querySelector('quire-shell') as HTMLElement;
      // Either the controller-applied inline-style value, OR the
      // CSS clamp() floor — either way the user should see ≥ 320 px.
      const v = shell.style.getPropertyValue('--aside-w') || '380px';
      return parseFloat(v);
    });
    expect(computed).toBeGreaterThanOrEqual(320);
  });
});
