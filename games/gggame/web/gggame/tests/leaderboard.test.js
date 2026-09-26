import { describe, it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { LeaderboardStore } from '../leaderboard.js';
import { Room, HOST_RECONNECT_MS } from '../room.js';
import { GGGame } from '../rules.js';

function store() {
  const db = new DatabaseSync(':memory:');
  return new LeaderboardStore({
    sql: { exec(query, ...args) { const stmt = db.prepare(query); return stmt.columns().length ? stmt.all(...args) : (stmt.run(...args), []); } },
    transactionSync(fn) { db.exec('BEGIN'); try { fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; } },
  });
}
function room() {
  const r = new Room('ABCDEF123456', 0);
  const a = r.join('甲', 0), b = r.join('乙', 0);
  r.command(a.memberId, { type: 'start', seq: 1 }, 0);
  return { r, a, b };
}
describe('durable leaderboard', () => {
  it('accumulates successful action counters and does not duplicate them on delivery retries', () => {
    const s = store();
    const match = { id: 'counts', players: [{ name: '甲', won: true, kills: 2, wears: 4 }] };
    s.record(match); s.record(match);
    s.record({ id: 'next', players: [{ name: '甲', won: false, kills: 1, wears: 2 }] });
    expect(s.read('甲').player).toMatchObject({ games: 2, wins: 1, kills: 3, wears: 6 });
  });
  it('records each match once, aggregates names across rooms, orders and searches exact names', () => {
    const s = store();
    const result = { id: 'one', players: [{ name: '甲', won: true }, { name: '乙', won: false }] };
    s.record(result); s.record(result);
    s.record({ id: 'two', players: [{ name: '甲', won: false }, { name: '丙', won: true }] });
    expect(s.read('甲').player).toEqual({ name: '甲', games: 2, wins: 1, winRate: .5, kills: 0, wears: 0 });
    expect(s.read().rows.map(p => p.name)).toEqual(['丙', '甲', '乙']);
    expect(s.read("' OR 1=1 --").player).toBeNull();
    expect(s.read('未知').player).toBeNull();
  });
  it('bounds the public list and supports names outside the top 50', () => {
    const s = store();
    for (let i = 0; i < 60; i++) s.record({ id: String(i), players: [{ name: `玩家${i}`, won: false }] });
    expect(s.read('玩家59').rows).toHaveLength(50);
    expect(s.read('玩家59').player.games).toBe(1);
  });
  it('keeps departed players, excludes bots and survives restore/rematch without double counting', () => {
    const { r, a, b } = room();
    expect(r.pendingResults).toEqual([]);
    r.command(b.memberId, { type: 'leave', seq: 1 }, 10);
    expect(r.pendingResults[0].players).toMatchObject([{ name: '甲', won: true }, { name: '乙', won: false }]);
    const restored = new Room(r.code, 10, r.save()); restored.finishMatch();
    expect(restored.pendingResults).toHaveLength(1);
    // Existing participants can rematch; a new bot is only added in the lobby.
    const ai = new Room('ABCDEF123457', 0); const host = ai.join('甲', 0);
    ai.command(host.memberId, { type: 'addBot', seq: 1 }, 0);
    ai.command(host.memberId, { type: 'start', seq: 2 }, 0);
    ai.game.state.phase = 'over'; ai.game.state.result = 'p0'; ai.finishMatch();
    ai.command(host.memberId, { type: 'rematch', seq: 3 }, 10);
    ai.close();
    expect(ai.pendingResults).toHaveLength(2);
    expect(new Set(ai.pendingResults.map(p => p.id)).size).toBe(2);
    expect(ai.pendingResults[0].players).toMatchObject([{ name: '甲', won: true }]);
    expect(ai.pendingResults[1].players).toMatchObject([{ name: '甲', won: false }]);
    const s = store(); for (const result of [...r.pendingResults, ...ai.pendingResults]) s.record(result);
    expect(s.read('甲').player).toMatchObject({ games: 3, wins: 2 });
  });
});
it('counts only settled successful wear and execution, never initial pants, failed actions or canceled jobs', () => {
  const g = new GGGame(); g.start(['甲', '乙', '丙']); g.state.phase = 'action';
  const [a, b] = g.state.players;
  Object.assign(a, { steps: 8, knife: true }); Object.assign(b, { steps: 3, location: 'p0', armor: 0 });
  expect(a.wears).toBe(0);
  g.invoke({ type: 'wear', actor: 'p0' }); g.update(.5); expect(a.wears).toBe(0);
  g.update(.5); expect(a.wears).toBe(1);
  g.invoke({ type: 'execute', actor: 'p0', target: 'p1' });
  g.invoke({ type: 'wear', actor: 'p1' }); g.update(3);
  expect(a.kills).toBe(0); expect(b.wears).toBe(1);
  g.invoke({ type: 'strip', actor: 'p0', target: 'p1' }); g.update(3);
  g.invoke({ type: 'execute', actor: 'p0', target: 'p1' }); g.update(3);
  expect(a.kills).toBe(1); expect(b.alive).toBe(false);
  g.invoke({ type: 'wear', actor: 'p0' }); a.alive = false; a.active = null; g.update(1);
  expect(a.wears).toBe(1);
  g.start(['甲', '乙']); expect(g.state.players[0]).toMatchObject({ kills: 0, wears: 0 });
});
describe('host lifecycle', () => {
  it('allows refresh within 15 seconds, persists disconnect deadline, then closes with no winner', () => {
    const { r, a } = room();
    r.disconnected(a.memberId, 1000); r.advance(15999); expect(r.expired).toBe(false);
    expect(r.connected(a.memberId, 15999)).toBe(true);
    r.advance(16000); expect(r.expired).toBe(false);
    r.disconnected(a.memberId, 17000);
    const restored = new Room(r.code, 17000, r.save());
    restored.advance(17000 + HOST_RECONNECT_MS);
    expect(restored.expired).toBe(true); expect(restored.game.state.result).toBeNull();
    expect(restored.pendingResults[0].players.every(p => !p.won)).toBe(true);
    expect(restored.connected(a.memberId, 32000)).toBe(false);
  });
  it('guest disconnect does not close the room and completed wins survive host closure', () => {
    const { r, a, b } = room();
    r.disconnected(b.memberId, 1000); r.advance(16000); expect(r.expired).toBe(false);
    r.command(b.memberId, { type: 'leave', seq: 1 }, 16000);
    r.disconnected(a.memberId, 16000); r.advance(31000);
    expect(r.expired).toBe(true); expect(r.pendingResults).toHaveLength(1);
    expect(r.pendingResults[0].players[0].won).toBe(true);
  });
});
it('draws last exactly one second for both two and three hand types; decisive results still take five', () => {
  for (const hands of [['rock', 'rock', 'rock'], ['rock', 'paper', 'scissors']]) {
    const g = new GGGame(); g.start(['甲', '乙', '丙']);
    hands.forEach((hand, i) => g.pick(`p${i}`, hand));
    g.update(.999); expect(g.state.phase).toBe('reveal');
    g.update(.001); expect(g.state.phase).toBe('rps'); expect(g.state.attempt).toBe(2);
    expect(g.state.round).toBe(1); expect(g.state.players.every(p => p.steps === 0 && !p.picked)).toBe(true);
  }
});
