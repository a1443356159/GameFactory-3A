import { test, expect } from '@playwright/test';

async function observe(page) {
  await page.addInitScript(() => {
    const Native = window.WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) {
        super(...args);
        this.addEventListener('message', event => {
          const msg = JSON.parse(event.data);
          if (msg.type === 'state') window.roomState = msg;
        });
      }
    };
  });
}
const state = page => page.evaluate(() => window.roomState);
async function phase(page, expected) { await expect.poll(async () => (await state(page))?.game.phase, { timeout: 12000 }).toBe(expected); }

test('three independent browsers complete a match; private hands, queues, reconnect and mobile', async ({ browser }, info) => {
  const contexts = await Promise.all([
    browser.newContext({ viewport: { width: 1280, height: 1000 } }),
    browser.newContext({ viewport: { width: 390, height: 844 } }),
    browser.newContext(),
  ]);
  const pages = await Promise.all(contexts.map(c => c.newPage()));
  const [a, b, c] = pages;
  const errors = [];
  for (const page of pages) { page.on('pageerror', error => errors.push(error.message)); await observe(page); }
  await a.goto('/projects/GGgame');
  await a.locator('#nickname').fill('阿橙'); await a.locator('#create').click();
  await expect(a.locator('#room-label')).toHaveText(/^[A-F0-9]{12}$/);
  const code = await a.locator('#room-label').textContent();
  for (const [i, page] of [b, c].entries()) {
    await page.goto(`/projects/GGgame?room=${code}`);
    await page.locator('#nickname').fill(['小蓝', '大麦'][i]);
    await page.locator('#join-form [type=submit]').click();
    await expect(page.locator('#room-label')).toHaveText(code);
  }
  await expect(a.locator('.member')).toHaveCount(3);
  await expect(b.locator('#start')).toBeDisabled();
  await a.locator('#start').click(); await phase(b, 'rps');
  await a.locator('[data-hand=rock]').click();
  await expect.poll(async () => (await state(b)).game.players[0].picked).toBe(true);
  expect((await state(b)).game.players[0].hand).toBeNull();
  expect(JSON.stringify(await state(b))).not.toContain('token');
  await b.locator('[data-hand=scissors]').click(); await c.locator('[data-hand=scissors]').click();
  await phase(a, 'action');
  expect((await state(a)).game.players.map(p => p.steps)).toEqual([2, 0, 0]);
  await a.locator('[data-action=knife]').click();
  await expect.poll(async () => (await state(a)).game.players[0].active?.type).toBe('knife');
  await a.locator('#destination').selectOption('p1'); await a.locator('[data-action=move]').click();
  await expect(a.locator('#queue')).toContainText('移动');
  // Refresh after submission: reconnect to the same actor and committed queue.
  await a.reload(); await expect(a.locator('#room-label')).toHaveText(code);
  await expect.poll(async () => (await state(b)).game.players[0].location).toBeNull();
  await b.screenshot({ path: info.outputPath('mobile-travel.png'), fullPage: true });
  expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect.poll(async () => (await state(a)).game.players[0].location).toBe('p1');
  expect((await state(a)).game.players[0].knife).toBe(true);

  async function winRound(live = [a, b, c]) {
    for (const p of live) await phase(p, 'rps');
    await live[0].locator('[data-hand=rock]').click();
    for (const p of live.slice(1)) await p.locator('[data-hand=scissors]').click();
    await phase(a, 'action');
  }
  await winRound();
  await a.locator('#target').selectOption('p1'); await a.locator('[data-action=strip]').click();
  await expect.poll(async () => (await state(a)).game.players[0].active?.type).toBe('strip');
  await a.locator('[data-action=execute]').click();
  await expect(a.locator('#queue')).toContainText('割');
  await a.screenshot({ path: info.outputPath('desktop-queue.png'), fullPage: true });
  await expect.poll(async () => (await state(b)).game.players[1].alive, { timeout: 9000 }).toBe(false);
  await winRound([a, c]);
  await a.locator('#destination').selectOption('p2'); await a.locator('[data-action=move]').click();
  await winRound([a, c]);
  await a.locator('#target').selectOption('p2'); await a.locator('[data-action=strip]').click();
  await winRound([a, c]); await a.locator('[data-action=execute]').click();
  for (const p of pages) { await phase(p, 'over'); expect((await state(p)).game.result).toBe('p0'); }
  await a.screenshot({ path: info.outputPath('winner.png'), fullPage: true });
  expect(errors).toEqual([]);
  for (const ctx of contexts) await ctx.close();
});

test('origin checks reject unrelated sites and one human can start with a computer', async ({ page, request }) => {
  const rejected = await request.post(`${process.env.GGGAME_ROOM_URL || 'http://127.0.0.1:8787'}/api/rooms`, { headers: { Origin: 'https://unrelated.example' }, data: { name: 'bad' } });
  expect(rejected.status()).toBe(403);
  await observe(page); await page.goto('/projects/GGgame');
  await page.locator('#nickname').fill('人机试玩'); await page.locator('#create').click();
  await expect(page.locator('#room-label')).toHaveText(/^[A-F0-9]{12}$/);
  await page.locator('#add-bot').click(); await expect(page.locator('.member')).toHaveCount(2);
  await page.locator('#start').click();
  await expect.poll(async () => (await state(page))?.game.players[1]?.picked).toBe(true);
  expect((await state(page)).game.players[1].hand).toBeNull();
  await page.locator('[data-hand=rock]').click(); await phase(page, 'reveal');
});
