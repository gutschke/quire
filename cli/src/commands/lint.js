import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Where the v0 schemas live relative to this CLI source.  The CLI is bundled
// inside the quire repository so we can resolve schemas by relative path.
const SCHEMA_DIR = join(__dirname, '..', '..', '..', 'schema', 'v0');

// Directories that hold one record per file, mapped to the schema key.
const RECORD_DIRS = {
  'characters/pcs': 'pc',
  'characters/npcs': 'npc',
  'bestiary': 'bestiary',
  'items': 'item',
  'spells': 'spell'
};

const SCHEMA_TYPES = [
  'campaign', 'pc', 'npc', 'bestiary', 'item',
  'spell', 'episode', 'scene', 'session-log'
];

export async function run(args) {
  const root = args[0] || '.';
  const warnings = [];

  const ajv = new Ajv2020.default({ allErrors: true, strict: false });
  addFormats.default(ajv);

  const validators = await loadSchemas(ajv);

  // Campaign manifest.
  try {
    const manifest = await readJson(join(root, 'campaign.json'));
    validate('campaign.json', manifest, validators.campaign, warnings);
  } catch (e) {
    if (e.code === 'ENOENT') {
      warnings.push('campaign.json not found at campaign root');
    } else {
      warnings.push(`campaign.json: ${e.message}`);
    }
  }

  // Per-record directories.
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
        validate(rel, record, validators[type], warnings);
      } catch (e) {
        warnings.push(`${rel}: ${e.message}`);
      }
    }
  }

  // Episodes: each subdir under episodes/ may have its own episode.json.
  try {
    const episodes = await readdir(join(root, 'episodes'), { withFileTypes: true });
    for (const ep of episodes) {
      if (!ep.isDirectory()) continue;
      if (ep.name.startsWith('.') || ep.name === '_discarded') continue;
      const epJson = join(root, 'episodes', ep.name, 'episode.json');
      try {
        const record = await readJson(epJson);
        validate(relative(root, epJson), record, validators.episode, warnings);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          warnings.push(`episodes/${ep.name}/episode.json: ${e.message}`);
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push(`episodes/: ${e.message}`);
  }

  // Sessions: each dated subdir under sessions/ may hold a session.json log.
  try {
    const sessions = await readdir(join(root, 'sessions'), { withFileTypes: true });
    for (const s of sessions) {
      if (!s.isDirectory()) continue;
      if (s.name.startsWith('.')) continue;
      const logJson = join(root, 'sessions', s.name, 'session.json');
      try {
        const record = await readJson(logJson);
        validate(relative(root, logJson), record, validators['session-log'], warnings);
      } catch (e) {
        if (e.code !== 'ENOENT') {
          warnings.push(`sessions/${s.name}/session.json: ${e.message}`);
        }
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') warnings.push(`sessions/: ${e.message}`);
  }

  if (warnings.length === 0) {
    console.log('OK: no warnings');
    return;
  }
  for (const w of warnings) console.log(`warning: ${w}`);
  process.exit(1);
}

async function loadSchemas(ajv) {
  const validators = {};
  for (const type of SCHEMA_TYPES) {
    const schemaPath = join(SCHEMA_DIR, `${type}.schema.json`);
    const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
    validators[type] = ajv.compile(schema);
  }
  return validators;
}

function validate(path, record, validator, warnings) {
  if (!validator) {
    warnings.push(`${path}: no validator available`);
    return;
  }
  if (typeof record !== 'object' || record === null) {
    warnings.push(`${path}: not a JSON object`);
    return;
  }
  const valid = validator(record);
  if (!valid) {
    for (const err of validator.errors) {
      const where = err.instancePath || '/';
      const detail = err.message || JSON.stringify(err);
      warnings.push(`${path}: ${where} ${detail}`);
    }
  }
}

async function readJson(path) {
  const text = await readFile(path, 'utf8');
  return JSON.parse(text);
}
