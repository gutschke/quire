/**
 * Real-browser probe — UX-MH-2: DM-side edit tray.
 *
 * Exercises the `<chargen-edit-tray>` primitive directly in
 * Chromium.  Per LL-3: assert user-visible outcomes (the four
 * fields render, the copy strings are correct, tag add/remove
 * callbacks fire) — not implementation details.
 *
 * Run #19 (2026-05-30) — UX-MH-2 closure proof.
 */

import { test, expect } from '@playwright/test';

test.describe('UX-MH-2 — DM-side edit tray', () => {
  test('chargen-edit-tray renders the four field editors with the spec copy', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/components/chargen-edit-tray.ts');
      const el = document.createElement(
        'chargen-edit-tray'
      ) as HTMLElement & {
        open: boolean;
        pcName: string;
        pcPronouns: string;
        pcTags: readonly string[];
        pcBackstory: string;
      };
      el.open = true;
      el.pcName = 'Mei';
      el.pcPronouns = 'they/them';
      el.pcTags = ['nurse', 'climber'];
      el.pcBackstory = 'Mei grew up by the Underleaf.';
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const inputs = el.querySelectorAll('input[type="text"]');
      const textarea = el.querySelector('textarea');
      const tags = el.querySelectorAll('.chargen-edit-tray-tag');
      const text = el.textContent ?? '';
      return {
        inputCount: inputs.length,
        hasTextarea: !!textarea,
        tagCount: tags.length,
        hasNoticeCopy: text.includes(
          'Editing this row will be visible to the player on next render.'
        ),
        hasVoiceCopy: text.includes('Voice belongs to the player')
      };
    });
    expect(result.inputCount).toBeGreaterThanOrEqual(2); // name + pronouns
    expect(result.hasTextarea).toBe(true);
    expect(result.tagCount).toBe(2);
    expect(result.hasNoticeCopy).toBe(true);
    expect(result.hasVoiceCopy).toBe(true);
  });

  test('chargen-edit-tray tag-remove click fires onTagOp callback', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/components/chargen-edit-tray.ts');
      const el = document.createElement(
        'chargen-edit-tray'
      ) as HTMLElement & {
        open: boolean;
        pcTags: readonly string[];
        onTagOp?: (op: {
          op: 'add' | 'remove' | 'rename';
          tagText?: string;
        }) => void;
      };
      el.open = true;
      el.pcTags = ['nurse'];
      let captured: { op: string; tagText?: string } | null = null;
      el.onTagOp = (op) => {
        captured = op;
      };
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const removeBtn = el.querySelector(
        '.chargen-edit-tray-tag-remove'
      ) as HTMLButtonElement | null;
      removeBtn?.click();
      return captured;
    });
    expect(result).toEqual({ op: 'remove', tagText: 'nurse' });
  });
});
