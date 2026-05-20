# Authoring conventions

Conventions for writing Quire campaigns. These are *recommended*, not enforced — the schemas and lint don't require them. Forks may diverge. But following them makes a campaign easier to run, easier to fork, and friendlier to player and DM expectations across the ecosystem.

## Public vs DM-only

Every campaign has two layers of content:

- **Public**: anything a player can browse without spoiling their game. The campaign manifest, public world overview, character creation guidance, scene narration that's been revealed during play, post-session summaries.
- **DM-only**: everything the players are not meant to read ahead of time. Per-episode twists, antagonist throughlines, world cosmology beyond what PCs know, NPC private notes, hidden mechanics.

DM-only content lives in `dm/` subfolders per episode and in `design/DM-ONLY/` at the campaign root. Every DM-only file should open with a GitHub `[!CAUTION]` alert block warning players away. In published Underleaf-style campaigns, `quire encrypt-dm` encrypts these folders at rest with the campaign passphrase.

See [`security.md`](security.md) for the trust model and [`schemas.md`](schemas.md) for the encryption tooling.

## In-medias-res opens

Quire's reference convention is to open episodes (especially episode 1) with the PCs already in a scene, not converging on one. This avoids the "everyone meets in a tavern" awkwardness and lets the DM start with concrete texture rather than introductions.

Backstory questions are answered through play, not before play. If a player asks "how did we meet?", the answer is "you're about to find out."

## Scenes as Markdown with frontmatter

Each scene is a Markdown file under `episodes/<NNN>/scenes/`, with YAML frontmatter that conforms to the [scene schema](../schema/v0/scene.schema.json):

```yaml
---
$schemaVersion: 0.1.0
name: Scene name
summary: One-line storyboard summary.
location: Where this happens.
presentNpcs: [list of NPC ids or names]
expectedDuration: 15 minutes
mood: Tonal cue for the DM.
rolls:
  - Anticipated rolls or moves.
---
```

The body is the DM's read-aloud + prompts + cues. Write in second person ("you're in the boarding line") for direct-address sections; switch to third person for stage directions ("the attendant glances up").

## DM-only material lives in dm/

Each episode has a `dm/` subfolder for spoiler-bearing material. Typical files:

- `README.md` — index of DM-only files in this episode, with a spoiler banner.
- One file per kind of DM-only material: the scene's hidden mechanics (e.g. `the-gate.md`), the antagonist's actions, the menus that drive choice-based scenes, the realism notes.

A typical episode might ship 4-8 DM-only files. Too few makes the DM thrash; too many makes the DM lose track.

## Ship an NPCs quick-reference

This is the *minimum-viable* DM aid for handling unexpected player questions.

Every episode ships `dm/npcs.md` (or equivalent) listing every named NPC with:

- Name and pronouns.
- One-line visual or physical snapshot.
- One-line voice / manner cue.
- One-line description of what they want or care about right now.
- Disposition toward the PCs.
- Optional: stat hints if a roll is plausible.
- Optional: an "if recurring" hook for what they could become.

The entries are **non-load-bearing.** The DM is never required to use any specific detail. The file exists for one specific case: a player asks for an NPC's name at an inopportune moment, and the DM needs to answer quickly and move on.

Players ask for names at the worst possible moments — when the DM is mid-scene, mid-rules-question, or trying to remember whether the PCs found the clue. Having pre-baked names available unblocks the moment without forcing improvisation under pressure.

The second use: PCs sometimes form unexpected attachments. A throwaway NPC the DM mentioned in passing becomes someone the players want to revisit. The pre-baked entry gives the DM material to build on rather than reinventing the character.

When an NPC becomes genuinely recurring, **promote** them: copy the entry into `characters/npcs/<id>.json` against the [npc schema](../schema/v0/npc.schema.json) and flesh them out. The dm/npcs.md entry stays; the canonical record lives at the campaign root.

## Diversity in NPC names

NPC name choices should reflect the setting plausibly. For a Bay Area campaign, that's a wide international mix — Asian-American, Latino, Black, white, Middle Eastern, South Asian, mixed-heritage. Names should not be exclusively Anglo unless the locale genuinely is.

Avoid two common failure modes:
- **Mono-cultural casts**: a campaign where every NPC is named Andrew, Kate, and James.
- **Token diversity**: one named-for-diversity NPC surrounded by Andrews and Kates.

The Bay Area's real demographic is the texture. NPC name lists should look like the real city.

## Voice and manner cues

For each NPC, include a one-line voice or manner cue that helps the DM perform the character. Examples:

- *"low, faintly amused, English with the soft Russian shape"*
- *"theater-kid energy under the customer-service voice"*
- *"the practiced 'everything is fine' cadence of a senior airline captain"*

