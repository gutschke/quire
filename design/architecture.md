# Architecture

## Premise

Quire is a browser-based TTRPG framework whose prime directive is collaborative interactive storytelling. The software supports the DM and players; it does not drive the game. A session with zero dice rolls is just as legitimate as one with heavy combat. Mechanics scaffold the DM and inject randomness when randomness serves the story.

The framework is designed for in-person play around a shared table, with optional online sessions over WebRTC. Offline play is a first-class goal — the play app must remain usable after first load even when the network is gone.

## Runtime / content split

The play app and campaign content are intentionally separate.

- **Runtime** — the play app. A static-deployed web bundle that lives at the canonical origin `https://play.quire.games` (Cloudflare Pages, real HTTP headers, real CSP and SRI). This is the trust anchor: when someone joins a campaign, the runtime they execute comes from a known origin, not from the campaign's author.
- **Content** — a campaign repository. Plain JSON and Markdown files in a public git repo (typically on GitHub). Loaded by the runtime at play time via `?campaign=<owner>/<repo>@<commit-or-tag>`.

The runtime never loads JavaScript from a campaign repository. Campaign data is parsed, validated, and rendered through the bundled sanitized Markdown pipeline. This is what makes forks safe.

### Three forking modes

1. **Fork content (default).** Copy a campaign repo, edit, publish. Players visit `play.quire.games?campaign=your-name/your-fork`. No hosting setup, no runtime maintenance.
2. **Fork content + self-host runtime (advanced).** Use the documented `play.html` build artifact from a Quire release. The play app's launch UI shows the build's SHA-256 with an opt-in warning. The forker owns security.
3. **Full re-skin.** Fork both, change names, run a fully independent variant.

Mode 1 is the normal case and preserves "fork and play" — what changes from a naive single-HTML model is that the runtime is shared infrastructure rather than per-campaign code.

## Hosting

- Runtime: Cloudflare Pages with custom domain `play.quire.games`. Real HTTP headers (CSP, SRI, Permissions-Policy) configured via `_headers`. Build artifacts cached by Service Worker; offline-capable after first load.
- Campaign repos: GitHub Pages or raw GitHub fetches. The runtime caches campaign content aggressively in IndexedDB; live fetches happen on first load and on explicit reload.
- Sample campaign: <https://github.com/gutschke/underleaf>.

## Networking

- **Topology.** Star (DM peer is coordinator), but no peer is the source of truth. Every peer keeps an append-only event log keyed by `(peerId, seq)`. Reconciliation uses vector clocks; non-coordinator events resolve last-writer-wins per logical event. Coordinator-authored events (reveals, scene transitions, truncate) are single-writer and serialize trivially.
- **Coordinator and decryptor are separable roles.** The coordinator gatekeeps event ordering. The decryptor is the peer that holds the campaign passphrase. Same person in practice, but a peer can hold coordinator role without the passphrase — in that case they cannot emit `reveal` events.
- **Hub handoff.** Any peer can request the coordinator role; clean handoff or a timeout election. New coordinator must enter the passphrase themselves to also become decryptor.
- **Signaling.** PeerJS public broker by default; configurable in `campaign.json`. Self-hosted signaling is an advanced option.
- **STUN-only.** No TURN service in v1. In-person play is the primary use case; over-the-internet play requires both peers to have reachable STUN paths. Symmetric NAT pairs may fail to connect; the UI surfaces this explicitly rather than hanging.

## AI

- **Bring-your-own-key.** The DM provides their own Claude or Gemini API key. No central proxy, no shared secret.
- **Anthropic only via Chrome extension.** A first-party extension stores the Anthropic key and performs the fetch; the page never touches the key. Direct browser calls to `api.anthropic.com` are not used.
- **Gemini direct from the browser.** Acceptable residual risk because the runtime origin is canonical, no third-party JavaScript runs, SRI pins every loaded asset. Documented.
- **Players never invoke AI.** Only the DM uses the AI prompt bar. AI cannot reach The Quiet in Underleaf (a world-rule), and from a software perspective AI calls are scoped to DM-mode only.

