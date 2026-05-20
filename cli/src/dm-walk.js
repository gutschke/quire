// Walk a campaign repository and identify which files belong under DM-only
// folders.  The convention is: any file whose ancestor chain includes a
// directory named `dm` (lowercase) or `DM-ONLY` (the Underleaf convention).
//
// This is shared by encrypt-dm and decrypt-dm.

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const DM_DIR_NAMES = new Set(['dm', 'DM-ONLY']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);

export async function walkDmFiles(root, { includeQenc = false } = {}) {
  const out = [];
  await walk(root, false, out, includeQenc);
  return out;
}

async function walk(dir, inDm, out, includeQenc) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const inDmHere = inDm || DM_DIR_NAMES.has(entry.name);
      await walk(join(dir, entry.name), inDmHere, out, includeQenc);
    } else if (entry.isFile() && inDm) {
      if (!includeQenc && entry.name.endsWith('.qenc')) continue;
      if (includeQenc && !entry.name.endsWith('.qenc')) continue;
      out.push(join(dir, entry.name));
    }
  }
}
