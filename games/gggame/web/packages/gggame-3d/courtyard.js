import * as THREE from 'three';
import { A3GameRuntimeHost, createSunLight, disposeObject3D } from '@a3game/playable';
import { ACTION_NAMES } from '../../../shared/rules.js';
import { box, house, neighbor, tree, COLORS } from './figures.js';
import { layoutHomes, residentPoint, travelPoint } from './layout.js';

const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export class Courtyard {
  constructor({ container, labels, onHome, onPlayer, onFailure }) {
    Object.assign(this, { container, labels, onHome, onPlayer, onFailure });
    this.actors = new Map(); this.homes = new Map(); this.tags = []; this.effects = [];
    this.yaw = .14; this.zoom = 1; this.focus = new THREE.Vector3(); this.lastEvent = undefined;
    this.abort = new AbortController(); this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
  async init() {
    this.host = new A3GameRuntimeHost({ container: this.container, cameraType: 'orthographic', frustumHeight: 20, near: .1, far: 300,
      clearColor: 0xe4eadb, antialias: true, pixelRatioCap: Math.min(devicePixelRatio, 1.5), shadows: innerWidth > 600 });
    await this.host.init();
    this.host.scene.add(new THREE.HemisphereLight(0xfff4dc, 0x8b9b78, 2.6));
    this.host.add(createSunLight({ position: { x: -9, y: 18, z: 12 }, target: { x: 0, y: 0, z: 0 }, intensity: 2.5, radius: 35, mapSize: 1024 }), 'environment');
    this.host.onRender(() => this.frame()); this.host.onResize(() => this.camera());
    const { signal } = this.abort;
    let down;
    this.container.addEventListener('pointerdown', event => { down = { x: event.clientX, y: event.clientY, yaw: this.yaw, moved: false }; }, { signal });
    this.container.addEventListener('pointermove', event => {
      if (!down) return;
      if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 8) down.moved = true;
      if (down.moved) { this.yaw = down.yaw - (event.clientX - down.x) * .007; this.camera(); }
    }, { signal });
    window.addEventListener('pointerup', event => {
      if (!down) return; const moved = down.moved; down = null;
      if (moved || event.target !== this.host.renderer.domElement) return;
      const hit = this.host.raycastFromPointer(event, this.root ? [this.root] : []);
      let object = hit?.object;
      while (object && !object.userData.playerId && !object.userData.homeId) object = object.parent;
      if (object?.userData.playerId) this.onPlayer(object.userData.playerId);
      else if (object?.userData.homeId) this.onHome(object.userData.homeId);
    }, { signal });
    this.container.addEventListener('pointercancel', () => { down = null; }, { signal });
    this.container.addEventListener('wheel', event => { event.preventDefault(); this.setZoom(this.zoom * (event.deltaY > 0 ? 1.1 : .9)); }, { passive: false, signal });
    this.host.renderer.domElement.addEventListener('webglcontextlost', event => { event.preventDefault(); this.host.stop(); this.onFailure(); }, { signal });
    this.host.renderer.domElement.setAttribute('aria-label', 'GGgame 3D 小院，拖动旋转；也可使用画面下方的文字操作');
    this.host.start(); this.container.dataset.ready = 'true'; return this;
  }
  clear() {
    if (this.root) { this.host.remove(this.root); disposeObject3D(this.root); }
    this.root = null; this.labels.replaceChildren(); this.actors.clear(); this.tags = []; this.effects = []; this.lastEvent = undefined;
  }
  rebuild(players) {
    this.clear(); this.root = new THREE.Group(); this.host.add(this.root, 'courtyard');
    this.homes = layoutHomes(players);
    const centers = [...this.homes.values()];
    this.width = Math.max(12, ...centers.map(p => Math.abs(p.x) * 2 + 8));
    this.depth = Math.max(10, ...centers.map(p => Math.abs(p.z) * 2 + 8));
    box(this.root, [this.width + 2, .65, this.depth + 2], [0, -.5, 0], 0xc0ccaa, .35);
    box(this.root, [this.width, .12, this.depth], [0, -.13, 0], 0xd7d9be, .22);
    for (let x = -this.width / 2 + 1; x < this.width / 2; x += 1.35) box(this.root, [1.05, .04, .7], [x, -.025, this.depth / 2 - 1.2], 0xe9e4d0);
    tree(this.root, -this.width / 2, -this.depth / 2, 1.2); tree(this.root, this.width / 2, -this.depth / 2, 1.05);
    tree(this.root, -this.width / 2, this.depth / 2, .85);
    const columns = Math.max(2, Math.ceil(Math.sqrt(players.length))), rows = Math.ceil(players.length / columns);
    for (let i = players.length; i < columns * rows; i++) {
      const x = (i % columns - (columns - 1) / 2) * 6.4, z = (Math.floor(i / columns) - (rows - 1) / 2) * 6.4;
      box(this.root, [4.9, .16, 4.8], [x, .02, z], 0xaebb8d, .25);
      tree(this.root, x + 1.25, z - 1.2, .8);
      box(this.root, [1.8, .15, .55], [x - .5, .65, z + .2], 0xbc986e);
      box(this.root, [1.8, .62, .13], [x - .5, .95, z - .02], 0xbc986e);
      for (const offset of [-.65, .65]) box(this.root, [.14, .6, .43], [x - .5 + offset, .3, z + .2], 0x77816a);
      for (let j = 0; j < 3; j++) box(this.root, [.65, .04, .45], [x - .8 + j * .8, .14, z + 1.6], 0xe9e4d0);
    }
    players.forEach((p, i) => {
      const center = this.homes.get(p.home); const color = COLORS[i % COLORS.length];
      house(this.root, center, color, p.home);
      const tag = document.createElement('button'); tag.className = 'home-tag'; tag.dataset.home3d = p.home;
      tag.textContent = `${p.name}的家`; tag.style.setProperty('--owner', `#${color.toString(16).padStart(6, '0')}`);
      tag.onclick = () => this.onHome(p.home); this.labels.append(tag);
      this.tags.push({ element: tag, position: new THREE.Vector3(center.x, 2.15, center.z - 2.4) });
      const actor = neighbor(color, p.id); this.root.add(actor.root);
      actor.label = document.createElement('button'); actor.label.className = 'actor-tag'; actor.label.dataset.actor3d = p.id;
      actor.title = document.createElement('strong'); actor.detail = document.createElement('span'); actor.progress = document.createElement('i');
      actor.label.append(actor.title, actor.detail, actor.progress); actor.label.onclick = () => this.onPlayer(p.id); this.labels.append(actor.label);
      this.actors.set(p.id, actor);
    });
    this.focus.set(0, 0, 0); this.zoom = 1; this.camera();
  }
  update(snapshot) {
    this.snapshot = snapshot; this.receivedAt = performance.now();
    const lobby = snapshot.game.phase === 'lobby';
    this.players = lobby ? snapshot.members.map(m => ({ id: m.id, home: m.id, name: m.name, location: m.id, alive: true, armor: 1, steps: 0, knife: false })) : snapshot.game.players;
    this.self = lobby ? snapshot.you : snapshot.playerId;
    const key = `${snapshot.code}:${lobby}:${this.players.map(p => `${p.id}:${p.name}`).join('|')}`;
    if (this.key !== key) { this.key = key; this.rebuild(this.players); }
    const events = snapshot.game.events || [];
    if (this.lastEvent !== undefined) for (const event of events) if (event.id > this.lastEvent && event.type === 'action_completed') {
      const actor = this.actors.get(event.target && ['strip', 'execute'].includes(event.action) ? event.target : event.actor);
      if (actor) this.burst(actor, event.success ? { wear: '+1 护甲', knife: '已持刀', move: '到家了', strip: '−1 护甲', execute: '出局' }[event.action] : '未生效', event.success);
    }
    this.lastEvent = events.at(-1)?.id ?? 0;
    this.active = !['rps', 'reveal'].includes(snapshot.game.phase);
    if (this.active && document.visibilityState !== 'hidden') this.host.start(); else this.host.stop();
    this.frame();
  }
  project(position, element) {
    const vector = position.clone().project(this.host.camera);
    const { clientWidth: w, clientHeight: h } = this.container;
    element.hidden = vector.z < -1 || vector.z > 1 || Math.abs(vector.x) > 1.12 || Math.abs(vector.y) > 1.12;
    element.style.left = `${(vector.x + 1) * w / 2}px`; element.style.top = `${(1 - vector.y) * h / 2}px`;
  }
  frame() {
    if (!this.snapshot || !this.root) return;
    const s = this.snapshot.game; const elapsed = (performance.now() - this.receivedAt) / 1000;
    const time = s.time + (s.phase === 'action' ? elapsed : 0); const ambient = this.reduced ? 0 : performance.now() / 1000;
    for (const p of this.players) {
      const a = this.actors.get(p.id), job = p.active;
      if (a.routeId !== (job?.type === 'move' ? job.id : null)) {
        if (a.route) { this.root.remove(a.route); a.route.geometry.dispose(); a.route.material.dispose(); a.route = null; }
        a.routeId = job?.type === 'move' ? job.id : null;
        if (a.routeId) {
          const points = Array.from({ length: 25 }, (_, i) => { const point = travelPoint(job, job.startedAt + (job.endsAt - job.startedAt) * i / 24, this.homes, p.home); return new THREE.Vector3(point.x, .4, point.z); });
          a.route = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineDashedMaterial({ color: 0x607e67, dashSize: .15, gapSize: .12, transparent: true, opacity: .65 }));
          a.route.computeLineDistances(); this.root.add(a.route);
        }
      }
      const point = job?.type === 'move' ? travelPoint(job, time, this.homes, p.home) : residentPoint(p, this.players, this.homes);
      a.root.position.set(point.x, .35, point.z);
      a.body.position.y = p.alive && !this.reduced ? Math.sin(ambient * 2.5) * .025 : 0;
      a.body.rotation.set(0, 0, p.alive ? 0 : -Math.PI / 2); if (!p.alive) a.body.position.y = .35;
      a.arms.forEach(arm => arm.rotation.set(0, 0, 0)); a.legs.forEach(leg => leg.pivot.rotation.set(0, 0, 0));
      a.root.rotation.y = .08;
      a.blade.visible = Boolean(p.knife); a.belts.forEach((belt, i) => { belt.visible = i < p.armor; });
      a.legs.forEach(leg => leg.pants.material.color.setHex(p.armor ? 0x577b8e : 0xf6eedb));
      if (p.alive && job) {
        const t = clamp((time - job.startedAt) / (job.endsAt - job.startedAt), 0, 1), wave = Math.sin(t * Math.PI * 8);
        if (job.type === 'move') {
          const next = travelPoint(job, Math.min(time + .04, job.endsAt), this.homes, p.home);
          if (t < 1) a.root.rotation.y = Math.atan2(next.x - point.x, next.z - point.z);
          if (!this.reduced && t < 1) { a.legs[0].pivot.rotation.x = wave * .65; a.legs[1].pivot.rotation.x = -wave * .65; a.arms[0].rotation.x = -wave * .45; a.arms[1].rotation.x = wave * .45; a.body.position.y = Math.abs(wave) * .08; }
        } else {
          const target = this.players.find(other => other.id === job.target);
          if (target) { const targetPoint = residentPoint(target, this.players, this.homes); a.root.rotation.y = Math.atan2(targetPoint.x - point.x, targetPoint.z - point.z); }
          if (!this.reduced) {
            if (job.type === 'wear') { a.body.rotation.x = .2 * Math.sin(t * Math.PI); a.arms.forEach(arm => arm.rotation.x = -.35 - Math.sin(t * Math.PI) * .8); }
            if (job.type === 'knife') a.arms[1].rotation.x = -Math.sin(t * Math.PI) * 2.5;
            if (job.type === 'strip') { a.arms.forEach(arm => arm.rotation.x = -1.1 + wave * .25); a.body.rotation.x = .2 + wave * .07; }
            if (job.type === 'execute') { a.arms[1].rotation.x = -1.9 + Math.sin(t * Math.PI * 3) * .8; a.body.rotation.y = Math.sin(t * Math.PI * 2) * .16; }
          }
        }
      } else if (s.phase === 'over' && s.result === p.id && !this.reduced) {
        a.body.position.y = Math.abs(Math.sin(ambient * 4)) * .25; a.arms[0].rotation.z = 2.3; a.arms[1].rotation.z = -2.3;
      }
      a.ring.visible = p.id === this.selected || p.id === this.self;
      a.ring.material.color.setHex(p.id === this.selected ? 0xf1b84b : 0x416f58);
      a.label.classList.toggle('selected', p.id === this.selected); a.label.classList.toggle('self', p.id === this.self); a.label.classList.toggle('out', !p.alive);
      const title = `${p.name}${p.id === this.self ? ' · 你' : ''}`;
      if (a.title.textContent !== title) a.title.textContent = title;
      const remaining = job ? Math.max(0, job.endsAt - time) : 0;
      const detail = !p.alive ? '已出局' : job ? `${job.type === 'move' ? '户外 · ' : ''}${ACTION_NAMES[job.type]} ${remaining ? `${remaining.toFixed(1)}s` : '待结算'}` : `裤 ${p.armor}/3 · ${p.knife ? '持刀 · ' : ''}${p.steps} 步`;
      if (a.detail.textContent !== detail) a.detail.textContent = detail;
      a.progress.style.width = job ? `${clamp(1 - remaining / (job.endsAt - job.startedAt), 0, 1) * 100}%` : '0%';
      this.project(a.root.position.clone().add(new THREE.Vector3(0, 2.4, 0)), a.label);
    }
    this.root.updateMatrixWorld(true); this.host.camera.updateMatrixWorld(true);
    this.tags.forEach(tag => this.project(tag.position, tag.element));
    this.arrangeLabels();
    for (const effect of [...this.effects]) {
      const age = (performance.now() - effect.born) / 1000;
      if (age > 1.4) { effect.element.remove(); this.effects.splice(this.effects.indexOf(effect), 1); continue; }
      this.project(effect.actor.root.position.clone().add(new THREE.Vector3(0, 2.6 + age * .6, 0)), effect.element);
      effect.element.style.opacity = String(1 - age / 1.4);
    }
  }
  arrangeLabels() {
    const placed = [], w = this.container.clientWidth, h = this.container.clientHeight;
    const overlap = (a, b) => a.x < b.x + b.w + 3 && a.x + a.w + 3 > b.x && a.y < b.y + b.h + 3 && a.y + a.h + 3 > b.y;
    const actors = [...this.actors.values()].sort((a, b) => parseFloat(a.label.style.top) - parseFloat(b.label.style.top));
    for (const actor of actors) {
      const label = actor.label; if (label.hidden) continue;
      const width = label.offsetWidth, height = label.offsetHeight;
      const rect = { x: clamp(parseFloat(label.style.left) - width / 2, 5, w - width - 5), y: clamp(parseFloat(label.style.top) - height, 8, h - height - 45), w: width, h: height };
      for (let i = 0; i < 12 && placed.some(other => overlap(rect, other)); i++) rect.y -= height + 4;
      if (rect.y < 5) rect.y = Math.min(h - height - 45, parseFloat(label.style.top) + 8);
      label.style.left = `${rect.x + width / 2}px`; label.style.top = `${rect.y + height}px`; placed.push(rect);
    }
    for (const tag of this.tags) {
      const label = tag.element; if (label.hidden) continue;
      const rect = { x: parseFloat(label.style.left) - label.offsetWidth / 2, y: parseFloat(label.style.top), w: label.offsetWidth, h: label.offsetHeight };
      if (placed.some(other => overlap(rect, other))) label.hidden = true;
    }
  }
  burst(actor, text, success) {
    const element = document.createElement('span'); element.className = `world-pop ${success ? '' : 'failed'}`; element.textContent = text;
    this.labels.append(element); this.effects.push({ actor, element, born: performance.now() });
  }
  select(id) { this.selected = id; }
  camera() {
    if (!this.host.camera) return;
    const aspect = Math.max(.3, this.container.clientWidth / Math.max(1, this.container.clientHeight));
    const span = ((this.width || 16) + 2) * Math.abs(Math.cos(this.yaw)) + ((this.depth || 12) + 2) * Math.abs(Math.sin(this.yaw));
    this.host.setFrustumHeight(Math.max((span + 2) / aspect, (this.depth || 12) * .83 + 6) * this.zoom);
    this.host.camera.position.set(this.focus.x + Math.sin(this.yaw) * 28, 30, this.focus.z + Math.cos(this.yaw) * 28);
    this.host.camera.lookAt(this.focus); this.host.camera.updateMatrixWorld(true);
  }
  setZoom(zoom) { this.zoom = clamp(zoom, .35, 1.6); this.camera(); }
  rotate(delta) { this.yaw += delta; this.camera(); }
  fit() { this.focus.set(0, 0, 0); this.zoom = 1; this.yaw = .14; this.camera(); }
  findSelf() { const actor = this.actors.get(this.self); if (actor) { this.focus.copy(actor.root.position); this.focus.y = 0; this.zoom = .55; this.camera(); } }
  suspend() { this.host?.stop(); }
  resume() { if (this.active) this.host?.start(); }
  dispose() { this.abort.abort(); this.clear(); this.host?.dispose(); delete this.container.dataset.ready; }
}
