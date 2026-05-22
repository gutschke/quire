# Rules schema (placeholder)

This doc describes the **contract** between the Quire engine and a campaign's
rules.  It is intentionally a scaffold: today we have one campaign (Underleaf)
and the engine has hardcoded several rules-policy items (see
`runtime/design/engine-vs-campaign-boundary.md` violations V-1 through V-8).
This file is the placeholder for the eventual campaign-authored rules schema
that would replace those hardcodings.

## Where the canonical rules live

Per the engine-vs-campaign-boundary decision (2026-05-22), the actual ruleset
that the bundled play app supports lives in the **campaign repo**, not here.
Today: [`underleaf/world/rules.md`](https://github.com/gutschke/underleaf/blob/main/world/rules.md)
(moved from `quire/design/rules-reference.md` 2026-05-22).

When other campaigns appear, each ships its own rules doc.

## What the engine consumes today (hardcoded)

The engine currently hardcodes the following Underleaf-shaped policy.  Each is
a known engine-vs-campaign violation that would be relocated to campaign-author
control if/when retargeting to a different game becomes a real need:

| Hardcoded                       | Engine location                                  | See              |
|---------------------------------|--------------------------------------------------|------------------|
| Stat keys (STR/DEX/CON/INT/WIS/CHA) | `src/ui/regions/player-rail.ts` `StatKey` type | V-4              |
| Harm/stress 4-box tracks        | `src/character-edits.ts` `HARM_MAX`/`STRESS_MAX` | V-3              |
| Stat range ±3                   | `src/character-edits.ts` `STAT_MIN`/`STAT_MAX`   | V-3              |
| CasterLadderState (5-state enum)| `src/core/state.ts` ~L84                         | V-1              |
| Hard-gate categories            | `src/core/state.ts` `pcEditHardGateReason`       | V-2              |
| 2d6+stat primary resolution     | (planned in `m3d-playtest-followups.md` §4)      | V-5              |
| Forbidden-token list (AI)       | (planned in `m4-character-creation.md` §AI)      | V-6              |
| 10-question chargen vocabulary  | (planned in `m4-character-creation.md`)          | V-8              |

## What a campaign-authored rules schema would look like (sketch)

Not specified yet.  When the engine grows hooks for any of the items above,
the campaign manifest (`campaign.json`) gains a corresponding field.  Sketch:

```jsonc
{
  // ...existing campaign manifest fields...

  "rules": {
    "stats": {
      "keys": ["STR", "DEX", "CON", "INT", "WIS", "CHA"],
      "range": { "min": -3, "max": 3 }
    },
    "tracks": {
      "harm":   { "kind": "boxes", "max": 4 },
      "stress": { "kind": "boxes", "max": 4 }
    },
    "primaryRoll": {
      "expression": "2d6+{stat}",
      "statSource": "boundPc",
      "modifierCap": { "min": -2, "max": 2 }
    },
    "hardGates": [
      { "field": "harm",   "predicate": ">= 3", "reason": "out-of-action transition" },
      { "field": "stress", "predicate": ">= 4", "reason": "Broken transition" }
    ]
  }
}
```

A campaign that didn't declare any of these would inherit the engine's current
hardcoded defaults — which means today's Underleaf-only world keeps working
without any schema in `campaign.json`.

## Going forward

Engine code that touches rules policy gets a `// TODO(campaign-policy)`
comment so a future schema-extraction pass can find it.  See
`runtime/design/engine-vs-campaign-boundary.md` for the full inventory.
