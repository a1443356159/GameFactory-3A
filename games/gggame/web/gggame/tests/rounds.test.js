import { describe, it, expect } from 'vitest';
import { GGGame, REVEAL_SECONDS } from '../rules.js';
import { Room } from '../room.js';
import { CueTracker } from '../../src/gggame/audio.js';

const pick = (g, hands) => hands.forEach((hand, i) => g.pick(`p${i}`, hand));
describe('round results and losing-streak guarantee', () => {
  it('shows results for exactly five server seconds and rejects early actions', () => {
    const g = new GGGame(); g.start(['甲', '乙']); pick(g, ['rock', 'scissors']);
    expect(g.state.revealUntil - g.state.time).toBe(5);
    g.update(4.999); expect(g.state.phase).toBe('reveal');
    expect(g.invoke({ type: 'knife', actor: 'p0' }).ok).toBe(false);
    g.update(.001); expect(g.state.phase).toBe('action');
    expect(g.invoke({ type: 'knife', actor: 'p0' }).ok).toBe(true);
  });
  it('awards every seventh loss, keeps streak through draws, resets on wins and rematch', () => {
    const g = new GGGame(); g.start(['甲', '乙', '丙']);
    for (let loss = 1; loss <= 14; loss++) {
      pick(g, ['rock', 'scissors', 'scissors']);
      for (const p of g.state.players.slice(1)) {
        expect(p.steps).toBe(loss % 7 === 0 ? 3 : 0);
        expect(p.pityAward).toBe(loss % 7 === 0);
        expect(p.lossStreak).toBe(loss % 7);
      }
      expect(g.state.players[0].steps).toBe(2);
      g.nextRps(true);
      if (loss === 3) {
        pick(g, ['paper', 'paper', 'paper']);
        g.update(REVEAL_SECONDS); expect(g.state.phase).toBe('rps');
        expect(g.state.players[1].lossStreak).toBe(3);
      }
    }
    pick(g, ['rock', 'scissors', 'scissors']); g.nextRps(true);
    pick(g, ['scissors', 'rock', 'rock']); expect(g.state.players[1].lossStreak).toBe(0);
    g.start(['甲', '乙']); expect(g.state.players.every(p => p.lossStreak === 0)).toBe(true);
  });
  it('persists six losses and lets the seventh-loss player spend all three steps', () => {
    const r = new Room('ABCDEF123456', 0); r.join('甲', 0); r.join('乙', 0);
    r.command(r.host, { type: 'start', seq: 1 }, 0);
    r.game.state.players[1].lossStreak = 6;
    const restored = new Room(r.code, 0, r.save()); pick(restored.game, ['rock', 'scissors']);
    restored.advance(5000);
    for (const type of ['knife', 'wear', 'wear']) expect(restored.game.invoke({ type, actor: 'p1' }).ok).toBe(true);
    expect(restored.game.state.players[1].steps).toBe(0);
    expect(restored.game.state.players[1].queue.length).toBe(2);
  });
});

describe('leaving rooms and lobby-only moderation', () => {
  function room() {
    const r = new Room('ABCDEF123456', 0);
    const members = ['甲', '乙', '丙'].map(n => r.join(n, 0));
    return { r, members };
  }
  it('only the host can kick in the lobby, and a kicked identity cannot reconnect', () => {
    const { r, members: [a, b, c] } = room();
    expect(r.command(b.memberId, { type: 'kick', seq: 1, target: c.memberId }, 0).ok).toBe(false);
    expect(r.command(a.memberId, { type: 'kick', seq: 1, target: a.memberId }, 0).ok).toBe(false);
    expect(r.command(a.memberId, { type: 'kick', seq: 2, target: c.memberId }, 0).ok).toBe(true);
    expect(r.authenticate(c.token)).toBeUndefined();
    expect(new Room(r.code, 0, r.save()).members.length).toBe(2);
    r.command(a.memberId, { type: 'start', seq: 3 }, 0);
    expect(r.command(a.memberId, { type: 'kick', seq: 4, target: b.memberId }, 0).ok).toBe(false);
    expect(r.game.state.players[1].alive).toBe(true);
  });
  it('leaving a lobby transfers host immediately and the last human closes the room', () => {
    const { r, members: [a, b, c] } = room();
    expect(r.command(a.memberId, { type: 'leave', seq: 1 }, 0).ok).toBe(true);
    expect(r.host).toBe(b.memberId); expect(r.authenticate(a.token)).toBeUndefined();
    r.command(b.memberId, { type: 'leave', seq: 1 }, 0);
    r.command(c.memberId, { type: 'addBot', seq: 1 }, 0);
    r.command(c.memberId, { type: 'leave', seq: 2 }, 0);
    expect(r.expired).toBe(true);
  });
  it('leaving during RPS unblocks the remaining choices; leaving during action cancels the queue', () => {
    const { r, members: [a, b, c] } = room();
    r.command(a.memberId, { type: 'start', seq: 1 }, 0);
    r.game.pick('p0', 'rock'); r.game.pick('p1', 'scissors');
    r.command(c.memberId, { type: 'leave', seq: 1 }, 0);
    expect(r.game.state.phase).toBe('reveal');
    expect(r.game.state.players[0].steps).toBe(1);
    r.advance(5000); r.game.state.players[0].steps = 2;
    r.game.invoke({ type: 'knife', actor: 'p0' }); r.game.invoke({ type: 'wear', actor: 'p0' });
    r.command(a.memberId, { type: 'leave', seq: 2 }, 5000);
    expect(r.game.state.phase).toBe('over'); expect(r.game.state.result).toBe('p1');
    expect(r.game.state.players[0].active).toBeNull(); expect(r.game.state.players[0].queue).toEqual([]);
  });
});

it('plays new events once, distinguishes win/loss and ignores historical events on reconnect', () => {
  const g = new GGGame(); g.start(['甲', '乙']);
  const a = new CueTracker(), b = new CueTracker();
  const view = id => ({ playerId: id, game: g.getState() });
  expect(a.take(view('p0'))).toEqual([]); b.take(view('p1'));
  pick(g, ['rock', 'scissors']);
  expect(a.take(view('p0'))[0].name).toBe('win'); expect(b.take(view('p1'))[0].name).toBe('lose');
  expect(a.take(view('p0'))).toEqual([]);
  a.reset(); expect(a.take(view('p0'))).toEqual([]);
  g.update(REVEAL_SECONDS); g.invoke({ type: 'knife', actor: 'p0' }); g.update(1);
  expect(a.take(view('p0'))[0].name).toBe('knife');
});
