import { describe, it, expect } from 'vitest';
import { Room, GRACE_MS } from '../room.js';

function setup(count = 2) {
  const room = new Room('ABCDEF123456', 0);
  const users = Array.from({ length: count }, (_, i) => room.join(`玩家${i}`, 0));
  const sequence = new Map();
  const send = (i, msg, time = room.wall) => {
    const seq = (sequence.get(i) || 0) + 1; sequence.set(i, seq);
    return room.command(users[i].memberId, { seq, ...msg }, time);
  };
  send(0, { type: 'start' });
  return { room, users, send };
}
describe('authoritative multiplayer room', () => {
  it('binds commands to the session and keeps every unrevealed hand secret', () => {
    const { room, users, send } = setup();
    expect(send(0, { type: 'pick', actor: 'p1', hand: 'rock' }).ok).toBe(true);
    expect(room.game.picks.has('p1')).toBe(false);
    const view = room.view(users[1].memberId);
    expect(view.game.players[0].hand).toBeNull();
    expect(JSON.stringify(view)).not.toContain('rock');
    for (const u of users) expect(JSON.stringify(view)).not.toContain(u.token);
    expect(send(1, { type: 'pause' }).ok).toBe(false);
  });
  it('reserves a queued step exactly once when a command is retried', () => {
    const { room, users, send } = setup(3);
    send(0, { type: 'pick', hand: 'rock' });
    send(1, { type: 'pick', hand: 'scissors' });
    send(2, { type: 'pick', hand: 'scissors' });
    room.advance(1300);
    const command = { seq: 3, type: 'knife', actor: 'p1', time: 999999 };
    const first = room.command(users[0].memberId, command, 1300);
    expect(first.ok).toBe(true);
    expect(room.command(users[0].memberId, command, 1300)).toEqual(first);
    expect(room.game.state.players[0].steps).toBe(1);
    expect(room.game.state.players[0].active.endsAt).toBe(2.3);
  });
  it('restores private picks and active queues, then catches up at exact deadlines', () => {
    const { room, users, send } = setup(3);
    send(0, { type: 'pick', hand: 'rock' });
    const restoredPicks = new Room(room.code, 0, room.save());
    expect(restoredPicks.game.picks.get('p0')).toBe('rock');
    send(1, { type: 'pick', hand: 'scissors' }); send(2, { type: 'pick', hand: 'scissors' });
    room.advance(1300); send(0, { type: 'knife' }); send(0, { type: 'move', target: 'p1' });
    const restored = new Room(room.code, 2000, room.save());
    restored.advance(2300);
    expect(restored.game.state.players[0].knife).toBe(true);
    expect(restored.game.state.players[0].location).toBeNull();
    restored.advance(4400);
    expect(restored.game.state.players[0].location).toBe('p1');
    expect(restored.game.state.phase).toBe('between');
    expect(restored.authenticate(users[0].token).playerId).toBe('p0');
  });
  it('never accepts another player or an unknown command as the host', () => {
    const r = new Room('ABCDEF123456', 0);
    const a = r.join('甲', 0), b = r.join('乙', 0);
    expect(r.command(b.memberId, { type: 'start', seq: 1 }, 0).ok).toBe(false);
    expect(r.command(a.memberId, { type: 'start', seq: 1 }, 0).ok).toBe(true);
    expect(r.join('迟到', 1).ok).toBe(false);
    expect(r.command(b.memberId, { type: 'reset', seq: 2 }, 1).ok).toBe(false);
  });
  it('lets a player reconnect in grace and forfeits a missing player without blocking RPS', () => {
    const { room, users, send } = setup(3);
    send(0, { type: 'pick', hand: 'rock' }); send(1, { type: 'pick', hand: 'scissors' });
    room.command(users[0].memberId, { type: 'ping' }, 60000);
    room.command(users[1].memberId, { type: 'ping' }, 60000);
    expect(room.authenticate(users[2].token)).toBeTruthy();
    room.advance(GRACE_MS);
    expect(room.game.state.players[2].alive).toBe(false);
    expect(room.game.state.phase).toBe('reveal');
    expect(room.game.state.players[0].steps).toBe(1);
  });
  it('transfers an absent host, expires abandoned rooms, and never authenticates bots', () => {
    const r = new Room('ABCDEF123456', 0);
    const a = r.join('甲', 0), b = r.join('乙', 0);
    r.command(a.memberId, { type: 'addBot', seq: 1 }, 0);
    expect(r.authenticate(null)).toBeUndefined();
    r.command(b.memberId, { type: 'ping' }, 60000); r.advance(GRACE_MS);
    expect(r.host).toBe(b.memberId);
    r.advance(2_000_000); expect(r.expired).toBe(true);
  });
  it('runs computer players on the server without a human opponent browser', () => {
    const r = new Room('ABCDEF123456', 0); const a = r.join('甲', 0);
    r.command(a.memberId, { type: 'addBot', seq: 1 }, 0);
    r.command(a.memberId, { type: 'start', seq: 2 }, 0);
    r.advance(1000);
    expect(r.game.state.players[1].picked).toBe(true);
    expect(r.view(a.memberId).game.players[1].hand).toBeNull();
  });
});
