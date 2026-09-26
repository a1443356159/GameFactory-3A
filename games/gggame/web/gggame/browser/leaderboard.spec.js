import { test, expect } from '@playwright/test';

async function observe(page) {
  await page.addInitScript(() => {
    localStorage.setItem('gggame-world', 'off');
    const Native = WebSocket;
    window.WebSocket = class extends Native {
      constructor(...args) { super(...args); this.addEventListener('message', event => {
        const msg = JSON.parse(event.data); if (msg.type === 'state') window.roomState = msg;
      }); }
    };
  });
}
const board = (page, name) => page.evaluate(async name => {
  const endpoint = document.querySelector('#gggame').dataset.endpoint || 'http://127.0.0.1:8787';
  const response = await fetch(`${endpoint}/api/leaderboard?name=${encodeURIComponent(name)}`);
  if (!response.ok) throw Error(`Leaderboard ${response.status}`);
  return response.json();
}, name);

test('draw retries in one second; host refresh reconnects and closing the host page expires the room', async ({ browser }, info) => {
  const ca = await browser.newContext(), cb = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ca.newPage(), b = await cb.newPage(); await observe(a); await observe(b);
  const name = `房主${Date.now().toString(36)}`, guest = `访客${Date.now().toString(36)}`;
  await a.goto('/projects/GGgame'); await a.locator('#nickname').fill(name); await a.locator('#create').click();
  await expect(a.locator('#room-label')).toHaveText(/^[A-F0-9]{12}$/); const code = await a.locator('#room-label').textContent();
  await b.goto(`/projects/GGgame?room=${code}`); await b.locator('#nickname').fill(guest); await b.locator('#join-form [type=submit]').click();
  await expect(a.locator('.member')).toHaveCount(2); await a.locator('#start').click();
  await a.locator('[data-hand=rock]').click(); await b.locator('[data-hand=rock]').click();
  await expect(a.locator('#reveal-title')).toContainText('平局');
  expect(await a.evaluate(() => window.roomState.game.revealUntil - window.roomState.game.time)).toBe(1);
  await expect(a.locator('#rps-stage')).toBeVisible({ timeout: 2500 });
  await a.reload(); await expect(a.locator('#rps-stage')).toBeVisible();
  expect(await a.evaluate(() => window.roomState.game.attempt)).toBe(2);
  await a.close();
  // It must retain the room briefly for refresh, then close all guests automatically.
  await expect(b.locator('#room')).toBeVisible();
  await expect(b.locator('#entrance')).toBeVisible({ timeout: 22000 });
  await expect(b.locator('#notice')).toContainText('关闭');
  await expect.poll(async () => (await board(b, name)).player).toMatchObject({ games: 1, wins: 0, kills: 0, wears: 0 });
  await b.locator('#leaderboard-open').click(); await b.locator('#leaderboard-name').fill(name); await b.locator('#leaderboard-search button').click();
  await expect(b.locator('#leaderboard-personal')).toContainText('游玩 1 次');
  expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await b.screenshot({ path: info.outputPath('leaderboard-phone.png') });
  await b.locator('#leaderboard-close').click();
  await b.goto(`/projects/GGgame?room=${code}`); await b.locator('#nickname').fill(guest); await b.locator('#join-form [type=submit]').click();
  await expect(b.locator('#notice')).toContainText('不存在');
  await ca.close(); await cb.close();
});

test('human versus computer counts the human; lobby closure never adds a game and stats writes are not public', async ({ page, request }) => {
  await observe(page); await page.goto('/projects/GGgame');
  const name = `人机${Date.now().toString(36)}`;
  await page.locator('#nickname').fill(name); await page.locator('#create').click();
  await expect(page.locator('#room')).toBeVisible(); await page.locator('#leave').click();
  await expect(page.locator('#entrance')).toBeVisible(); expect((await board(page, name)).player).toBeNull();
  await page.locator('#create').click(); await page.locator('#add-bot').click();
  await expect(page.locator('.member')).toHaveCount(2); await page.locator('#start').click();
  await expect(page.locator('#rps-stage')).toBeVisible(); await page.locator('#leave').click();
  await expect(page.locator('#entrance')).toBeVisible();
  await expect.poll(async () => (await board(page, name)).player).toMatchObject({ games: 1, wins: 0, kills: 0, wears: 0 });
  expect((await board(page, '电脑 1')).player).toBeNull();
  const endpoint = process.env.GGGAME_ROOM_URL || 'http://127.0.0.1:8787';
  const origin = new URL(process.env.GGGAME_WEB_URL || 'http://127.0.0.1:4321').origin;
  expect((await request.post(`${endpoint}/api/leaderboard`, { headers: { Origin: origin }, data: { name, wins: 99 } })).status()).toBe(405);
  expect((await request.get(`${endpoint}/api/leaderboard`, { headers: { Origin: 'https://unrelated.example' } })).status()).toBe(403);
  expect((await board(page, name)).player.wins).toBe(0);
});
