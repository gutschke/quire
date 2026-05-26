import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  loadCharacter,
  CharacterLoadError,
  DM_ONLY_CHARACTER_FIELDS,
  type AccidentalGrant,
  type AdvancementMarkBullets,
  type AlignmentDrift,
  type CharacterKind,
  type CharacterRecord,
  type Condition,
  type Focus,
  type InventoryItem,
  type MagicPhase,
  type MoneyBand,
  type TaxState,
  type ThreadDebt,
  type ThreadDebtRung
} from './character-loader';
import { type CampaignSource } from './campaign-loader';

const SRC: CampaignSource = {
  owner: 'gutschke',
  repo: 'underleaf',
  ref: 'main'
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('loadCharacter — basic', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('loads a PC record', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        $schemaVersion: '0.1.0',
        name: 'Example PC',
        pronouns: 'they/them',
        stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: 1 }
      })
    );
    const result = await loadCharacter(SRC, 'pc', 'example-character');
    expect(result.kind).toBe('pc');
    expect(result.id).toBe('example-character');
    expect(result.record.name).toBe('Example PC');
    expect(result.record.pronouns).toBe('they/them');
  });

  it('loads an NPC record', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        $schemaVersion: '0.1.0',
        name: 'Yui Tanaka',
        role: 'flight attendant'
      })
    );
    const result = await loadCharacter(SRC, 'npc', 'yui-tanaka');
    expect(result.kind).toBe('npc');
    expect(result.id).toBe('yui-tanaka');
    expect(result.record.name).toBe('Yui Tanaka');
  });

  it('uses the correct URL for PCs', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
    );
    await loadCharacter(SRC, 'pc', 'example-character');
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/gutschke/underleaf/main/characters/pcs/example-character.json',
      expect.any(Object)
    );
  });

  it('uses the correct URL for NPCs', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
    );
    await loadCharacter(SRC, 'npc', 'yui-tanaka');
    expect(fetch).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/gutschke/underleaf/main/characters/npcs/yui-tanaka.json',
      expect.any(Object)
    );
  });
});

describe('loadCharacter — error paths', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws on 404', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 404 }));
    await expect(loadCharacter(SRC, 'pc', 'missing')).rejects.toThrow(
      CharacterLoadError
    );
  });

  it('throws on invalid JSON', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response('not json{{{', { status: 200 })
    );
    await expect(loadCharacter(SRC, 'pc', 'x')).rejects.toThrow(/valid JSON/i);
  });

  it('throws on missing name', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '0.1.0' })
    );
    await expect(loadCharacter(SRC, 'pc', 'x')).rejects.toThrow(/name/i);
  });

  it('throws on invalid $schemaVersion', async () => {
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({ $schemaVersion: '1.0', name: 'X' })
    );
    await expect(loadCharacter(SRC, 'pc', 'x')).rejects.toThrow(
      /\$schemaVersion/
    );
  });

  it('rejects malicious id', async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}));
    await expect(loadCharacter(SRC, 'pc', '../escape')).rejects.toThrow(
      CharacterLoadError
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each<CharacterKind>(['pc', 'npc'])(
    'passes AbortSignal through (%s)',
    async (kind) => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ $schemaVersion: '0.1.0', name: 'X' })
      );
      const ac = new AbortController();
      await loadCharacter(SRC, kind, 'x', { signal: ac.signal });
      expect(fetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ signal: ac.signal })
      );
    }
  );
});

// =====================================================================
// Phase B P1a (2026-05-23): types for the TTRPG-mandated character
// fields.  These tests don't exercise runtime behavior (the types
// are erased); they pin the SHAPE so that future refactors that
// rename a field or change its allowed values break the tests, not
// the consumers downstream.
// =====================================================================

