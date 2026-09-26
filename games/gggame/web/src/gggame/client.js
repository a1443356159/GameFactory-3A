import { GGGame, ACTION_NAMES, ACTION_SECONDS, HAND_NAMES } from '../../gggame/rules.js';
import { CueTracker, GameAudio } from './audio.js';
import './world.css';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const storageKey = 'gggame-session-v1';
let session, socket, snapshot, receivedAt = 0, retry, attempts = 0, stopped = false, picked = null;
let leaving = false, displayedPhase;
let courtyard, courtyardLoading, worldGeneration = 0, worldEnabled = true, worldFailed = false;
try { worldEnabled = localStorage.getItem('gggame-world') !== 'off'; } catch { /* Optional. */ }
const sounds = new GameAudio(), cues = new CueTracker();
function soundLabel() {
  $('sound-toggle').textContent = sounds.enabled ? '音效：开' : '音效：关';
  $('sound-toggle').setAttribute('aria-pressed', String(sounds.enabled));
}
soundLabel();
document.addEventListener('pointerdown', () => sounds.unlock(), { capture: true });
document.addEventListener('keydown', () => sounds.unlock(), { capture: true });
$('sound-toggle').onclick = () => { sounds.setEnabled(!sounds.enabled); soundLabel(); };
let endpoint = $('gggame').dataset.endpoint;
if (!endpoint && ['localhost', '127.0.0.1'].includes(location.hostname)) endpoint = 'http://127.0.0.1:8787';
const predictor = new GGGame();
const pending = new Map();
const notice = text => { $('notice').textContent = text; };
const status = (text, online = false) => { $('connection').textContent = text; $('connection').classList.toggle('online', online); };
const store = () => { try { sessionStorage.setItem(storageKey, JSON.stringify(session)); } catch { /* Storage may be disabled. */ } };
try { session = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); } catch { session = null; }
const invitedCode = (new URL(location.href).searchParams.get('room') || '').toUpperCase();
$('room-code').value = invitedCode;
if (session) { $('nickname').value = session.name; $('resume').hidden = false; }
if (!endpoint) notice('联机服务尚未配置。页面已经准备好，服务上线后即可创建房间。');

