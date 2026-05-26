// @vitest-environment happy-dom

/**
 * <stat-grid> — six-stat block for the quire-v0.1 ruleset
 * (rules.md:14-27).  Renders STR/DEX/CON/INT/WIS/CHA labels +
 * modifiers, with optional +/- bumpers in editable mode.
 *
 * Phase B P1d (2026-05-26): extracted from the inline
 * `renderStatBlock` method in `player-rail.ts`.  Per the
 * planning-expert recommendation: smallest useful next P1d
 * deliverable, mirroring the `<track-bar>` template (rule-hover
 * tooltip on each label exposing the stat's mechanical role).
 *
 * Tooltip text (rules.md:14-27): every label exposes the stat's
 * primary use so the DM hovering doesn't have to memorize 6
 * mechanical roles × 4 PCs.  Same DM-friction-saver pattern that
 * `<track-bar>` introduced.
 *
 * Engine-vs-campaign note (V-6): the 6-stat schema + names are
 * Underleaf-defined.  This component takes a `ruleText` map prop
 * so a future ruleset declaring different stats wires its own
 * text in.  Defaults below match quire-v0.1.
 */

import { LitElement, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './rule-hover';
import {
  STAT_MIN,
  STAT_MAX
} from '../../character-edits';

export type StatKey = 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha';

export type StatRuleText = Readonly<Record<StatKey, string>>;

/**
 * quire-v0.1 default stat rule texts.  Sourced from
 * underleaf/rules.md:14-27.  When the `ruleText` prop is unset,
 * the component falls back to these.
 */
export const DEFAULT_STAT_RULES: StatRuleText = {
  str: 'STR — feats of force, contests of physical power',
  dex: 'DEX — precision, agility, hand-eye coordination',
  con: 'CON — endurance, resisting fatigue + poison',
  int: 'INT — recall + lateral problem-solving + languages',
  wis: 'WIS — instinct, perception, sensing trouble',
  cha: 'CHA — social leverage, persuasion, performance'
} as const;

export type BumpStatCallback = (
  pcId: string,
  key: StatKey,
  current: number,
  delta: number
) => void;

const STAT_ORDER: Array<[Uppercase<StatKey>, StatKey]> = [
  ['STR', 'str'],
  ['DEX', 'dex'],
  ['CON', 'con'],
  ['INT', 'int'],
  ['WIS', 'wis'],
  ['CHA', 'cha']
];

function formatStat(value: number): string {
  return value >= 0 ? `+${value}` : `${value}`;
}

@customElement('stat-grid')
export class StatGrid extends LitElement {
  /** Light-DOM rendering so the legacy CSS cascade applies. */
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  /**
   * Stat values keyed by lowercase stat name.  Missing entries
   * render as `—` (placeholder) — better than `0` for
   * "not yet rolled," especially at chargen time.
   */
  @property({ attribute: false }) stats: Partial<Record<StatKey, number>> = {};

  /**
   * When non-null, +/- bumpers appear next to each stat value and
   * fire `onBumpStat(pcId, key, current, delta)`.  Null = read-only.
   */
  @property() editablePcId: string | null = null;

  @property({ attribute: false }) onBumpStat: BumpStatCallback | null = null;

  /**
   * Per-stat rule text used by the `<rule-hover>` tooltip on each
   * label.  Defaults to quire-v0.1; campaign-config can override.
   */
  @property({ attribute: false }) ruleText: StatRuleText | null = null;

  override render(): TemplateResult {
    const ruleText = this.ruleText ?? DEFAULT_STAT_RULES;
    return html`
      <h3>Stats</h3>
      <dl class="stat-grid">
        ${STAT_ORDER.map(([label, key]) =>
          this.renderRow(label, key, ruleText[key])
        )}
      </dl>
    `;
  }

  private renderRow(
    label: string,
    key: StatKey,
    ruleText: string
  ): TemplateResult {
    const value = this.stats[key];
    const editable = this.editablePcId !== null;
    return html`
      <dt>
        <rule-hover .text=${ruleText}>${label}</rule-hover>
      </dt>
      <dd>
        ${typeof value === 'number' ? formatStat(value) : '—'}
        ${editable && this.onBumpStat
          ? html`<span class="stat-bumpers">
              <button
                type="button"
                aria-label="Decrease ${label}"
                ?disabled=${typeof value === 'number' && value <= STAT_MIN}
                @click=${() =>
                  this.onBumpStat?.(
                    this.editablePcId!,
                    key,
                    value ?? 0,
                    -1
                  )}
              >
                −
              </button>
              <button
                type="button"
                aria-label="Increase ${label}"
                ?disabled=${typeof value === 'number' && value >= STAT_MAX}
                @click=${() =>
                  this.onBumpStat?.(
                    this.editablePcId!,
                    key,
                    value ?? 0,
                    +1
                  )}
              >
                +
              </button>
            </span>`
          : nothing}
      </dd>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stat-grid': StatGrid;
  }
}