describe('Phase B P1a — new CharacterRecord field types', () => {
  it('Focus accepts the full status enum + boundFor', () => {
    const f: Focus = {
      name: "grandmother's ring",
      domain: 'identity',
      status: 'active',
      boundFor: 'remembering who I was before the move',
      notes: 'silver, worn smooth on the outside band'
    };
    expect(f.status).toBe('active');
    // The enum compiles for every variant.
    const variants: Array<Focus['status']> = [
      'active',
      'broken',
      'faded',
      'corrupted',
      'transformed',
      undefined
    ];
    expect(variants.length).toBe(6);
  });

  it('AdvancementMarkBullets carries the 5 bullets from rules.md:149-154', () => {
    const b: AdvancementMarkBullets = {
      hardMoment: true,
      learned: false,
      risk: true,
      against: false,
      complication: false
    };
    expect(b.hardMoment).toBe(true);
    expect(b.complication).toBe(false);
    // All five are optional (partial bullets render in the EOS grid).
    const partial: AdvancementMarkBullets = { hardMoment: true };
    expect(partial.learned).toBeUndefined();
  });

  it('Condition carries source + scope enums', () => {
    const c: Condition = {
      name: 'Drunk',
      effect: '-1 INT until end of scene',
      source: 'fiction',
      scope: 'scene',
      appliedTs: 1700000000000
    };
    expect(c.source).toBe('fiction');
    // Source enum cardinality.
    const sources: Array<Condition['source']> = [
      'fiction',
      'cast',
      'tag',
      'item',
      undefined
    ];
    expect(sources.length).toBe(5);
    // Scope enum cardinality.
    const scopes: Array<Condition['scope']> = [
      'scene',
      'persistent',
      'until-rest',
      'until-released',
      undefined
    ];
    expect(scopes.length).toBe(5);
  });

  it('InventoryItem distinguishes on-person vs stowed', () => {
    const i: InventoryItem = {
      name: "grandmother's ring",
      carriedBy: 'on-person',
      notes: 'on a chain around the neck, under the shirt'
    };
    expect(i.carriedBy).toBe('on-person');
  });

  it('ThreadDebtRung enum covers the 5 rungs from rules.md:128', () => {
    const rungs: ThreadDebtRung[] = [
      'quiet',
      'noticed',
      'watched',
      'pushing-back',
      'hunted'
    ];
    expect(rungs.length).toBe(5);
    const td: ThreadDebt = { rung: 'noticed', spamCount: 2 };
    expect(td.rung).toBe('noticed');
  });

  it('MagicPhase enum covers the 4 phases from rules.md:174-188', () => {
    const phases: MagicPhase[] = [
      'accidental',
      'realization',
      'tax',
      'free'
    ];
    expect(phases.length).toBe(4);
  });

  it('TaxState carries the 3-field tax model', () => {
    const t: TaxState = {
      active: true,
      sessionsRemaining: 3,
      releaseMoment: 'the quiet moment by the bay at the end of session 7'
    };
    expect(t.active).toBe(true);
    // Active false + a release-moment marks "tax was released, this
    // is what released it" — useful for narrative callbacks.
    const released: TaxState = {
      active: false,
      releaseMoment: 'released when she accepted the call'
    };
    expect(released.active).toBe(false);
  });

  it('AccidentalGrant log entries carry ts + note + optional sceneId', () => {
    const g: AccidentalGrant = {
      ts: 1700000000000,
      note: 'silently nudged the conversation toward the family question',
      sceneId: 'ep1/scene-3'
    };
    expect(g.note.length).toBeGreaterThan(0);
  });

  it('AlignmentDrift carries marks + optional lastUpdated', () => {
    const d: AlignmentDrift = { marks: 3, lastUpdated: 1700000000000 };
    expect(d.marks).toBe(3);
  });

  it('MoneyBand enum has 5 bands (not a number)', () => {
    const bands: MoneyBand[] = [
      'broke',
      'tight',
      'comfortable',
      'well-off',
      'wealthy'
    ];
    expect(bands.length).toBe(5);
  });

  it('CharacterRecord can carry all the new fields (forward-compat with old records)', () => {
    // Old-shape record still satisfies the type (everything optional).
    const old: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei'
    };
    expect(old.name).toBe('Mei');
    // Full new-shape record compiles too.
    const full: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei Tanaka',
      pronouns: 'she/her',
      alignment: 'NN',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      tags: ['junior engineer'],
      harm: 0,
      stress: 1,
      foci: [
        {
          name: "grandmother's ring",
          domain: 'identity',
          status: 'active'
        }
      ],
      advancements: 0,
      marks: 2,
      markBullets: {
        hardMoment: true,
        learned: true,
        risk: false,
        against: false,
        complication: false
      },
      backstory: 'a paragraph',
      inventory: [
        { name: 'Chromebook', carriedBy: 'on-person' }
      ],
      conditions: [
        { name: 'Aided', effect: '+1 next roll', source: 'cast', scope: 'until-released' }
      ],
      languages: ['English', 'Mandarin'],
      moneyBand: 'comfortable',
      // ---- DM-only fields below ----
      magicPhase: 'accidental',
      knowsTheyCanCast: false,
      tax: { active: false },
      threadDebt: { rung: 'quiet' },
      accidentalGrants: [
        { ts: 1700000000000, note: 'silent nudge' }
      ],
      alignmentDrift: { marks: 0 },
      dmNotes: 'reminder: deflect the premonition question'
    };
    expect(full.knowsTheyCanCast).toBe(false);
  });
});

