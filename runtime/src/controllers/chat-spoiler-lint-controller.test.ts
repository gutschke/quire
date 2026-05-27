// @vitest-environment node

/**
 * Unit tests for ChatSpoilerLintController.  Originally extracted
 * in E-LARGE-1 step 1 with only the end-to-end quire-app.chat.test
 * for coverage; the post-extraction session simulation (Session 4)
 * found a firewall-bypass bug that the end-to-end tests didn't
 * exercise — a co-DM reclaim leaves the prior DM's lint modal
 * open with a working "Send to chat anyway" button.  These tests
 * pin both the gate semantics AND the coord-loss auto-dismiss
 * fix.
 */

import { describe, it, expect } from 'vitest';
import type { ReactiveControllerHost } from 'lit';
import {
  ChatSpoilerLintController,
  type ChatSpoilerLintEnv
} from './chat-spoiler-lint-controller';
import type { AiProvider as AiProviderImpl } from '../ai/broker';

function makeHost() {
  let updates = 0;
  const host: ReactiveControllerHost = {
    addController: () => {},
    removeController: () => {},
    requestUpdate: () => {
      updates++;
    },
    updateComplete: Promise.resolve(true)
  };
  return { host, updateCount: () => updates };
}

interface EnvHandle {
  env: ChatSpoilerLintEnv;
  sentChats: string[];
  aiPrompts: string[];
  setCoord(value: boolean): void;
  setApiKey(value: string): void;
}

function makeEnv(opts: {
  isCoord?: boolean;
  apiKey?: string;
} = {}): EnvHandle {
  let isCoord = opts.isCoord ?? true;
  let apiKey = opts.apiKey ?? ''; // no AI by default so runAi doesn't fire
  const sentChats: string[] = [];
  const aiPrompts: string[] = [];
  let chatDraft = '';
  return {
    env: {
      isCoordinator: () => isCoord,
      hasActiveSession: () => true,
      getAiApiKey: () => apiKey,
      getAiProvider: () => 'claude',
      getAiProviders: () =>
        ({}) as Record<'claude' | 'gemini', AiProviderImpl>,
      getAiModel: () => 'claude-sonnet-4-6',
      chatMaxLength: () => 500,
      sendChat: (text) => sentChats.push(text),
      submitAiPrompt: (text) => aiPrompts.push(text),
      setChatDraft: (draft) => {
        chatDraft = draft;
      },
      clearChatError: () => {
        chatDraft = chatDraft; // touch to silence unused warning
      }
    },
    sentChats,
    aiPrompts,
    setCoord: (v) => {
      isCoord = v;
    },
    setApiKey: (v) => {
      apiKey = v;
    }
  };
}

describe('ChatSpoilerLintController — gateDraft', () => {
  it('passes through non-coord drafts (silent firewall: players never see anything)', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: false });
    const c = new ChatSpoilerLintController(host, h.env);
    expect(c.gateDraft('Sam, want to learn some magic?')).toBe(true);
    expect(c.state).toBeNull();
  });

  it('passes through coord drafts with no substring hits', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    expect(c.gateDraft('Roll for initiative.')).toBe(true);
    expect(c.state).toBeNull();
  });

  it('opens the modal when a coord draft has substring hits', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    expect(c.gateDraft('Anyone curious about magic in this place?')).toBe(
      false
    );
    expect(c.state).not.toBeNull();
    expect(c.state?.draft).toContain('magic');
    expect(c.state?.aiStatus).toBe('unchecked'); // no API key
  });
});

describe('ChatSpoilerLintController — confirmSend', () => {
  it('broadcasts the held draft to chat (silent — no marker)', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    expect(c.confirmSend()).toBe(true);
    expect(h.sentChats).toEqual(['magic talk']);
    expect(c.state).toBeNull();
  });

  it('returns false when no modal is open', () => {
    const { host } = makeHost();
    const h = makeEnv();
    const c = new ChatSpoilerLintController(host, h.env);
    expect(c.confirmSend()).toBe(false);
    expect(h.sentChats).toEqual([]);
  });
});

describe('ChatSpoilerLintController — routeToAi', () => {
  it('routes the draft to the AI panel instead of chat', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    expect(c.routeToAi()).toBe(true);
    expect(h.aiPrompts).toEqual(['magic talk']);
    expect(h.sentChats).toEqual([]); // critically NOT broadcast
    expect(c.state).toBeNull();
  });
});

describe('ChatSpoilerLintController — coord-loss auto-dismiss (Session 4 fix)', () => {
  /**
   * SECURITY BUG fix (post-session-simulation, 2026-05-27):
   * pre-fix, a co-DM reclaim left the prior DM's lint modal open.
   * The "Send to chat anyway" button only checks hasActiveSession
   * + chatMaxLength — NOT isCoordinator() — so a non-coord peer
   * could click Send and append a chat event that bypassed the
   * silent-firewall coord gate.  This pins the controller-side
   * defense: hostUpdated auto-dismisses the modal when
   * isCoordinator() flips false.
   */
  it('hostUpdated auto-dismisses the modal when local peer loses coord', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    expect(c.state).not.toBeNull();
    // Co-DM reclaim flips coord status.
    h.setCoord(false);
    c.hostUpdated();
    expect(c.state).toBeNull();
  });

  it('confirmSend refuses when local peer has lost coord (defense-in-depth)', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    // The reactive hostUpdated path is the primary defense; the
    // confirmSend gate is belt-and-suspenders in case the host
    // hasn't ticked yet.
    h.setCoord(false);
    expect(c.confirmSend()).toBe(false);
    expect(h.sentChats).toEqual([]); // critically NOT broadcast
  });

  it('hostUpdated is a no-op while the local peer is still coord', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    c.hostUpdated();
    expect(c.state).not.toBeNull(); // still open
  });

  it('hostUpdated is a no-op when no modal is open', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: false });
    const c = new ChatSpoilerLintController(host, h.env);
    c.hostUpdated();
    expect(c.state).toBeNull();
  });
});

describe('ChatSpoilerLintController — dismiss', () => {
  it('dismiss closes the modal + restores the draft', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    c.dismiss();
    expect(c.state).toBeNull();
  });
});

describe('ChatSpoilerLintController — hostDisconnected', () => {
  it('drops modal state on unmount (HMR / tab-close)', () => {
    const { host } = makeHost();
    const h = makeEnv({ isCoord: true });
    const c = new ChatSpoilerLintController(host, h.env);
    c.gateDraft('magic talk');
    c.hostDisconnected();
    expect(c.state).toBeNull();
  });
});
