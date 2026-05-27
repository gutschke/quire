// @vitest-environment happy-dom

import { describe, it, expect, beforeEach } from 'vitest';
import './session-digest';
import type { SessionDigest, DigestEntry } from './session-digest';

function mount(): SessionDigest {
  const el = document.createElement('session-digest') as SessionDigest;
  document.body.appendChild(el);
  return el;
}

describe('<session-digest> (D4)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('renders empty section header when no prior digests + no callbacks (player viewer)', async () => {
    const el = mount();
    await el.updateComplete;
    expect(el.querySelector('.session-digest')).not.toBeNull();
    expect(el.textContent).toMatch(/Session digest/);
    // No editor for non-coord viewer (callbacks null).
    expect(el.querySelector('.session-digest-editor')).toBeNull();
  });

  it('renders the latest prior digest first; older ones collapsed', async () => {
    const el = mount();
    el.priorDigests = [
      { ts: 1, markdown: 'oldest recap', savedByPeerId: 'a' },
      { ts: 2, markdown: 'middle recap', savedByPeerId: 'a' },
      { ts: 3, markdown: 'newest recap', savedByPeerId: 'a' }
    ];
    await el.updateComplete;
    // Latest renders as the primary card.
    const primary = el.querySelector('.session-digest-prior-md');
    expect(primary?.textContent).toBe('newest recap');
    // Older ones live behind a disclosure.
    const details = el.querySelector('.session-digest-prior-older');
    expect(details).not.toBeNull();
    expect(details!.textContent).toMatch(/2 earlier recap/);
  });

  it('coord viewer (callbacks wired): editor surfaces Generate button', async () => {
    const el = mount();
    el.onGenerate = async () => ({
      ok: true,
      markdown: 'AI draft',
      responseId: 'r-1'
    });
    el.onSave = () => true;
    await el.updateComplete;
    const btn = el.querySelector(
      '.session-digest-generate'
    ) as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.textContent).toMatch(/Generate digest/);
  });

  it('Generate → draft renders in textarea + Save/Discard buttons appear', async () => {
    const el = mount();
    el.onGenerate = async () => ({
      ok: true,
      markdown: '# Session\n\nMei found the keys.',
      responseId: 'r-1'
    });
    el.onSave = () => true;
    await el.updateComplete;
    const genBtn = el.querySelector(
      '.session-digest-generate'
    ) as HTMLButtonElement;
    genBtn.click();
    // Wait for the async generation to resolve + re-render.
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-draft')) break;
      await Promise.resolve();
    }
    const draft = el.querySelector(
      '.session-digest-draft'
    ) as HTMLTextAreaElement;
    expect(draft).not.toBeNull();
    expect(draft.value).toMatch(/Mei found the keys/);
    expect(el.querySelector('.session-digest-save')).not.toBeNull();
    expect(el.querySelector('.session-digest-discard')).not.toBeNull();
  });

  it('Generate failure surfaces an error message + leaves draft empty', async () => {
    const el = mount();
    el.onGenerate = async () => ({
      ok: false,
      code: 'no-events',
      message: 'No qualifying events since the last digest.'
    });
    el.onSave = () => true;
    await el.updateComplete;
    const genBtn = el.querySelector(
      '.session-digest-generate'
    ) as HTMLButtonElement;
    genBtn.click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-error')) break;
      await Promise.resolve();
    }
    const err = el.querySelector('.session-digest-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toMatch(/No qualifying events/);
    expect(el.querySelector('.session-digest-draft')).toBeNull();
  });

  it('Save commits the trimmed draft + clears local state', async () => {
    let saved: { md: string; rid?: string } | null = null;
    const el = mount();
    el.onGenerate = async () => ({
      ok: true,
      markdown: '   Recap with leading whitespace   ',
      responseId: 'r-2'
    });
    el.onSave = (md, rid) => {
      saved = { md, rid };
      return true;
    };
    await el.updateComplete;
    (el.querySelector('.session-digest-generate') as HTMLButtonElement).click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-save')) break;
      await Promise.resolve();
    }
    (el.querySelector('.session-digest-save') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(saved).toEqual({
      md: 'Recap with leading whitespace',
      rid: 'r-2'
    });
    // Local state cleared — back to Generate-only.
    expect(el.querySelector('.session-digest-draft')).toBeNull();
  });

  it('Discard clears the draft without calling onSave', async () => {
    let saveCount = 0;
    const el = mount();
    el.onGenerate = async () => ({
      ok: true,
      markdown: 'draft text',
      responseId: 'r-3'
    });
    el.onSave = () => {
      saveCount += 1;
      return true;
    };
    await el.updateComplete;
    (el.querySelector('.session-digest-generate') as HTMLButtonElement).click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-discard')) break;
      await Promise.resolve();
    }
    (el.querySelector('.session-digest-discard') as HTMLButtonElement).click();
    await el.updateComplete;
    expect(saveCount).toBe(0);
    expect(el.querySelector('.session-digest-draft')).toBeNull();
  });

  it('Generate failure followed by retry clears the error', async () => {
    let firstCall = true;
    const el = mount();
    el.onGenerate = async () => {
      if (firstCall) {
        firstCall = false;
        return { ok: false, code: 'provider-error', message: 'fail' };
      }
      return { ok: true, markdown: 'success', responseId: 'r' };
    };
    el.onSave = () => true;
    await el.updateComplete;
    const click = (): void =>
      (el.querySelector(
        '.session-digest-generate'
      ) as HTMLButtonElement).click();
    click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-error')) break;
      await Promise.resolve();
    }
    expect(el.querySelector('.session-digest-error')).not.toBeNull();
    click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-draft')) break;
      await Promise.resolve();
    }
    expect(el.querySelector('.session-digest-error')).toBeNull();
    expect(el.querySelector('.session-digest-draft')).not.toBeNull();
  });

  it('priorDigests appearing after Save does not clobber a fresh in-progress draft', async () => {
    // Reactive test: simulate the parent re-rendering with the
    // newly-saved digest in priorDigests right after Save.  The
    // editor state was just cleared (handleSave path); incoming
    // priorDigests should NOT regenerate the draft.
    const el = mount();
    let savedCount = 0;
    el.onGenerate = async () => ({
      ok: true,
      markdown: 'first draft',
      responseId: 'r-1'
    });
    el.onSave = () => {
      savedCount++;
      return true;
    };
    await el.updateComplete;
    (el.querySelector('.session-digest-generate') as HTMLButtonElement).click();
    for (let i = 0; i < 5; i++) {
      await el.updateComplete;
      if (el.querySelector('.session-digest-save')) break;
      await Promise.resolve();
    }
    (el.querySelector('.session-digest-save') as HTMLButtonElement).click();
    // Simulate parent re-render with the new entry in priorDigests.
    const newPrior: DigestEntry[] = [
      { ts: 100, markdown: 'first draft', savedByPeerId: 'HOST' }
    ];
    el.priorDigests = newPrior;
    await el.updateComplete;
    expect(savedCount).toBe(1);
    // No draft (we just saved it).
    expect(el.querySelector('.session-digest-draft')).toBeNull();
    // Prior digest list shows the just-saved entry.
    const primary = el.querySelector('.session-digest-prior-md');
    expect(primary?.textContent).toBe('first draft');
  });
});