describe('Phase B P1a — DM_ONLY_CHARACTER_FIELDS source-of-truth list', () => {
  it('includes every DM-only field the TTRPG matrix marks', () => {
    // These are the fields the P1b viewer-scope projection must
    // strip before sending a CharacterRecord to a player peer.
    // Single source of truth — keep this assertion in sync with the
    // matrix in design/engine-vs-campaign-boundary.md §V-10 + the
    // TTRPG R1 priority matrix.
    expect(DM_ONLY_CHARACTER_FIELDS).toEqual([
      'magicPhase',
      'knowsTheyCanCast',
      'tax',
      'threadDebt',
      'accidentalGrants',
      'alignmentDrift',
      'dmNotes'
    ]);
  });

  it('every entry is a real keyof CharacterRecord (compile-time satisfies clause)', () => {
    // The `satisfies ReadonlyArray<keyof CharacterRecord>` clause on
    // the export catches typos at COMPILE time — this runtime test
    // just smoke-tests that the array isn't empty.  If the const
    // ever drifts from CharacterRecord (e.g. someone renames a
    // field but forgets to update the list), TypeScript fails the
    // build before this test runs.
    expect(DM_ONLY_CHARACTER_FIELDS.length).toBeGreaterThan(0);
  });

  it('does NOT include fields that are player-visible (regression guard)', () => {
    // A future maintainer might accidentally add e.g. `inventory`
    // to the DM-only list during a refactor.  Inventory must
    // remain player-visible (the player needs to see what they
    // carry).  Likewise for: harm/stress (player edits 1-2),
    // conditions (player sees their own debuffs), languages,
    // moneyBand, advancementHistory, markBullets, foci (only
    // visible AFTER realization but that's a different filter —
    // not the DM_ONLY list which is unconditional).
    const playerVisibleSamples = [
      'name',
      'pronouns',
      'stats',
      'harm',
      'stress',
      'tags',
      'skills',
      'foci',
      'inventory',
      'languages',
      'moneyBand',
      'conditions',
      'markBullets',
      'advancements',
      'marks',
      'backstory'
    ] as const;
    for (const field of playerVisibleSamples) {
      expect(
        (DM_ONLY_CHARACTER_FIELDS as readonly string[]).includes(field)
      ).toBe(false);
    }
  });
});

// =====================================================================
// Phase B P1b (2026-05-23): viewer-scope projection — stripDmOnlyFromCharacter
// =====================================================================

