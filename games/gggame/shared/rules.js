export const HANDS = ['rock', 'scissors', 'paper'];
export const HAND_NAMES = { rock: '石头', scissors: '剪刀', paper: '布' };
const BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };
export const ACTION_SECONDS = { knife: 1, move: 2, wear: 1, strip: 3, execute: 3 };
export const ACTION_NAMES = { knife: '拿刀', move: '移动', wear: '穿裤子', strip: '脱裤子', execute: '割' };
const PRIORITY = { knife: 0, move: 1, wear: 2, strip: 3, execute: 4 };
const EPS = 1e-8;
const colocated = (a, b) => a.location !== null && a.location === b.location;

/** No DOM, timers or renderer: every player goes through the same atomic rules. */
export class GGGame {
  constructor() {
    this.listeners = new Set();
    this.state = { phase: 'lobby', players: [], time: 0, round: 0, attempt: 0, revision: 0, logs: [], paused: false, result: null };
    this.picks = new Map();
    this.sequence = 0;
  }
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  getState() { return structuredClone(this.state); }
  emit(type, data = {}) {
    this.state.revision++;
    const event = { type, ...data };
    for (const fn of this.listeners) fn(event);
  }
  log(text, kind = 'info') {
    this.state.logs.push({ id: this.state.revision, round: this.state.round, time: this.state.time, text, kind });
    if (this.state.logs.length > 120) this.state.logs.shift();
  }
  start(names) {
    if (!Array.isArray(names) || names.length < 2 || names.some(n => typeof n !== 'string' || !n.trim())) return { ok: false, reason: '至少需要两位有名字的玩家。' };
    this.state = {
      phase: 'rps', time: 0, round: 1, attempt: 1, revision: this.state.revision + 1,
      paused: false, result: null, logs: [], revealUntil: 0,
      players: names.map((name, i) => ({ id: `p${i}`, name: name.trim().slice(0, 24), home: `p${i}`, location: `p${i}`, armor: 1, knife: false, alive: true, steps: 0, active: null, queue: [], hand: null, picked: false, won: false })),
    };
    this.picks.clear();
    this.log('所有人回到自己家，穿上 1 条裤子。猜拳开始！');
    this.emit('started');
    return { ok: true };
  }
  invoke(command) {
    if (command.type === 'pause') {
      if (['lobby', 'over'].includes(this.state.phase)) return { ok: false, reason: '当前无需暂停。' };
      this.state.paused = !this.state.paused;
      this.emit('paused'); return { ok: true };
    }
    if (this.state.paused) return { ok: false, reason: '对局已暂停。' };
    if (command.type === 'pick') return this.pick(command.actor, command.hand);
    return this.act(command);
  }
  pick(id, hand) {
    const p = this.state.players.find(p => p.id === id);
    if (this.state.phase !== 'rps' || !p?.alive || !HANDS.includes(hand) || this.picks.has(id)) return { ok: false, reason: '现在不能出拳。' };
    this.picks.set(id, hand); p.picked = true;
    if (this.state.players.filter(p => p.alive).every(p => this.picks.has(p.id))) this.resolve();
    this.emit('picked', { actor: id });
    return { ok: true };
  }
  resolve() {
    const alive = this.state.players.filter(p => p.alive);
    const hands = new Set(this.picks.values());
    const winning = hands.size === 2 ? [...hands].find(hand => hands.has(BEATS[hand])) : null;
    const losers = winning ? alive.filter(p => this.picks.get(p.id) !== winning).length : 0;
    for (const p of alive) {
      p.hand = this.picks.get(p.id); p.won = p.hand === winning; p.steps = p.won ? losers : 0;
    }
    this.state.phase = 'reveal'; this.state.tie = !winning; this.state.revealUntil = this.state.time + 1.3;
    this.log(winning ? `${alive.filter(p => p.won).map(p => p.name).join('、')}获胜，各得 ${losers} 步。` : '平局！所有人重新出拳。', winning ? 'reward' : 'info');
    this.emit('revealed');
  }
  plannedPlayer(p) {
    const projected = { ...p };
    const stripCounts = new Map();
    for (const job of [p.active, ...p.queue].filter(Boolean)) {
      if (job.type === 'move') projected.location = job.target;
      if (job.type === 'knife') projected.knife = true;
      if (job.type === 'wear') projected.armor = Math.min(3, projected.armor + 1);
      if (job.type === 'strip') stripCounts.set(job.target, (stripCounts.get(job.target) ?? 0) + 1);
    }
    return { projected, stripCounts };
  }
  reason(command) {
    const s = this.state;
    const p = s.players.find(p => p.id === command.actor);
    const t = s.players.find(p => p.id === command.target);
    if (s.paused) return '对局已暂停';
    if (!p?.alive) return '已出局';
    if (s.phase !== 'action') return '等待行动阶段';
    if (p.steps <= 0) return '没有可分配步数';
    const { projected, stripCounts } = this.plannedPlayer(p);
    switch (command.type) {
      case 'move':
        if (!s.players.some(x => x.home === command.target)) return '请选择地点';
        return projected.location === command.target ? '已经在这里或已计划前往' : '';
      case 'wear': return projected.armor >= 3 ? '已穿满或已安排穿满 3 条裤子' : '';
      case 'knife': return projected.knife ? '已经持刀或已安排拿刀' : '';
      case 'strip': case 'execute': {
        if (!t || t.id === p.id) return '请选择其他玩家';
        if (!t.alive) return '对方已经出局';
        if (!colocated(projected, t)) return '需要同地点，或先安排移动';
        const armor = Math.max(0, t.armor - (stripCounts.get(t.id) ?? 0));
        if (command.type === 'strip') return armor <= 0 ? '对方无裤子或已安排脱完' : '';
        if (!projected.knife) return '需要先拿刀或安排拿刀';
        return armor > 0 ? '对方还有裤子，先安排脱裤子' : '';
      }
      default: return '未知操作';
    }
  }
  act(command) {
    const reason = this.reason(command);
    if (reason) return { ok: false, reason };
    const p = this.state.players.find(p => p.id === command.actor);
    const job = { id: ++this.sequence, type: command.type, target: command.target ?? null };
    p.steps--; // Reserve this step once; queued actions never borrow from the next round.
    p.queue.push(job);
    this.emit('queued', { actor: p.id, action: job.type, target: job.target });
    if (!p.active) this.startNext(p);
    return { ok: true, queued: p.active?.id !== job.id, actionId: job.id };
  }
  startNext(p) {
    if (!p.alive || p.active || !p.queue.length) return;
    const job = p.queue.shift();
    p.active = { ...job, startedAt: this.state.time, endsAt: this.state.time + ACTION_SECONDS[job.type] };
    if (job.type === 'move') p.location = null; // Outdoor travel is unique to each player, never a shared place.
    this.log(`${p.name}开始${ACTION_NAMES[job.type]}（${ACTION_SECONDS[job.type]} 秒）。`, job.type === 'move' ? 'move' : 'info');
    this.emit('action_started', { actor: p.id, action: job.type, target: job.target });
  }
  settle(p, job) {
    if (!p.alive || p.active?.id !== job.id) return;
    const s = this.state;
    const t = s.players.find(p => p.id === job.target);
    let failure = '';
    if (job.type === 'wear' && p.armor >= 3) failure = '裤子已满';
    if (job.type === 'knife' && p.knife) failure = '已经持刀';
    if (['strip', 'execute'].includes(job.type)) {
      if (!t?.alive) failure = '对方已出局';
      else if (!colocated(p, t)) failure = '对方与你不在同一地点';
      else if (job.type === 'strip' && t.armor <= 0) failure = '对方已经没有裤子';
      else if (job.type === 'execute' && !p.knife) failure = '你没有刀';
      else if (job.type === 'execute' && t.armor > 0) failure = '对方穿上了裤子';
    }
    p.active = null;
    if (failure) {
      this.log(`${p.name}的${ACTION_NAMES[job.type]}无效：${failure}。`, 'failed');
    } else if (job.type === 'move') {
      p.location = job.target; this.log(`${p.name}到达${t.name}的家。`, 'move');
    } else if (job.type === 'wear') {
      p.armor++; this.log(`${p.name}穿上一条裤子，护甲 ${p.armor}/3。`, 'armor');
    } else if (job.type === 'knife') {
      p.knife = true; this.log(`${p.name}拿到了刀。`, 'knife');
    } else if (job.type === 'strip') {
      t.armor--; this.log(`${p.name}脱掉了${t.name}的一条裤子，剩余 ${t.armor} 条。`, 'attack');
    } else if (job.type === 'execute') {
      t.alive = false; t.steps = 0; t.active = null; t.queue = [];
      this.log(`${p.name}割了${t.name}，${t.name}出局！`, 'out');
    }
    this.emit('action_completed', { actor: p.id, target: job.target, action: job.type, success: !failure, reason: failure });
  }
  checkRoundEnd() {
    const s = this.state; const survivors = s.players.filter(p => p.alive);
    if (survivors.length === 1) {
      s.phase = 'over'; s.result = survivors[0].id;
      for (const p of s.players) { p.steps = 0; p.active = null; p.queue = []; }
      this.log(`${survivors[0].name}成为最后的幸存者。`, 'reward');
      this.emit('game_over');
    } else if (survivors.every(p => p.steps === 0 && !p.active && !p.queue.length)) {
      s.phase = 'between'; s.revealUntil = s.time + 1.1; this.emit('round_completed');
    }
  }
  update(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('dt must be finite and non-negative');
    if (this.state.paused || ['lobby', 'over'].includes(this.state.phase)) return;
    const s = this.state; const end = s.time + dt;
    // Process event timestamps, not array order or frame end: equal-time jobs share one batch.
    while (s.phase === 'action') {
      const active = s.players.filter(p => p.alive && p.active);
      if (!active.length) break;
      const next = Math.min(...active.map(p => p.active.endsAt));
      if (next > end + EPS) break;
      s.time = next;
      const batch = active.filter(p => Math.abs(p.active.endsAt - next) <= EPS)
        .map(p => ({ p, job: p.active }))
        .sort((a, b) => PRIORITY[a.job.type] - PRIORITY[b.job.type] || a.job.id - b.job.id);
      for (const { p, job } of batch) this.settle(p, job);
      this.checkRoundEnd();
      // Start queued work only after every completion at this timestamp has settled.
      if (s.phase === 'action') for (const p of s.players) this.startNext(p);
    }
    if (s.phase !== 'over') s.time = end;
    if (s.phase === 'reveal' && s.time + EPS >= s.revealUntil) {
      if (s.tie) this.nextRps(false);
      else { s.phase = 'action'; this.emit('action_phase'); }
    } else if (s.phase === 'between' && s.time + EPS >= s.revealUntil) this.nextRps(true);
  }
  nextRps(newRound) {
    const s = this.state;
    if (newRound) { s.round++; s.attempt = 1; } else s.attempt++;
    s.phase = 'rps'; s.tie = false; this.picks.clear();
    for (const p of s.players) { p.steps = 0; p.hand = null; p.picked = false; p.won = false; p.active = null; p.queue = []; }
    this.emit('round_started');
  }
}
