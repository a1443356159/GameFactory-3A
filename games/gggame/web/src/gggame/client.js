import { GGGame, ACTION_NAMES, ACTION_SECONDS, HAND_NAMES } from '../../gggame/rules.js';

const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const storageKey = 'gggame-session-v1';
let session, socket, snapshot, receivedAt = 0, retry, attempts = 0, stopped = false, picked = null;
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
    session = { ...body, name, seq: 0 }; store(); connect();
  } catch (error) { notice(`无法加入：${error.message} 请检查网络后重试。`); }
  finally { $('create').disabled = false; $('join-form').querySelector('[type=submit]').disabled = false; }
}
function connect() {
  if (!session || !endpoint) return;
  stopped = false; clearTimeout(retry);
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
    const message = JSON.parse(event.data);
    if (message.type === 'state') {
      if (message.expired) { stopped = true; notice('房间已过期，请创建新房间。'); current.close(); return; }
      const previousKey = snapshot && `${snapshot.game.round}:${snapshot.game.attempt}`;
      snapshot = message; receivedAt = performance.now();
      session.seq = Math.max(session.seq, message.commandSeq || 0); store();
      if (previousKey !== `${message.game.round}:${message.game.attempt}`) picked = null;
      predictor.state = message.game;
      render();
    } else if (message.type === 'ack' && message.seq) {
      pending.delete(message.seq);
      if (!message.ok) notice(message.reason);
    }
  };
  current.onclose = event => {
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
  if (socket?.readyState !== WebSocket.OPEN || !session) { notice('等待连接恢复后再操作。'); return; }
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
  const isLobby = s.phase === 'lobby';
  $('lobby').hidden = !isLobby; $('match').hidden = isLobby;
  if (isLobby) {
    $('members').innerHTML = members.map(m => `<div class="member">${escape(m.name)}<em>${m.id === you ? '你 · ' : ''}${m.bot ? '电脑' : m.id === host ? '房主' : '已加入'}</em></div>`).join('');
    $('start').disabled = host !== you || members.length < 2;
    $('add-bot').disabled = host !== you || members.length >= 64;
    $('host-hint').textContent = host === you ? `当前 ${members.length} 人，准备好了就开始。` : '等待房主开始游戏。';
    return;
  }
  const me = s.players.find(p => p.id === playerId);
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
    <div class="player-head"><span class="player-name">${escape(p.name)}${p.id === playerId ? ' · 你' : ''}</span><span class="badge">${!p.alive ? '已出局' : s.phase === 'rps' ? (p.picked ? '已出拳' : '思考中') : `${p.steps} 步可用`}</span></div>
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
    const reason = !snapshot || socket?.readyState !== WebSocket.OPEN ? '尚未连接' : predictor.reason(commandFor(button.dataset.action));
    button.disabled = Boolean(reason); button.title = reason || `消耗 1 步，执行 ${ACTION_SECONDS[button.dataset.action]} 秒`;
  }
}
function animate() {
  if (!snapshot) return;
  const time = snapshot.game.time + (performance.now() - receivedAt) / 1000;
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
$('destination').onchange = updateControls; $('target').onchange = updateControls;
document.querySelectorAll('[data-hand]').forEach(button => { button.onclick = () => { picked = button.dataset.hand; send('pick', { hand: picked }); }; });
document.querySelectorAll('[data-action]').forEach(button => { button.onclick = () => { const { actor, ...command } = commandFor(button.dataset.action); send(command.type, command); }; });
$('invite').onclick = async () => {
  const link = `${location.origin}/projects/GGgame?room=${snapshot.code}`;
  try { await navigator.clipboard.writeText(link); notice('邀请链接已复制，发给朋友即可加入。'); }
  catch { notice(`邀请链接：${link}`); }
};
$('leave').onclick = () => {
  stopped = true; clearTimeout(retry); socket?.close(); snapshot = null; pending.clear();
  $('entrance').hidden = false; $('room').hidden = true; $('resume').hidden = false;
  notice('已断开连接，75 秒内可以恢复本局。');
};
setInterval(animate, 100);
setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'ping' })); }, 15000);
if (session && endpoint && (!invitedCode || invitedCode === session.code)) connect();
