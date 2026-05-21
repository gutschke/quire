import { describe, it, expect } from 'vitest';
import { normalizeSlug } from './quire-app';

describe('normalizeSlug', () => {
  it('strips a trailing @main', () => {
    expect(normalizeSlug('owner/repo@main')).toBe('owner/repo');
  });

  it('leaves owner/repo unchanged', () => {
    expect(normalizeSlug('owner/repo')).toBe('owner/repo');
  });

  it('preserves non-main refs', () => {
    expect(normalizeSlug('owner/repo@v1.2.3')).toBe('owner/repo@v1.2.3');
    expect(normalizeSlug('owner/repo@feature-branch')).toBe(
      'owner/repo@feature-branch'
    );
  });

  it('only strips @main as a suffix, not as a substring', () => {
    expect(normalizeSlug('owner/repo@maintenance')).toBe(
      'owner/repo@maintenance'
    );
  });
});
