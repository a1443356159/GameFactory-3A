import { test, expect } from '@playwright/test';
const read = page => page.evaluate(() => window.__A3GAME_GAME__.getState());
test('desktop: real clicks complete a match, every human action, pause and restart', async ({ page }, testInfo) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?seed=2'); await expect(page.locator('#start-game')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({path: testInfo.outputPath('lobby.png'), fullPage:true});
  await page.locator('[data-count="1"]').click(); await page.locator('#start-game').click();
  await page.locator('#pause-button').click(); const paused = await read(page); await page.waitForTimeout(250);
  expect((await read(page)).time).toBe(paused.time); await page.locator('#resume-button').click();
  await page.locator('#rules-button').click(); await expect(page.locator('#rules-dialog')).toBeVisible();
  await page.locator('#close-rules').click(); await expect.poll(async () => (await read(page)).paused).toBe(false);
  const actions = new Set(); let screenshotTaken = false;
  const deadline = Date.now() + 150000;
  while (Date.now() < deadline) {
    const s = await read(page); const me = s.players[0]; const foe = s.players.find(p => p.alive && p.id !== 'p0');
    if (s.phase === 'over') break;
    if (s.phase === 'rps' && me.alive && !me.picked) {
      await page.locator('[data-hand="rock"]').click();
    } else if (s.phase === 'action' && me.alive && me.steps && !me.active && !me.queue.length && foe?.location !== null) {
      let selector, type;
      if (!actions.has('wear') && me.armor < 3) { type = 'wear'; selector = '[data-action="wear"]'; }
      else if (!me.knife) { type = 'knife'; selector = '[data-action="knife"]'; }
      else if (foe.location !== me.location) { type = 'move'; selector = `[data-move="${foe.location}"]`; }
      else { type = foe.armor ? 'strip' : 'execute'; selector = `[data-action="${type}"]`; }
      await page.locator(selector).click(); actions.add(type);
      if (!screenshotTaken && actions.has('knife')) { await page.screenshot({path: testInfo.outputPath('action.png'),fullPage:true}); screenshotTaken = true; }
    }
    await page.waitForTimeout(80);
  }
  const final = await read(page);
  expect(final.phase).toBe('over'); expect(final.players.filter(p => p.alive)).toHaveLength(1);
  expect([...actions]).toEqual(expect.arrayContaining(['wear','knife','move','strip','execute']));
  await expect(page.locator('#result-overlay')).toBeVisible();
  await page.screenshot({path: testInfo.outputPath('result.png'),fullPage:true});
  await page.locator('#again-button').click();
  expect((await read(page)).players.every(p => p.alive && p.armor === 1 && !p.knife)).toBe(true);
  expect(errors).toEqual([]);
  await testInfo.attach('final-game-state', {body:JSON.stringify({final, actions:[...actions]},null,2),contentType:'application/json'});
});

test('mobile: usable layout, dynamic roster and target selection', async ({page},testInfo) => {
  await page.setViewportSize({width:390,height:844});
  await page.goto('/?seed=7'); await expect(page.locator('#start-game')).toBeVisible();
  await page.evaluate(()=>document.fonts.ready);
  await page.screenshot({path:testInfo.outputPath('mobile-lobby.png'),fullPage:true});
  await page.locator('#bot-count').fill('7'); await page.locator('#start-game').click();
  expect((await read(page)).players).toHaveLength(8);
  await page.locator('[data-player="p7"]').click(); await expect(page.locator('#target-label')).toHaveText('小满');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('#pause-button').click(); await page.locator('#pause-restart').click();
  await page.locator('[data-count="3"]').click(); await page.locator('#start-game').click();
  await page.locator('[data-hand="rock"]').click();
  await page.screenshot({path:testInfo.outputPath('mobile-match.png'),fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
