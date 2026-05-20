# Rules reference (v0.1)

This is the ruleset that Quire's bundled play app supports out of the box. It is paper-friendly: every mechanic here can be tracked on a character sheet with pencil and dice. The runtime adds convenience (digital sheet, dice helper, magic-tier reasoning aid, audit log) but never gates play on a computer.

The framework is in principle ruleset-agnostic, but only this ruleset is wired into the v0.1 runtime. Other rulesets would require additional code in the play app.

## Design pillars

- **Story over mechanics.** A session with zero dice rolls is valid. The dice are for moments where outcome is genuinely uncertain and the surprise serves the story.
- **Players roll, DM narrates.** Only players roll dice. The DM applies consequences, not random rolls of their own.
- **No farming.** No XP grind, no mana pool, no spell-slot accounting. Progression is milestone-based and capped.
- **DM cognitive load minimized.** A simple core resolution carries most situations.

## Stats

Six stats, each rated **-2 to +3**:

- **STR** — lifting, brawling, physical labor.
- **DEX** — driving, fine motor, dodging, climbing.
- **CON** — endurance, illness resistance, drug or alcohol tolerance, sleep deprivation.
- **INT** — academics, problem-solving, languages, technical knowledge.
- **WIS** — willpower, intent integrity, perception, intuition. This is the stat that modifies uncertain magic rolls — not because magic is stat-gated, but because uncertain casts depend on how cleanly the caster can hold intent.
- **CHA** — talk, presence, lying, reading rooms.

**Fixed starting array (no point-buy):** one +2, three +1s, two 0s. Story-first play discourages min-maxing.

No 7th "Conviction" stat. Adding one would signal that magic is stat-gated, which it is not.

## Resolution

For any uncertain outcome, the player rolls **2d6 + stat**:

| Roll | Result |
|---|---|
| ≤ 6 | **Miss** — fail, or succeed at cost. |
| 7-9 | **Partial** — yes-but, yes-and-cost. |
| 10+ | **Hit** — clean success. |
| 12+ | **Exceptional** — success with bonus. |

Skill modifiers add to the total (see Skills, below). The DM does not roll for the world — they narrate outcomes.

### Wild outcomes

Double 1s and double 6s preserve the dice-as-storyteller role that d20's nat-1 and nat-20 play, at about half the frequency (~5.6% combined vs d20's ~10%).