This is more useful than physical description for at-the-table improvisation. The DM doesn't need to remember what someone looks like; they need to know what voice to put on.

## Every session ends with a concrete beat

Sessions that close on *"...and we agreed to meet again next week"* lose the surface-layer player by the tenth session. Per-session resolution is a load-bearing DM-craft principle, separate from arc progress.

For each session, plan a **session-shaped beat** — a small thing that resolves *in this session*, independent of whether the larger arc moved forward. Types:

- A confrontation resolved (or escalated to a known cliffhanger).
- A kindness given or received.
- A small cast that worked (or visibly failed in an interesting way).
- A relationship moment crystallized.
- An investigative breakthrough (small, not arc-level).
- A misdirection planted or paid off.

The beat doesn't have to be plot-significant. It has to be *concretely complete* — the players leave the table able to name what happened.

This applies especially in middle acts of long campaigns, where mid-arc sessions risk feeling like "another conversation with NPCs." Surface-layer players cannot tell whether an arc is moving forward; they can absolutely tell whether their evening had a shape.

## NPC encounters are *problems*, not lectures

When a recurring NPC is introduced, **the encounter is also a current problem the PCs can engage with**. Meeting an NPC must do something or cost something — not just transfer information.

Examples:

- An engineer with quiet misgivings is being pressured to ship something *this week*. PCs can advise, intervene, slow the ship, or sabotage.
- A user-experience designer is collecting interview data *tonight*. PCs can help her analyze, choose what to publish, decide who to show first.
- A founder is preparing a public keynote. PCs can attend, ask hard questions in Q&A, or work backstage.
- A gate agent has been written up by a supervisor. PCs can vouch for them, escalate further, or stay clear.

The contrast is *"meeting NPC X teaches you Y about the world"* (lecture) vs. *"meeting NPC X means the PCs walk into a situation NPC X is mid-decision in"* (problem). Problem-mode encounters yield the same information *and* give the table something to do.

Across an act, every recurring NPC should be encountered through at least one problem-mode scene. The Casual Player and the Combat Fan especially benefit; the Social Player gets relationship-as-stakes; the Lore Reader still gets the lore via the situation's texture.

## Stakes menus for high-tension scenes

Scenes that hinge on PCs' personal investment work better with a *menu* of stakes than a single fixed one. The DM picks per-PC during prep based on who's at the table.

See `episodes/001-unattended-baggage/dm/stakes.md` for an example in Underleaf — eight pre-baked stake categories from which the DM assigns one to each PC.

The menu pattern also applies to:
- Coincidence prompts (for surfacing connections between PCs).
- Cover-story / distraction beats (for stealth or social-cover scenes).
- NPC dispositions (when an NPC's mood depends on what just happened).

## Pacing files for substantial episodes

For episodes targeting more than 60 minutes, ship a `dm/pacing.md` with:

- Per-scene time targets.
- Which scenes are compressible (and how much).
- Which scenes are not compressible.
- Natural break points.
- Cadence cues (voice and tempo shifts).

This is especially valuable for episodes with a *fragile* scene where compression damages the experience. The DM can compress around it, not through it.

## Naming and slugs

- Episode directories: `<NNN>-<slug>/` where NNN is a zero-padded sequence number and slug is kebab-case (`001-unattended-baggage`).
- Scene files: `<NN>-<slug>.md` (e.g. `07-the-gate.md`).
- Character files: `<id>.json` where id is kebab-case based on a memorable element of the name (e.g. `reggie-okeke.json`).

Numbers control display order in the storyboard; slugs make filenames human-readable.

## Linking between files

Cross-reference liberally. The runtime resolves relative Markdown links via the safe renderer:

- From a scene to its DM material: `[See dm/the-gate.md](../dm/the-gate.md)`.
- From a DM file to a campaign-level design doc: `[See world-truths.md](../../../design/DM-ONLY/world-truths.md)`.
- From any file to an NPC: `[Reggie Okeke](../dm/npcs.md#reggie-okeke)`.

Players never see DM-only files in the runtime; the runtime gates them by role.

## What NOT to do

- Don't bury essential DM information in scene-file prose. The scene file should be runnable; the deep material lives in `dm/`.
- Don't pre-resolve mysteries by writing "the answer is X" anywhere in the scene files. The answer belongs in `dm/`.
- Don't assume your DMs have memorized the cosmology. Cross-reference to design docs liberally.
- Don't include character names that look like the players' actual names. (See the *possible-future-not-prophecy* principle for the principal at the campaign level.)

## Templates

See `episodes/000-template/` in Underleaf for a starter skeleton with the conventional structure.

## When in doubt

Default to "more notes are better than fewer" in DM-only files. Surface scenes can be sparse; DM-only material should be generous. The DM running your campaign for the first time will thank you for every detail you provide; they will hate you for every gap they have to improvise.
