import { bootA3GameRuntime, createSeededRandom } from '@a3game/playable';
import { GGGame } from '../packages/gggame/src/rules.js';
import { BotController } from '../packages/gggame/src/bots.js';
import { mountUI } from '../packages/gggame/src/ui.js';
import '../packages/gggame/src/style.css';
try {
  const context = await bootA3GameRuntime({container: '#a3game-viewport', hudContainer: '#a3game-hud', requireManifest: false, autoStart: false, hostOptions: {clearColor: 0xf3f2e9, antialias: false, shadows: false, pixelRatioCap: 1}});
  const game = new GGGame();
  let bots = null;
  const names = ['阿橙', '小蓝', '大麦', '团子', '阿墨', '栗子', '小满', '豆包'];
  const initialSeed = new URLSearchParams(location.search).get('seed');
  function start({count, gentle}) {
    const seed = initialSeed === null ? crypto.getRandomValues(new Uint32Array(1))[0] : Number(initialSeed);
    bots = new BotController(game, createSeededRandom(seed), {gentle});
    game.start(['你', ...Array.from({length: count}, (_, i) => names[i] ?? `电脑 ${i + 1}`)]);
  }
  const panel = context.hud.addPanel('gggame', {anchor: 'top-left', className: 'gg-shell', value: ''});
  const ui = mountUI(panel, game, start);
  context.host.onTick(dt => { game.update(dt); bots?.update(); });
  context.host.onRender(() => ui.updateClock());
  globalThis.__A3GAME_GAME__ = {host: context.host, getState: () => game.getState()};
  globalThis.__A3GAME_PLAYTEST__ = {look: 'off', warmup: 0, actions: [{id: 'start', click: '#start-game', duration: 1}, {id: 'choose-rock', click: '[data-hand="rock"]', duration: 3}, {id: 'read-table', duration: 2}]};
  document.querySelector('#boot-message').remove();
  context.host.start();
  window.addEventListener('pagehide', () => {ui.dispose(); context.hud.dispose(); context.runtime.deinitialize(); context.assets.dispose(); context.host.dispose();}, {once: true});
} catch (error) {
  console.error(error);
  document.querySelector('#boot-message').textContent = `未能启动 GGgame：${error.message}。请使用支持 WebGL 的浏览器刷新重试。`;
}
