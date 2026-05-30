# Visual-design expert report — 2026-05-30

## Top 10 highest-leverage changes (ranked)

1. **Consume `tokens.css.ts` from `quire-app.css.ts`** — `src/ui/styles/quire-app.css.ts:16-23` imports `css` but never references `var(--surface-*)`, `var(--ink-prose)`, `var(--accent-teal)`, `var(--s-*)`, or `var(--r-*)`. Tokens exist (`src/ui/styles/tokens.css.ts:18-80`) but are dead code (0 occurrences in the legacy sheet vs 988 hardcoded `light-dark(#…)` calls). Replace the high-traffic surfaces (`.card`, `.ai-panel`, `.chat-panel`, `.session-bar`, `.dm-rail`, `.player-rail`, `.backups-card`) with tokenized fills. Impact: H. Cost: M.
2. **Add 4 missing tokens + a global `:focus-visible` rule** to `tokens.css.ts`: `--shadow-card`, `--shadow-elev-1`, `--ring-focus` (e.g. `0 0 0 2px color-mix(in oklch, var(--accent-teal) 50%, transparent)`), `--button-bg/--button-bg-primary`. Then add `*:focus-visible { outline: var(--ring-focus); outline-offset: 2px; border-radius: var(--r-chip); }` at the top of `quire-app.css.ts`. Today only 7 `outline:` rules exist in 6668 LOC, hand-rolled per-region (`quire-app.css.ts:1334,1849,4278,4751`). Impact: H. Cost: S.
3. **Collapse the 12-value `border-radius` chaos to 3 tokens.** `grep border-radius` yields `2px,3px,4px,6px,8px,999px,0.25rem,0.3rem,0.4rem` etc. across 290+ sites. Map all to `--r-chip` (4) / `--r-card` (8) / `--r-pill` (999). Impact: H. Cost: M. Tooling-friendly find/replace.
4. **Ship a `button` reset + 2 button variants** (`.btn`, `.btn-primary`). There is no global `button` rule; every region rolls its own (`quire-app.css.ts:122-148, 5211-5218, 5234-5243`; `session-digest.ts:240-267` has no `static styles` at all and inherits whatever cascades down). Add `button { font: inherit; border-radius: var(--r-chip); padding: var(--s-2) var(--s-3); border: 1px solid color-mix(in oklch, var(--ink-prose) 18%, transparent); background: var(--surface-card); }` and a `.btn-primary` that fills with `--accent-teal`. Impact: H. Cost: S.
5. **Replace the no-campaign landing's plaintext-and-anchor with a real first-impression hero.** `quire-app.ts:5182-5239` renders three stacked `.card` divs of dense prose; the "Open Underleaf →" anchor is the only CTA and renders as default blue text. Promote to a single centered hero card (max-width ~560px), a primary `.btn-primary` for Underleaf, with the recently-played list (`renderRecentlyPlayed`, `:5256-5287`) demoted to a quieter sidebar/footer list. Impact: H. Cost: S.
6. **Tighten the chargen path picker** at `character-creation.ts:386-465` (`renderPickPath` / `renderPathButton`). Today: three full-width `<button>` blocks with no card framing, badge text rendered as a plain `<span>`, and `.character-creation-path` styles inherit ad-hoc colors. Make the three paths a token-styled 3-up card grid; the badge ("AI-assisted" / "No AI" / "Quickest") becomes a small pill; the disabled paths get a single muted border + reason tooltip — currently the disabled `<button>` looks identical to enabled minus the cursor. Impact: H. Cost: S.
7. **Demote the session-digest backup chip** at `session-digest.ts:147-163`. The chip is currently a `<p>`-plus-`<button>` group with no border or surface, but the surrounding `.session-digest-prior-md` carries strong content weight, so the chip reads as orphan UI rather than a natural follow-on. Wrap in a token `.card` with `--dm-amber-fill` (already a token, line 32), label "Tonight's session" + secondary `.btn` "Back up…". Impact: M. Cost: S.
8. **Give `dm-operational-view` an admin-card aesthetic, not the play surface.** `dm-operational-view.ts:146-167` renders inside the same `.card` class as everything else — players' "card" and DM's "operational view card" look identical when overlaid; the surface reads as a debug pane. Add an `.operational` surface variant: slightly cooler `--surface-card`, a left-edge `--border-dm-rail` (already a token, line 55), and a clear "Operational view" h2 with a subtitle. Impact: M. Cost: S.
9. **Add `.muted` and `h1/h2/h3` typography tokens** consistently. `quire-app.css.ts:3653-3661` defines `.card h2` / `.card h3` once, but `font-size` values across the sheet span 24 distinct numeric values (`0.7em` … `1.15rem`). Apply `--type-section` (`tokens.css.ts:49`) to all h2, `--type-chrome-base` to h3, and tokenize `.muted` to `color-mix(in oklch, var(--ink-prose) 60%, transparent)`. Impact: M. Cost: M.
10. **Light-DOM region components lack `static styles`** — `session-digest.ts:71-73`, `backups-card.ts:93-95`, `ai-panel.ts:71-74`, `dm-operational-view.ts:67-71`, `character-creation.ts:78-81`, `dm-rail.ts:38-41` all override `createRenderRoot` to render into the host's light DOM and rely on the legacy cascade. That's tolerable for migration, but it means **every visual fix must land in `quire-app.css.ts`**, and a region author who tries to add `static styles = [tokens, regionStyles]` will be invisible. Document the pattern (or migrate one canonical region — `<backups-card>` is smallest — to shadow-DOM with tokens imported) so the team knows where to ship CSS. Impact: M (process). Cost: S.

