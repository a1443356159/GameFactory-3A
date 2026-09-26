import { DurableObject } from 'cloudflare:workers';
import { Room } from './room.js';

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const codePattern = /^[A-F0-9]{12}$/;
const origins = env => new Set((env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()));

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/health') return json({ ok: true, service: 'gggame-rooms' });
    const origin = request.headers.get('Origin');
    if (!origins(env).has(origin)) return json({ reason: '不允许的网页来源。' }, 403);
    const cors = { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (Number(request.headers.get('Content-Length')) > 2048) return json({ reason: '请求过大。' }, 413, cors);
    let code, route;
    if (url.pathname === '/api/rooms' && request.method === 'POST') {
      code = crypto.randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase(); route = 'create';
    } else {
      const match = url.pathname.match(/^\/api\/rooms\/([A-F0-9]{12})\/(join|ws)$/);
      if (!match) return json({ reason: '找不到房间接口。' }, 404, cors);
      [, code, route] = match;
    }
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
    const internal = new URL(request.url); internal.pathname = `/${code}/${route}`;
    const result = await stub.fetch(new Request(internal, request));
    if (result.status === 101) return result;
    const response = new Response(result.body, result);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  },
};

export class GameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env); this.ctx = ctx;
    ctx.blockConcurrencyWhile(async () => {
      const saved = await ctx.storage.get('room');
      this.room = saved ? new Room(saved.code, Date.now(), saved) : null;
    });
  }
  async persist() {
    if (this.room.expired) {
      for (const ws of this.ctx.getWebSockets()) ws.close(1000, '房间已过期');
      await this.ctx.storage.deleteAll(); this.room = null; return;
    }
    await this.ctx.storage.put('room', this.room.save());
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.ceil(this.room.nextEvent())));
  }
  broadcast() {
    if (!this.room) return;
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(JSON.stringify(this.room.view(ws.deserializeAttachment().id))); } catch { /* Closed socket. */ }
    }
  }
  async fetch(request) {
    const [, code, route] = new URL(request.url).pathname.split('/');
    if (!codePattern.test(code)) return json({ reason: '无效房间号。' }, 400);
    if (route === 'create' || route === 'join') {
      if (request.method !== 'POST') return json({ reason: '需要 POST 请求。' }, 405);
      let body;
      try { const raw = await request.text(); if (raw.length > 2048) throw Error(); body = JSON.parse(raw); }
      catch { return json({ reason: '无效请求。' }, 400); }
      if (route === 'create' && !this.room) this.room = new Room(code);
      if (!this.room) return json({ reason: '房间不存在或已过期。' }, 404);
      const reply = this.room.join(body?.name, Date.now());
      await this.persist(); this.broadcast();
      return json(reply, reply.ok ? 200 : 400);
    }
    if (route !== 'ws' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ reason: '需要 WebSocket 连接。' }, 400);
    if (!this.room) return json({ reason: '房间不存在。' }, 404);
    this.room.advance(Date.now());
    const protocols = (request.headers.get('Sec-WebSocket-Protocol') || '').split(',').map(s => s.trim());
    const token = protocols.find(s => s.startsWith('session.'))?.slice(8);
    const member = this.room.authenticate(token);
    if (!member || this.room.expired) return json({ reason: '身份已失效，请重新加入。' }, 401);
    for (const socket of this.ctx.getWebSockets()) if (socket.deserializeAttachment()?.id === member.id) socket.close(4001, '已在另一个页面连接');
    member.lastSeen = Date.now();
    const [client, server] = Object.values(new WebSocketPair());
    server.serializeAttachment({ id: member.id, window: Date.now(), count: 0 });
    this.ctx.acceptWebSocket(server);
    await this.persist(); this.broadcast();
    return new Response(null, { status: 101, webSocket: client, headers: { 'Sec-WebSocket-Protocol': 'gggame' } });
  }
  async webSocketMessage(ws, raw) {
    if (!this.room || typeof raw !== 'string' || raw.length > 2048) { ws.close(1008, '无效消息'); return; }
    const attachment = ws.deserializeAttachment();
    const now = Date.now();
    if (now - attachment.window > 1000) { attachment.window = now; attachment.count = 0; }
    if (++attachment.count > 20) { ws.close(1008, '操作过于频繁'); return; }
    ws.serializeAttachment(attachment);
    let msg;
    try { msg = JSON.parse(raw); } catch { ws.close(1008, '无效 JSON'); return; }
    const reply = this.room.command(attachment.id, msg, now);
    await this.persist();
    try { ws.send(JSON.stringify({ type: 'ack', seq: msg?.seq, ...reply })); } catch { /* Disconnected during commit. */ }
    this.broadcast();
  }
  async alarm() {
    if (!this.room) return;
    this.room.advance(Date.now()); await this.persist(); this.broadcast();
  }
  webSocketClose(ws, code) { ws.close([1005, 1006, 1015].includes(code) ? 1000 : code); }
  webSocketError(ws) { ws.close(1011, '连接错误'); }
}
