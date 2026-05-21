/**
 * Legacy quire-app styles, extracted from `quire-app.ts` during M1
 * (P0-1 facade-migration step 1).  These are the existing styles
 * verbatim from the pre-refactor stack-of-cards UI; they will be
 * progressively split per-region and migrated to consume the design
 * tokens in `tokens.css.ts` as part of M2 region extraction.
 *
 * Do not edit these styles freely during M1; the migration discipline
 * is "extract first, refactor later."  New styles introduced in M1
 * (e.g. for shell wrappers) belong in their own per-region modules,
 * not here.
 */

import { css } from 'lit';

export const quireAppStyles = css`
    :host {
      display: block;
      font-family: system-ui, -apple-system, sans-serif;
      max-width: 65ch;
      margin: 2rem auto;
      padding: 1rem;
      line-height: 1.55;
      color: light-dark(#111, #eee);
      background: light-dark(#fff, #1a1a1a);
    }

    header h1 {
      font-size: 1.75rem;
      margin: 0;
    }

    .summary {
      font-style: italic;
      margin: 0.5rem 0 1.5rem;
      color: light-dark(#444, #aaa);
    }

    nav.breadcrumb {
      font-size: 0.9rem;
      margin: 0 0 1rem;
      color: light-dark(#555, #aaa);
    }

    nav.breadcrumb a {
      color: light-dark(#0050a0, #6bb6ff);
    }

    .card {
      padding: 1rem 1.25rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 6px;
      margin: 1rem 0;
      background: light-dark(#fcfcfc, #1f1f1f);
    }

    .card h2 {
      margin-top: 0;
      font-size: 1.15rem;
    }

    .card h3 {
      font-size: 1rem;
      margin: 1rem 0 0.5rem;
    }

    .card.placeholder {
      border-style: dashed;
      background: light-dark(#fafafa, #222);
    }

    .card.error {
      border-color: light-dark(#d77, #d44);
      background: light-dark(#fff5f5, #2a1a1a);
    }

    .card.error pre {
      background: light-dark(#fef0f0, #1a0a0a);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.85em;
      white-space: pre-wrap;
      word-break: break-all;
    }

    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 0.4rem 1.25rem;
      margin: 0;
    }

    dt {
      font-weight: 500;
      color: light-dark(#555, #aaa);
    }

    dd {
      margin: 0;
    }

    ul {
      padding-left: 1.5em;
      margin: 0.5rem 0 0;
    }

    ul.episode-list,
    ul.scene-list {
      list-style: none;
      padding-left: 0;
      margin: 0.5rem 0 0;
    }

    ul.episode-list li,
    ul.scene-list li {
      padding: 0.25rem 0;
    }

    code {
      background: light-dark(#f0f0f0, #2a2a2a);
      padding: 0 0.25rem;
      border-radius: 3px;
      font-size: 0.95em;
    }

    a {
      color: light-dark(#0050a0, #6bb6ff);
    }

    .markdown > :first-child {
      margin-top: 0;
    }

    .markdown > :last-child {
      margin-bottom: 0;
    }

    .markdown h1 {
      font-size: 1.25rem;
      margin: 1.5rem 0 0.5rem;
    }

    .markdown h2 {
      font-size: 1.1rem;
      margin: 1.25rem 0 0.5rem;
    }

    .markdown h3 {
      font-size: 1rem;
      margin: 1rem 0 0.5rem;
    }

    .markdown p {
      margin: 0.75rem 0;
    }

    .markdown blockquote {
      border-left: 3px solid light-dark(#ccc, #555);
      padding: 0.25rem 1rem;
      margin: 0.75rem 0;
      color: light-dark(#555, #aaa);
    }

    .markdown pre {
      background: light-dark(#f4f4f4, #222);
      padding: 0.5rem 0.75rem;
      border-radius: 4px;
      overflow-x: auto;
      font-size: 0.9em;
    }

    .markdown pre code {
      background: transparent;
      padding: 0;
    }

    .markdown hr {
      border: none;
      border-top: 1px solid light-dark(#e0e0e0, #333);
      margin: 1.5rem 0;
    }

    .markdown table {
      border-collapse: collapse;
      margin: 0.75rem 0;
    }

    .markdown th,
    .markdown td {
      border: 1px solid light-dark(#ddd, #333);
      padding: 0.25rem 0.5rem;
    }

    .roll-form {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      margin: 0.25rem 0;
    }

    .roll-form label {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex: 1;
    }

    .roll-form .roll-label {
      font-family: ui-monospace, monospace;
      color: light-dark(#555, #aaa);
    }

    .roll-form input[type='text'] {
      flex: 1;
      padding: 0.25rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .roll-form button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .roll-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.9em;
      margin: 0.25rem 0;
    }

    .roll-history {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0 0;
    }

    .roll-history li {
      padding: 0.15rem 0;
    }

    .muted {
      color: light-dark(#555, #aaa);
      font-size: 0.9em;
      margin: 0.25rem 0;
    }

    .session-bar {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.4rem 0.6rem;
      margin: 0 0 1rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 6px;
      background: light-dark(#fafafa, #1f1f1f);
      font-size: 0.9em;
      flex-wrap: wrap;
    }

    .session-bar input {
      padding: 0.2rem 0.4rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .session-bar input.session-code {
      text-transform: uppercase;
      width: 8.5rem;
    }

    .session-bar input.session-name {
      width: 7rem;
    }

    .session-bar button {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
    }

    .session-bar .session-label {
      font-weight: 600;
    }

    .session-bar .session-sep {
      color: light-dark(#555, #aaa);
    }

    .session-bar .session-code-display code {
      font-size: 0.95em;
    }

    .session-bar .session-peers {
      color: light-dark(#555, #aaa);
      cursor: help;
    }

    .session-peers-warn {
      color: light-dark(#a04010, #d4885c);
      font-size: 0.9em;
    }

    .session-bar.session-active {
      border-color: light-dark(#9bb09b, #4a6a4a);
      background: light-dark(#f4faf4, #1a221a);
    }

    .session-bar.session-error {
      border-color: light-dark(#cc8888, #884444);
      background: light-dark(#fcf4f4, #221a1a);
    }

    .session-load-label {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      font-size: 0.85em;
    }

    .session-load-label input[type='file'] {
      display: none;
    }

    .reclaim-button {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#bb6a3a, #87481c);
      border-radius: 4px;
      background: light-dark(#fdf0d0, #2a1f10);
      color: light-dark(#7a4010, #d4885c);
      cursor: pointer;
      font-size: 0.85em;
    }

    .reclaim-modal {
      margin: 0.5rem 0;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#bb6a3a, #87481c);
      border-radius: 6px;
      background: light-dark(#fdf6e8, #221a10);
    }

    .reclaim-modal-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .reclaim-modal-actions button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .reclaim-button-confirm {
      border-color: light-dark(#bb6a3a, #87481c) !important;
      background: light-dark(#fdf0d0, #2a1f10) !important;
      font-weight: 600;
    }

    .resume-prompt {
      margin: 0 0 1rem;
      padding: 0.6rem 0.8rem;
      border: 1px solid light-dark(#9bb09b, #4a6a4a);
      border-radius: 6px;
      background: light-dark(#f4faf4, #1a221a);
    }

    .resume-prompt-actions {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .resume-prompt-actions button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .save-status {
      font-size: 0.85em;
      color: light-dark(#555, #aaa);
      width: 100%;
    }

    .save-status.save-error {
      color: light-dark(#a01010, #ff7070);
    }

    .roster-panel {
      margin-top: 0.5rem;
    }

    .roster-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .roster-head h2 {
      margin: 0;
    }

    .roster-count {
      font-weight: normal;
      color: light-dark(#555, #aaa);
      margin-left: 0.3rem;
    }

    .roster-toggle {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .roster-list {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .roster-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0.4rem;
      border-radius: 4px;
    }

    .roster-row.roster-row-self {
      background: light-dark(#f8f4e8, #221c10);
    }

    .roster-dm-tag {
      font-size: 0.7em;
      padding: 0.05rem 0.35rem;
      background: light-dark(#bb6a3a, #87481c);
      color: light-dark(#fff, #fdf0d0);
      border-radius: 3px;
      letter-spacing: 0.05em;
    }

    .roster-name {
      font-weight: 600;
    }

    .roster-char {
      color: light-dark(#555, #aaa);
      font-style: italic;
    }

    .roster-edit {
      margin-left: auto;
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 3px;
      background: light-dark(#fff, #1a1a1a);
      color: inherit;
      cursor: pointer;
      font-size: 0.8em;
    }

    .roster-kick {
      margin-left: 0.4rem;
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#cc8888, #884444);
      border-radius: 3px;
      background: light-dark(#fcf4f4, #221a1a);
      color: light-dark(#a01010, #ff7070);
      cursor: pointer;
      font-size: 0.8em;
    }

    .rename-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid light-dark(#eee, #2a2a2a);
    }

    .rename-form label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.9em;
    }

    .rename-form input[type='text'] {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
    }

    .rename-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .rename-actions button {
      padding: 0.25rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .version-badge {
      margin: 2rem 0 0;
      padding-top: 0.5rem;
      text-align: right;
      font-size: 0.75em;
      font-family: ui-monospace, monospace;
      color: light-dark(#555, #aaa);
      border-top: 1px solid light-dark(#f0f0f0, #2a2a2a);
      cursor: help;
    }

    .session-role-hint {
      width: 100%;
      margin: 0 0 0.5rem;
      padding: 0.3rem 0.5rem;
      font-size: 0.85em;
      color: light-dark(#555, #aaa);
      background: light-dark(#fdfaf2, #1a1812);
      border-left: 3px solid light-dark(#bb9a3a, #876618);
      border-radius: 3px;
      line-height: 1.4;
    }

    .session-bar-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
      width: 100%;
    }

    .session-copy-invite {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#9bb09b, #4a6a4a);
      border-radius: 4px;
      background: light-dark(#f4faf4, #1a221a);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .session-regenerate-code {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#bb9a3a, #876618);
      border-radius: 4px;
      background: light-dark(#fdf6e8, #2a2418);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .ai-key-hint {
      margin: 0.3rem 0 0;
      font-size: 0.8em;
      line-height: 1.4;
    }

    .ai-key-hint a {
      color: light-dark(#0050a0, #6bb6ff);
    }

    .broker-badge {
      display: inline-block;
      padding: 0.1rem 0.4rem;
      border: 1px solid light-dark(#bb9a3a, #876618);
      border-radius: 3px;
      background: light-dark(#fdf4d0, #2a2410);
      color: light-dark(#7a5e10, #d4b256);
      font-size: 0.8em;
      cursor: help;
    }

    .session-bar .session-error-msg {
      color: light-dark(#a01010, #ff7070);
    }

    .chat-panel .chat-list {
      list-style: none;
      padding: 0;
      margin: 0.5rem 0;
      max-height: 14rem;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      background: light-dark(#fafafa, #1a1a1a);
      border: 1px solid light-dark(#eee, #2a2a2a);
      border-radius: 4px;
      padding: 0.4rem 0.6rem;
    }

    .chat-panel .chat-list li {
      display: flex;
      gap: 0.4rem;
      font-size: 0.95em;
    }

    .chat-panel .chat-author {
      font-weight: 600;
      color: light-dark(#0050a0, #6bb6ff);
      flex-shrink: 0;
    }

    .chat-panel .chat-text {
      flex: 1;
      word-break: break-word;
    }

    .chat-form {
      display: flex;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .chat-form input {
      flex: 1;
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
    }

    .chat-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.85em;
      margin: 0.4rem 0 0;
    }

    .chat-form button {
      padding: 0.3rem 0.75rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
    }

    .reveal-chips {
      display: inline-flex;
      flex-wrap: wrap;
      gap: 0.3rem;
      align-items: baseline;
    }

    .reveal-chip {
      display: inline-flex;
      align-items: center;
      padding: 0.1rem 0.5rem;
      border: 1px solid light-dark(#d9c89b, #5a4d2a);
      border-radius: 3px;
      background: light-dark(#fdf8e7, #2a2418);
      text-decoration: none;
      color: inherit;
    }

    .reveal-chip.reveal-chip-current {
      background: light-dark(#f4c860, #6a4d2a);
      border-color: light-dark(#b88c20, #b8983e);
      cursor: default;
    }

    .reveal-chip-marker {
      font-size: 0.85em;
      margin-left: 0.25rem;
      color: light-dark(#7a5c10, #d4b256);
    }

    .reveal-banner {
      display: flex;
      gap: 0.5rem;
      align-items: baseline;
      padding: 0.4rem 0.6rem;
      margin: 0 0 1rem;
      border: 1px solid light-dark(#d9c89b, #5a4d2a);
      background: light-dark(#fdf8e7, #2a2418);
      border-radius: 6px;
      font-size: 0.92em;
      flex-wrap: wrap;
    }

    .reveal-banner-label {
      font-weight: 600;
    }

    .reveal-control {
      margin: 0.25rem 0 0;
    }

    .reveal-control button {
      padding: 0.3rem 0.75rem;
      border: 1px solid light-dark(#9a7e2a, #b8983e);
      border-radius: 4px;
      background: light-dark(#fdf3c8, #3a3018);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
    }

    .reveal-undo {
      margin-left: 0.5rem;
      padding: 0.25rem 0.6rem !important;
      border-color: light-dark(#888, #555) !important;
      background: light-dark(#f4f4f4, #222) !important;
      color: light-dark(#555, #aaa) !important;
      font-size: 0.85em !important;
    }

    .reveal-badge {
      display: inline-block;
      margin: 0.25rem 0 0;
      padding: 0.15rem 0.5rem;
      border-radius: 4px;
      font-size: 0.85em;
    }

    .reveal-badge-revealed {
      background: light-dark(#e0f0e0, #1f2a1f);
      color: light-dark(#2a6a2a, #88c088);
      border: 1px solid light-dark(#b0d0b0, #3a5a3a);
    }

    .reveal-badge-private {
      background: light-dark(#f0f0f0, #222);
      color: light-dark(#555, #aaa);
      border: 1px solid light-dark(#ddd, #333);
    }

    dl.stat-grid {
      display: grid;
      grid-template-columns: auto auto;
      gap: 0.25rem 0.75rem;
      margin: 0.5rem 0;
    }

    dl.stat-grid dt {
      font-weight: 600;
      align-self: center;
    }

    dl.stat-grid dd {
      margin: 0;
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .stat-bumpers {
      display: inline-flex;
      gap: 0.2rem;
    }

    .stat-bumpers button {
      width: 1.5rem;
      height: 1.5rem;
      padding: 0;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.9em;
      line-height: 1;
    }

    .stat-bumpers button:disabled {
      cursor: not-allowed;
      opacity: 0.4;
    }

    .track-boxes {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
    }

    .track-box {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.4rem;
      height: 1.4rem;
      padding: 0;
      border: 1px solid light-dark(#aaa, #555);
      border-radius: 3px;
      background: light-dark(#fff, #1a1a1a);
      color: inherit;
      font-family: ui-monospace, monospace;
      font-size: 0.9em;
      cursor: pointer;
    }

    .track-box.track-box-filled {
      background: light-dark(#444, #ddd);
      color: light-dark(#fff, #111);
      border-color: light-dark(#222, #aaa);
    }

    button.track-box:hover {
      outline: 1px solid light-dark(#0050a0, #6bb6ff);
    }

    .track-count {
      margin-left: 0.4rem;
      color: light-dark(#555, #aaa);
      font-size: 0.85em;
    }

    .ai-panel {
      border-color: light-dark(#c8b8d8, #4a3a5a);
      background: light-dark(#fbf8fd, #1f1a25);
    }

    .ai-panel-head {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 0.5rem;
    }

    .ai-panel-head h2 {
      margin: 0;
    }

    .ai-panel-head .ai-provider-tag {
      font-size: 0.8em;
      color: light-dark(#555, #aaa);
      margin-left: 0.5rem;
    }

    .ai-provider-choice {
      display: flex;
      gap: 0.75rem;
      border: 1px solid light-dark(#ddd, #333);
      border-radius: 4px;
      padding: 0.3rem 0.6rem;
      margin: 0;
    }

    .ai-provider-choice legend {
      font-size: 0.85em;
      padding: 0 0.3rem;
      color: light-dark(#555, #aaa);
    }

    .ai-provider-radio {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      font-size: 0.9em;
    }

    .ai-settings select {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .ai-settings-toggle {
      padding: 0.2rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }

    .ai-settings {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .ai-settings label {
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      font-size: 0.9em;
    }

    .ai-settings input,
    .ai-settings textarea {
      padding: 0.3rem 0.5rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: ui-monospace, monospace;
    }

    .ai-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      margin-top: 0.5rem;
    }

    .ai-form textarea {
      padding: 0.4rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#fff, #111);
      color: inherit;
      font-family: inherit;
      resize: vertical;
    }

    .ai-form-actions {
      display: flex;
      gap: 0.5rem;
      justify-content: flex-end;
    }

    .ai-form button {
      padding: 0.3rem 0.85rem;
      border: 1px solid light-dark(#9978b8, #6a4d8a);
      border-radius: 4px;
      background: light-dark(#ede4f6, #2a2030);
      color: inherit;
      cursor: pointer;
    }

    .ai-error {
      color: light-dark(#a01010, #ff7070);
      font-size: 0.9em;
      margin: 0.5rem 0 0;
    }

    .ai-response {
      margin-top: 0.75rem;
      padding: 0.5rem 0.75rem;
      background: light-dark(#fff, #15101a);
      border: 1px solid light-dark(#e0d5ec, #3a2e4a);
      border-radius: 4px;
    }

    .ai-response > button {
      margin-top: 0.5rem;
      padding: 0.25rem 0.6rem;
      border: 1px solid light-dark(#ccc, #444);
      border-radius: 4px;
      background: light-dark(#f4f4f4, #222);
      color: inherit;
      cursor: pointer;
      font-size: 0.85em;
    }
`;