async function join(create) {
  if (!$('join-form').reportValidity()) return;
  if (!endpoint) { notice('联机服务尚未配置，请稍后再试。'); return; }
  const name = $('nickname').value.trim();
  const code = $('room-code').value.trim().toUpperCase();
  if (!create && !/^[A-F0-9]{12}$/.test(code)) { notice('请输入完整的 12 位房间号，或打开朋友发来的邀请链接。'); return; }
  $('create').disabled = true;
  $('join-form').querySelector('[type=submit]').disabled = true;
  try {
    const response = await fetch(`${endpoint}/api/rooms${create ? '' : `/${code}/join`}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }), signal: AbortSignal.timeout(10000),
    });
    const body = await response.json();
    if (!response.ok || !body.ok) throw Error(body.reason || '加入失败。');
    cues.reset(); session = { ...body, name, seq: 0 }; store(); connect();
  } catch (error) { notice(`无法加入：${error.message} 请检查网络后重试。`); }
  finally { $('create').disabled = false; $('join-form').querySelector('[type=submit]').disabled = false; }
}
function connect() {
  if (!session || !endpoint) return;
  stopped = false; cues.reset(); clearTimeout(retry);
  if (socket) { socket.onclose = null; socket.close(); }
  status('连接中…');
  const address = new URL(`${endpoint}/api/rooms/${session.code}/ws`);
  address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
  const current = socket = new WebSocket(address, ['gggame', `session.${session.token}`]);
  current.onopen = () => {
    attempts = 0; status('● 已连接', true); notice('');
    for (const command of pending.values()) current.send(JSON.stringify(command));
  };
  current.onmessage = event => {
    if (current !== socket) return;
    const message = JSON.parse(event.data);
    if (message.type === 'removed') { resetRoom(message.reason === 'kicked' ? '你已被房主踢出房间。' : '已退出房间。'); return; }
    if (message.type === 'state') {
      if (message.expired) { resetRoom('房间已关闭，请重新创建或加入。'); return; }
      const previousKey = snapshot && `${snapshot.game.round}:${snapshot.game.attempt}`;
      snapshot = message; receivedAt = performance.now();
      session.seq = Math.max(session.seq, message.commandSeq || 0); store();
      if (previousKey !== `${message.game.round}:${message.game.attempt}`) picked = null;
      predictor.state = message.game;
      for (const cue of cues.take(message)) sounds.play(cue);
      render();
    } else if (message.type === 'ack' && message.seq) {
      pending.delete(message.seq);
      if (!message.ok) notice(message.reason);
    }
  };
  current.onclose = event => {
    if (current !== socket) return;
    if (event.code === 4003) { resetRoom('你已被房主踢出房间。'); return; }
    if (event.code === 4002) { resetRoom(leaving ? '已退出房间。' : '房间已关闭，请重新加入。'); return; }
    status('连接已断开'); updateControls();
    if (stopped) return;
    if ([4001, 1008].includes(event.code)) { stopped = true; notice(event.code === 4001 ? '你已在另一个页面连接此身份。可点击“恢复上次连接”重新连接。' : '连接因无效或过于频繁的操作关闭，请刷新重试。'); return; }
    notice('连接中断，正在重连；75 秒内回来仍可继续本局。');
    if (++attempts > 12) { notice('暂时无法连接房间。请检查网络，或刷新后重新加入。'); return; }
    retry = setTimeout(connect, Math.min(1000 * 2 ** Math.min(attempts, 3), 8000));
  };
  current.onerror = () => status('服务暂时不可达');
}
function send(type, extra = {}) {
  if (leaving || socket?.readyState !== WebSocket.OPEN || !session) { notice('等待连接恢复后再操作。'); return; }
  const command = { type, ...extra, seq: ++session.seq };
  pending.set(command.seq, command); store();
  socket.send(JSON.stringify(command)); notice('');
}
function options(select, players, label) {
  const previous = select.value;
  const html = players.map(p => `<option value="${escape(p.id)}">${escape(label(p))}</option>`).join('');
  if (select.innerHTML !== html) { select.innerHTML = html; if (players.some(p => p.id === previous)) select.value = previous; }
}
function render() {
  const { game: s, playerId, you, host, members } = snapshot;
  $('entrance').hidden = true; $('room').hidden = false;
  $('room-label').textContent = snapshot.code;
  $('gggame').dataset.phase = s.phase;
  const isLobby = s.phase === 'lobby', focused = ['rps', 'reveal'].includes(s.phase);
  renderWorld(focused);
  $('lobby').hidden = !isLobby; $('match').hidden = isLobby || focused;
  $('rps-stage').hidden = s.phase !== 'rps'; $('reveal-stage').hidden = s.phase !== 'reveal';
  if (displayedPhase !== s.phase) {
    displayedPhase = s.phase; window.scrollTo(0, 0);
    if (focused) $(s.phase === 'rps' ? 'rps-title' : 'reveal-title').focus({ preventScroll: true });
  }
  const kickButton = member => isLobby && host === you && member && member.id !== you ? `<button class="kick" data-kick="${escape(member.id)}" title="从大厅移出成员">踢出</button>` : '';
  if (isLobby) {
    $('members').innerHTML = members.map(m => `<div class="member">${escape(m.name)}<em>${m.id === you ? '你 · ' : ''}${m.bot ? '电脑' : m.id === host ? '房主' : '已加入'}</em>${kickButton(m)}</div>`).join('');
    $('start').disabled = host !== you || members.length < 2;
    $('add-bot').disabled = host !== you || members.length >= 64;
    $('host-hint').textContent = host === you ? `当前 ${members.length} 人，准备好了就开始。` : '等待房主开始游戏。';
    return;
  }
  $('members').replaceChildren();
  const me = s.players.find(p => p.id === playerId);
  const roundLabel = `ROUND ${String(s.round).padStart(2, '0')} · 第 ${s.attempt} 次猜拳`;
  $('rps-round').textContent = roundLabel; $('reveal-round').textContent = roundLabel;
  $('rps-title').textContent = !me?.alive ? '坐看街坊过招' : me.picked ? '已出拳，等大家亮手。' : '这一拳，出什么？';
  $('rps-note').textContent = `${s.players.filter(p => p.alive && p.picked).length} / ${s.players.filter(p => p.alive).length} 人已出拳${!me?.alive ? ' · 你已出局，正在观战' : ''}`;
  $('pick-status').innerHTML = s.players.filter(p => p.alive).map(p => `<div class="pick-person ${p.picked ? 'ready' : ''}"><span>${escape(p.name)}${p.id === playerId ? ' · 你' : ''}</span><small>${p.picked ? '已出拳' : '思考中'}</small>${kickButton(members.find(m => m.playerId === p.id))}</div>`).join('');
  $('reveal-stage').dataset.outcome = s.tie ? 'tie' : me?.alive && me.won ? 'win' : 'lose';
  $('reveal-title').textContent = s.tie ? '平局，再来一拳！' : !me?.alive ? '本轮结果' : me.pityAward ? '七连败保底，拿到 3 步！' : me.won ? '这一轮，你赢了！' : '这一轮，先守住。';
  $('reward-value').textContent = me?.alive ? `+${me.steps}` : '观战';
  $('reward-unit').hidden = !me?.alive;
  $('reveal-note').textContent = s.tie ? '本次没人获得步数，倒计时结束后全员重新出拳。' : me?.pityAward ? '保底步数与普通步数一样使用，本次连败已清零。' : me?.won ? '这些步数可以用来行动，准备好你的下一步。' : `本轮没有步数 · 当前连败 ${me?.lossStreak || 0}/7`;
  $('round-results').innerHTML = s.players.map(p => `<div class="result-person ${(p.won || p.pityAward) && p.alive ? 'won' : ''}" data-result-player="${p.id}"><span>${escape(p.name)}${p.id === playerId ? ' · 你' : ''}${p.pityAward ? '<em>七连败保底</em>' : ''}</span><small>${p.alive ? HAND_NAMES[p.hand] || '—' : '已出局'}</small><strong>${p.alive ? `${p.steps} 步` : '—'}</strong></div>`).join('');
  $('round').textContent = `ROUND ${String(s.round).padStart(2, '0')} · 第 ${s.attempt} 次猜拳`;
  const titles = { rps: me?.picked ? '已出拳，等大家亮手。' : '石头、剪刀，还是布？', reveal: s.tie ? '没分出胜负，再来！' : '赢家拿步数，准备行动。', action: '行动开始，手快有优势。', between: '步数用完，下一轮见。', over: s.result ? `${s.players.find(p => p.id === s.result)?.name} 获胜！` : '本局结束' };
  $('phase-title').textContent = titles[s.phase] || '';
  $('phase-note').textContent = s.phase === 'rps' ? `${s.players.filter(p => p.alive && p.picked).length} / ${s.players.filter(p => p.alive).length} 人已出拳${me && !me.alive ? ' · 你已出局，可以继续观战' : ''}` : s.phase === 'action' ? '可以连续提交指令。每个人独立执行自己的行动队列。' : s.phase === 'over' ? '最后的幸存者，今晚由你守住这条街。' : '这一轮的步数不能留到下一轮。';
  $('hands').hidden = s.phase !== 'rps';
  document.querySelectorAll('[data-hand]').forEach(button => {
    button.disabled = !me?.alive || me.picked || socket?.readyState !== WebSocket.OPEN;
    button.classList.toggle('chosen', picked === button.dataset.hand);
  });
  $('rematch').hidden = s.phase !== 'over' || host !== you;
  const locationName = p => p.location === null ? '户外 · 正在路上' : `${s.players.find(t => t.id === p.location)?.name}的家`;
  $('players').innerHTML = s.players.map(p => `<article class="player ${p.id === playerId ? 'me' : ''} ${p.alive ? '' : 'out'}" data-player="${p.id}">
    <div class="player-head"><span class="player-name">${escape(p.name)}${p.id === playerId ? ' · 你' : ''}</span><span class="badge">${!p.alive ? '已出局' : s.phase === 'rps' ? (p.picked ? '已出拳' : '思考中') : `${p.steps} 步可用`}</span>${kickButton(members.find(m => m.playerId === p.id))}</div>
    <p>${escape(locationName(p))}</p><div class="equipment"><span>裤子 ${p.armor}/3</span><span class="${p.knife ? 'armed' : ''}">${p.knife ? '持刀' : '空手'}</span>${p.hand ? `<span>${HAND_NAMES[p.hand]}${p.won ? ' · 胜' : ''}</span>` : ''}</div>
    <p class="action-text" ${p.active ? `data-timer="${p.id}"` : ''}>${p.active ? ACTION_NAMES[p.active.type] : p.alive ? '等待行动' : '本局结束'}</p><div class="progress"><i data-progress="${p.id}" style="width:0%"></i></div>${p.queue.length ? `<p>排队 ${p.queue.length} 步</p>` : ''}</article>`).join('');
  options($('destination'), s.players, p => `${p.name}的家`);
  options($('target'), s.players.filter(p => p.alive && p.id !== playerId), p => p.name);
  $('steps').textContent = me ? `${me.steps} 步可分配` : '观战中';
  $('self-status').textContent = !me?.alive ? '你已出局，可以观看其他玩家继续。' : me.active ? `正在${ACTION_NAMES[me.active.type]}，可以继续安排下一步。` : '选择行动，或先排好去别人家的路线。';
  $('queue').textContent = `我的队列：${me?.queue.length ? me.queue.map(job => `${ACTION_NAMES[job.type]}${job.target ? ` → ${s.players.find(p => p.id === job.target)?.name}` : ''}`).join('　→　') : '空'}`;
  const logs = s.logs.slice(-35).reverse();
  const logKey = JSON.stringify(logs);
  if ($('logs').dataset.key !== logKey) {
    $('logs').dataset.key = logKey;
    $('logs').innerHTML = logs.map(log => `<li class="${escape(log.kind)}"><time>第 ${log.round} 轮 · ${log.time.toFixed(1)}s</time>${escape(log.text)}</li>`).join('');
  }
  updateControls(); animate();
}
function commandFor(type) {
  return { type, actor: snapshot?.playerId, ...(['strip', 'execute'].includes(type) ? { target: $('target').value } : type === 'move' ? { target: $('destination').value } : {}) };
}
function updateControls() {
  for (const button of document.querySelectorAll('[data-action]')) {
    const reason = leaving || !snapshot || socket?.readyState !== WebSocket.OPEN ? '尚未连接' : predictor.reason(commandFor(button.dataset.action));
    button.disabled = Boolean(reason); button.title = reason || `消耗 1 步，执行 ${ACTION_SECONDS[button.dataset.action]} 秒`;
  }
}
function animate() {
  if (!snapshot) return;
  const time = snapshot.game.time + (performance.now() - receivedAt) / 1000;
  if (snapshot.game.phase === 'reveal') {
    const remaining = Math.max(0, snapshot.game.revealUntil - time);
    $('reveal-countdown').textContent = remaining > 0 ? `${Math.ceil(remaining)} 秒后${snapshot.game.tie ? '重新出拳' : '开始行动'}` : '等待其他街坊一起进入下一阶段…';
    $('reveal-progress').style.width = `${Math.min(100, remaining / 5 * 100)}%`;
  }
  for (const p of snapshot.game.players) if (p.active) {
    const remaining = Math.max(0, p.active.endsAt - time);
    const label = document.querySelector(`[data-timer="${p.id}"]`);
    if (label) label.textContent = `${ACTION_NAMES[p.active.type]} · ${remaining > 0 ? `${remaining.toFixed(1)}s` : '等待结算'}${p.queue.length ? ` · 后续 ${p.queue.length} 步` : ''}`;
    const bar = document.querySelector(`[data-progress="${p.id}"]`);
    if (bar) bar.style.width = `${Math.min(100, Math.max(0, (time - p.active.startedAt) / ACTION_SECONDS[p.active.type] * 100))}%`;
  }
}
$('create').onclick = () => join(true);
$('join-form').onsubmit = event => { event.preventDefault(); join(false); };
$('resume').onclick = connect;
$('start').onclick = () => send('start'); $('rematch').onclick = () => send('rematch');
$('add-bot').onclick = () => send('addBot');
$('destination').onchange = updateControls; $('target').onchange = () => { courtyard?.select($('target').value); updateControls(); };
document.querySelectorAll('[data-hand]').forEach(button => { button.onclick = () => { picked = button.dataset.hand; send('pick', { hand: picked }); }; });
document.querySelectorAll('[data-action]').forEach(button => { button.onclick = () => { const { actor, ...command } = commandFor(button.dataset.action); send(command.type, command); }; });
$('invite').onclick = async () => {
  const link = `${location.origin}/projects/GGgame?room=${snapshot.code}`;
  try { await navigator.clipboard.writeText(link); notice('邀请链接已复制，发给朋友即可加入。'); }
  catch { notice(`邀请链接：${link}`); }
};
function resetRoom(message) {
  worldGeneration++; courtyard?.dispose(); courtyard = null; courtyardLoading = null;
  delete globalThis.__A3GAME_GAME__;
  stopped = true; clearTimeout(retry);
  const previous = socket; socket = null; previous?.close();
  session = null; snapshot = null; picked = null; displayedPhase = undefined; leaving = false;
  pending.clear(); cues.reset(); sounds.stop();
  try { sessionStorage.removeItem(storageKey); } catch { /* Optional. */ }
  history.replaceState(null, '', location.pathname); $('room-code').value = '';
  delete $('gggame').dataset.phase;
  $('entrance').hidden = false; $('room').hidden = true; $('resume').hidden = true;
  $('leave').disabled = false; $('leave').textContent = '退出房间';
  status('尚未连接'); notice(message); window.scrollTo(0, 0);
}
function worldFallback() {
  worldFailed = true; courtyard?.suspend(); $('world-stage').hidden = true;
  $('world-hint').textContent = '当前设备无法显示 3D，已切换文字视图，仍可正常联机。';
  $('gggame').dataset.world = 'off'; $('world-toggle').textContent = '重试 3D 视图'; $('world-toggle').setAttribute('aria-pressed', 'false');
}
async function renderWorld(focused) {
  $('world-shell').hidden = focused;
  const visible = worldEnabled && !worldFailed;
  $('gggame').dataset.world = visible ? 'on' : 'off'; $('world-stage').hidden = !visible;
  $('world-toggle').textContent = worldFailed ? '重试 3D 视图' : worldEnabled ? '切换文字视图' : '打开 3D 小院';
  $('world-toggle').setAttribute('aria-pressed', String(visible));
  if (!visible) { courtyard?.suspend(); return; }
  if (courtyard) { courtyard.update(snapshot); return; }
  if (courtyardLoading || focused) return;
  const generation = worldGeneration;
  $('world-loading').hidden = false;
  courtyardLoading = import('../../packages/gggame-3d/courtyard.js');
  let scene;
  try {
    const { Courtyard } = await courtyardLoading;
    if (generation !== worldGeneration || !snapshot) return;
    scene = new Courtyard({ container: $('world-canvas'), labels: $('world-labels'), onFailure: worldFallback,
      onHome: id => {
        if (snapshot?.game.phase !== 'action') { notice('行动阶段可以消耗 1 步前往这户人家。'); return; }
        $('destination').value = id; updateControls();
        const command = commandFor('move'), reason = predictor.reason(command);
        if (reason) notice(reason); else send('move', { target: id });
      },
      onPlayer: id => {
        if (id === snapshot?.playerId) { courtyard?.findSelf(); return; }
        if (snapshot?.game.phase === 'lobby') return;
        $('target').value = id; courtyard?.select(id); updateControls();
        const p = snapshot.game.players.find(p => p.id === id);
        if (p) notice(`已选择 ${p.name}，可在下方安排脱裤子或割。`);
      },
    });
    await scene.init();
    if (generation !== worldGeneration || !snapshot) { scene.dispose(); return; }
    courtyard = scene; courtyard.update(snapshot); if (!worldEnabled) courtyard.suspend();
    $('world-loading').hidden = true;
    // Read-only public playtest observation; it cannot modify server state.
    globalThis.__A3GAME_GAME__ = { host: courtyard.host, getState: () => snapshot?.game };
  } catch (error) { console.warn('GGgame 3D unavailable:', error); scene?.dispose(); if (generation === worldGeneration) worldFallback(); }
  finally { if (generation === worldGeneration) courtyardLoading = null; }
}
$('world-toggle').onclick = () => {
  if (worldFailed) { worldGeneration++; courtyard?.dispose(); courtyard = null; courtyardLoading = null; worldFailed = false; worldEnabled = true; }
  else worldEnabled = !worldEnabled;
  try { localStorage.setItem('gggame-world', worldEnabled ? 'on' : 'off'); } catch { /* Optional. */ }
  $('world-hint').textContent = '每个人的家都是独立地点。路上可以擦肩而过，但不能交手。';
  renderWorld(['rps', 'reveal'].includes(snapshot?.game.phase));
};
$('world-zoom-in').onclick = () => courtyard?.setZoom(courtyard.zoom * .8);
$('world-zoom-out').onclick = () => courtyard?.setZoom(courtyard.zoom * 1.2);
$('world-rotate').onclick = () => courtyard?.rotate(Math.PI / 4);
$('world-fit').onclick = () => courtyard?.fit(); $('world-self').onclick = () => courtyard?.findSelf();
document.addEventListener('visibilitychange', () => { if (document.hidden) courtyard?.suspend(); else if (worldEnabled) courtyard?.resume(); });
window.addEventListener('pagehide', () => courtyard?.suspend());
$('leave').onclick = async () => {
  if (!session || leaving) return;
  leaving = true; $('leave').disabled = true; $('leave').textContent = '正在退出…'; updateControls();
  const leavingSession = session;
  const seq = ++session.seq; store();
  try {
    const response = await fetch(`${endpoint}/api/rooms/${session.code}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: session.token, seq }), signal: AbortSignal.timeout(10000) });
    if (session !== leavingSession) return; // A removal notification may already have reset the UI.
    if (!response.ok && ![401, 404].includes(response.status)) throw Error('退出未确认');
    resetRoom('已退出房间，可以创建或加入新的房间。');
  } catch {
    if (session === leavingSession) resetRoom('本机已退出；网络中断，原房间将在断线超时后将你移出。');
  }
};
$('room').addEventListener('click', event => {
  const button = event.target.closest('[data-kick]');
  if (button && snapshot?.host === snapshot.you) send('kick', { target: button.dataset.kick });
});
setInterval(animate, 100);
setInterval(() => { if (!leaving && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })); }, 15000);
if (session && endpoint && (!invitedCode || invitedCode === session.code)) connect();
