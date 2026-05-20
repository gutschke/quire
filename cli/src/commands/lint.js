import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const SCHEMA_VERSION_RE = /^0\.[0-9]+\.[0-9]+$/;

// Map of relative paths in a campaign repo to the record type expected there.
const RECORD_DIRS = {
  'characters/pcs': 'pc',
  'characters/npcs': 'npc',
  'bestiary': 'bestiary',
  'items': 'item',
  'spells': 'spell'
};

export async function run(args) {
  const root = args[0] || '.';
  const warnings = [];

  // Campaign manifest.
  try {
    const manifest = await readJson(join(root, 'campaign.json'));
    checkRecord('campaign.json', manifest, warnings);
  } catch (e) {
    if (e.code === 'ENOENT') {
      warnings.push('campaign.json not found at campaign root');
    } else {
      warnings.push(`campaign.json: ${e.message}`);
    }
  }

  // Records under known directories.
  for (const [dir, type] of Object.entries(RECORD_DIRS)) {
    const full = join(root, dir);
    let entries;
    try {
      entries = await readdir(full);
    } catch (e) {
      if (e.code !== 'ENOENT') warnings.push(`${dir}: ${e.message}`);
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const rel = relative(root, join(full, entry));
      try {
        const record = await readJson(join(full, entry));
        checkRecord(rel, record, warnings);
      } catch (e) {
        warnings.push(`${rel}: ${e.message}`);
      }
    }
  }

  // Episodes: each subdir under episodes/ may have its own episode.json.
  try {
    const episodes = await readdir(join(root, 'episodes'));
    for (const epDir of episodes) {
      if (epDir.startsWith('.') || epDir === '_discarded') continue;
      const epJson = join(root, 'episodes', epDir, 'episode.json');
      try {
        const record = await readJson(epJson);
        checkRecord(relative(root, epJson), record, warnings);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          warnings.push(`episodes/${epDir}/episode.json: ${e.message}`);
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push(`episodes/: ${e.message}`);
  }

  if (warnings.length === 0) {
    console.log('OK: no warnings');
    return;
  }
  for (const w of warnings) console.log(`warning: ${w}`);
  process.exit(1);
}

function checkRecord(path, record, warnings) {
  if (typeof record !== 'object' || record === null) {
    warnings.push(`${path}: not a JSON object`);
    return;
  }
  if (!record.$schemaVersion) {
    warnings.push(`${path}: missing $schemaVersion`);
  } else if (!SCHEMA_VERSION_RE.test(record.$schemaVersion)) {
    warnings.push(`${path}: $schemaVersion "${record.$schemaVersion}" does not match 0.x.y`);
  }
  if (!record.name) {
    warnings.push(`${path}: missing name`);
  }
}

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}
