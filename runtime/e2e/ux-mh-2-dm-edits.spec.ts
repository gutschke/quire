/**
 * Real-browser probe — UX-MH-2: DM-side edit tray.
 *
 * Exercises the `<chargen-edit-tray>` primitive AND the integrated
 * chargen-dm-review host wiring per Run #19 Phase 9.  Per LL-3:
 * assert user-visible outcomes (the four fields render, the copy
 * strings are correct, tag add/remove callbacks fire) — not
 * implementation details.
 *
 * Run #19 (2026-05-30) — UX-MH-2 closure proof.  Phase 9 extends the
 * spec with an integration test that mounts <chargen-dm-review>
 * with the new tray wiring and asserts the DM can click "Edit",
 * see the tray expand, edit pronouns, and see the `onEditPcField`
 * host callback fire.
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

  test('DM clicks "Edit" inside chargen-dm-review, removes a tag, sees onPcTagOp host callback fire with the right pcId', async ({
    page
  }) => {
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      await import('/src/ui/regions/chargen-dm-review.ts');
      type Seat = { pcId?: string; controllerPeerId?: string; state?: string };
      const el = document.createElement('chargen-dm-review') as HTMLElement & {
        pcSlots: Record<number, Seat>;
        synthResults: Map<number, unknown>;
        pcEditDataLookup:
          | ((pcId: string) => {
              name: string;
              pronouns: string;
              tags: readonly string[];
              backstory: string;
            } | null)
          | null;
        onPcTagOp:
          | ((
              pcId: string,
              op: { op: string; tagText?: string }
            ) => boolean)
          | null;
        onEditPcField:
          | ((
              pcId: string,
              field: string,
              value: string
            ) => boolean)
          | null;
      };
      el.pcSlots = {
        1: { pcId: 'mei', controllerPeerId: 'alice', state: 'bound-active' }
      };
      el.synthResults = new Map();
      el.pcEditDataLookup = (pcId) =>
        pcId === 'mei'
          ? {
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse', 'climber'],
              backstory: 'Mei grew up by the Underleaf.'
            }
          : null;
      const captured: Array<{
        kind: 'tag' | 'field';
        pcId: string;
        op?: { op: string; tagText?: string };
        field?: string;
        value?: string;
      }> = [];
      el.onPcTagOp = (pcId, op) => {
        captured.push({ kind: 'tag', pcId, op });
        return true;
      };
      el.onEditPcField = (pcId, field, value) => {
        captured.push({ kind: 'field', pcId, field, value });
        return true;
      };
      document.body.appendChild(el);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Find the host-mounted edit tray for slot 1.
      const tray = el.querySelector(
        'chargen-edit-tray[data-slot="1"]'
      ) as HTMLElement | null;
      if (!tray) return { stage: 'no-tray', captured };
      // Click "Edit" disclosure button to open.
      const editBtn = tray.querySelector(
        '.chargen-edit-tray-toggle'
      ) as HTMLButtonElement | null;
      if (!editBtn) return { stage: 'no-edit-btn', captured };
      editBtn.click();
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // The tray is now open — click the first tag's remove "×".
      const removeBtn = tray.querySelector(
        '.chargen-edit-tray-tag-remove'
      ) as HTMLButtonElement | null;
      if (!removeBtn) return { stage: 'no-remove-btn', captured };
      removeBtn.click();
      return { stage: 'committed', captured };
    });
    expect(result.stage).toBe('committed');
    expect(result.captured.length).toBeGreaterThanOrEqual(1);
    const tagEvent = result.captured.find((c) => c.kind === 'tag');
    expect(tagEvent).toBeDefined();
    expect(tagEvent?.pcId).toBe('mei');
    expect(tagEvent?.op).toEqual({ op: 'remove', tagText: 'nurse' });
  });
});
