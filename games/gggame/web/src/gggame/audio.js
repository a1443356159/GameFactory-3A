// Short synthesized cues: no external downloads or music autoplay.
const melodies = {
  win: [[523, 0, .13], [659, .12, .13], [784, .24, .28]],
  lose: [[392, 0, .15], [330, .15, .15], [262, .3, .23]],
  tie: [[440, 0, .1], [440, .17, .14]],
  wear: [[440, 0, .08], [660, .07, .14]],
  knife: [[1175, 0, .07], [1568, .05, .17]],
  move: [[180, 0, .08], [240, .13, .1]],
  strip: [[480, 0, .08], [240, .07, .13]],
  execute: [[110, 0, .16], [70, .08, .21]],
  failed: [[160, 0, .09], [130, .12, .15]],
};

export class CueTracker {
  reset() { this.cursor = undefined; }
  take(snapshot) {
    const events = snapshot.game.events || [];
    const latest = events.at(-1)?.id ?? 0;
    // Reconnecting synchronizes the cursor without replaying historical sounds.
    if (this.cursor === undefined) { this.cursor = latest; return []; }
    const fresh = events.filter(event => event.id > this.cursor);
    this.cursor = latest;
    const me = snapshot.game.players.find(p => p.id === snapshot.playerId);
    return fresh.flatMap(event => {
      if (event.type === 'action_completed') return [{ name: event.success ? event.action : 'failed', volume: event.actor === snapshot.playerId ? 1 : .3 }];
      if (event.type === 'revealed') return [{ name: snapshot.game.tie ? 'tie' : me?.alive ? me.won ? 'win' : 'lose' : 'tie', volume: 1 }];
      if (event.type === 'game_over' && me) return [{ name: snapshot.game.result === me.id ? 'win' : 'lose', volume: 1 }];
      return [];
    });
  }
}

export class GameAudio {
  constructor() {
    this.enabled = true; this.voices = new Set();
    try { this.enabled = localStorage.getItem('gggame-sound') !== 'off'; } catch { /* Storage is optional. */ }
  }
  unlock() {
    if (!this.enabled) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context ??= new Context();
      this.master ??= this.context.createGain();
      if (!this.connected) { this.master.gain.value = .11; this.master.connect(this.context.destination); this.connected = true; }
      if (this.context.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* Unsupported audio must never block a game action. */ }
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    try { localStorage.setItem('gggame-sound', enabled ? 'on' : 'off'); } catch { /* Optional. */ }
    if (!enabled) this.stop();
    else this.unlock();
  }
  stop() {
    for (const voice of this.voices) { try { voice.stop(); } catch { /* Already ended. */ } }
    this.voices.clear();
  }
  play({ name, volume = 1 }) {
    const ctx = this.context;
    if (!this.enabled || ctx?.state !== 'running' || !melodies[name]) return;
    for (const [frequency, offset, duration] of melodies[name]) {
      if (this.voices.size >= 16) { const oldest = this.voices.values().next().value; oldest.stop(); this.voices.delete(oldest); }
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      const start = ctx.currentTime + offset;
      oscillator.type = ['execute', 'move', 'failed'].includes(name) ? 'triangle' : 'sine';
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(volume, start + .008);
      gain.gain.exponentialRampToValueAtTime(.001, start + duration);
      oscillator.connect(gain); gain.connect(this.master);
      this.voices.add(oscillator);
      oscillator.onended = () => { this.voices.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
      oscillator.start(start); oscillator.stop(start + duration + .01);
    }
    document.dispatchEvent(new CustomEvent('gggame:sound', { detail: { name } }));
  }
}
