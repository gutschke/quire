# Player D (Riley) — DM persona spec

Authored by the UX agent for Phase 0.5 of the multi-session test
plan.  Pairs with `player-c-persona.md` (Sam, player seat).  Riley
sits in the DM seat in run-2 (role-swap) and in subsequent
multi-session runs where the DM perspective needs coverage.

## Persona

**Name:** Riley Okafor.  Late 30s.  ~5 years running games
online: a Foundry-hosted Pathfinder 2e campaign weekly, a
Discord-and-Roll20 PbtA hack weekly.  Has dabbled with Owlbear
Rodeo and Alchemy RPG.

**Software comfort:** High end of non-developer.  Reads release
notes, will open a JSON in a text editor, but has never written
code beyond copy-pasted Foundry macros.

**Workflow constraint:** single 27" monitor; Discord (voice +
text channel) on a second monitor.  No tablet, no streamdeck, no
second runtime tab unless forced.

**Tabletop values, in priority order:**
1. **Flow at the table.** Anything that breaks scene momentum is
   a UX bug.  A 4s pause where nobody knows what's happening is
   worse than a wrong rule.
2. **Visibility of player state.** Riley needs to know who joined,
   whose turn it is, who rolled what — without asking.  Asking
   taxes the fiction.
3. **DM prep stays hidden.** NPC sheets, AI drafts, and unrevealed
   scenes must not leak.  Accidental reveals are unrecoverable.
4. **Session continuity.** Save at session end, resume next week
   with the same players in the same seats.

**Catchphrases:**
- "If I have to say 'hold on, the app is doing something' out
  loud, you've lost me."
- "I shouldn't have to triple-click anything."
- "I'd rather see a confirmation I don't need than make a mistake
  I can't undo."

**Out of scope:** edge probes (those belong to Player B,
QA-adversarial).  Riley reports REAL friction in real DM
workflows.

## Report format

JSON written to `e2e/results/player-d-<runId>.json`.  Schema is
identical to Player C's:

```json
{
  "persona": "player-d-riley",
  "runId": "<run-id>",
  "beats": [
    {
      "beat": "<short-id>",
      "task": "<one-line description>",
      "expectedSteps": <number>,
      "actualSteps": <number>,
      "msToFirstFeedback": <number | null>,
      "friction": [
        {
          "severity": "blocking" | "significant" | "minor" | "nit",
          "summary": "<one-sentence>",
          "filePathHint": "<src/file/where/the/fix/lives>",
          "note": "<optional>"
        }
      ]
    }
  ]
}
```

