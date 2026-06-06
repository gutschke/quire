/**
 * Five synthesized PCs derived from the pack files at
 * /home/markus/src/ttrpg/quire-pc-gutschke-underleaf-slot{1..5}-2026-05-31.json.
 *
 * The pack files contain raw QA-chargen answers (archetype, intent
 * answers, bond drafts).  These fixtures combine those answers with
 * archetype defaults from
 * /home/markus/src/ttrpg/underleaf/characters/pcs/archetypes.md
 * plus AI-style synthesized backstory prose, producing plausible
 * fully-formed `CharacterRecord` values.
 *
 * The fixture set was designed to stress every code path in the
 * generator and every seam in the firewall:
 *
 *   slot 1 (Marcus, hacker)   — accidental phase, no magic visible
 *   slot 2 (Yui, caregiver)   — tax phase, magic visible, foci active
 *   slot 3 (Rae, outsider)    — free phase, broken focus + bond
 *   slot 4 (Hadrian, "other") — accidental phase, lawful-evil alignment
 *   slot 5 (Sam, operator)    — realization phase, mid-cycle marks
 */

import type { CharacterRecord } from '../character-loader';

export const SLOT_1_MARCUS: CharacterRecord = {
  $schemaVersion: '0.1.0',
  name: 'Marcus Vance',
  pronouns: 'he/him',
  alignment: 'chaotic-good',
  stats: { str: 0, dex: 1, con: 0, int: 2, wis: 1, cha: 1 },
  skills: ['Tech'],
  tags: [
    'infosec generalist',
    'ex-government red-teamer',
    'embedded systems hobbyist',
    'fluent in Python',
    'social engineer'
  ],
  harm: 0,
  stress: 1,
  foci: [
    {
      name: 'father\'s Flipper Zero',
      domain: 'systems-info',
      condition: 'in hand',
      status: 'active',
      boundFor: 'reading signals where they should not be'
    }
  ],
  advancements: 0,
  marks: 1,
  markBullets: { hardMoment: true },
  bonds: [
    {
      targetPcId: 'slot-5-sam',
      text:
        'We met online playing War Thunder. Talked for years about random ' +
        'projects. Met them in person last week — we are going to Taiwan ' +
        'together.'
    }
  ],
  inventory: [
    { name: 'Flipper Zero', carriedBy: 'on-person', notes: 'father\'s gift' },
    { name: 'laptop with custom firmware', carriedBy: 'on-person' },
    { name: 'burner phone', carriedBy: 'stowed' }
  ],
  conditions: [],
  languages: ['English'],
  moneyBand: 'tight',
  backstory:
    'Marcus learned to write code by breaking other people\'s. His first ' +
    'paid job was a sponsored government engagement: red-team a federal ' +
    'system, surface the holes, write the report. The system was a ' +
    'population-monitoring program. The holes were the program. He filed ' +
    'the report anyway. They thanked him, paid out, and started looking ' +
    'for him 72 hours later.\n\n' +
    '*What in their life taught them to hold an intention against ' +
    'pressure?* A childhood spent watching his father — a sysadmin at a ' +
    'small ISP that resisted three takeover offers — hold a position ' +
    'against money and lawyers. The Flipper Zero was a graduation gift; ' +
    'an instrument his father knew he\'d use to do something useful and ' +
    'expensive.',
  // DM-only fields below — firewall regression test must NOT see these
  // on player-audience exports.
  magicPhase: 'accidental',
  knowsTheyCanCast: false,
  threadDebt: { rung: 'quiet' },
  accidentalGrants: [
    {
      ts: 1780000000000,
      note:
        'At the gate, the right person walked past at the right moment to ' +
        'let Marcus pass without being noticed.  Cheap nudge.'
    }
  ],
  alignmentDrift: { marks: 0 },
  dmNotes:
    'Marcus reads as the hacker archetype but the magic surfaces will be ' +
    'cheap-nudge social camouflage rather than tech-tier. Watch for ' +
    'Realization beat when he notices someone *looking* at him deliberately.'
};

