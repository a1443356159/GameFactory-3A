import { HAND_NAMES, ACTION_NAMES, ACTION_SECONDS } from './rules.js';
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icons = {
  home: '<path d="m3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8"/>',
  pants: '<path d="M5 3h14l1 18h-7l-1-10-1 10H4L5 3ZM5 7h14M12 3v4"/>',
  knife: '<path d="m5 21 5-6-2-2-5 6 2 2ZM8 13 20 2c3 7-1 11-10 13M7 12l5 5"/>',
  rock: '<path d="m5 18-2-7 3-6 10-2 5 7-3 10H9l-4-2ZM6 5l4 6 6-8M10 11l-1 9m1-9 11-1"/>',
  scissors: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="m8 15 9-13M16 15 7 2"/>',
  paper: '<path d="M5 3h10l4 4v14H5V3Zm10 0v5h4M8 12h8M8 16h8"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.home}</svg>`;

export function mountUI(root, game, startGame) {
  let target = 'p1'; let lastRevision = -1; let lastClock = -1; let toastUntil = 0;
  let resumeAfterRules = false;
  root.innerHTML = `
    <header class="topbar"><a class="wordmark" href="./" aria-label="GGgame 首页">GG<span>game</span><i>低配版</i></a>
      <nav><span class="local-label"><b></b> 人机试玩</span><button class="text-button" id="rules-button">玩法说明 <span>↗</span></button><button class="text-button" id="pause-button" hidden>暂停</button></nav></header>
    <main>
      <section id="lobby" class="lobby">
        <div class="intro"><div class="eyebrow">石头 · 剪刀 · 布 &nbsp; / &nbsp; 生存小游戏</div><h1>猜一拳，<br>抢<span class="headline-mark">一步。</span></h1><p class="intro-copy">穿好你的裤子，去别人家串个门。<br>运气决定步数，手速决定下一秒。</p><div class="intro-tags"><span>同时行动</span><span>行动排队</span><span>最后一人获胜</span></div>
        <div class="mini-rule"><strong>01 / 猜拳</strong><span>赢几个人，就得几步。</span><strong>02 / 行动</strong><span>移动、穿裤、脱裤、拿刀，各用一步。</span><strong>03 / 生存</strong><span>拿刀割掉没有裤子的对手。</span></div></div>
        <div class="setup"><div class="setup-top"><span class="eyebrow">准备开局</span><span class="stamp">GG!</span></div><h2>叫上几个电脑？</h2><p class="muted">你们各自在自己家，穿着 1 条裤子开场。</p>
          <div class="count-presets"><button data-count="1">1 位 <small>双人过招</small></button><button data-count="3" class="chosen">3 位 <small>热闹一点</small></button><button data-count="5">5 位 <small>乱中取胜</small></button></div>
          <label class="number-row" for="bot-count">自定义电脑人数<input id="bot-count" type="number" min="1" step="1" value="3" inputmode="numeric"></label>
          <label class="difficulty"><input id="gentle" type="checkbox" checked><span><strong>慢热电脑</strong><small>多留一点反应时间，适合第一局。</small></span></label>
          <button class="primary start-button" id="start-game">开始这一局 <span>→</span></button><p class="setup-foot">无需登录 · 随时暂停 · 点击即可操作</p><p id="setup-error" role="alert"></p>
        </div>
      </section>
      <section id="match" hidden>
        <div class="match-title"><div><div class="eyebrow" id="round-label"></div><h1 id="phase-title"></h1><p id="phase-description"></p></div><div class="alive-counter"><strong id="alive-count"></strong><span>人仍在局内</span></div></div>
        <div class="match-grid"><div class="table-column"><section class="rps-panel" id="rps-panel"><div class="section-heading"><h2 id="rps-heading">选好你的手势</h2><span id="rps-status"></span></div><div class="hands">${['rock', 'scissors', 'paper'].map((hand, i) => `<button data-hand="${hand}" aria-label="出${HAND_NAMES[hand]}">${icon(hand)}<strong>${HAND_NAMES[hand]}</strong><kbd>${i + 1}</kbd></button>`).join('')}</div></section>
        <section class="arena"><div class="section-heading"><h2>桌上局势</h2><span>点玩家选目标 · 点前往去串门</span></div><div id="homes" class="homes"></div><div id="outdoors" class="outdoors"></div><div id="eliminated" class="eliminated"></div></section></div>
        <aside><section class="action-panel"><div class="section-heading"><h2>你的行动</h2><span id="human-status"></span></div><div class="step-meter"><strong id="my-steps">0</strong><span>可用步数<small>提交扣步，到时结算</small></span></div><div class="cooldown"><div id="cooldown-fill"></div><span id="cooldown-text">等待出拳</span></div><div class="self-actions"><button data-action="wear">${icon('pants')}<span>穿裤子<small>1 秒 · 1 步</small></span><kbd>W</kbd></button><button data-action="knife">${icon('knife')}<span>拿刀<small>1 秒 · 永久</small></span><kbd>K</kbd></button></div><div class="target-label">当前目标 <strong id="target-label">—</strong></div><div class="attack-actions"><button data-action="strip">脱裤子 <small>3 秒 · D</small></button><button data-action="execute">割 <small>3 秒 · G</small></button></div><p class="target-note" id="target-note"></p><div class="queue-box"><div class="target-label">等待队列 <strong id="queue-count">0</strong></div><ol id="queue-list"></ol><p>忙碌时也可提交；每项占用 1 步。</p></div></section>
        <section class="feed"><div class="section-heading"><h2>刚刚发生</h2><span class="live-dot"></span></div><ol id="feed-list" aria-label="对局战报"></ol></section></aside></div>
      </section>
      <footer><span>GGgame <b> / </b> 猜拳有运气，行动有讲究。</span><span>低配规则 · 无门 · 无技能</span></footer>
    </main>
    <div id="toast" class="toast" role="status" hidden></div>
    <div id="pause-overlay" class="overlay" hidden><div class="modal"><span class="eyebrow">休息一下</span><h2>时间停在这里。</h2><p>电脑、行动进度和整场对局都已暂停。</p><button id="resume-button" class="primary">继续游戏 →</button><button id="pause-restart" class="text-button">结束本局，重新设置</button></div></div>
    <div id="result-overlay" class="overlay" hidden><div class="modal result-modal"><span class="eyebrow">本局结束</span><div class="result-mark">GG!</div><h2 id="result-title"></h2><p id="result-copy"></p><button id="again-button" class="primary">再来一局 →</button><button id="settings-button" class="text-button">调整人数</button></div></div>
    <dialog id="rules-dialog"><button id="close-rules" class="close-button" aria-label="关闭玩法说明">×</button><div class="eyebrow">一分钟，学会 GGgame</div><h2>先猜拳，再抢着行动。</h2><ol class="rules-list"><li><strong>赢几个人，得几步。</strong>所有存活玩家一起猜拳。只有两种手势时分胜负；平局全员重猜。</li><li><strong>每次动作，都花 1 步。</strong>可以去任意人的家，在任何地方穿裤子或拿刀。裤子最多 3 条。</li><li><strong>同地点，才能脱和割。</strong>脱一次减对方 1 条裤子。自己有刀、对方没裤子时才能割；被割即出局，刀不会消耗。</li><li><strong>同时行动，各自排队。</strong>拿刀 / 穿裤子 1 秒，移动 2 秒，脱裤子 / 割 3 秒。自己忙碌时新操作进入队列；完成后立即执行下一项，期间仍可被偷袭。</li><li><strong>到时结算，快一步逃生。</strong>同一时刻：拿刀 → 移动 → 穿裤子 → 脱裤子 → 割。割结算时对方有裤子则无效，仍耗步数。移动开始即进入独立户外，途中不与任何人同地点。</li><li><strong>步数不能存。</strong>本试玩版等存活玩家用完步数、所有行动结算后再猜拳，最后存活者获胜。</li></ol><p class="muted">快捷键：1 / 2 / 3 出拳，W 穿裤子，K 拿刀，D 脱裤子，G 割，空格暂停。也可以全部点击操作。</p></dialog>`;
  const $ = selector => root.querySelector(selector);
  function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; toastUntil = performance.now() + 2200; }
  function begin() {
    const count = Number($('#bot-count').value);
    if (!Number.isSafeInteger(count) || count < 1) { $('#setup-error').textContent = '请输入至少 1 位电脑，人数需为整数。'; return; }
    $('#setup-error').textContent = ''; target = 'p1'; startGame({ count, gentle: $('#gentle').checked });
  }
  function settings() {
    const s = game.getState(); if (!s.paused && !['lobby', 'over'].includes(s.phase)) game.invoke({ type: 'pause' });
    $('#lobby').hidden = false; $('#match').hidden = true; $('#pause-overlay').hidden = true; $('#result-overlay').hidden = true; $('#pause-button').hidden = true; $('#start-game').focus();
  }
  function command(type, destination) { const r = game.invoke({ type, actor: 'p0', target: destination ?? target }); if (!r.ok) toast(r.reason); }
  const onClick = event => {
    const button = event.target.closest('button'); if (!button || button.disabled) return;
    if (button.dataset.count) { $('#bot-count').value = button.dataset.count; root.querySelectorAll('[data-count]').forEach(b => b.classList.toggle('chosen', b === button)); }
    if (button.dataset.hand) { const r = game.invoke({ type: 'pick', actor: 'p0', hand: button.dataset.hand }); if (!r.ok) toast(r.reason); }
    if (button.dataset.player) { target = button.dataset.player; render(game.getState()); }
    if (button.dataset.move) command('move', button.dataset.move);
    if (button.dataset.action) command(button.dataset.action);
    if (['start-game', 'again-button'].includes(button.id)) begin();
    if (['pause-button', 'resume-button'].includes(button.id)) game.invoke({ type: 'pause' });
    if (['settings-button', 'pause-restart'].includes(button.id)) settings();
    if (button.id === 'rules-button') {
      const s = game.getState(); resumeAfterRules = !s.paused && !['lobby', 'over'].includes(s.phase);
      if (resumeAfterRules) game.invoke({ type: 'pause' }); $('#rules-dialog').showModal();
    }
    if (button.id === 'close-rules') $('#rules-dialog').close();
  };
  const onRulesClose = () => { if (resumeAfterRules && game.getState().paused) game.invoke({ type: 'pause' }); resumeAfterRules = false; };
  const onKey = event => {
    if (/INPUT|SELECT|TEXTAREA/.test(event.target.tagName) || $('#rules-dialog').open || !$('#lobby').hidden || event.repeat) return;
    if (event.code === 'Space') { event.preventDefault(); game.invoke({ type: 'pause' }); }
    const hand = { Digit1: 'rock', Digit2: 'scissors', Digit3: 'paper' }[event.code];
    if (hand) { const r = game.invoke({ type: 'pick', actor: 'p0', hand }); if (!r.ok) toast(r.reason); }
    const action = { KeyW: 'wear', KeyK: 'knife', KeyD: 'strip', KeyG: 'execute' }[event.code]; if (action) command(action);
  };
  const onVisibility = () => { if (document.hidden && !game.getState().paused && ['rps', 'reveal', 'action', 'between'].includes(game.getState().phase)) game.invoke({ type: 'pause' }); };
  root.addEventListener('click', onClick); document.addEventListener('keydown', onKey); document.addEventListener('visibilitychange', onVisibility);
  $('#rules-dialog').addEventListener('close', onRulesClose);
  $('#bot-count').addEventListener('input', () => root.querySelectorAll('[data-count]').forEach(b => b.classList.toggle('chosen', b.dataset.count === $('#bot-count').value)));

  function render(s, event = {}) {
    lastRevision = s.revision;
    if (s.phase === 'lobby') return;
    $('#lobby').hidden = true; $('#match').hidden = false; $('#pause-button').hidden = s.phase === 'over';
    const me = s.players[0]; const alive = s.players.filter(p => p.alive);
    if (!s.players.find(p => p.id === target && p.alive)) target = alive.find(p => p.id !== 'p0')?.id ?? 'p1';
    const t = s.players.find(p => p.id === target);
    $('#round-label').textContent = `ROUND ${String(s.round).padStart(2, '0')} / ${s.attempt > 1 ? `第 ${s.attempt} 次猜拳` : '新的一轮'}`;
    const titles = { rps: me.alive ? '这一拳，你出什么？' : '你已出局，继续观战。', reveal: s.tie ? '平局！再来一拳。' : me.won ? `漂亮！你拿到 ${me.steps} 步。` : '机会在对手那边。', action: me.active ? '行动进行中，留意偷袭。' : me.steps ? '有步数，就动起来。' : me.alive ? '留意对手的下一步。' : '你已出局，继续观战。', between: '步数用完，再猜一拳。', over: '这一局，GG。' };
    $('#phase-title').textContent = titles[s.phase];
    $('#phase-description').textContent = s.phase === 'action' ? '所有人同时行动 · 动作到时结算 · 空闲立即执行，忙碌自动排队' : s.phase === 'rps' ? '全员出拳后同时揭晓，赢几个人就得几步。' : s.phase === 'reveal' ? '手势已揭晓，马上继续。' : '位置、裤子和刀会保留；步数不会。';
    $('#alive-count').textContent = `${alive.length} / ${s.players.length}`;
    $('#rps-panel').hidden = !['rps', 'reveal'].includes(s.phase);
    $('#rps-heading').textContent = s.phase === 'reveal' ? '手势揭晓' : me.alive ? '选好你的手势' : '电脑正在出拳';
    $('#rps-status').textContent = s.phase === 'reveal' ? (s.tie ? '全员重猜' : '准备行动') : `${alive.filter(p => p.picked).length} / ${alive.length} 已准备`;
    root.querySelectorAll('[data-hand]').forEach(b => { b.disabled = s.phase !== 'rps' || !me.alive || me.picked || s.paused; });
    $('#homes').innerHTML = s.players.map(home => {
      const residents = s.players.filter(p => p.location === home.home && p.alive);
      return `<article class="home ${me.location === home.home && me.alive ? 'my-location' : ''}" data-home="${home.home}"><div class="home-title"><span>${icon('home')} ${esc(home.name)}的家</span><button class="move-button" data-move="${home.home}">前往 <span>2 秒 ↗</span></button></div><div class="residents">${residents.length ? residents.map(p => `<button data-player="${p.id}" class="player ${p.id === 'p0' ? 'human' : ''} ${p.id === target ? 'selected' : ''} ${p.armor === 0 ? 'vulnerable' : ''}" aria-label="选择${esc(p.name)}为目标" ${p.id === 'p0' ? 'disabled' : ''}><div class="player-top"><span class="avatar">${p.id === 'p0' ? '你' : esc(p.name.slice(0, 1))}</span><strong>${esc(p.name)}<small>${p.id === 'p0' ? 'YOU' : '电脑'}</small></strong><span class="hand-reveal">${p.hand ? icon(p.hand) : p.picked ? '✓' : '…'}</span></div><div class="player-stats"><span class="armor ${p.armor === 0 ? 'zero' : ''}">${icon('pants')} ${p.armor}/3</span><span class="knife ${p.knife ? 'has-knife' : ''}">${icon('knife')} ${p.knife ? '有刀' : '无刀'}</span><span class="steps">${p.steps} 步</span></div><div class="player-bottom"><span>${p.active ? ACTION_NAMES[p.active.type] + '中' : p.armor === 0 ? '没穿裤子 · 小心被割' : p.won ? '本轮赢家' : '存活'}</span><span class="player-cooldown" data-cooldown="${p.id}"></span></div></button>`).join('') : '<div class="empty-home">暂时没人，来去自由。</div>'}</div></article>`;
    }).join('');
    $('#outdoors').innerHTML = s.players.filter(p => p.alive && p.location === null).map(p => `<div class="traveler"><span>↗ ${esc(p.name)} · 户外</span><small>前往${esc(s.players.find(h => h.home === p.active?.target)?.name ?? '目的地')}的家 · 独立移动中 <b data-cooldown="${p.id}"></b></small></div>`).join('');
    $('#queue-count').textContent = me.queue.length;
    $('#queue-list').innerHTML = me.queue.map((job, i) => `<li><b>${i + 1}</b> ${ACTION_NAMES[job.type]}${job.target ? ' → ' + esc(s.players.find(p => p.id === job.target)?.name ?? '') : ''}<span>${ACTION_SECONDS[job.type]}s</span></li>`).join('') || '<li class="empty-queue">队列为空</li>';
    $('#eliminated').innerHTML = s.players.filter(p => !p.alive).map(p => `<span>${esc(p.name)} · 已出局</span>`).join('');
    $('#human-status').textContent = me.alive ? (me.knife ? '持刀中' : '未持刀') : '已出局';
    $('#my-steps').textContent = me.steps;
    $('#target-label').textContent = t?.alive ? t.name : '无';
    $('#target-note').textContent = t?.alive ? t.location === null ? `${t.name}在户外，当前无法对其脱或割` : `${t.name}在${s.players.find(p => p.home === t.location)?.name}的家 · ${me.location !== null && t.location === me.location ? '与你同地点' : '需先安排移动'}` : '点击玩家卡片选择目标。';
    $('#feed-list').innerHTML = s.logs.slice(-12).reverse().map((entry, i) => `<li class="feed-${entry.kind} ${i === 0 ? 'fresh' : ''}"><span class="feed-dot"></span><div>${esc(entry.text)}<small>第 ${entry.round} 轮</small></div></li>`).join('');
    $('#pause-overlay').hidden = !s.paused; $('#pause-button').textContent = s.paused ? '继续' : '暂停';
    $('#result-overlay').hidden = s.phase !== 'over';
    if (s.phase === 'over') { const winner = s.players.find(p => p.id === s.result); $('#result-title').textContent = s.result === 'p0' ? '这局，你活到了最后！' : `${winner.name}赢下了这一局。`; $('#result-copy').textContent = `经过 ${s.round} 轮猜拳，${s.players.length - 1} 位玩家出局。再来一次？`; }
    if (event.type === 'action_completed') {
      const el = root.querySelector(`[data-player="${event.action === 'strip' ? event.target : event.actor}"]`);
      if (el && !matchMedia('(prefers-reduced-motion: reduce)').matches) el.animate([{ transform: 'translateY(-5px)', filter: 'brightness(1.15)' }, { transform: 'translateY(0)', filter: 'brightness(1)' }], { duration: 340 });
      if (event.action === 'execute' || !event.success) toast(s.logs.at(-1)?.text ?? '行动已结算');
    }
    updateClock(true);
  }
  function updateClock(force = false) {
    if (performance.now() > toastUntil) $('#toast').hidden = true;
    const s = game.getState(); const clock = Math.floor(s.time * 10);
    if (!force && clock === lastClock && s.revision === lastRevision) return;
    lastClock = clock;
    const me = s.players[0]; if (!me) return;
    const remaining = me.active ? Math.max(0, me.active.endsAt - s.time) : 0;
    $('#cooldown-fill').style.width = `${me.active ? Math.min(1, remaining / ACTION_SECONDS[me.active.type]) * 100 : 0}%`;
    $('#cooldown-text').textContent = !me.alive ? '已出局 · 观战中' : s.paused ? '已暂停' : s.phase !== 'action' ? '等待下一次行动' : me.active ? `${ACTION_NAMES[me.active.type]}中 · ${remaining.toFixed(1)}s` : me.steps ? '空闲，提交后立即开始' : '没有步数，观察局势';
    root.querySelectorAll('[data-action]').forEach(b => { const reason = game.reason({ type: b.dataset.action, actor: 'p0', target }); b.disabled = !!reason; b.title = reason || `${me.active ? '加入等待队列' : '立即开始'} · ${ACTION_SECONDS[b.dataset.action]} 秒 · 1 步`; });
    root.querySelectorAll('[data-move]').forEach(b => { const reason = game.reason({ type: 'move', actor: 'p0', target: b.dataset.move }); b.disabled = !!reason; b.title = reason || `${me.active ? '排队移动' : '立即进入户外'} · 2 秒 · 1 步`; });
    root.querySelectorAll('[data-cooldown]').forEach(el => { const p = s.players.find(p => p.id === el.dataset.cooldown); const left = p.active ? Math.max(0, p.active.endsAt - s.time) : 0; el.textContent = left > 0.001 && s.phase === 'action' ? `${left.toFixed(1)}s` : ''; });
  }
  const unsubscribe = game.subscribe(event => render(game.getState(), event));
  return { updateClock, dispose() { unsubscribe(); root.removeEventListener('click', onClick); document.removeEventListener('keydown', onKey); document.removeEventListener('visibilitychange', onVisibility); } };
}
