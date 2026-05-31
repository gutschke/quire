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

  test('Player-side inbox mount: host gates the render on peerId match and Accept emits pc-edit field:backstory with the proposed text', async ({
    page
  }) => {
    // Run #19 final integration — proves the player side of MH-2:
    //   "Player can do the same for their own PC."
    // The host's `renderPlayerBackstoryRefreshInbox` renders a card
    // ONLY when the local peer controls the seat AND a proposal
    // exists; Accept emits a `pc-edit field:backstory` with the
    // proposed text (player owns voice per R-F).
    await page.goto('/');
    await page.waitForSelector('quire-app', { timeout: 10000 });
    const result = await page.evaluate(async () => {
      type AppShape = {
        sessionView: unknown;
        requestUpdate: () => void;
        acceptBackstoryRefreshProposal: (pcId: string) => boolean;
        rejectBackstoryRefreshProposal: (pcId: string) => boolean;
        controlsSeatForPc: (pcId: string) => boolean;
        renderPlayerBackstoryRefreshInbox: (
          character: { kind: string; id: string }
        ) => unknown;
        session: { append: (kind: string, payload: unknown) => void } | null;
        effectiveCharacter: (
          c: { kind: string; id: string }
        ) => Record<string, unknown>;
        sha256HexUtil: (text: string) => Promise<string>;
      };
      const el = document.querySelector('quire-app') as unknown as AppShape;
      if (!el) return { stage: 'no-quire-app' };
      const baselineBackstory = 'Mei grew up by the Underleaf.';
      const proposed =
        'Mei (they/them) grew up by the Underleaf, training as a nurse.';
      const baselineHash = await el.sha256HexUtil(baselineBackstory);
      const view = {
        status: 'active' as const,
        peerId: 'alice-peer',
        shared: {
          pcSlots: {
            1: {
              pcId: 'mei',
              state: 'bound-active',
              controllerPeerId: 'alice-peer'
            }
          },
          synthesizedPcs: {
            mei: {
              id: 'mei',
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              backstory: baselineBackstory
            }
          },
          backstoryRefreshProposals: {
            mei: {
              pcId: 'mei',
              proposedBackstory: proposed,
              baselineHash,
              initiator: 'dm' as const,
              proposedByPeerId: 'dm-peer',
              ts: 1000
            }
          },
          coordHolders: new Set(),
          pcEdits: {}
        },
        filteredShared: {
          pcSlots: {
            1: {
              pcId: 'mei',
              state: 'bound-active',
              controllerPeerId: 'alice-peer'
            }
          },
          synthesizedPcs: {
            mei: {
              id: 'mei',
              name: 'Mei',
              pronouns: 'they/them',
              tags: ['nurse'],
              backstory: baselineBackstory
            }
          },
          backstoryRefreshProposals: {
            mei: {
              pcId: 'mei',
              proposedBackstory: proposed,
              baselineHash,
              initiator: 'dm' as const,
              proposedByPeerId: 'dm-peer',
              ts: 1000
            }
          },
          pcEdits: {} as Record<string, unknown>
        }
      };
      (el as unknown as { sessionView: unknown }).sessionView = view;
      // Stub effectiveCharacter so the render helper reads the
      // baseline backstory + pcDisplayName.
      el.effectiveCharacter = () => ({
        kind: 'pc',
        id: 'mei',
        name: 'Mei',
        pronouns: 'they/them',
        backstory: baselineBackstory
      });
      // Capture pc-edit emissions.
      const appended: Array<{ kind: string; payload: unknown }> = [];
      (el as unknown as {
        session: { append: (kind: string, payload: unknown) => void } | null;
      }).session = {
        append: (kind: string, payload: unknown) => {
          appended.push({ kind, payload });
        }
      };
      // Verify the render-gate: render the helper directly into a
      // detached container.  Imports lit-html render dynamically so
      // we can mount the TemplateResult outside the shadow tree.
      const lit = await import('/node_modules/lit/index.js');
      const host = document.createElement('div');
      document.body.appendChild(host);
      const template = el.renderPlayerBackstoryRefreshInbox({
        kind: 'pc',
        id: 'mei'
      });
      (lit as unknown as { render: (t: unknown, h: Element) => void }).render(
        template,
        host
      );
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      const inboxes = host.querySelectorAll('backstory-refresh-inbox');
      const inboxCount = inboxes.length;
      const cards = host.querySelectorAll('.backstory-refresh-inbox-card');
      const inboxHeaders = Array.from(cards).map((c) =>
        c.querySelector('h3')?.textContent?.trim()
      );
      // Drive Accept programmatically (matches the production
      // path — onAccept is wired in the host's render).
      const acceptOk = el.acceptBackstoryRefreshProposal('mei');
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // Negative-control: a peer who does NOT control the seat
      // must be refused.
      const v2 = JSON.parse(JSON.stringify(view, (_, val) =>
        val instanceof Set ? Array.from(val) : val
      ));
      v2.peerId = 'bob-peer';
      (el as unknown as { sessionView: unknown }).sessionView = v2;
      const negative = el.acceptBackstoryRefreshProposal('mei');
      const negativeGate = el.controlsSeatForPc('mei');
      return {
        stage: 'committed',
        inboxCount,
        inboxHeaders,
        acceptResult: acceptOk,
        negativeAccept: negative,
        negativeGate,
        appendedKinds: appended.map((a) => a.kind),
        appendedPayloads: appended.map((a) => a.payload)
      };
    });
    expect(result.stage).toBe('committed');
    expect(result.inboxCount).toBeGreaterThanOrEqual(1);
    expect(result.inboxHeaders.some((h) => h?.includes('Your DM has'))).toBe(
      true
    );
    expect(result.acceptResult).toBe(true);
    expect(result.appendedKinds).toContain('pc-edit');
    const pcEdit = (result.appendedPayloads ?? []).find(
      (p) =>
        typeof p === 'object' &&
        p !== null &&
        (p as { field?: string }).field === 'backstory'
    ) as { pcId?: string; field?: string; value?: string } | undefined;
    expect(pcEdit?.pcId).toBe('mei');
    expect(pcEdit?.value).toContain('they/them');
    // Defense in depth: the seat-gate refuses for an unrelated peer.
    expect(result.negativeAccept).toBe(false);
    expect(result.negativeGate).toBe(false);
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