describe('Phase B P1b — stripDmOnlyFromCharacter (runtime strip)', () => {
  it('strips every field listed in DM_ONLY_CHARACTER_FIELDS', async () => {
    const { stripDmOnlyFromCharacter } = await import('./character-loader');
    const full: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      // DM-only fields:
      magicPhase: 'accidental',
      knowsTheyCanCast: true,
      tax: { active: false },
      threadDebt: { rung: 'noticed' },
      accidentalGrants: [{ ts: 1700000000000, note: 'nudge' }],
      alignmentDrift: { marks: 1 },
      dmNotes: 'reminder'
    };
    const stripped = stripDmOnlyFromCharacter(full);
    for (const field of DM_ONLY_CHARACTER_FIELDS) {
      expect(field in stripped).toBe(false);
    }
  });

  it('preserves every player-visible field', async () => {
    const { stripDmOnlyFromCharacter } = await import('./character-loader');
    const full: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      pronouns: 'she/her',
      alignment: 'NN',
      stats: { str: 0, dex: 1, con: 1, int: 2, wis: 1, cha: 0 },
      skills: ['Tech', 'Knowledge'],
      tags: ['junior engineer'],
      harm: 0,
      stress: 1,
      foci: [{ name: "grandmother's ring", domain: 'identity', status: 'active' }],
      advancements: 0,
      marks: 2,
      markBullets: { hardMoment: true, learned: true },
      backstory: 'a paragraph',
      inventory: [{ name: 'Chromebook', carriedBy: 'on-person' }],
      conditions: [{ name: 'Aided', effect: '+1' }],
      languages: ['English'],
      moneyBand: 'comfortable',
      // DM-only fields present too:
      knowsTheyCanCast: false,
      dmNotes: 'note'
    };
    const stripped = stripDmOnlyFromCharacter(full);
    expect(stripped.name).toBe('Mei');
    expect(stripped.pronouns).toBe('she/her');
    expect(stripped.alignment).toBe('NN');
    expect(stripped.stats?.wis).toBe(1);
    expect(stripped.skills).toEqual(['Tech', 'Knowledge']);
    expect(stripped.tags).toEqual(['junior engineer']);
    expect(stripped.harm).toBe(0);
    expect(stripped.stress).toBe(1);
    expect(stripped.foci?.[0]?.name).toBe("grandmother's ring");
    expect(stripped.advancements).toBe(0);
    expect(stripped.marks).toBe(2);
    expect(stripped.markBullets?.hardMoment).toBe(true);
    expect(stripped.backstory).toBe('a paragraph');
    expect(stripped.inventory?.[0]?.name).toBe('Chromebook');
    expect(stripped.conditions?.[0]?.name).toBe('Aided');
    expect(stripped.languages).toEqual(['English']);
    expect(stripped.moneyBand).toBe('comfortable');
  });

  it('is idempotent (calling twice yields the same shape)', async () => {
    const { stripDmOnlyFromCharacter } = await import('./character-loader');
    const full: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      knowsTheyCanCast: true,
      dmNotes: 'note'
    };
    const once = stripDmOnlyFromCharacter(full);
    const twice = stripDmOnlyFromCharacter(once);
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
  });

  it('does not mutate the input record (callers can rely on this)', async () => {
    const { stripDmOnlyFromCharacter } = await import('./character-loader');
    const full: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      knowsTheyCanCast: true,
      dmNotes: 'note'
    };
    const beforeStr = JSON.stringify(full);
    stripDmOnlyFromCharacter(full);
    expect(JSON.stringify(full)).toBe(beforeStr);
    expect(full.knowsTheyCanCast).toBe(true);
    expect(full.dmNotes).toBe('note');
  });

  it('handles a record with no DM-only fields gracefully', async () => {
    const { stripDmOnlyFromCharacter } = await import('./character-loader');
    const clean: CharacterRecord = {
      $schemaVersion: '0.1.0',
      name: 'Mei'
    };
    const stripped = stripDmOnlyFromCharacter(clean);
    expect(stripped.name).toBe('Mei');
  });

  it('handles forward-compat unknown fields (preserves them — they may be player-visible extras)', async () => {
    // V-10-strict (2026-05-25): the index signature was removed
    // from CharacterRecord, but the runtime stripper still preserves
    // any non-named fields via shallow-clone (the type cast +
    // runtime `delete DM_ONLY_CHARACTER_FIELDS` are the only steps).
    // Older saves with flat extras keep round-tripping.  Newer code
    // should put forward-compat fields under the typed `extras` bag.
    const { stripDmOnlyFromCharacter } = await import('./character-loader');
    const withExtras = {
      $schemaVersion: '0.1.0',
      name: 'Mei',
      knowsTheyCanCast: true, // DM-only (stripped)
      customCampaignField: 'something a future ruleset uses' // unknown (kept)
    } as unknown as CharacterRecord;
    const stripped = stripDmOnlyFromCharacter(withExtras);
    expect('knowsTheyCanCast' in stripped).toBe(false);
    expect(
      (stripped as unknown as Record<string, unknown>).customCampaignField
    ).toBe('something a future ruleset uses');
  });
});