## Cohesion grade (per region)

| Region | Grade 1-5 | Worst offender (file:line) |
|---|---|---|
| `quire-app.ts` idle/landing | **2** | `quire-app.ts:5182-5239` — three stacked plaintext `.card`s, no hero/CTA |
| `character-creation` | **3** | `character-creation.ts:386-465` — buttons-as-paths, badge inconsistency |
| `chargen-dm-review` (CSS only) | **2** | `quire-app.css.ts:73-300` — 200+ bespoke `.chargen-dm-review-*` rules, own button styles, own undo-banner colors |
| `session-bar` | **3** | `session-bar.ts:108-130` — role-hint prose dominates; primary CTA is a generic `<button>` |
| `dm-rail` | **4** | clean structure; just inherits inconsistent link/focus styling |
| `player-rail` | **3** | `quire-app.css.ts:3579-3635` — advancement-ready / casting-tax / threshold chips each invented their own palette |
| `scene-stage` | **4** | well-bounded; main hit is heading scale drift |
| `chat-panel` | **3** | `chat-panel.ts:96-108` — input + send button styled per-region; no visual link to `surface-public` token |
| `ai-panel` | **3** | `ai-panel.ts:194-238` — dual-card, write-strip, dm-only badge, verdict footer, sources list, budget meter, rejection banner all visually independent; high-density screen with no visual hierarchy backbone |
| `session-digest` | **2** | `session-digest.ts:113-129` — no `static styles`; backup chip reads as afterthought; prior-recap markdown takes visual weight away from the live editor |
| `backups-card` | **3** | `backups-card.ts:179-198` — fine structure but unstyled `<dl>` + 3 sibling buttons, no primary/secondary distinction |
| `dm-operational-view` | **2** | `dm-operational-view.ts:146-167` — uses the same `.card` shell as play; reads as a debug pane, not a control room |
| `cloud-push-consent-dialog` | **3** | inherits dialog defaults; OK |
| `session-open-stage` | **3** | recap + carryover headings drift in scale |
| `session-wrap-marks` | **3** | OK structurally; advancement chips fight player-rail chips on color |

## Q1-Q10 answers

### Q1 — Landing first impression
Weakest 30 seconds: the **no-campaign landing** at `quire-app.ts:5182-5239`. A new DM sees `<h1>Quire</h1>`, a 1-line summary, then three stacked `.card`s of prose, and the only call to action is a plain blue underlined link "Open Underleaf →". The "Recently played" list (`:5256-5287`) renders identically to a card of bullet points. Fix in #5 above.

### Q2 — Cohesion sweep
Top 5 worst offenders:
1. `quire-app.css.ts:16-6668` — 0 token references, 988 `light-dark()` calls, 12 distinct `border-radius` values.
2. `quire-app.css.ts:73-3640` — ~200 bespoke `.chargen-dm-review-*` rules, each with their own colors and buttons.
3. `quire-app.css.ts:3579-3635` — player-rail advancement / casting-tax / threshold chips, each with hand-rolled palettes.
4. `ai-panel.ts:194-238` rendering inheriting `.ai-panel`, `.ai-card`, `.ai-write-strip`, `.ai-budget`, `.ai-rejection-banner` (`quire-app.css.ts:5094+`) — five overlapping visual languages on one panel.
5. `session-digest.ts:71-73` — light-DOM with no scoped styles at all.

Cross-cut: there is no global focus-visible (only 7 outline declarations) — keyboard users see browser-default rings on most buttons.

### Q3 — Chargen first impression
- **Path picker** (`character-creation.ts:386-465`): make the three options a 3-up card grid with token surfaces and a primary-styled CTA per card; disabled paths get a muted border + tooltip; badges become small pills not body text.
- **Q&A flow** (the renderWork qa branch): textareas inherit monospace font from `quire-app.css.ts:5178` because the AI-settings selector cascades — give chargen inputs `font-family: inherit` and apply the prose typography token (`--type-prose`).
- **Free-write editor** is unbuilt (`character-creation.ts:478-491`). When it ships, anchor it to one large centered editor with `--type-prose` and a sticky autosave/word-count strip at the bottom — don't replicate the 720px chargen-shell rules.