- **Double 6s** — exceptional success regardless of the underlying math; **the player narrates** an unexpected positive fictional detail they had not asked for.
- **Double 1s** — the mechanical result resolves normally with modifier (so high-stat PCs don't whiff just because the dice did), **but the DM introduces** an unexpected fictional complication or twist independent of success or failure.

## Skills

**Categories** (small fixed list, +1 each when relevant):

- **Action** — physical violence, athletics, brute force.
- **Subterfuge** — stealth, lying, manipulation, theft.
- **Knowledge** — academic recall, research, analysis.
- **Insight** — perception, reading people, noticing patterns.
- **Influence** — persuasion, performance, leadership.
- **Tech** — computers, devices, networks, code.
- **Craft** — making, fixing, building.
- **Medic** — first aid, treatment, diagnostics.

**Tags** (open free-text, +1 each when fiction-relevant):

A tag is a specific bit of expertise the PC owns — "ICU nurse," "competition climber," "fluent in Mandarin," "raised by a beekeeper." 3-5 at character creation; more through advancement.

**Modifier cap:** +2 from skills (one category plus one tag, or two stacking tags). Plus stat modifier. A typical roll is 2d6 + stat + 0-2 from skills.

## Harm and Stress

Two parallel **4-box tracks** replace HP.

### Harm

| Box | Description |
|---|---|
| 1 | **Bruised** — winded, scuffed, minor cuts. No mechanical penalty. |
| 2 | **Wounded** — meaningful injury. -1 to physical rolls. |
| 3 | **Serious** — bleeding, broken, concussed. -1 to all rolls; needs medical attention soon. |
| 4 | **Critical** — out of action. Dying or unconscious. DM and player decide together what "out" means for this PC and situation. |

Healing is mostly fictional. Box 1 clears with rest. Box 2 needs days. Box 3 needs medical attention. Box 4 needs significant intervention; can be fatal without it.

### Stress

| Box | Description |
|---|---|
| 1 | **Tense** — wound up. No penalty. |
| 2 | **Strained** — -1 to WIS-modified rolls (magic, perception, willpower). |
| 3 | **Frayed** — -2 to WIS rolls; thread debt accumulates faster from any cast. |
| 4 | **Broken** — cannot cast at all. -1 to all rolls until reduced. |

**Triggers:** see the magic tier table below for casting-related triggers. Other stress sources include witnessing distressing events, holding intent against intense social pressure, and direct contact with the world's deeper mechanics.

**Recovery:** one box per full night's real sleep; one box per meaningful conversation, art, or human connection (DM judgment); never clears in-scene; drugs and alcohol suppress stress temporarily with their own consequences.

## Combat

Theater of the mind. No initiative tracker by default.

The DM goes around the table naturally; "what do you do?" rhythm. When stakes spike — an ambush, the opening moments of a fight — the DM may call for an Insight check; high rolls act first.

**Moves available to anyone:**

- **Attack** — Action vs target. Hit deals harm. Partial deals harm + you take harm too.
- **Defend** — DEX or Action against incoming harm. Hit avoids. Partial reduces.
- **Maneuver** — change position, create advantage. Hit gives an ally +1 to their next roll.
- **Aid** — help another's action directly. Hit gives +1.
- **Press** — force someone to reveal or give up something. Influence-based.
- **Withdraw** — disengage. Hit clean exits. Partial exits at cost.

Combat is rare and lethal. PCs are mostly civilians.

## Magic

For the world rationale (The Quiet, plausibility, foci as cognitive anchors), see the campaign's design docs. The framework's mechanical interface is:

| Tier | Roll? | Outcome |
|---|---|---|
| **Free** | No | Succeeds immediately. No thread debt. |
| **Cheap** | No (or WIS check for show) | Succeeds, minimal thread debt. |
| **Costly** | 2d6 + WIS | 10+ clean; 7-9 partial (works but at higher cost than expected); ≤6 fails + thread debt anyway. Auto-marks 1 stress. |
| **Hard** | 2d6 + WIS with -1 to -2 penalty | 10+ partial only (the most consistent reading granted); 7-9 fail with major thread debt; ≤6 backlash. Auto-marks 2 stress. |
| **Prohibited** | — | Not allowed. |

**Thread debt** is a soft narrative meter — not a number. The DM tracks the caster's current state on a five-step ladder and **narrates the state in fiction** so the player can perceive where they stand without referring to a sheet:

| State | What the world is doing |
|---|---|
| **Quiet** | Nothing notable. The Quiet has not noticed. |
| **Noticed** | Small comments from NPCs about "lucky timing." The universe is registering. |
| **Watched** | Coincidences actively accumulating around the caster. Banks flag, friends ask, the weather seems to consult about whether to cooperate. |
| **Pushing Back** | The world begins working against the caster — bad luck for them specifically; suspicion; narrative friction. Casts in this state are harder than their tier alone suggests. |
| **Hunted** | (Very rare; only after sustained overreach.) The world is actively obstructing. Severe consequences. The caster cannot easily cast at all. |

The DM advances and retreats the state aloud in fiction, never by number: *"You're starting to feel watched."* *"Things have eased; the world's eye has drifted."* The Skeptic player needs to see the cost; the Wonder Chaser needs the state to feel like part of the world. The ladder serves both.

Debt **eases slowly** with restraint — typically one step per session of low-key behaviour, faster with deliberate withdrawal and apology to the threads being kept open.

**Foci** shift the plausibility tier of an in-domain cast down by one (Costly → Cheap, Hard → Costly; Prohibited stays Prohibited). Foci have a domain (emotion, systems/information, identity, motion, knowledge, etc.) and only apply within it. Foci can break, fade, corrupt, or transform when spent on Hard-tier casts.

**Free / Cheap casting in rapid succession** triggers a stress check after the 3rd or 4th in a single scene (DM judgment, AI assist available). Roll 2d6 + WIS; miss marks a stress box. This is what limits cast-spamming organically.

The runtime AI prompt bar serves as the DM's adjudication aid: the player describes a desired effect, the AI proposes a tier and the narrative threads that would make the change consistent, and the DM accepts, modifies, or overrides in seconds. The AI is *not* required — DMs running paper-only games adjudicate themselves.

## Advancement

No XP. No leveling treadmill.

**At session end**, each player may mark up to one of:

- ☐ Resolved a hard moment by acting in line with alignment.
- ☐ Learned something true about The Quiet, the world, or another character.
- ☐ Took a meaningful risk for someone else.
- ☐ Acted against your own short-term interest because the story demanded it.
- ☐ Took on a complication or scar that will matter later.

**Every 5 marks**, the PC may take one advancement:

- +1 to a stat (max +3 per stat; max two stats at +3).
- A category mastery: a +1 category becomes +2.
- A new tag.
- A new focus (a personally-meaningful casting anchor).
- A relationship with an NPC who now appears when called for.
- Access to a resource: safe house, contact, equipment.

**Cap: 8 advancements per character.** Past that, growth is narrative.

## Alignment

Standard 9-grid: Lawful/Neutral/Chaotic crossed with Good/Neutral/Evil. Chosen at creation. Binding — characters act in accord with their alignment even when it is short-term costly.

**Drift tracker.** The DM privately notes actions that pulled the PC toward a different quadrant. Around 5 drift marks toward the same destination triggers a realignment conversation between DM and player. Realignment has story consequences: old vows feel wrong, old allies notice.

## Discovering magic (Underleaf-specific arc)

For the sample campaign, PCs *can* cast from session one but do not know it. The three-phase arc:

1. **Accidental** (sessions 1-3): players have no cast action on their sheets; the DM may silently grant Free or Cheap effects to strong intent, attributed in fiction to luck. Tracked in a DM-private out-of-session log.
2. **Realization** (scripted beat, around session 3-5): DM reveals the pattern. The player gains access to cast mechanics on their sheet.
3. **Trying-too-hard tax** (next 2-3 sessions): intentional casts take -2 until the PC learns to hold intent without forcing it.

The tax is framed in-fiction: *"Now that you know magic exists, you're trying. Trying breaks intent. Until you re-learn how to hold an intention without forcing it."* The end-condition is concrete and player-perceivable: the PC must experience **one quiet moment of release** — a calming conversation, an emotional acceptance, an unforced spontaneous cast they didn't aim for. The release **drops the tax to 0** for that PC. Until then it stays at -2.

This is not a fade-out (no gradual -2 → -1 → 0); it's a gating beat. The PC either has had their moment or hasn't.

Each PC realizes on their own schedule. The moment of release is itself the cue for the act break in Underleaf's three-act structure.

This arc is specific to Underleaf and would not apply to a Quire campaign with different cosmology.
