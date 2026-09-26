import { test, expect } from '@playwright/test';

async function observe(page) {
  await page.addInitScript(() => {
    window.audioCues = []; window.oscillatorStarts = 0;
    document.addEventListener('gggame:sound', event => window.audioCues.push(event.detail.name));
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...args) { window.oscillatorStarts++; return start.apply(this, args); };
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
  await expect(a.locator('#rps-stage')).toBeVisible(); await expect(a.locator('#match')).toBeHidden();
  await expect(a.locator('[data-kick]')).toHaveCount(0);
  await a.locator('[data-hand=rock]').click();
  await expect.poll(async () => (await state(b)).game.players[0].picked).toBe(true);
  expect((await state(b)).game.players[0].hand).toBeNull();
  expect(JSON.stringify(await state(b))).not.toContain('token');
  await b.locator('[data-hand=scissors]').click(); await c.locator('[data-hand=scissors]').click();
  await phase(a, 'reveal');
  await expect(a.locator('#reveal-stage')).toBeVisible(); await expect(a.locator('#rps-stage')).toBeHidden();
  await expect(a.locator('[data-result-player=p0]')).toContainText('2 步');
  await expect(a.locator('[data-result-player=p1]')).toContainText('0 步');
  await expect(a.locator('[data-result-player=p2]')).toContainText('0 步');
  await expect.poll(() => a.evaluate(() => window.audioCues.includes('win'))).toBe(true);
  await expect.poll(() => b.evaluate(() => window.audioCues.includes('lose'))).toBe(true);
  expect(await a.evaluate(() => window.oscillatorStarts)).toBeGreaterThan(0);
  await a.screenshot({ path: info.outputPath('results-desktop.png'), fullPage: true });
  await b.screenshot({ path: info.outputPath('results-mobile.png'), fullPage: true });
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
  await expect.poll(() => b.evaluate(() => window.audioCues.includes('knife') && window.audioCues.includes('move'))).toBe(true);

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

test('host kicks only in lobby; explicit exit revokes identity and ends participation immediately', async ({ browser }) => {
  const ca = await browser.newContext(), cb = await browser.newContext();
  const a = await ca.newPage(), b = await cb.newPage();
  await observe(a); await observe(b);
  await a.goto('/projects/GGgame'); await a.locator('#nickname').fill('房主'); await a.locator('#create').click();
  await expect(a.locator('#room-label')).toHaveText(/^[A-F0-9]{12}$/);
  const code = await a.locator('#room-label').textContent();
  async function join() {
    await b.goto(`/projects/GGgame?room=${code}`); await b.locator('#nickname').fill('朋友');
    await b.locator('#join-form [type=submit]').click(); await expect(b.locator('#room-label')).toHaveText(code);
  }
  await join(); await expect(b.locator('[data-kick]')).toHaveCount(0);
  await a.locator('[data-kick]').click();
  await expect(b.locator('#entrance')).toBeVisible(); await expect(b.locator('#notice')).toContainText('踢出');
  expect(await b.evaluate(() => sessionStorage.getItem('gggame-session-v1'))).toBeNull();
  await b.reload(); await expect(b.locator('#entrance')).toBeVisible(); await expect(b.locator('#resume')).toBeHidden();
  await join(); await a.locator('#start').click(); await phase(b, 'rps');
  await expect(a.locator('[data-kick]')).toHaveCount(0);
  await b.locator('#leave').click(); await expect(b.locator('#entrance')).toBeVisible();
  await phase(a, 'over'); expect((await state(a)).game.result).toBe('p0');
  await a.locator('#leave').click(); await expect(a.locator('#entrance')).toBeVisible();
  await a.reload(); await expect(a.locator('#resume')).toBeHidden();
  await ca.close(); await cb.close();
});

test('seventh loss displays three usable guarantee steps and mute survives refresh', async ({ browser }, info) => {
  const ca = await browser.newContext(), cb = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ca.newPage(), b = await cb.newPage(); await observe(a); await observe(b);
  await a.goto('/projects/GGgame'); await a.locator('#nickname').fill('甲'); await a.locator('#create').click();
  await expect(a.locator('#room-label')).toHaveText(/^[A-F0-9]{12}$/); const code = await a.locator('#room-label').textContent();
  await b.goto(`/projects/GGgame?room=${code}`); await b.locator('#nickname').fill('乙'); await b.locator('#join-form [type=submit]').click();
  await expect(a.locator('.member')).toHaveCount(2); await a.locator('#start').click();
  for (let round = 1; round <= 7; round++) {
    await phase(a, 'rps'); await phase(b, 'rps');
    await a.locator('[data-hand=rock]').click(); await b.locator('[data-hand=scissors]').click();
    await phase(b, 'reveal');
    if (round === 7) {
      await expect(b.locator('#reveal-title')).toContainText('七连败保底');
      await expect(b.locator('#reward-value')).toHaveText('+3');
      await expect(b.locator('[data-result-player=p1]')).toContainText('3 步');
      await b.screenshot({ path: info.outputPath('guarantee-mobile.png'), fullPage: true });
      break;
    }
    await phase(a, 'action'); await a.locator('#destination').selectOption(round % 2 ? 'p1' : 'p0'); await a.locator('[data-action=move]').click();
  }
  await phase(b, 'action'); await b.locator('#sound-toggle').click();
  await expect(b.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  const soundCount = await b.evaluate(() => window.oscillatorStarts);
  await b.locator('[data-action=knife]').click();
  await expect.poll(async () => (await state(b)).game.players[1].knife).toBe(true);
  expect(await b.evaluate(() => window.oscillatorStarts)).toBe(soundCount);
  await b.reload(); await expect(b.locator('#sound-toggle')).toHaveAttribute('aria-pressed', 'false');
  await expect(b.locator('#room-label')).toHaveText(code);
  expect(await b.evaluate(() => window.audioCues)).toEqual([]);
  await b.locator('#leave').click(); await a.locator('#leave').click();
  await ca.close(); await cb.close();
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
