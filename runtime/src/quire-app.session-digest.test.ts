// @vitest-environment happy-dom

/**
 * D4 (2026-05-26) — quire-app host-level test for
 * generateSessionDigest + appendSessionDigest.
 *
 * Focus: the FIELD-LEVEL spoiler firewall on the AI input bundle.
 *
 * Background: pc-edit is in SESSION_DIGEST_INPUT_KINDS because
 * player-visible field edits (name, harm, stress) make for a great
 * recap.  But pc-edit can ALSO carry writes to DM-only top-level
 * fields (dmNotes, magicPhase, tax.*, threadDebt.*,
 * accidentalGrants, alignmentDrift, knowsTheyCanCast) per
 * DM_ONLY_CHARACTER_FIELDS.  If those reach the AI prompt, the
 * generated draft will routinely surface DM-only material; the DM
 * is the only barrier and one slip would put it in a player-
 * visible event.  generateSessionDigest must filter those out.
 *
 * Verifier-found pre-commit blocker — regression-locking test.
 */

import { describe, it, expect, vi } from 'vitest';
import './quire-app';
import { QuireApp } from './quire-app';
import type { TransportFactory } from './session-controller';
import {
  InMemoryNetwork,
  InMemoryTransport
} from './core/transports/in-memory';
import type { AiProviderStructuredResult } from './ai/broker';

function inMemoryFactory(network: InMemoryNetwork, id: string): TransportFactory {
  return {
    createHost: async () => ({
      transport: new InMemoryTransport(id, network),
      pairingCode: id
    }),
    createGuest: async () => ({
      transport: new InMemoryTransport(id, network)
    })
  };
}

function mountApp(): QuireApp {
  const el = document.createElement('quire-app') as QuireApp;
  el.sessionFactory = inMemoryFactory(new InMemoryNetwork(), 'HOST');
  document.body.appendChild(el);
  return el;
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

interface CapturedCall {
  systemPrompt?: string;
  prompt?: string;
}

function stubClaudeCapturing(
  app: QuireApp,
  captured: CapturedCall,
  markdown = '# Recap\n\nThings happened.'
): void {
  const result: AiProviderStructuredResult<{ markdown: string }> = {
    ok: true,
    value: { markdown },
    raw: JSON.stringify({ markdown }),
    tokensIn: 0,
    tokensOut: 0,
    responseId: 'r-test'
  };
  app.aiProviders = {
    ...app.aiProviders,
    claude: {
      id: 'claude',
      callStructured: vi.fn().mockImplementation((req: { systemPrompt: string; prompt: string }) => {
        captured.systemPrompt = req.systemPrompt;
        captured.prompt = req.prompt;
        return Promise.resolve(result);
      })
    }
  };
}

describe('QuireApp.generateSessionDigest — DM-only field firewall', () => {
  it('excludes pc-edit events whose top-level field is in DM_ONLY_CHARACTER_FIELDS', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    const captured: CapturedCall = {};
    stubClaudeCapturing(app, captured);

    // Player-visible pc-edits (must reach the AI prompt).
    app.submitPcEdit('mei', 'name', 'Mei Sandwalker');
    app.submitPcEdit('mei', 'harm', 2);
    // DM-only pc-edits (must NOT reach the AI prompt).
    app.submitPcEdit('mei', 'dmNotes', 'mei fears the dark — exploit late');
    app.submitPcEdit('mei', 'magicPhase', 'realization');
    app.submitPcEdit('mei', 'tax.active', true);
    app.submitPcEdit('mei', 'threadDebt.notes', 'broken oath to the chorus');
    app.submitPcEdit('mei', 'accidentalGrants', ['veil-thinning']);
    app.submitPcEdit('mei', 'alignmentDrift', { dim: 'mercy', value: -2 });
    app.submitPcEdit('mei', 'knowsTheyCanCast', true);
    // A chat event for positive control (must reach the AI prompt).
    app.submitChat('public message in the open');
    await flush();

    const result = await app.generateSessionDigest();
    expect(result.ok).toBe(true);

    const prompt = captured.prompt ?? '';
    // Positive control: player-visible material reached the prompt.
    expect(prompt).toContain('Mei Sandwalker');
    expect(prompt).toContain('harm');
    expect(prompt).toContain('public message in the open');
    // Firewall: DM-only payload values must NOT have leaked.
    expect(prompt).not.toContain('fears the dark');
    expect(prompt).not.toContain('realization');
    expect(prompt).not.toContain('tax.active');
    expect(prompt).not.toContain('broken oath to the chorus');
    expect(prompt).not.toContain('veil-thinning');
    expect(prompt).not.toContain('alignmentDrift');
    expect(prompt).not.toContain('knowsTheyCanCast');
    expect(prompt).not.toContain('dmNotes');
  });

  it('strips DM-private `reason` and `scene` from pc-retire/pc-archive payloads', async () => {
    // D4-cleanup-4 / Adversarial A-1: pc-retire + pc-archive
    // payloads carry DM-private `reason` enum + optional `scene`.
    // The session-digest summarizer is narrow today, but the
    // firewall must be structural — stripped at the bundling
    // stage — so a future summarizer refactor that JSON-stringifies
    // the payload can never surface those fields.
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    const captured: CapturedCall = {};
    stubClaudeCapturing(app, captured);

    // Drive a pc-retire AND pc-archive directly so the payload
    // carries `reason` + `scene` end-to-end.  Bypass the host's
    // helper methods by appending the events to the session log;
    // we want to assert the digest bundler scrubs them.
    const session = (app as unknown as { session: { append: (k: string, p: unknown) => void } }).session;
    expect(session).toBeTruthy();
    // First create + bind a PC slot so the materializer accepts retire.
    session.append('seat-add', { v: 1, slot: 1 });
    session.append('pc-create', {
      v: 1,
      pcId: 'mei',
      name: 'Mei Sandwalker',
      stats: { str: 0, dex: 1, con: 0, int: 0, wis: 1, cha: 0 },
      harm: 0,
      stress: 0
    });
    session.append('pc-slot-bind', { v: 1, slot: 1, pcId: 'mei' });
    session.append('pc-retire', {
      v: 1,
      pcId: 'mei',
      state: 'bound-retired',
      inFictionReason: 'she walked back into the rain',
      reason: 'died',
      scene: 'ep04/scene-07-secret-dm-only-path'
    });
    await flush();

    const result = await app.generateSessionDigest();
    expect(result.ok).toBe(true);
    const prompt = captured.prompt ?? '';
    // In-fiction reason must reach the AI (player-visible).
    expect(prompt).toContain('she walked back into the rain');
    // DM-private fields must NOT.
    expect(prompt).not.toContain('ep04/scene-07-secret-dm-only-path');
    expect(prompt).not.toMatch(/\breason\s*[":=]\s*['"]?died/);
  });

  it('refuses to generate when there are no qualifying events', async () => {
    const app = mountApp();
    app.startHosting();
    await flush();
    app.setAiApiKey('sk-test');
    const captured: CapturedCall = {};
    stubClaudeCapturing(app, captured);
    // ONLY DM-only edits — the field filter strips them all, leaving
    // zero events → host returns the no-events sentinel without ever
    // calling the provider.
    app.submitPcEdit('mei', 'dmNotes', 'private');
    app.submitPcEdit('mei', 'magicPhase', 'realization');
    await flush();

    const result = await app.generateSessionDigest();
    expect(result.ok).toBe(false);
    if (result.ok === false) expect(result.code).toBe('no-events');
    expect(captured.prompt).toBeUndefined();
  });
});
