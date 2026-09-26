import { HANDS } from './rules.js';

/** Bots see only the public snapshot and never inspect hidden hand choices. */
export class BotController {
  constructor(game, random, { gentle = true } = {}) {
    this.game = game; this.random = random; this.gentle = gentle; this.due = new Map();
    this.lastPhase = ''; this.lastRound = '';
  }
  choose(list) { return list[Math.floor(this.random() * list.length)]; }
  update() {
    const s = this.game.getState();
    if (s.paused || !['rps', 'action'].includes(s.phase)) return;
    const key = `${s.round}:${s.attempt}:${s.phase}`;
    if (this.lastPhase !== key) { this.due.clear(); this.lastPhase = key; }
    for (const p of s.players.filter(p => p.alive && p.id !== 'p0')) {
      if (!this.due.has(p.id)) this.due.set(p.id, s.time + 0.35 + this.random() * (this.gentle ? 1.3 : 0.55));
      if (s.time < this.due.get(p.id)) continue;
      if (s.phase === 'rps' && !p.picked) {
        this.game.invoke({ type: 'pick', actor: p.id, hand: this.choose(HANDS) });
      } else if (s.phase === 'action' && p.steps > 0 && !p.active && !p.queue.length) {
        const action = this.decide(this.game.getState(), p.id);
        if (action) this.game.invoke({ actor: p.id, ...action });
        this.due.set(p.id, s.time + (this.gentle ? 0.65 : 0.12) + this.random() * 0.55);
      }
    }
  }
  decide(s, id) {
    const p = s.players.find(p => p.id === id);
    const opponents = s.players.filter(t => t.alive && t.id !== id);
    const near = opponents.filter(t => p.location !== null && t.location === p.location);
    const bare = near.filter(t => t.armor === 0);
    if (p.knife && bare.length) return { type: 'execute', target: this.choose(bare).id };
    if (!p.armor && near.some(t => t.knife && t.steps > 0)) return { type: 'wear' };
    if (!p.knife) return { type: 'knife' };
    if (near.some(t => t.armor > 0)) return { type: 'strip', target: this.choose(near.filter(t => t.armor > 0)).id };
    if (!p.armor) return { type: 'wear' };
    const inside = opponents.filter(t => t.location !== null);
    if (!inside.length) return p.armor < 3 ? { type: 'wear' } : null;
    const targets = inside.filter(t => t.armor === Math.min(...inside.map(t => t.armor)));
    return { type: 'move', target: this.choose(targets).location };
  }
}