Severity rubric (same as Sam's):
- **blocking** — Riley cannot complete the beat; play stops.
- **significant** — completes but visibly loses flow (>3s pause,
  has to discuss app state with players, makes a mistake to walk
  back).
- **minor** — extra clicks or awkward visual; scene keeps moving.
- **nit** — copy, spacing, color.

`msToFirstFeedback` = ms between Riley's primary action and any
visible UI change.  `null` if nothing within 2s — itself a
finding.

## Scripted beats

In chronological order.  No arbitrary `sleep` — wait for explicit
UI signals.

### Beat 1 — Pre-session prep: open campaign, scan an NPC

**Task.** Open `?campaign=gutschke/underleaf`, navigate to the
NPC list, open Yui (or Reggie), skim stats and tags.

**Riley's prediction.** 3 clicks: open campaign → NPCs → pick
NPC.  Sheet renders <800ms.  Harm/stress visible if defined.

**Playwright sketch.**
```ts
await page.goto('/?campaign=gutschke/underleaf');
await expect(page.getByRole('heading', { name: /underleaf/i })).toBeVisible();
const t0 = Date.now();
await page.getByRole('link', { name: /Yui/i }).click();
await expect(page.getByRole('heading', { name: /Yui/i })).toBeVisible();
const sheetMs = Date.now() - t0;
expect(sheetMs).toBeLessThan(800);
await expect(page.getByText(/Harm/i)).toBeVisible();
```

**Friction budget.** <3 clicks, <800ms per navigation.  Flag if
the NPC link is not obvious from campaign landing.

**Record.** `beat: "prep-npc"`, `expectedSteps: 3`,
`msToFirstFeedback: sheetMs`.

### Beat 2 — Pre-session prep: test the AI aide

**Task.** Open the AI panel, enter a benign prompt ("describe
the rain on the cabin roof, two sentences"), click Ask, see
response.

**Riley's prediction.** Panel visible without scrolling.  API
key already set.  Response <3s (mocked).

**Playwright sketch.**
```ts
await expect(page.locator('.ai-panel')).toBeVisible();
await page.locator('.ai-form textarea').fill(
  'Describe the rain on the cabin roof, two sentences.'
);
const t0 = Date.now();
await page.getByRole('button', { name: /^Ask$/ }).click();
await expect(page.locator('.ai-response')).toBeVisible();
const askMs = Date.now() - t0;
```

**Friction budget.** Ask → response <3s with mocked client.  Flag
if AI panel only appears on certain routes — Riley wants to test
without navigating.

**Record.** `beat: "prep-ai-test"`.

### Beat 3 — Host a session and share the pairing code

**Task.** Type display name "Riley", click Host session, get the
code into Discord for two players.

**Riley's prediction.** Click Host → code appears <2s.  A Copy
button next to the code copies to clipboard with a toast.

**Playwright sketch.**
```ts
await page.locator('.session-name').fill('Riley');
const t0 = Date.now();
await page.getByRole('button', { name: /Host session/i }).click();
await expect(page.locator('.session-code-display code')).toBeVisible();
const hostMs = Date.now() - t0;
// EXPECTED but currently MISSING:
const copyBtn = page.getByRole('button', { name: /copy/i });
const hasCopy = await copyBtn.isVisible().catch(() => false);
expect(hasCopy).toBe(true); // will FAIL today — record as friction
```

**Friction budget.** Riley expects 1 click to copy.  Today only
path is triple-click on `<code>` + Ctrl+C — three interactions on
a tiny target while players watch.

**Record.** `beat: "host-share-code"`, `expectedSteps: 2`
(Host, Copy), `actualSteps: 4+`.  Friction:
```json
{
  "severity": "significant",
  "summary": "No Copy button next to pairing code; DM must triple-click <code> to share over Discord.",
  "filePathHint": "src/quire-app.ts#renderSessionBar"
}
```

### Beat 4 — Wait for players to join

**Task.** Wait 30-60s for players to paste the code.  Riley
needs to know, without asking on voice, when each player joins
and who they are.

**Riley's prediction.** Session bar shows a live peer count that
increments; each player's display name appears in a chip list; a
subtle "joined" indicator catches Riley's eye while they look at
prep on the other monitor.

**Playwright sketch.**
```ts
await expect(page.locator('.session-peers')).toHaveText(/no peers yet/);
// Sam joins from another context...
await expect(page.locator('.session-peers')).toHaveText(/1 peer/, {
  timeout: 5000
});
await expect(page.getByText(/Sam/)).toBeVisible();
```

**Friction budget.** A bare "1 peer" with no name is minor —
Riley does NOT know if it's Sam or a stranger who guessed the
code.  If names only appear after a chat message, that's
significant: Riley uses the join event itself as a ready check.

**Record.** `beat: "host-wait-for-players"`.

### Beat 5 — Reveal Scene 1

**Task.** Navigate to Episode 1, Scene 1, click "Reveal to
players."

**Riley's prediction.** 2 clicks from campaign root.  Reveal
button prominent on the scene page itself (not buried in a
menu).  Button changes to "Already revealed"; players' banner
appears <500ms.

**Playwright sketch.**
```ts
await page.getByRole('link', { name: /episode 1/i }).click();
await page.getByRole('link', { name: /scene 1/i }).click();
const t0 = Date.now();
await page.getByRole('button', { name: /Reveal to players/i }).click();
await expect(page.locator('.reveal-badge-revealed')).toBeVisible();
const revealMs = Date.now() - t0;
expect(revealMs).toBeLessThan(500);
await expect(samPage.locator('.reveal-banner')).toContainText(/scene 1/i);
```

**Friction budget.** Reveal control must be visually distinct so
Riley doesn't double-reveal or click the wrong scene.

**Record.** `beat: "reveal-scene-1"`.

### Beat 6 — Ask a player for a roll

**Task.** Mid-scene, type in chat: "Yui, roll +DEX to vault the
railing."  Riley needs to know whether Sam (playing Yui) saw it
and rolled — without breaking voice immersion.

**Riley's prediction.** Sam's roll lands in the shared dice log
within seconds.  Riley does NOT need to ask "did you roll?"  If
Sam stalls, Riley wants no UI signal either way (today) — record
that gap.

**Playwright sketch.**
```ts
await page.locator('.chat-panel form input').fill(
  'Yui, roll +DEX to vault the railing.'
);
await page.locator('.chat-panel form button').click();
await samPage.locator('button:has-text("Roll")').click();
await expect(page.locator('.dice-log').last()).toContainText(/DEX/, {
  timeout: 3000
});
```

**Friction budget.** THE flow-critical beat.  >3s from Sam's
click to Riley's visible dice entry is significant.  Flag if
chat doesn't visually associate the request with a player ("did
Riley mean me?"), or if the dice log doesn't surface new entries
(no badge, no autoscroll).

**Record.** `beat: "request-roll"`,
`msToFirstFeedback: <chat-send-to-dice-arrive>`.

### Beat 7 — Use the AI aide for an NPC voice

**Task.** Yui needs a first line.  Open AI aide, prompt: "Yui,
soft-spoken archivist, greets the players as they enter the
reading room; one line, in character, no stage directions."
Click Ask, review, click Share to chat.

**Riley's prediction.** Response <3s.  Share button visible
without scrolling.  Players see Yui's line attributed to Yui,
not prefixed with something that breaks immersion.

**Playwright sketch.**
```ts
await page.locator('.ai-form textarea').fill(
  'Yui, soft-spoken archivist, greets the players...'
);
await page.getByRole('button', { name: /^Ask$/ }).click();
await expect(page.locator('.ai-response')).toBeVisible();
await page.getByRole('button', { name: /Share to chat/i }).click();
const lastChat = page.locator('.chat-list li').last();
await expect(lastChat).toContainText(/Yui|reading room/i);
// Today: prefixed "[AI]" — tonal grenade.
await expect(lastChat).toContainText(/\[AI\]/); // documents the friction
```

**Friction budget.** Literal `[AI]` prefix announces "this is
fake" exactly when Riley wanted Yui's line to land.  Wants either
a per-share toggle (post as DM / post as Yui) or the marker moved
to a DM-only visual chip — not in the message body.

**Record.** `beat: "ai-npc-voice"`.  Friction:
```json
{
  "severity": "significant",
  "summary": "AI-shared chat always carries literal '[AI]' prefix in the message body; breaks immersion for NPC dialogue.",
  "filePathHint": "src/quire-app.ts#shareAiResponseToChat"
}
```

### Beat 8 — Apply harm to a PC

**Task.** Riley narrates "the cave-in deals 2 harm to Yui," then
navigates to Yui's PC sheet to fill in 2 harm boxes.

**Riley's prediction.** Same harm-track checkboxes Sam sees
should be editable from the DM seat.  Table-stakes for any VTT.

**Playwright sketch.**
```ts
await page.goto('/?campaign=gutschke/underleaf&pc=yui');
await expect(page.getByText('Harm')).toBeVisible();
const firstHarmBox = page.locator('[data-track="harm"] button').first();
await expect(firstHarmBox).toBeEnabled(); // currently FAILS for DM
await firstHarmBox.click();
await expect(samPage.locator('[data-track="harm"] button').first())
  .toHaveAttribute('aria-pressed', 'true');
```

**Friction budget.** Blocking for the DM workflow.  Today
`editable` is gated on `character.kind === 'pc' && active
session` with no coordinator branch — only the PC's own player
can edit.  Riley has to interrupt the scene ("Sam, mark 2 harm
please") — exactly the attention-tax Riley budgets against.

**Record.** `beat: "apply-harm-pc"`, `expectedSteps: 2`,
`actualSteps: 0` (cannot complete; delegated via chat).  Friction:
```json
{
  "severity": "blocking",
  "summary": "DM cannot edit a PC's harm/stress tracks; only the owning player can. Forces DM to interrupt the scene to ask.",
  "filePathHint": "src/quire-app.ts#renderCharacter (editable gate)"
}
```

### Beat 9 — Reveal Scene 2, then navigate back to Scene 1

**Task.** Reveal Scene 2.  Two minutes later, navigate back to
Scene 1 to re-read a callout.  What does the reveal banner show
to PLAYERS?

**Riley's prediction.** The banner reflecting the LATEST reveal
is fine.  But Riley assumes there's some way to revisit Scene 1
without it being weird — either a history of recent reveals, or
the ability to re-reveal Scene 1.  Today, revealing Scene 2
overwrites the banner; the only path back is for Riley to
navigate AND chat "go back to Scene 1."

**Playwright sketch.**
```ts
await page.goto('/?campaign=gutschke/underleaf&episode=ep1&scene=scene-2');
await page.getByRole('button', { name: /Reveal to players/i }).click();
await expect(samPage.locator('.reveal-banner')).toContainText(/scene-2/);

await page.goto('/?campaign=gutschke/underleaf&episode=ep1&scene=scene-1');
// Sam still sees scene-2 (latest reveal). Document this.
await expect(samPage.locator('.reveal-banner')).toContainText(/scene-2/);
// Reveal banner shows only one entry today — no history.
expect(await samPage.locator('.reveal-banner').count()).toBe(1);
```

**Friction budget.** Significant.  Riley's mental model is
"reveal is additive, like a breadcrumb."  Runtime model is
"reveal is a single latest pointer."

**Record.** `beat: "reveal-history"`.  Friction:
```json
{
  "severity": "significant",
  "summary": "Reveal banner shows only the latest reveal; no history. Players cannot easily revisit an earlier reveal once a new one lands.",
  "filePathHint": "src/quire-app.ts#renderRevealBanner"
}
```

### Beat 10 — Mid-session AI failure

**Task.** Mocked endpoint returns HTTP 500.  Riley must notice,
recover (retry or ad-lib), and keep the scene moving.

**Riley's prediction.** Error appears in-panel, clearly worded.
Ask button is re-enabled immediately.  Any previous response is
preserved as fallback.  No browser-level modal.

**Playwright sketch.**
```ts
await page.route('**/v1/messages*', (route) =>
  route.fulfill({ status: 500, body: '{"error":"internal"}' })
);
await page.locator('.ai-form textarea').fill(
  'Reggie smirks at the players; one line.'
);
const t0 = Date.now();
await page.getByRole('button', { name: /^Ask$/ }).click();
await expect(page.locator('.ai-error')).toBeVisible();
const errMs = Date.now() - t0;
expect(errMs).toBeLessThan(2000);
await expect(page.getByRole('button', { name: /^Ask$/ })).toBeVisible();
```

**Friction budget.** Significant if Riley has to refresh, clear
input, or hunt through settings to recover.  Minor if a single
clear error line.

**Record.** `beat: "ai-failure-recovery"`.

### Beat 11 — End of session: save

**Task.** Click Save.  Riley wants to know the filename without
opening Downloads.

**Riley's prediction.** 1 click.  Filename includes campaign
slug and date: `underleaf-2026-05-20.json` or similar.  A
toast confirms the save and surfaces the filename.

**Playwright sketch.**
```ts
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('button', { name: /^Save/i }).click()
]);
const name = download.suggestedFilename();
expect(name).toMatch(/underleaf.*\.json$/);
expect(name).toMatch(/2026-05-20/);
await expect(page.getByText(/saved/i)).toBeVisible();
```

**Friction budget.** 1 click.  `download.json` or
`quire-save.json` (no campaign, no date) is significant — Riley
runs multiple campaigns and will mix saves up.

**Record.** `beat: "save-end-of-session"`.

### Beat 12 — Leave as DM

**Task.** Click Leave.

**Riley's prediction.** Confirmation appears: "Leave session?
Players will lose connection."  Riley confirms.  Players see
"Riley has left the session" in chat or session bar.  Riley
returns to the solo bar.

**Playwright sketch.**
```ts
await page.getByRole('button', { name: /^Leave$/ }).click();
const confirm = page.getByRole('button', { name: /confirm|leave anyway/i });
await expect(confirm).toBeVisible({ timeout: 500 });
await confirm.click();
await expect(page.locator('.session-solo')).toBeVisible();
await expect(samPage.locator('.session-bar')).toContainText(
  /DM left|coordinator left|disconnected/i
);
```

**Friction budget.** No confirmation is significant — Riley will
eventually misclick Leave next to the broker badge and dump
players without warning.  No player-side notification is
significant.

**Record.** `beat: "leave-as-dm"`.

### Beat 13 — Next week: load, reclaim, host

**Task.** A week later: fresh runtime, click Load, pick the
saved JSON, click Reclaim with confirmation, then Host and share
a new code.

**Riley's prediction.**
- "Resume previous Underleaf session?" autosave prompt offered;
  Riley picks Load-from-file anyway to be sure.
- After load, Reclaim button is visible (Riley saved this).
- Reclaim confirmation says exactly what will happen.
- Host works as in Beat 3 — and the missing Copy button is felt
  again (record as RECURRING).

**Playwright sketch.**
```ts
await page.goto('/?campaign=gutschke/underleaf');
const fileChooser = page.waitForEvent('filechooser');
await page.getByRole('button', { name: /^Load/i }).click();
const fc = await fileChooser;
await fc.setFiles('e2e/fixtures/underleaf-2026-05-20.json');

await expect(page.getByRole('button', { name: /Reclaim/i })).toBeVisible();
await page.getByRole('button', { name: /Reclaim/i }).click();
const confirm = page.getByRole('button', { name: /confirm/i });
await expect(confirm).toBeVisible();
await confirm.click();

await page.getByRole('button', { name: /Host session/i }).click();
await expect(page.locator('.session-code-display code')).toBeVisible();
```

**Friction budget.** End-to-end: 5 clicks (Load, file pick,
Reclaim, confirm, Host).  Anything more is significant.  If
Reclaim is hidden or labelled obscurely, Riley will assume the
save is broken.

**Record.** `beat: "next-week-resume"`.  Reuse the Beat 3 tag for
the missing Copy button to surface the recurrence at triage.

## Adversarial DM probes (Phase 3.5)

Run-2 puts Player B (QA-adversarial) in a DM seat too.  Riley's
persona stays UX-focused, but the plan requires DM-only edge
coverage to land even if QA doesn't reach it.  Record each as a
separate beat; `severity: "significant"` if the runtime fails
quietly or corrupts, `severity: "minor"` if it fails safely-but-
loudly with a clear message.

### Probe A — Load mid-active-session

Riley is hosting; clicks Load and picks another save.  Expected:
warning dialog ("Loading replaces the current session.  Players
disconnect.  Continue?").  Silent player drop = blocking.

### Probe B — Reclaim when shouldn't

Player B in another context loaded the DM's save but is not the
original saver.  Assert the Reclaim button is NOT rendered for
Player B (visibility: `currentPeerId === savedByPeerId`).  No
button = no opportunity to mis-reclaim = desired outcome.

### Probe C — Save then immediately leave

Click Save, then Leave within 200ms.  Expected: download
completes (already triggered); leaving does not retract it.
Assert downloaded file parses cleanly with the same loader.

### Probe D — Save during in-flight AI request

Click Ask, then Save before AI returns.  Expected: save completes
from the event log (no in-flight AI state included); AI
unaffected; response renders normally on return.  No race, no
duplicated/dropped event.

### Probe E — Two rapid AI requests

Click Ask, edit prompt, click Ask again before the first returns.
Expected: first request is aborted (existing `aiAbort` pattern);
only the second response surfaces.  Assert no `[AI]` artifact
from the first request leaks into chat.

### Probe F — Open the same save in two tabs

Same browser, same `savedByPeerId` persistence.  Both tabs see
Reclaim.  Both click Reclaim.  Expected per the concurrent-reclaim
spec: deterministic resolution by event order; loser's UI
updates to non-coordinator.  Riley wouldn't normally do this,
but might have a stale tab open from last week.

## Cross-cutting anti-patterns

Apply as lenses across all beats; add a friction entry with the
lens name in `note` whenever violated.

- **Silent state changes.** Click → nothing visible for >200ms
  with no spinner / no disable.  `minor` per occurrence.
- **Player-visible DM prep.** NPC sheets, AI drafts, or
  unrevealed scenes leaking via the shared event log.
  `blocking` regardless of beat.
- **Asymmetric vocabulary.** DM-facing button says "Reveal" but
  player-side banner says "Shared" (or any drift).  `minor` —
  Riley uses the same words to players that the UI uses to Riley.
- **Modal interrupts.** Any `window.confirm`/`window.alert`
  mid-session.  `significant` — Riley wants in-place dismissable
  confirmations, not focus-grabbing browser modals.
- **Lost dice / lost chat.** A roll or chat message Riley
  expected fails to appear, even once.  `blocking` — Riley will
  not trust the runtime for the rest of the session.

## Run discipline

Riley runs the beats in order, top to bottom, with NO retries
within a beat.  If a beat is blocking, Riley records the blocker
and skips to the next beat that does not depend on the failed
state (e.g., a blocked Beat 8 does not stop Beat 9).

Step counts are literal user-visible interactions (click,
type-and-Enter, file-select).  Page loads triggered by navigation
count as zero steps.

Friction entries are short and specific — one-line summary plus
file path hint is more useful at triage than a paragraph.

## Out-of-band channels

Test scaffolding, not runtime UX:

- `e2e/results/scratchpad-<runId>.md` is Riley's test-meta
  scratchpad.  Append PASS / FAIL / FRICTION per beat.  Other
  agents read at beat boundaries.
- The runtime's own chat is for in-character communication only.
  Anything typed there becomes part of the event log and would
  round-trip through save/load — putting test notes there would
  persist forever.

Keep the two channels strictly separate.
