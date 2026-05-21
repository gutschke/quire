# Security

## Threat model

Quire is designed to be safe to fork, browse, and play through campaigns of unknown provenance. The main threats:

1. **A hostile campaign repo could try to execute JavaScript** in the player's browser. Mitigation: campaigns are data-only. The runtime never loads JS from a campaign repo. Markdown rendering uses a sanitized pipeline with raw HTML disabled.
2. **A hostile campaign could try to exfiltrate the DM's API key** via crafted prompts. Mitigation: the AI broker uses a fixed non-overridable system prompt that frames campaign-derived content as untrusted; campaign strings are wrapped in `<untrusted_content source="…">` tags with sentinel-token escaping before injection.
3. **A hostile campaign could try to mislead the DM via the AI prompt-bar**, e.g. by smuggling instructions inside an NPC's existing description that get re-fed into a prompt. Same mitigation as above: every campaign-derived string passes through the wrapper, including those read back from the campaign for diff context.
4. **A fork of the play app itself** (mode 2 self-host) could be malicious. Mitigation: the launch UI shows the build's SHA-256 with an opt-in warning. Users entering a non-canonical runtime origin see the hash and acknowledge.
5. **A pairing-code brute-force attack** on the signaling broker could let an outsider hijack a session. Mitigation: pairing codes are high-entropy plus a per-room secret in the URL fragment; sessions are ephemeral.
6. **A player's browser sees content meant only for the DM.** Mitigation: campaign repos use age-encrypted `dm/` subfolders; the DM holds the passphrase locally and it is never transmitted. Reveals broadcast the *decrypted record* (JSON or Markdown) to peers, not pre-rendered HTML — each peer renders independently in its sandboxed pipeline.

## What the canonical-origin model buys you

The play app lives at one origin we control: `play.quire.games`. This gives us:

- Real HTTP headers (CSP, SRI, Permissions-Policy), which `<meta>` CSP cannot fully provide.
- A stable trust anchor: when you visit a campaign by URL parameter, the runtime is known.
- The ability to pin every loaded asset with Subresource Integrity. No third-party JavaScript runs.
- A single bug-fix path: a security update to the runtime affects every campaign immediately.

The cost: a fork that wants to run its own runtime instead of using ours has to take responsibility for security. We document that path (mode 2) but warn forkers explicitly.

## What it does not buy you

- It does not prevent campaign content from being misleading or socially manipulative.
- It does not prevent a DM with a malicious local Chrome extension from leaking their own key.
- It does not prevent compromise of the DM's local device.
- It does not prevent a fork of the canonical runtime from replacing the trust model entirely. That's the cost of being open-source.
- It does not police the **DM's local clipboard**. The DM-only AI response card carries a "Copy (do not read aloud)" affordance; when used, the DM-only material enters the system clipboard. Linux clipboard managers (CopyQ, Klipper, GPaste) keep history; macOS Universal Clipboard syncs to the DM's iPhone; X11 forwarding over SSH propagates clipboards across hosts. Treating the DM's local clipboard as untrusted is out of scope. The affordance exists because DMs need to copy DM-only material into their own notes; the trust assumption is that the DM owns their machine and curates their own clipboard hygiene.

## AI broker invariants

The broker is the only path out of the bundle to external APIs. It enforces:

- `connect-src` allowlist: Anthropic, Gemini, GitHub raw, Google Drive App-folder, configured signaling. No other origin is reachable from the page.
- A fixed system prompt; campaign content cannot override it.
- Untrusted-content wrapping with sentinel-token escaping on every string sourced from campaign data.
- A per-session token budget with a visible meter and a hard stop.
- A hash-chained audit log (prompt, response, tokens, cost, accept/reject) that is exportable as verifiable JSON.
- **Structured tool returns** (`{safe, dmOnly, sources}`); the renderer never trusts free-form blobs. Parse failures degrade to a synthesized response, never an unfenced raw blob.
- **`contextRefs` path validation**: campaign-relative only, no `..`, no absolute paths. When the request scope is `public`, paths to `dm/*` and `design/DM-ONLY/` are rejected even if otherwise valid (defense in depth against a DM who toggles scope wrong mid-prompt).
- **Scope reset per prompt**: the DM's "include DM notes" toggle defaults back to `public` after every prompt submit. A one-off DM-only query does not stay armed for the next.
- **Coordinator-only**: `complete()` rejects calls from peers who are in `coordHolders` historically but are not currently the coordinator. Keeps the hash chain a strict chain (single appender), not a fork-prone DAG.

## DM-private content

Each episode's `dm/` subfolder is age-encrypted at rest. The campaign passphrase is held only by the DM, locally. It is never transmitted to other peers. New coordinators (during hub handoff) must enter the passphrase themselves to become decryptors.

Soft-spoiler plaintext mode is opt-in for campaigns where DM-private content is purely about pacing, not secrets that matter outside the table.

## Encryption details

- **Cipher:** libsodium sealed boxes via `age` (or compatible). Per-file encryption; not bulk-archive.
- **Key derivation:** passphrase → Argon2id → encryption key.
- **CLI tooling:** `quire encrypt-dm` and `quire decrypt-dm` handle batch operations. The browser runtime can also decrypt on-the-fly given the passphrase, without a CLI round trip.

## AI key storage

AI provider API keys are persisted to `localStorage` on the DM's machine under `quire.ai.<provider>.apiKey`. The runtime's canonical-origin model (`play.quire.games`, SRI-pinned assets, no third-party JavaScript) prevents page-resident code from leaking the key — but the key is NOT encrypted at rest. Specifically:

- A malicious **browser extension** with `storage` permission for the origin can read the key.
- **DevTools** users see the key in plain text under Application → Storage.
- **Browser clipboard managers** (CopyQ, Klipper, GPaste, macOS Universal Clipboard) retain a copy whenever the DM copies the key into the input.
- **Self-hosted forks (mode 2)** inherit this layout without the canonical-origin protections; the fork's runtime owners are responsible for the key's safety in their deployment.

This is documented residual risk, not a bug. The DM is treated as having control of their own machine. Production deployments may layer a per-user encryption-at-rest scheme (passphrase-derived key, libsodium SecretBox) over the localStorage layer if their threat model demands it; v1 does not.

## What forkers need to know

A few practices every forker should follow:

- Do not embed API keys in committed files. The runtime never asks for keys via campaign content; campaigns that prompt the user to paste an API key into a custom UI are suspect.
- Do not include `<untrusted_content>` literal strings or `<!--UC_CLOSE-->` sentinels in raw content. **Note (M1):** the load-time validator that will enforce this is scheduled for M3b alongside the AI broker upgrade. Until M3b ships, the prohibition is policy-only — comply via authorial discipline.
- Do not put player-targeted Markdown inside `dm/` folders. The runtime will not surface them to players, but the encryption is for content the DM intends to keep hidden.
- If you fork the runtime itself (mode 2), audit your `_headers` CSP, your AI broker, and your Markdown sanitizer. The published Quire releases pass a security review; your fork is your responsibility.

## Open questions

- **Whether to add a "report this campaign" affordance** to the canonical runtime, and how to triage reports without becoming a content moderation operation. Deferred.
- **Whether AI providers will tighten browser-from-key policies** during v1's lifetime. The architecture already routes Anthropic via extension to insulate against this.
