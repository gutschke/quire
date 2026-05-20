/**
 * Character loader — fetches and minimally validates PC and NPC records.
 *
 * PCs and NPCs share enough fields that one loader handles both; the
 * caller specifies which kind via the `kind` parameter, and the loader
 * routes to characters/{pcs|npcs}/<id>.json.
 */

import {
  fetchCampaignFile,
  CampaignLoadError,
  type CampaignSource,
  type FetchOptions
} from './campaign-loader';

export type CharacterKind = 'pc' | 'npc';

export interface CharacterRecord {
  $schemaVersion: string;
  name: string;
  pronouns?: string;
  alignment?: string;
  role?: string; // NPC-only typically
  disposition?: string; // NPC-only
  stats?: {
    str?: number;
    dex?: number;
    con?: number;
    int?: number;
    wis?: number;
    cha?: number;
  };
  skills?: string[];
  tags?: string[];
  harm?: number;
  stress?: number;
  foci?: Array<{
    name: string;
    domain?: string;
    condition?: string;
    notes?: string;
  }>;
  advancements?: number;
  marks?: number;
  backstory?: string;
  description?: string; // NPC-typical
  voice?: string;
  signature?: string[];
  dmNotes?: string;
  relationships?: Array<{ who: string; kind?: string; notes?: string }>;
  resources?: string[];
  // Background sub-object some NPCs include (free-form).
  background?: Record<string, string>;
  // Forward-compat: any other fields are kept as unknown.
  [key: string]: unknown;
}

export interface LoadedCharacter {
  kind: CharacterKind;
  id: string;
  record: CharacterRecord;
  source: CampaignSource;
}

export class CharacterLoadError extends Error {
  override readonly name = 'CharacterLoadError';
  constructor(
    message: string,
    public readonly details?: string
  ) {
    super(message);
  }
}

const ID_RE = /^[A-Za-z0-9._-]+$/;
const SCHEMA_VERSION_RE = /^0\.\d+\.\d+$/;

function pathFor(kind: CharacterKind, id: string): string {
  const folder = kind === 'pc' ? 'pcs' : 'npcs';
  return `characters/${folder}/${id}.json`;
}

export async function loadCharacter(
  source: CampaignSource,
  kind: CharacterKind,
  id: string,
  options: FetchOptions = {}
): Promise<LoadedCharacter> {
  if (!id || !ID_RE.test(id) || id === '.' || id === '..') {
    throw new CharacterLoadError(
      `Invalid character id "${id}".`,
      'Character ids must match [A-Za-z0-9._-]+ and cannot be . or ..'
    );
  }

  const path = pathFor(kind, id);
  let text: string | null;
  try {
    text = await fetchCampaignFile(source, path, options);
  } catch (e) {
    if (e instanceof CampaignLoadError) {
      throw new CharacterLoadError(e.message, e.details);
    }
    throw e;
  }
  if (text === null) {
    throw new CharacterLoadError(
      `Character "${id}" (${kind}) not found.`,
      `Path: ${path}`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new CharacterLoadError(
      `Character "${id}" is not valid JSON.`,
      (e as Error).message
    );
  }

  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new CharacterLoadError(
      `Character "${id}" manifest must be a JSON object.`
    );
  }

  const m = data as Record<string, unknown>;

  if (
    typeof m.$schemaVersion !== 'string' ||
    !SCHEMA_VERSION_RE.test(m.$schemaVersion)
  ) {
    throw new CharacterLoadError(
      `Character "${id}" has missing or invalid $schemaVersion.`,
      `Expected "0.x.y"; got ${JSON.stringify(m.$schemaVersion)}.`
    );
  }

  if (typeof m.name !== 'string' || m.name.length === 0) {
    throw new CharacterLoadError(
      `Character "${id}" is missing the required "name" field.`
    );
  }

  return {
    kind,
    id,
    record: m as unknown as CharacterRecord,
    source
  };
}
