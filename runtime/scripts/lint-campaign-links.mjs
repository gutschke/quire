#!/usr/bin/env node
/**
 * M3D-2 (campaign-link linter).
 *
 * Walk a directory of campaign markdown + JSON files, extract every
 * relative `.md` link inside markdown bodies, and report any that
 * don't resolve to a real file in the repo.  Exit 1 when broken
 * links are found, 0 when clean.
 *
 * Usage:
 *   node lint-campaign-links.mjs [target-dir]
 *
 * `target-dir` defaults to `cwd`.  Skips:
 *   - node_modules
 *   - .git
 *   - hidden directories (starting with `.`)
 *   - files in the runtime / quire repo (those aren't campaign content)
 *
 * Link extraction is conservative:
 *   - Markdown `[label](href)` syntax.
 *   - href ending in `.md` (case-insensitive).
 *   - Anchors (`#section`) on `.md` paths are stripped before
 *     resolution.
 *   - External `http(s)://`, `mailto:`, and other-scheme URLs are
 *     skipped (the linter doesn't validate the open web).
 *
 * Tested separately via the unit tests in `lint-campaign-links.test.mjs`.
 *
 * History: surfaced as a play-test follow-up after the
 * `dm/stakes.md` broken link bit the user (see
 * `runtime/design/m3d-playtest-followups.md` §2).  Prevents
 * recurrence of that class of bug at commit / CI time.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, dirname, join, sep } from 'node:path';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.cache',
  'dist',
  'build',
  'coverage'
]);

/**
 * Walk a directory recursively, yielding each `.md` file path.
 * Skips hidden directories and the SKIP_DIRS allowlist.
 */
async function* walkMarkdownFiles(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(rootDir, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdownFiles(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      yield full;
    }
  }
}

/**
 * Parse one markdown file body for relative `.md` links.  Returns
 * an array of `{href, line}` entries — line numbers are 1-based to
 * match what editors / CI logs show.
 *
 * Exported via the `extractMdLinks` re-export for unit testing.
 */
export function extractMdLinks(body) {
  const out = [];
  const lines = body.split(/\r?\n/);
  // [text](href).  Captures non-greedy; href stops at whitespace or
  // close paren (which can't appear in valid relative paths anyway).
  // We intentionally don't try to handle the (rare) escaped paren
  // case — those tend to be image alt-text mishaps, not real links.
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    re.lastIndex = 0;
    while ((match = re.exec(line)) !== null) {
      const href = match[1];
      if (!href) continue;
      // Skip external schemes (http, https, mailto, etc.) — the
      // linter doesn't validate the open web.
      if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
      // Skip protocol-relative links.
      if (href.startsWith('//')) continue;
      // Skip pure anchors (`#section`) — those resolve to the
      // current file and aren't broken.
      if (href.startsWith('#')) continue;
      // Strip anchors from .md paths so the existence check works.
      const hashIdx = href.indexOf('#');
      const path = hashIdx >= 0 ? href.slice(0, hashIdx) : href;
      // Only check .md paths.  Image links, asset links, etc. are
      // not the linter's concern.
      if (!path.toLowerCase().endsWith('.md')) continue;
      out.push({ href: path, line: i + 1 });
    }
  }
  return out;
}

/**
 * Resolve a relative link against the source file's directory.
 * Refuses to escape the project root (rootDir): a link like
 * `../../../etc/passwd` is reported as broken even if the path
 * happens to resolve to something on disk.
 *
 * Returns either:
 *   { ok: true, resolved: '/abs/path/to/target.md' }
 *   { ok: false, code: 'escape' | 'absolute' }
 */
export function resolveLink(sourceFile, href, rootDir) {
  if (href.startsWith('/')) {
    // Absolute paths are ambiguous in a cross-platform context.
    // Campaign links should all be relative.
    return { ok: false, code: 'absolute' };
  }
  const sourceDir = dirname(sourceFile);
  const resolved = resolve(sourceDir, href);
  const rootAbs = resolve(rootDir);
  // Defensive: ensure the resolved path is within the project root.
  // Without trailing separator the prefix check would false-match
  // `/home/markus/src/foo` against `/home/markus/src/foobar`.
  const rootWithSep = rootAbs.endsWith(sep) ? rootAbs : rootAbs + sep;
  if (resolved !== rootAbs && !resolved.startsWith(rootWithSep)) {
    return { ok: false, code: 'escape' };
  }
  return { ok: true, resolved };
}

/**
 * Top-level entrypoint.  Walks the tree, extracts links, resolves
 * + checks each, prints a report, and exits 0 (clean) or 1 (broken).
 */
async function main() {
  const target = process.argv[2] || process.cwd();
  let rootDir;
  try {
    const st = await stat(target);
    if (!st.isDirectory()) {
      console.error(`[lint-campaign-links] not a directory: ${target}`);
      process.exit(2);
    }
    rootDir = resolve(target);
  } catch (e) {
    console.error(`[lint-campaign-links] cannot stat ${target}: ${e.message}`);
    process.exit(2);
  }

  const issues = [];
  let mdFileCount = 0;
  let linkCount = 0;
  for await (const file of walkMarkdownFiles(rootDir)) {
    mdFileCount++;
    let body;
    try {
      body = await readFile(file, 'utf8');
    } catch (e) {
      console.warn(`[lint-campaign-links] couldn't read ${file}: ${e.message}`);
      continue;
    }
    const links = extractMdLinks(body);
    for (const { href, line } of links) {
      linkCount++;
      const r = resolveLink(file, href, rootDir);
      if (!r.ok) {
        issues.push({
          file,
          line,
          href,
          reason:
            r.code === 'absolute'
              ? 'absolute path (use a relative path instead)'
              : 'link escapes the project root'
        });
        continue;
      }
      if (!existsSync(r.resolved)) {
        issues.push({
          file,
          line,
          href,
          reason: `target file does not exist (resolved: ${r.resolved})`
        });
      }
    }
  }

  if (issues.length === 0) {
    console.log(
      `[lint-campaign-links] OK — checked ${linkCount} link(s) across ${mdFileCount} markdown file(s)`
    );
    process.exit(0);
  }
  console.error(
    `[lint-campaign-links] ${issues.length} broken link(s) across ${mdFileCount} markdown file(s):`
  );
  for (const issue of issues) {
    // Format: file:line: href — reason.  Matches editor + CI
    // expectations (most editors highlight `path:line:` as a
    // clickable jump).
    const relative = issue.file.startsWith(rootDir)
      ? issue.file.slice(rootDir.length + 1)
      : issue.file;
    console.error(`  ${relative}:${issue.line}: ${issue.href}`);
    console.error(`    ${issue.reason}`);
  }
  process.exit(1);
}

// Run main() only when invoked directly (not when imported by tests).
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('lint-campaign-links.mjs');
if (isMain) {
  void main();
}