### AI broker

The AI broker is the only path out of the bundle to external APIs. It enforces:

- A fixed, non-overridable system prompt that frames any campaign-derived content as untrusted.
- Wrapping of every campaign-sourced string in `<untrusted_content source="…">` tags with sentinel-token escaping. Strings that would contain the close-tag literal get the literal replaced with `<!--UC_CLOSE-->` before injection; load-time validation rejects raw campaign content containing this sentinel.
- A separate `<edit_target>` wrapper around the specific field a diff is operating on.
- A per-session token budget with a visible meter and a hard stop.
- A hash-chained audit log of every prompt, response, token count, cost, and DM accept/reject decision. The log is exportable as verifiable JSON for player audit.

### AI-assisted authoring

Authoring uses a diff-preview workflow: the DM describes a desired change ("make this NPC a bit more cunning, add a hidden agenda"), the AI returns a structured diff against the current record, and the DM accepts or rejects per-field. The diff carries the base version vector of every field it touches; if a field has moved since diff generation, the DM is re-prompted rather than silently overwriting.

## Storage and sync

- **IndexedDB** holds session state and the campaign tarball cache. Origin-bound to `play.quire.games`.
- **iOS Safari ITP** can evict IndexedDB after 7 days of inactivity. Sync is therefore mandatory in practice for any campaign that runs longer than a week.
- **Sync backends** (one per campaign, user-configurable): GitHub commit (DM with PAT or device flow), Google Drive App-folder scope, manual JSON file export/import.

## Storyboard and rewind

Per-session, the campaign repo carries `sessions/<YYYY-MM-DD>/{events.jsonl, snapshot.json, summary.md}`. The runtime's storyboard view renders this as a timeline of episodes, sessions, and scenes.

**Rewind** is supported at two granularities:

- Whole-session: archive `sessions/<date>/` into `sessions/_discarded/<date>/`, revert state to the session's pre-start `snapshot.json`. Committed to git, recoverable.
- Mid-session: coordinator-only broadcast `truncate(to_event_id)` event. All peers apply. Truncated events move to `_discarded/`, not deleted. Confirmation modal shows affected players and the events being dropped.

Branching sessions is deferred; v1's rewind is destructive-but-archived.

## Pluggable provider interfaces

Locked in phase 0 so the codebase doesn't accumulate non-pluggable hardcoded paths:

- `AIProvider` — `complete(messages, tools?, schema?) → response`. Implementations: Claude-via-extension, Gemini-direct, future local-LLM. Each declares capability flags (`supportsTools`, `supportsStreaming`, `supportsIncrementalEdit` for map providers, etc.) so the UI degrades gracefully when a less-capable backend is selected.
- `MapProvider` — `generate(prompt, scene_context) → MapJSON`. Default is `ai-text-to-grid` with two-pass plan-then-place tool calls and connectedness validation.
- `SyncBackend` — `pull()`, `push(diff)`, `status()`. GitHub / Drive / manual.
- `SignalingBackend` — PeerJS public, PeerJS self-hosted, future Cloudflare Worker or manual SDP exchange.

The sanitized Markdown renderer is **not** pluggable — it is a trust boundary and lives in the bundled runtime.

## UI shape

The default view is a **reference shelf**, not a chat channel: episode outline + active scene + a cmd-K search that finds any record (NPC, monster, item, spell, PC, lore, prior summary) in the loaded campaign. Inline quick-edit on any record by both DM and players, mobile-first. An always-present **AI prompt bar** for the DM accepts natural-language edits and returns a diff preview against the affected records.

The chat pane is collapsible and opens when peers join digitally, when the table wants a roll log, or when the DM wants slash-command dice. It is not the default.

The player sheet on phone is designed first; desktop is a superset.

## Out of scope (v1)

- AI map generation beyond coarse grids with named features.
- Tactical grid combat (theater of the mind only in v1).
- Live token movement on a battle map.
- Voice and video (use Discord or Jitsi alongside).
- Calendar / scheduling.
- iOS Progressive-Web-App installation (best-effort).