### Q4 — The session-digest moment
`session-digest.ts:115-129` puts: head → priorDigests → editor → backupChip. Visual hierarchy inverted: prior recap dominates with rendered markdown; the editor is a textarea; the backup chip is a `<p>` + `<button>` (`:147-163`). Backup chip feels like an afterthought. Fix in #7. Also: the prior recap should collapse-by-default after the first session (it's a `<details>` per `:191`, but the *latest* prior renders open inline — flip the default so the live editor is the visual hero on session-end).

### Q5 — The AI panel
`ai-panel.ts:194-238` mixes too many independently-styled blocks: budget meter, settings toggle, write-strip, error, rejection banner, dual-card, source chips, verdict buttons. The dual-card (`:354-404`) is the strongest signal in the panel (DM-only is amber-rail-tagged via inline copy "🔒 DM only — do not read aloud") and reads well. The accept/reject verdict (`:412-438`) renders as two equal grey buttons — no primary affordance.

Player-visible AI surface: AI output reaches players only via the DM's manual "Share to chat" (`ai-panel.ts:366-374` → chat-panel). That's the correct firewall posture and visually it stays as a chat line, not a tool — good.

### Q6 — The DM operational view (DEC-029)
Reads as **debugging**, not admin. `dm-operational-view.ts:146-167` uses the same `.card` class as play surfaces; the intro line "The engineering reality behind your table" tells the DM what they're looking at, but the surface doesn't *feel* in-control — no visual frame, no header divider, no DM-amber rail. Fix in #8. Also: the player fallback (`:140-143`) is a friendly card; the DM surface should outclass it visually.

### Q7 — Information density
- **Over-dense:** `ai-panel.ts:194-238` (budget meter + settings + write-strip + dual-card + verdict + rejection banner stacked); `quire-app.css.ts:3579-3635` (player-rail chip family).
- **Over-dense:** `chargen-dm-review-*` per-seat card (`quire-app.css.ts:73-700`) — head + pill + display-name + id + remove + drift + Q&A spoiler chip + accept/review actions in one card.
- **Under-dense:** the no-campaign landing (Q1) — three stacked `.card`s with no hero CTA.
- **Under-dense:** `dm-operational-view.ts:170-187` — one `<backups-card>` in a near-empty modal; lots of whitespace because future surfaces aren't built yet.
- **Under-dense:** `session-open-stage` recap header has tons of breathing room while the carryover list is dense.

### Q8 — Modern aesthetic reference
**Linear.** Same register as Quire's locked tone: dark-first, oklch palette, type-clamped, restrained accent (their indigo ≈ our `--accent-teal`), generous radii, no illustration, focus rings are crisp. The Quiet's "mystical-quiet-civilized" reads through restraint, not ornament — Linear's surface family (`oklch(16-20% chroma 250)`) already matches `tokens.css.ts:21-22`. Avoid: Notion (too text-heavy, no shipping-tool feeling), Figma (too colorful), Roam (too sparse). Stripe Docs would also work but skews more docsite than app cockpit; Linear is the closer match for an in-table tool.

### Q9 — Top 10 cosmetic changes
See ranked list above.

### Q10 — What NOT to change
1. **`tokens.css.ts:18-80`** — the token system is correct: dark-first oklch, clamp-driven type, motion respects `prefers-reduced-motion`. Don't redesign; *consume* it.
2. **The 5-region cockpit grid** (`quire-app.css.ts:23-50`) and the chargen-shell single-column layout (`:59-68`). The IA is sound — the playtest is about polish, not architecture.
3. **The amber-rail + "🔒 DM only" badge convention** on the AI dual-card (`ai-panel.ts:376-386`) and per-PC chargen review (`chargen-dm-review.ts`). It already encodes the firewall in a way the DM reads at a glance without leaking to players. Preserve verbatim.

## Would-want-but-defer

- A full button-component rewrite with size variants + icon support — defer to post-playtest M8.
- A custom illustration set / wordmark — explicitly out of scope.
- A motion-design pass (panel transitions, chip enter/leave) — defer; current `--motion-*` tokens are unused but adequate for v1.
- Shadow-DOM migration for the light-DOM regions — defer; documenting the pattern (#10) closes the immediate confusion.

The smaller-fix that closes the most-important first-impression gap in the time available: **ship #1-#5 together as one CSS-only diff**. That delivers: tokens actually consumed, real focus rings, consistent radii, one button system, and a real landing hero. Together that moves a new DM from "default Lit page" to "intentional tool" without touching a single component's behavior — keeping WS-G re-validation cost low.
