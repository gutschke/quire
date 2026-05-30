// @vitest-environment happy-dom

import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import './session-digest';
import type { SessionDigest, DigestEntry } from './session-digest';
import { ensureMarkdownPipeline } from '../../markdown';

// E-LH6: prior-digest renders markdown via the lazy pipeline.
beforeAll(async () => {
  await ensureMarkdownPipeline();
});

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

  it('renders prior digest markdown as HTML (not literal `##` / `**`)', async () => {
    // D4-cleanup-1 (2026-05-26): the prior digest is the highest-
    // value player-facing AI artifact — players read it at next
    // session-open.  Was rendered as <pre> showing literal `##`
    // and `**` characters; now goes through renderMarkdown.
    const el = mount();
    el.priorDigests = [
      {
        ts: 1,
        markdown:
          '## What happened\n\nMei found the **iron keys** in the underleaf.',
        savedByPeerId: 'HOST'
      }
    ];
    await el.updateComplete;
    const primary = el.querySelector('.session-digest-prior-md');
    expect(primary).not.toBeNull();
    // Heading element rendered.
    expect(primary?.querySelector('h2')?.textContent).toBe('What happened');
    // Bold span rendered (no literal asterisks remaining in textContent).
    expect(primary?.querySelector('strong')?.textContent).toBe('iron keys');
    expect(primary?.innerHTML ?? '').not.toContain('##');
    expect(primary?.innerHTML ?? '').not.toContain('**');
  });

  it('renders the latest prior digest first; older ones collapsed', async () => {
    const el = mount();
    el.priorDigests = [
      { ts: 1, markdown: 'oldest recap', savedByPeerId: 'a' },
      { ts: 2, markdown: 'middle recap', savedByPeerId: 'a' },
      { ts: 3, markdown: 'newest recap', savedByPeerId: 'a' }
    ];
    await el.updateComplete;
    // Latest renders as the primary card.  Markdown-rendered so
    // we assert by textContent of the parsed body, not the raw
    // string (parsed `newest recap` paragraph trims to the same
    // text).
    const primary = el.querySelector('.session-digest-prior-md');
    expect(primary?.textContent?.trim()).toBe('newest recap');
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

  // OP-037 (run #9, M6a-FS-2): session-digest backup chip surface.
  describe('OP-037 — backup chip (§A10-A primary surface)', () => {
    it('does NOT render the chip for the player viewer (defense in depth)', async () => {
      const el = mount();
      // Player viewer: callbacks null even with showBackupChip=true.
      el.showBackupChip = true;
      await el.updateComplete;
      expect(
        el.querySelector('[data-testid="session-digest-backup-chip"]')
      ).toBeNull();
    });

    it('does NOT render the chip when host opts out (showBackupChip=false)', async () => {
      const el = mount();
      el.onGenerate = async () => ({
        ok: true,
        markdown: 'draft',
        responseId: 'r-1'
      });
      el.onSave = () => true;
      el.showBackupChip = false;
      await el.updateComplete;
      expect(
        el.querySelector('[data-testid="session-digest-backup-chip"]')
      ).toBeNull();
    });

    it('renders the chip for the DM when showBackupChip=true + no draft', async () => {
      const el = mount();
      el.onGenerate = async () => ({
        ok: true,
        markdown: 'draft',
        responseId: 'r-1'
      });
      el.onSave = () => true;
      el.showBackupChip = true;
      await el.updateComplete;
      const chip = el.querySelector(
        '[data-testid="session-digest-backup-chip"]'
      );
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toMatch(/Back up tonight/);
      expect(chip?.querySelector('button')).not.toBeNull();
    });

    it('chip click dispatches session-digest-open-operational-view (bubbles + composed)', async () => {
      const el = mount();
      el.onGenerate = async () => ({
        ok: true,
        markdown: 'draft',
        responseId: 'r-1'
      });
      el.onSave = () => true;
      el.showBackupChip = true;
      await el.updateComplete;
      let bubbled = false;
      document.body.addEventListener(
        'session-digest-open-operational-view',
        () => {
          bubbled = true;
        },
        { once: true }
      );
      (
        el.querySelector('.session-digest-backup-action') as HTMLButtonElement
      ).click();
      expect(bubbled).toBe(true);
    });

    it('chip is suppressed while the DM is mid-edit on a draft (no yank-out)', async () => {
      const el = mount();
      el.onGenerate = async () => ({
        ok: true,
        markdown: 'In-progress draft body',
        responseId: 'r-1'
      });
      el.onSave = () => true;
      el.showBackupChip = true;
      await el.updateComplete;
      // Pre-Generate: chip is up.
      expect(
        el.querySelector('[data-testid="session-digest-backup-chip"]')
      ).not.toBeNull();
      // Generate → draft appears.
      (
        el.querySelector('.session-digest-generate') as HTMLButtonElement
      ).click();
      for (let i = 0; i < 5; i++) {
        await el.updateComplete;
        if (el.querySelector('.session-digest-draft')) break;
        await Promise.resolve();
      }
      // Chip is gone while a draft is open.
      expect(el.querySelector('.session-digest-draft')).not.toBeNull();
      expect(
        el.querySelector('[data-testid="session-digest-backup-chip"]')
      ).toBeNull();
    });
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
    expect(primary?.textContent?.trim()).toBe('first draft');
  });
});
