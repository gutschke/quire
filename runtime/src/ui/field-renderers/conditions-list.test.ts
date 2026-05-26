// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './conditions-list';
import type { ConditionsList } from './conditions-list';

function mount(props: Partial<ConditionsList> = {}): ConditionsList {
  const el = document.createElement('conditions-list') as ConditionsList;
  if (props.conditions !== undefined) el.conditions = props.conditions;
  if (props.editablePcId !== undefined) el.editablePcId = props.editablePcId;
  if (props.onRelease !== undefined) el.onRelease = props.onRelease;
  document.body.appendChild(el);
  return el;
}

describe('<conditions-list>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders nothing when conditions array is empty', async () => {
    const el = mount({ conditions: [] });
    await el.updateComplete;
    expect(el.querySelector('.conditions-list')).toBeNull();
  });

  it('renders one item per condition with name + effect', async () => {
    const el = mount({
      conditions: [
        { name: 'Drunk', effect: '-1 INT until end of scene' },
        { name: 'Aided', effect: '+1 next physical roll' }
      ]
    });
    await el.updateComplete;
    const items = el.querySelectorAll('.conditions-list-item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toMatch(/Drunk/);
    expect(items[0].textContent).toMatch(/INT until end of scene/);
  });

  it('shows source + scope tags', async () => {
    const el = mount({
      conditions: [
        {
          name: 'Blessed by Yui',
          effect: '+1 CHA',
          source: 'fiction',
          scope: 'until-rest'
        }
      ]
    });
    await el.updateComplete;
    const item = el.querySelector('.conditions-list-item');
    expect(item?.textContent).toMatch(/fiction/);
    expect(item?.textContent).toMatch(/until rest/);
  });

  it('defaults missing source to "fiction" and scope to "persistent"', async () => {
    const el = mount({
      conditions: [{ name: 'X', effect: 'Y' }]
    });
    await el.updateComplete;
    const item = el.querySelector('.conditions-list-item');
    expect(item?.classList.contains('conditions-list-source-fiction')).toBe(
      true
    );
    expect(item?.textContent).toMatch(/persistent/);
  });

  it('read-only: no release button', async () => {
    const el = mount({
      conditions: [{ name: 'X', effect: 'Y' }],
      editablePcId: null
    });
    await el.updateComplete;
    expect(el.querySelector('.conditions-list-release')).toBeNull();
  });

  it('editable: release button fires onRelease with index', async () => {
    const calls: Array<[string, number]> = [];
    const el = mount({
      conditions: [
        { name: 'A', effect: '1' },
        { name: 'B', effect: '2' }
      ],
      editablePcId: 'mei',
      onRelease: (pcId, idx) => {
        calls.push([pcId, idx]);
      }
    });
    await el.updateComplete;
    const buttons = el.querySelectorAll<HTMLButtonElement>(
      '.conditions-list-release'
    );
    expect(buttons.length).toBe(2);
    buttons[1].click();
    expect(calls).toEqual([['mei', 1]]);
  });

  it('editable but no callback: chip renders read-only (no button)', async () => {
    const el = mount({
      conditions: [{ name: 'X', effect: 'Y' }],
      editablePcId: 'mei',
      onRelease: null
    });
    await el.updateComplete;
    expect(el.querySelector('.conditions-list-release')).toBeNull();
  });

  it('each source value carries a distinct class for CSS theming', async () => {
    const el = mount({
      conditions: [
        { name: 'a', effect: '1', source: 'fiction' },
        { name: 'b', effect: '2', source: 'cast' },
        { name: 'c', effect: '3', source: 'tag' },
        { name: 'd', effect: '4', source: 'item' }
      ]
    });
    await el.updateComplete;
    const items = el.querySelectorAll('.conditions-list-item');
    expect(
      items[0].classList.contains('conditions-list-source-fiction')
    ).toBe(true);
    expect(items[1].classList.contains('conditions-list-source-cast')).toBe(
      true
    );
    expect(items[2].classList.contains('conditions-list-source-tag')).toBe(
      true
    );
    expect(items[3].classList.contains('conditions-list-source-item')).toBe(
      true
    );
  });
});
