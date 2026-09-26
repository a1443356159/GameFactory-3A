import { test, expect } from '@playwright/test';

test('3D full match uses all five actions, scene targeting, reconnect and server-timed outcomes', async ({ browser }, info) => {
  const contexts = await Promise.all([0, 1, 2].map(i => browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(i === 0 ? { recordVideo: { dir: info.outputPath('video'), size: { width: 1440, height: 1000 } } } : {}) })));
  const [a, b, c] = await Promise.all(contexts.map(context => context.newPage()));
  const errors = []; for (const page of [a, b, c]) page.on('pageerror', e => errors.push(e.message));
  const state = () => a.evaluate(() => window.__A3GAME_GAME__?.getState());
  const phase = expected => expect.poll(async () => (await state())?.phase, { timeout: 15000 }).toBe(expected);
  await a.goto('/projects/GGgame'); await a.locator('#nickname').fill('阿橙'); await a.locator('#create').click();
  await expect(a.locator('#world-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
  const code = await a.locator('#room-label').textContent();
  for (const [page, name] of [[b, '小蓝'], [c, '大麦']]) {
    await page.goto(`/projects/GGgame?room=${code}`); await page.locator('#nickname').fill(name); await page.locator('#join-form [type=submit]').click();
    await expect(page.locator('#world-canvas')).toHaveAttribute('data-ready', 'true');
  }
  await expect(a.locator('[data-actor3d]')).toHaveCount(3); await a.locator('#start').click();
  async function winRound(opponents = [b, c]) {
    await phase('rps'); await a.locator('[data-hand=rock]').click();
    for (const page of opponents) await page.locator('[data-hand=scissors]').click();
    await phase('action');
  }
  await winRound();
  await a.locator('[data-action=knife]').click(); await a.locator('[data-action=wear]').click();
  await expect.poll(async () => (await state()).players[0].armor).toBe(2);
  expect((await state()).players[0].knife).toBe(true);
  await winRound();
  // Click the actual rendered floor, not just a DOM command button.
  const floor = await a.evaluate(() => {
    const host = window.__A3GAME_GAME__.host;
    let house; host.scene.traverse(object => { if (object.userData.homeId === 'p1') house = object; });
    const point = house.position.clone(); point.y = .4; point.x += 1.35; point.z += .75;
    point.project(host.camera); const rect = host.renderer.domElement.getBoundingClientRect();
    return { x: rect.x + (point.x + 1) * rect.width / 2, y: rect.y + (1 - point.y) * rect.height / 2 };
  });
  await a.mouse.click(floor.x, floor.y);
  await expect.poll(async () => (await state()).players[0].location).toBeNull();
  await expect(a.locator('[data-actor3d=p0]')).toContainText('户外');
  await a.locator('[data-actor3d=p1]').click(); await expect(a.locator('#target')).toHaveValue('p1');
  await a.locator('[data-action=strip]').click();
  await expect.poll(async () => (await state()).players[0].active?.type).toBe('strip');
  await a.screenshot({ path: info.outputPath('action-desktop.png') });
  await expect.poll(async () => (await state()).players[1].armor).toBe(0);
  await winRound();
  await a.locator('[data-action=execute]').click();
  await a.locator('#destination').selectOption('p2'); await a.locator('[data-action=move]').click();
  await expect.poll(async () => (await state()).players[1].alive).toBe(false);
  await expect(a.locator('[data-actor3d=p1]')).toContainText('已出局');
  await a.reload(); await expect(a.locator('#world-canvas')).toHaveAttribute('data-ready', 'true');
  await expect.poll(async () => (await state()).players[0].location).toBe('p2');
  await winRound([c]); await a.locator('[data-actor3d=p2]').click(); await a.locator('[data-action=strip]').click();
  await expect.poll(async () => (await state()).players[2].armor).toBe(0);
  await winRound([c]); await a.locator('[data-action=execute]').click(); await phase('over');
  expect((await state()).result).toBe('p0');
  await a.screenshot({ path: info.outputPath('winner-desktop.png') });
  expect(await a.evaluate(() => window.__A3GAME_GAME__.host.getStats().triangles)).toBeGreaterThan(1000);
  await a.locator('#rematch').click(); await phase('rps');
  expect((await state()).players.every(p => p.alive && p.armor === 1 && !p.knife)).toBe(true);
  await a.locator('#leave').click(); await expect(a.locator('#entrance')).toBeVisible();
  expect(errors).toEqual([]);
  await Promise.all(contexts.map(context => context.close()));
  await a.video().saveAs(info.outputPath('courtyard-match.webm'));
});