export const SLOT_2_YUI: CharacterRecord = {
  $schemaVersion: '0.1.0',
  name: 'Yui Tanaka',
  pronouns: 'she/her',
  alignment: 'chaotic-neutral',
  stats: { str: 0, dex: 0, con: 1, int: 1, wis: 2, cha: 1 },
  skills: ['Medic', 'Insight'],
  tags: [
    'ICU nurse',
    'highway-crash first responder (off-duty)',
    'ocean beach regular',
    'chronic-pain patient',
    'reads people fast'
  ],
  harm: 1,
  stress: 2,
  foci: [
    {
      name: 'the breath-count she uses with dying patients',
      domain: 'identity',
      status: 'active',
      boundFor: 'holding presence when the room is panicking'
    },
    {
      name: 'her medication bag',
      domain: 'systems-info',
      status: 'active',
      boundFor: 'reading what a body needs'
    }
  ],
  advancements: 1,
  marks: 2,
  markBullets: { hardMoment: true, risk: true },
  advancementHistory: [
    {
      ts: 1779000000000,
      kind: 'tag',
      note: 'added "highway-crash first responder" after the SR-1 wreck.'
    }
  ],
  bonds: [],
  inventory: [
    {
      name: 'medication bag',
      carriedBy: 'on-person',
      notes: 'her own daily regimen'
    },
    { name: 'pocket EMT shears', carriedBy: 'on-person' }
  ],
  conditions: [
    {
      name: 'Spoke-too-late ache',
      effect: '-1 to all rolls until end of scene',
      source: 'cast',
      scope: 'scene',
      appliedTs: 1780100000000
    }
  ],
  languages: ['English', 'Japanese'],
  moneyBand: 'tight',
  backstory:
    'Yui was seventeen and driving south on the 101 when the wreck ' +
    'happened — a truck on its side, a man with his leg crushed under ' +
    'the cab. Onlookers shouted that it was hopeless, that she was making ' +
    'it worse, that he\'d lost too much blood. She knew exactly what ' +
    'she was doing. She stabilized him. He lived.\n\n' +
    '*What in their life taught them to hold an intention against ' +
    'pressure?* The crash. And every shift since, in the ICU, where the ' +
    'family is the loudest thing in the room and the work is quiet and ' +
    'specific and right.',
  // DM-only:
  magicPhase: 'tax',
  knowsTheyCanCast: true,
  tax: { active: true, sessionsRemaining: 2 },
  threadDebt: { rung: 'noticed', spamCount: 1 },
  accidentalGrants: [
    {
      ts: 1779500000000,
      note:
        'Held a Code Blue together too long; the patient stabilized when ' +
        'they statistically shouldn\'t have. She felt the moment.'
    }
  ],
  alignmentDrift: { marks: 1, lastUpdated: 1780100000000 },
  dmNotes:
    'Realization happened off-screen between sessions 3 and 4 when she ' +
    'consciously held a patient\'s vitals. Tax is in effect; she keeps ' +
    'trying. The release moment will be a quiet shift when she stops ' +
    'trying and just holds presence.'
};

export const SLOT_3_RAE: CharacterRecord = {
  $schemaVersion: '0.1.0',
  name: 'Rae Park',
  pronouns: 'they/them',
  alignment: 'chaotic-good',
  stats: { str: 1, dex: 1, con: 0, int: 1, wis: 2, cha: 0 },
  skills: ['Insight', 'Subterfuge'],
  tags: [
    'moved to SF age 7, lost half their family in the move',
    'amateur cryptographer',
    'long-distance runner',
    'collects strangers\' overheard sentences',
    'four-language reader'
  ],
  harm: 0,
  stress: 0,
  foci: [
    {
      name: 'brother\'s note ("Don\'t listen to what they tell you...")',
      domain: 'identity',
      status: 'broken',
      condition: 'paper torn at the fold',
      boundFor: 'holding a memory others say did not happen',
      notes:
        'broke during the Pier 14 cast — Rae intentionally pushed past ' +
        'a Hard tier and the focus tore.'
    }
  ],
  advancements: 3,
  marks: 0,
  markBullets: {},
  advancementHistory: [
    { ts: 1778000000000, kind: 'stat', note: '+1 WIS' },
    {
      ts: 1779000000000,
      kind: 'tag',
      note: '"collects strangers\' overheard sentences" — surfaced in play.'
    },
    {
      ts: 1779800000000,
      kind: 'focus',
      note: 'brother\'s note granted as focus after the dream-channel beat.'
    }
  ],
  bonds: [
    {
      targetPcId: 'npc-older-brother',
      text:
        'When I was a child he disappeared. Everyone acted as though he ' +
        'never existed. When I mentioned him they told me I never had a ' +
        'brother. I know he is out there.'
    }
  ],
  inventory: [
    {
      name: 'the note',
      carriedBy: 'on-person',
      notes: 'now broken as a focus; still a keepsake'
    },
    { name: 'second-hand running shoes', carriedBy: 'on-person' }
  ],
  conditions: [],
  languages: ['English', 'Korean', 'Mandarin', 'reading German'],
  moneyBand: 'tight',
  backstory:
    'Rae was four. They had an older brother who talked endlessly about AI. ' +
    'One night there was arguing. The next morning his room was empty — ' +
    'and not just empty; it was as if no one had lived there at all. ' +
    'Except a note on the window sill: *Don\'t listen to what they tell ' +
    'you about me. I still exist and I will find you one day.*\n\n' +
    'Everyone Rae spoke to said they had never had a brother.\n\n' +
    '*What in their life taught them to hold an intention against ' +
    'pressure?* Twenty-six years of trusting their own memory when every ' +
    'other person in the room voted otherwise.',
  // DM-only:
  magicPhase: 'free',
  knowsTheyCanCast: true,
  threadDebt: { rung: 'watched' },
  accidentalGrants: [],
  alignmentDrift: { marks: 0 },
  dmNotes:
    'Rae is the campaign\'s anchor for the "everything is in the Quiet" ' +
    'theme — their brother was, is, will be. The dream-channel beat ran ' +
    'in session 5. Watch the thread-debt; Rae has been pushing.'
};

