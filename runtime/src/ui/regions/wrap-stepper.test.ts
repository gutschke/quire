// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './wrap-stepper';
import { WRAP_STEPS, type WrapStepper, type WrapStep } from './wrap-stepper';

function mount(): WrapStepper {
  const el = document.createElement('wrap-stepper') as WrapStepper;
  document.body.appendChild(el);
  return el;
}

describe('<wrap-stepper>', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders all three breadcrumbs with the right labels', async () => {
    const el = mount();
    await el.updateComplete;
    const crumbs = el.querySelectorAll('.wrap-stepper-crumb-button');
    expect(crumbs).toHaveLength(3);
    expect(crumbs[0].textContent).toMatch(/Marks/);
    expect(crumbs[1].textContent).toMatch(/Digest/);
    expect(crumbs[2].textContent).toMatch(/Diff-review/);
  });

  it('marks the current step with aria-current="step" and disables its button', async () => {
    const el = mount();
    el.step = 'digest';
    await el.updateComplete;
    const crumbs = Array.from(
      el.querySelectorAll('.wrap-stepper-crumb-button')
    ) as HTMLButtonElement[];
    expect(crumbs[1].getAttribute('aria-current')).toBe('step');
    expect(crumbs[1].disabled).toBe(true);
    // Other steps are clickable (when handler wired).
    expect(crumbs[0].getAttribute('aria-current')).toBe('false');
  });

  it('disables all crumb buttons when no onStepChange handler is wired', async () => {
    const el = mount();
    await el.updateComplete;
    const crumbs = Array.from(
      el.querySelectorAll('.wrap-stepper-crumb-button')
    ) as HTMLButtonElement[];
    for (const c of crumbs) expect(c.disabled).toBe(true);
  });

  it('invokes onStepChange when a non-current crumb is clicked', async () => {
    const el = mount();
    const changes: WrapStep[] = [];
    el.onStepChange = (next) => changes.push(next);
    await el.updateComplete;
    const crumbs = Array.from(
      el.querySelectorAll('.wrap-stepper-crumb-button')
    ) as HTMLButtonElement[];
    crumbs[2].click();
    expect(changes).toEqual(['diff-review']);
  });

  it('renders Next on non-final steps and Finish on the diff-review step', async () => {
    const el = mount();
    el.step = 'marks';
    el.onStepChange = () => {};
    el.onFinish = () => {};
    await el.updateComplete;
    expect(el.querySelector('.wrap-stepper-next')).not.toBeNull();
    expect(el.querySelector('.wrap-stepper-finish')).toBeNull();

    el.step = 'diff-review';
    await el.updateComplete;
    expect(el.querySelector('.wrap-stepper-next')).toBeNull();
    expect(el.querySelector('.wrap-stepper-finish')).not.toBeNull();
  });

  it('Next button advances by one step', async () => {
    const el = mount();
    el.step = 'marks';
    const changes: WrapStep[] = [];
    el.onStepChange = (s) => changes.push(s);
    await el.updateComplete;
    (el.querySelector('.wrap-stepper-next') as HTMLButtonElement).click();
    expect(changes).toEqual(['digest']);
  });

  it('Back button retreats by one step; disabled on the first step', async () => {
    const el = mount();
    el.step = 'marks';
    el.onStepChange = () => {};
    await el.updateComplete;
    const back = el.querySelector('.wrap-stepper-back') as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    el.step = 'digest';
    await el.updateComplete;
    const back2 = el.querySelector('.wrap-stepper-back') as HTMLButtonElement;
    expect(back2.disabled).toBe(false);
    const changes: WrapStep[] = [];
    el.onStepChange = (s) => changes.push(s);
    back2.click();
    expect(changes).toEqual(['marks']);
  });

  it('Finish button invokes onFinish on the last step', async () => {
    const el = mount();
    el.step = 'diff-review';
    let finished = 0;
    el.onFinish = () => finished++;
    await el.updateComplete;
    (el.querySelector('.wrap-stepper-finish') as HTMLButtonElement).click();
    expect(finished).toBe(1);
  });

  it('renders a per-step blurb so DM has the "why am I here" context', async () => {
    const el = mount();
    await el.updateComplete;
    const blurb = el.querySelector('.wrap-stepper-blurb')?.textContent ?? '';
    expect(blurb).toMatch(/Tick the bullets/);
    el.step = 'digest';
    await el.updateComplete;
    expect(el.querySelector('.wrap-stepper-blurb')?.textContent ?? '').toMatch(
      /campfire recap/
    );
  });

  it('WRAP_STEPS constant is the canonical order', () => {
    expect([...WRAP_STEPS]).toEqual(['marks', 'digest', 'diff-review']);
  });
});
