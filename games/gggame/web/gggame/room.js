import { GGGame, HANDS } from './rules.js';
import { BotController } from './bots.js';

export const GRACE_MS = 75_000;
export const IDLE_MS = 30 * 60_000;
const allowed = new Set(['pick', 'knife', 'move', 'wear', 'strip', 'execute']);
const fail = reason => ({ ok: false, reason });

/** One authoritative room; independent of HTTP, sockets and hosting provider. */
export class Room {
  constructor(code, now = Date.now(), saved) {
    this.code = code; this.game = new GGGame(); this.members = [];
    this.host = null; this.wall = now; this.touched = now; this.expired = false; this.botAt = now + 1000;
    if (saved) {
      Object.assign(this, saved, { game: this.game });
      this.game.state = saved.game.state;
      this.game.picks = new Map(saved.game.picks);
      this.game.sequence = saved.game.sequence;
    }
  }
  save() {
    return structuredClone({ code: this.code, members: this.members, host: this.host,
      wall: this.wall, touched: this.touched, expired: this.expired, botAt: this.botAt,
      game: { state: this.game.state, picks: [...this.game.picks], sequence: this.game.sequence } });
  }
  join(name, now, bot = false) {
    this.advance(now);
    if (this.expired) return fail('房间已过期，请重新创建。');
    if (this.game.state.phase !== 'lobby') return fail('对局已经开始，暂时不能加入。');
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 24) return fail('昵称需要 1–24 个字。');
    if (this.members.length >= 64) return fail('此试玩服务每房间最多 64 人。');
    const member = { id: crypto.randomUUID(), token: bot ? null : crypto.randomUUID(), name: name.trim(), bot,
      lastSeen: now, playerId: null, lastSeq: 0, lastReply: null };
    this.members.push(member); this.host ??= member.id; this.touched = now;
    return { ok: true, code: this.code, token: member.token, memberId: member.id };
  }
  authenticate(token) { return typeof token === 'string' ? this.members.find(m => m.token === token) : undefined; }
  view(id) {
    return { type: 'state', code: this.code, host: this.host, you: id,
      playerId: this.members.find(m => m.id === id)?.playerId ?? null,
      commandSeq: this.members.find(m => m.id === id)?.lastSeq ?? 0,
      members: this.members.map(({ id, name, playerId, lastSeen, bot }) => ({ id, name, playerId, bot, connected: bot || this.wall - lastSeen < 30_000 })),
      game: this.game.getState(), expired: this.expired };
  }
  command(id, msg, now) {
    this.advance(now);
    const m = this.members.find(m => m.id === id);
    if (!m || this.expired) return fail('房间或身份已失效。');
    m.lastSeen = now; this.touched = now;
    if (msg?.type === 'ping') return { ok: true };
    if (!Number.isSafeInteger(msg?.seq) || msg.seq < 1) return fail('无效的操作序号。');
    if (msg.seq === m.lastSeq) return m.lastReply;
    if (msg.seq < m.lastSeq) return fail('旧操作已忽略。');
    let reply;
    if (msg.type === 'addBot') {
      reply = id === this.host ? this.join(`电脑 ${this.members.filter(m => m.bot).length + 1}`, now, true) : fail('只有房主可以添加电脑。');
    } else if (msg.type === 'start' || msg.type === 'rematch') {
      if (id !== this.host) reply = fail('只有房主可以开始。');
      else if (!['lobby', 'over'].includes(this.game.state.phase)) reply = fail('对局正在进行。');
      else if (this.members.length < 2) reply = fail('至少需要两个人。');
      else {
        this.members.forEach((member, i) => { member.playerId = `p${i}`; });
        reply = this.game.start(this.members.map(member => member.name));
        this.botAt = now + 1000;
      }
    } else if (allowed.has(msg.type)) {
      // The authenticated session supplies the actor. Client actor/time/state are ignored.
      reply = this.game.invoke({ type: msg.type, actor: m.playerId, hand: msg.hand, target: msg.target });
    } else reply = fail('未知操作。');
    m.lastSeq = msg.seq; m.lastReply = reply;
    return reply;
  }
  nextEvent() {
    const s = this.game.state;
    const events = [this.touched + IDLE_MS];
    for (const m of this.members) if (!m.departed && !m.bot) events.push(m.lastSeen + GRACE_MS);
    if (!['lobby', 'over'].includes(s.phase) && this.members.some(m => m.bot)) events.push(this.botAt);
    if (['reveal', 'between'].includes(s.phase)) events.push(this.wall + Math.max(0, s.revealUntil - s.time) * 1000);
    if (s.phase === 'action') for (const p of s.players) if (p.active) events.push(this.wall + Math.max(0, p.active.endsAt - s.time) * 1000);
    return Math.min(...events);
  }
  advance(now) {
    if (this.expired) return;
    now = Math.max(now, this.wall);
    // Stop exactly at deadlines so delayed alarms preserve completion ordering.
    for (let i = 0; i < 10000; i++) {
      const due = this.nextEvent();
      const end = Math.min(now, due);
      this.game.update(Math.max(0, end - this.wall) / 1000); this.wall = end;
      if (end >= this.touched + IDLE_MS) { this.expired = true; return; }
      for (const m of this.members) {
        if (!m.departed && !m.bot && end >= m.lastSeen + GRACE_MS) {
          m.departed = true;
          const p = this.game.state.players.find(p => p.id === m.playerId);
          if (p?.alive && this.game.state.phase !== 'over') {
            p.alive = false; p.steps = 0; p.active = null; p.queue = [];
            this.game.picks.delete(p.id);
            this.game.log(`${m.name}断线超时，退出本局。`, 'out');
          }
        }
      }
      const s = this.game.state;
      if (end >= this.botAt) {
        this.botAt = end + 1000;
        const ai = new BotController(this.game, Math.random);
        for (const m of this.members.filter(m => m.bot)) {
          const p = s.players.find(p => p.id === m.playerId);
          if (!p?.alive) continue;
          if (s.phase === 'rps' && !p.picked) this.game.invoke({ type: 'pick', actor: p.id, hand: HANDS[Math.floor(Math.random() * HANDS.length)] });
          else if (s.phase === 'action' && p.steps > 0 && !p.active) {
            const action = ai.decide(this.game.getState(), p.id);
            if (action) this.game.invoke({ ...action, actor: p.id });
          }
        }
      }
      if (!['lobby', 'over'].includes(s.phase)) {
        const alive = s.players.filter(p => p.alive);
        if (!alive.length) { s.phase = 'over'; s.result = null; }
        else if (alive.length === 1) this.game.checkRoundEnd();
        else if (s.phase === 'rps' && alive.every(p => this.game.picks.has(p.id))) this.game.resolve();
        else if (s.phase === 'action') this.game.checkRoundEnd();
      }
      if (['lobby', 'over'].includes(s.phase)) {
        this.members = this.members.filter(m => !m.departed);
      }
      if (!this.members.some(m => m.id === this.host && !m.departed)) this.host = this.members.find(m => !m.departed && !m.bot)?.id ?? null;
      if (end >= now) break;
    }
  }
}