export const SLOT_4_HADRIAN: CharacterRecord = {
  $schemaVersion: '0.1.0',
  name: 'Hadrian Wells',
  pronouns: 'he/him',
  alignment: 'lawful-evil',
  stats: { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 2 },
  skills: ['Influence', 'Subterfuge'],
  tags: [
    'self-made; no trend ever touched him',
    'pipe smoker (always)',
    'amateur historian of populist movements',
    'collector of speeches',
    'knows the abandoned places of Marin'
  ],
  harm: 0,
  stress: 0,
  foci: [
    {
      name: 'engraved mahogany pipe',
      domain: 'identity',
      status: 'active',
      condition: 'lit',
      boundFor: 'returning to himself when others want him to be something'
    }
  ],
  advancements: 1,
  marks: 0,
  markBullets: {},
  bonds: [
    {
      targetPcId: 'npc-huey-long',
      text:
        'My idol growing up. I know his speeches by heart. A damn shame ' +
        'Carl Austin Weiss killed him. God took an eye for an eye.'
    },
    {
      targetPcId: 'slot-2-yui',
      text:
        'The quietest, most gullible one. Always listens. Always takes ' +
        'what I tell them as gospel.'
    }
  ],
  inventory: [
    {
      name: 'engraved mahogany pipe',
      carriedBy: 'on-person',
      notes: 'his name on the band'
    },
    { name: 'period leather notebook', carriedBy: 'on-person' }
  ],
  conditions: [],
  languages: ['English'],
  moneyBand: 'comfortable',
  backstory:
    'Hadrian\'s parents tried for years to make him a child of suggestion. ' +
    '"Try this." "Do that." He didn\'t. While the other children went ' +
    'down slides he sharpened sticks on playground concrete and called ' +
    'them his arsenal. No trend ever touched him.\n\n' +
    'He has spent his adult life on the edge of San Francisco, in places ' +
    'closed since the 1950s, where his only companion is the pipe and his ' +
    'recordings of populist orators.\n\n' +
    '*What in their life taught them to hold an intention against ' +
    'pressure?* Refusing every adult who told him who he was.',
  // DM-only:
  magicPhase: 'accidental',
  knowsTheyCanCast: false,
  threadDebt: { rung: 'quiet' },
  accidentalGrants: [],
  alignmentDrift: { marks: 2, lastUpdated: 1780100000000 },
  dmNotes:
    'Hadrian is the table\'s unreliable narrator. His "intent integrity" ' +
    'is real but channeled through narcissism. The bond to Yui (slot 2) ' +
    'is from his point of view; her file should NOT have him listed as ' +
    'a bond unless she ratifies it.  Watch the alignment drift — the ' +
    'lawful-evil reads as a stable performance, but he is closer to ' +
    'chaotic-neutral than he admits.'
};

