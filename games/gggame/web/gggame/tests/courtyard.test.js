import { it, expect } from 'vitest';
import { layoutHomes, residentPoint, travelPoint } from '../../packages/gggame-3d/layout.js';
import { GGGame } from '../rules.js';

it('keeps homes distinct for 2 to 64 members and spreads co-located residents', () => {
  for (const count of [2, 3, 8, 64]) {
    const players = Array.from({ length: count }, (_, i) => ({ id: `p${i}`, home: `p${i}`, location: 'p0' }));
    const homes = layoutHomes(players);
    expect(new Set([...homes.values()].map(p => `${p.x}:${p.z}`)).size).toBe(count);
    expect(new Set(players.map(p => JSON.stringify(residentPoint(p, players, homes)))).size).toBe(count);
  }
});
it('reconstructs in-progress travel from authoritative timestamps after a reload', () => {
  const g = new GGGame(); g.start(['甲', '乙', '丙']);
  g.state.phase = 'action'; g.state.players[0].location = 'p1'; g.state.players[0].steps = 1;
  g.invoke({ type: 'move', actor: 'p0', target: 'p2' });
  const p = g.getState().players[0], homes = layoutHomes(g.state.players);
  expect(p.location).toBeNull(); expect(p.active.from).toBe('p1');
  expect(travelPoint(p.active, 0, homes, 'p0')).toMatchObject({ x: homes.get('p1').x, z: homes.get('p1').z + 3 });
  expect(travelPoint(p.active, 1, homes, 'p0').t).toBe(.5);
  const end = travelPoint(p.active, 100, homes, 'p0');
  expect(end.x).toBe(homes.get('p2').x); expect(end.z).toBeCloseTo(homes.get('p2').z + 3);
  // Presentation never mutates or settles the pending server action.
  expect(g.state.players[0].location).toBeNull();
});
