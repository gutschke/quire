/**
 * Integration tests — end-to-end multi-peer sessions on the in-memory
 * transport.  These exercise the gossip protocol, late join, partition,
 * heal, and concurrent edits.
 */

import { describe, it, expect } from 'vitest';
import { Simulator } from '../harness/simulator';

describe('Session — small game', () => {
  it('DM + 4 players play through a brief session and converge', () => {
    const sim = new Simulator();
    const dm = sim.addPeer('dm');
    const p1 = sim.addPeer('player1');
    const p2 = sim.addPeer('player2');
    const p3 = sim.addPeer('player3');
    const p4 = sim.addPeer('player4');

    dm.append('coordinator-claim', {});
    dm.append('peer-join', { name: 'DM' });
    p1.append('peer-join', { name: 'Player 1' });
    p2.append('peer-join', { name: 'Player 2' });
    p3.append('peer-join', { name: 'Player 3' });
    p4.append('peer-join', { name: 'Player 4' });

    dm.append('scene-reveal', {
      scenePath: 'episodes/001-unattended-baggage/scenes/01-wheels-up.md'
    });

    p1.append('chat', { text: 'Reading the scene.' });
    p2.append('dice-roll', {
      expression: '2d6+1',
      result: 8,
      dice: [4, 3]
    });
    p3.append('chat', { text: 'Good roll!' });
    p4.append('pc-edit', { pcId: 'p4-pc', field: 'harm', value: 1 });

    dm.append('scene-reveal', {
      scenePath: 'episodes/001-unattended-baggage/scenes/02-the-threads.md'
    });

    sim.verifyConvergence();

    expect(dm.state().coordinator).toBe('dm');
    expect(dm.state().revealedScenes).toHaveLength(2);
    expect(dm.state().chat).toHaveLength(2);
    expect(dm.state().diceRolls).toHaveLength(1);
    expect(dm.state().pcEdits['p4-pc'].harm).toBe(1);

    expect(p1.state().revealedScenes).toEqual(dm.state().revealedScenes);
    expect(p2.state().diceRolls).toEqual(dm.state().diceRolls);
  });
});

describe('Session — drop and reconnect', () => {
  it('a player partitioned mid-session catches up after reconnect', () => {
    const sim = new Simulator();
    const dm = sim.addPeer('dm');
    const p1 = sim.addPeer('player1');
    const p2 = sim.addPeer('player2');

    dm.append('coordinator-claim', {});
    dm.append('scene-reveal', { scenePath: 'scene1.md' });

    // p2 received scene1 before the partition.
    expect(p2.state().revealedScenes).toEqual(['scene1.md']);

    sim.partition('player2', true);
    dm.append('scene-reveal', { scenePath: 'scene2.md' });
    p1.append('chat', { text: 'where did player 2 go?' });
    p1.append('dice-roll', {
      expression: '1d20',
      result: 15,
      dice: [15]
    });

    // p2 missed everything that happened during the partition.
    expect(p2.state().revealedScenes).toEqual(['scene1.md']);
    expect(p2.state().chat).toHaveLength(0);
    expect(p2.state().diceRolls).toHaveLength(0);

    sim.partition('player2', false);

    expect(p2.state().revealedScenes).toEqual(['scene1.md', 'scene2.md']);
    expect(p2.state().chat).toHaveLength(1);
    expect(p2.state().diceRolls).toHaveLength(1);

    sim.verifyConvergence();
  });

  it('a player rejoining as a new peer catches up via sync', () => {
    const sim = new Simulator();
    const dm = sim.addPeer('dm');
    sim.addPeer('player1');
    dm.append('coordinator-claim', {});
    dm.append('scene-reveal', { scenePath: 'scene1.md' });
    dm.append('scene-reveal', { scenePath: 'scene2.md' });

    const lateJoiner = sim.addPeer('player2');
    expect(lateJoiner.state().revealedScenes).toEqual([
      'scene1.md',
      'scene2.md'
    ]);
    expect(lateJoiner.state().coordinator).toBe('dm');
    sim.verifyConvergence();
  });
});

describe('Session — concurrent edits during partition', () => {
  it('two PCs editing the same field while partitioned converge after heal', () => {
    const sim = new Simulator();
    sim.addPeer('dm');
    const p1 = sim.addPeer('player1');
    const p2 = sim.addPeer('player2');

    sim.partition('player1', true);
    sim.partition('player2', true);

    p1.append('pc-edit', { pcId: 'pc-shared', field: 'note', value: 'p1' });
    p2.append('pc-edit', { pcId: 'pc-shared', field: 'note', value: 'p2' });

    expect(p1.state().pcEdits['pc-shared'].note).toBe('p1');
    expect(p2.state().pcEdits['pc-shared'].note).toBe('p2');

    sim.partition('player1', false);
    sim.partition('player2', false);

    expect(p1.state().pcEdits['pc-shared'].note).toBe(
      p2.state().pcEdits['pc-shared'].note
    );
    sim.verifyConvergence();
  });
});

describe('Session — chaos', () => {
  it('survives interleaved partitions and concurrent appends', () => {
    const sim = new Simulator();
    const dm = sim.addPeer('dm');
    const p1 = sim.addPeer('p1');
    const p2 = sim.addPeer('p2');
    const p3 = sim.addPeer('p3');

    dm.append('coordinator-claim', {});

    sim.partition('p1', true);
    p2.append('chat', { text: 'p2-1' });
    p3.append('chat', { text: 'p3-1' });

    sim.partition('p2', true);
    p3.append('chat', { text: 'p3-2' });
    dm.append('chat', { text: 'dm-1' });

    sim.partition('p1', false);
    p1.append('chat', { text: 'p1-1' });

    sim.partition('p2', false);
    p2.append('chat', { text: 'p2-2' });

    sim.verifyConvergence();
    const chatLen = dm.state().chat.length;
    expect(chatLen).toBe(6);
    for (const p of [p1, p2, p3]) {
      expect(p.state().chat.length).toBe(chatLen);
    }
  });
});

describe('Session — peer leave', () => {
  it('a peer leaving via close still appears in state with leftAt set after explicit peer-leave', () => {
    const sim = new Simulator();
    sim.addPeer('dm');
    const p1 = sim.addPeer('player1');
    p1.append('peer-join', { name: 'P1' });
    p1.append('peer-leave', {});
    sim.verifyConvergence();
    expect(p1.state().peers.player1.leftAt).toBeGreaterThan(0);
  });
});

describe('Session — dice helper smoke', () => {
  it('records a sequence of dice rolls in order', () => {
    const sim = new Simulator();
    sim.addPeer('dm');
    const p1 = sim.addPeer('player1');
    p1.append('dice-roll', {
      expression: '2d6',
      result: 7,
      dice: [4, 3]
    });
    p1.append('dice-roll', {
      expression: 'd20',
      result: 18,
      dice: [18]
    });
    p1.append('dice-roll', {
      expression: '3d6+2',
      result: 14,
      dice: [4, 5, 3]
    });
    expect(p1.state().diceRolls).toHaveLength(3);
    expect(p1.state().diceRolls.map((r) => r.expression)).toEqual([
      '2d6',
      'd20',
      '3d6+2'
    ]);
    sim.verifyConvergence();
  });
});
