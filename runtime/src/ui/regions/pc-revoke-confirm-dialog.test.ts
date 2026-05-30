// @vitest-environment happy-dom

/**
 * Tests for <pc-revoke-confirm-dialog>.
 *
 * Following the run-#17 LL-2/LL-3 lessons-learned: assert
 * user-visible STATE / PLACEMENT, not internal node identity.  A
 * passing test means a real DM would actually see the affordance
 * and the click would actually emit the right shape.
 */

import { afterEach, describe, expect, it } from 'vitest';
import './pc-revoke-confirm-dialog';
import type { PcRevokeConfirmDialog } from './pc-revoke-confirm-dialog';

function mount(): PcRevokeConfirmDialog {
  const el = document.createElement(
    'pc-revoke-confirm-dialog'
  ) as PcRevokeConfirmDialog;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('<pc-revoke-confirm-dialog>', () => {
  it('renders nothing until open() is called (silent-player firewall defense-in-depth)', async () => {
    const el = mount();
    await el.updateComplete;
    // PLACEMENT: no dialog visible until open().
    expect(
      document.querySelector('[data-testid="pc-revoke-dialog"]')
    ).toBeNull();
  });

  it('open(remove-player): renders title + firewall reminder + three narrativeShape radios, defaults to offstage-forever', async () => {
    const el = mount();
    void el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    // STATE: dialog is visible.
    const dialog = document.querySelector(
      '[data-testid="pc-revoke-dialog"]'
    );
    expect(dialog).not.toBeNull();
    // PLACEMENT: title names the PC by display name.
    expect(dialog?.querySelector('h2')?.textContent).toContain('Mei');
    expect(dialog?.querySelector('h2')?.textContent).toContain('PC1');
    // PLACEMENT: firewall reminder copy is present and names the silence.
    const reminder = document.querySelector(
      '[data-testid="pc-revoke-firewall-reminder"]'
    );
    expect(reminder?.textContent).toContain("won't be told");
    // PLACEMENT: all three radio shapes are rendered.
    const neverArrived = document.querySelector(
      '[data-testid="pc-revoke-shape-never-arrived"]'
    ) as HTMLInputElement;
    const offstage = document.querySelector(
      '[data-testid="pc-revoke-shape-offstage-forever"]'
    ) as HTMLInputElement;
    const recast = document.querySelector(
      '[data-testid="pc-revoke-shape-recast"]'
    ) as HTMLInputElement;
    expect(neverArrived).not.toBeNull();
    expect(offstage).not.toBeNull();
    expect(recast).not.toBeNull();
    // STATE: default for remove-player variant is offstage-forever.
    expect(offstage.checked).toBe(true);
    expect(neverArrived.checked).toBe(false);
    expect(recast.checked).toBe(false);
  });

  it('open(reset-character): default narrativeShape is recast', async () => {
    const el = mount();
    void el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'reset-character'
    });
    await el.updateComplete;
    const recast = document.querySelector(
      '[data-testid="pc-revoke-shape-recast"]'
    ) as HTMLInputElement;
    expect(recast.checked).toBe(true);
  });

  it('no inbound bonds: bond fieldset is absent', async () => {
    const el = mount();
    void el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    expect(
      document.querySelector('[data-testid="pc-revoke-bonds"]')
    ).toBeNull();
  });

  it('inbound bonds present: shows bond-list line naming the source PCs', async () => {
    const el = mount();
    void el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: ['Kasumi', 'Aiko'],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    const bondList = document.querySelector(
      '[data-testid="pc-revoke-bond-list"]'
    );
    expect(bondList?.textContent).toContain('Kasumi');
    expect(bondList?.textContent).toContain('Aiko');
  });

  it('available NPCs: select shows the NPCs; selecting one hides the free-text tombstone input', async () => {
    const el = mount();
    void el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: ['Kasumi'],
      availableNpcs: [
        { id: 'mateo', name: 'Mateo' },
        { id: 'rin', name: 'Rin' }
      ],
      variant: 'remove-player'
    });
    await el.updateComplete;
    const select = document.querySelector(
      '[data-testid="pc-revoke-npc-select"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    // PLACEMENT: NPC options surface (3 total: the "don't reassign" + 2 NPCs).
    expect(select.options).toHaveLength(3);
    // PLACEMENT: free-text tombstone input is initially visible.
    expect(
      document.querySelector('[data-testid="pc-revoke-tombstone-input"]')
    ).not.toBeNull();
    // STATE: pick an NPC; the free-text input disappears.
    select.value = 'mateo';
    select.dispatchEvent(new Event('change'));
    await el.updateComplete;
    expect(
      document.querySelector('[data-testid="pc-revoke-tombstone-input"]')
    ).toBeNull();
  });

  it('Cancel resolves null; STATE: dialog closes', async () => {
    const el = mount();
    const promise = el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    (
      document.querySelector(
        '[data-testid="pc-revoke-cancel"]'
      ) as HTMLButtonElement
    ).click();
    const result = await promise;
    expect(result).toBeNull();
    await el.updateComplete;
    // PLACEMENT: dialog gone after cancel.
    expect(
      document.querySelector('[data-testid="pc-revoke-dialog"]')
    ).toBeNull();
  });

  it('Confirm resolves the chosen narrativeShape + bondTombstoneName', async () => {
    const el = mount();
    const promise = el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: ['Kasumi'],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    // STATE: pick 'never-arrived' shape.
    const neverArrived = document.querySelector(
      '[data-testid="pc-revoke-shape-never-arrived"]'
    ) as HTMLInputElement;
    neverArrived.checked = true;
    neverArrived.dispatchEvent(new Event('change'));
    // STATE: type a stand-in name.
    const input = document.querySelector(
      '[data-testid="pc-revoke-tombstone-input"]'
    ) as HTMLInputElement;
    input.value = 'an old colleague';
    input.dispatchEvent(new Event('input'));
    await el.updateComplete;
    // Confirm.
    (
      document.querySelector(
        '[data-testid="pc-revoke-confirm"]'
      ) as HTMLButtonElement
    ).click();
    const result = await promise;
    expect(result).not.toBeNull();
    expect(result?.narrativeShape).toBe('never-arrived');
    expect(result?.bondTombstoneName).toBe('an old colleague');
    expect(result?.bondTombstoneNpcId).toBeUndefined();
  });

  it('Confirm with NPC reassignment: result carries both targetNpcId + NPC name', async () => {
    const el = mount();
    const promise = el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: ['Kasumi'],
      availableNpcs: [{ id: 'mateo', name: 'Mateo' }],
      variant: 'remove-player'
    });
    await el.updateComplete;
    const select = document.querySelector(
      '[data-testid="pc-revoke-npc-select"]'
    ) as HTMLSelectElement;
    select.value = 'mateo';
    select.dispatchEvent(new Event('change'));
    await el.updateComplete;
    (
      document.querySelector(
        '[data-testid="pc-revoke-confirm"]'
      ) as HTMLButtonElement
    ).click();
    const result = await promise;
    expect(result?.bondTombstoneNpcId).toBe('mateo');
    expect(result?.bondTombstoneName).toBe('Mateo');
  });

  it('Escape resolves null', async () => {
    const el = mount();
    const promise = el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    const result = await promise;
    expect(result).toBeNull();
  });

  it('Backdrop click resolves null', async () => {
    const el = mount();
    const promise = el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    const backdrop = document.querySelector(
      '[data-testid="pc-revoke-backdrop"]'
    ) as HTMLElement;
    // Synthetic click whose target IS the backdrop (not a child).
    const evt = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: backdrop });
    Object.defineProperty(evt, 'currentTarget', { value: backdrop });
    backdrop.dispatchEvent(evt);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('disconnect resolves any pending promise null (no hung callers)', async () => {
    const el = mount();
    const promise = el.open({
      slot: 1,
      pcId: 'mei',
      pcDisplayName: 'Mei',
      inboundBondSourceDisplayNames: [],
      availableNpcs: [],
      variant: 'remove-player'
    });
    await el.updateComplete;
    el.remove();
    const result = await promise;
    expect(result).toBeNull();
  });
});