export const SLOT_5_SAM: CharacterRecord = {
  $schemaVersion: '0.1.0',
  name: 'Sam Reyes',
  pronouns: 'she/her',
  alignment: 'chaotic-neutral',
  stats: { str: 0, dex: 1, con: 0, int: 1, wis: 1, cha: 2 },
  skills: ['Subterfuge', 'Influence'],
  tags: [
    'lifer Bay Area; knows the Dogpatch grain silos',
    'short, picked-on her whole life',
    'recent mugging victim',
    'walks light, talks fast',
    'self-taught fast-talker'
  ],
  harm: 1,
  stress: 1,
  foci: [
    {
      name: 'the 9mm she carries to feel safe',
      domain: 'identity',
      status: 'active',
      condition: 'stowed in coat',
      boundFor: 'reminding herself she does not have to be afraid here'
    }
  ],
  advancements: 0,
  marks: 3,
  markBullets: { hardMoment: true, risk: true, against: true },
  bonds: [
    {
      targetPcId: 'slot-1-marcus',
      text:
        'We met online playing War Thunder. Talked online ever since, on ' +
        'and off, about random projects and cool things.'
    }
  ],
  inventory: [
    { name: '9mm pistol', carriedBy: 'stowed', notes: 'unregistered' },
    { name: 'pocket bag of cigarettes', carriedBy: 'on-person' }
  ],
  conditions: [
    {
      name: 'Edge of fight-or-flight',
      effect: '+1 DEX, -1 CHA until end of scene',
      source: 'fiction',
      scope: 'scene',
      appliedTs: 1780100000000
    }
  ],
  languages: ['English', 'conversational Spanish'],
  moneyBand: 'broke',
  backstory:
    'Sam was born here. She has watched the city become something her ' +
    'family cannot afford while her family\'s wages did not move. She is ' +
    'short, she has been picked on, and three weeks ago a man pulled a ' +
    'knife on her at 24th and Bryant. She bought the 9mm the next day.\n\n' +
    'She does not love the pistol. She loves the silence in her chest ' +
    'when she remembers it is there.\n\n' +
    '*What in their life taught them to hold an intention against ' +
    'pressure?* Living in a city that wanted her to stop existing and ' +
    'choosing not to.',
  // DM-only:
  magicPhase: 'realization',
  knowsTheyCanCast: true,
  tax: { active: true, sessionsRemaining: 3 },
  threadDebt: { rung: 'noticed', spamCount: 0 },
  accidentalGrants: [
    {
      ts: 1779900000000,
      note:
        'At Pier 14 — talked the harbormaster into letting them through. ' +
        'A genuine cast; she did not know it.'
    },
    {
      ts: 1780050000000,
      note:
        'The mugger\'s flashlight died at the exact moment she reached ' +
        'for the gun. Cheap; framed as luck.'
    }
  ],
  alignmentDrift: { marks: 1, lastUpdated: 1780000000000 },
  dmNotes:
    'Realization scene is locked for session 7. She will notice the ' +
    'pattern when a stranger\'s sentence finishes the sentence she did ' +
    'not say out loud. Marcus (slot 1) is her partner in the discovery ' +
    'arc; they will probably realize within a session of each other.'
};

export const ALL_FIXTURES = [
  SLOT_1_MARCUS,
  SLOT_2_YUI,
  SLOT_3_RAE,
  SLOT_4_HADRIAN,
  SLOT_5_SAM
] as const;

/**
 * Substrings drawn from DM-only fields in the fixtures.  The
 * firewall regression test asserts that NONE of these appear in
 * `pdftotext` output of a player-audience PDF.  Update whenever a
 * fixture\'s DM-only field text changes.
 */
export const DM_ONLY_FIXTURE_PHRASES: ReadonlyArray<string> = [
  // Marcus dmNotes
  'cheap-nudge social camouflage',
  'Watch for Realization beat',
  // Marcus accidentalGrants
  'right person walked past at the right moment',
  // Yui dmNotes
  'Realization happened off-screen between sessions',
  'quiet shift when she stops trying',
  // Yui accidentalGrants
  'Held a Code Blue together too long',
  // Rae dmNotes
  'campaign\'s anchor for the "everything is in the Quiet"',
  'dream-channel beat ran in session 5',
  // Hadrian dmNotes
  'unreliable narrator',
  'closer to chaotic-neutral than he admits',
  // Sam dmNotes
  'Realization scene is locked for session 7',
  'finishes the sentence she did not say out loud',
  // Sam accidentalGrants
  'mugger\'s flashlight died at the exact moment',
  // magic-phase enum values that should never print to player
  'accidental',
  'realization',
  // tax / threadDebt / alignmentDrift labels
  'thread-debt',
  'alignmentDrift'
];
