import { test, expect } from '@playwright/test';

test('3D courtyard renders real geometry, handles camera and survives room changes on desktop and phone', async ({ browser }, info) => {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1440, height: 1080 } });
    const page = await context.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/projects/GGgame'); await page.locator('#nickname').fill('小院主人'); await page.locator('#create').click();
    await expect(page.locator('#world-canvas')).toHaveAttribute('data-ready', 'true', { timeout: 30000 });
    for (let i = 0; i < 3; i++) await page.locator('#add-bot').click();
    await expect(page.locator('[data-actor3d]')).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => window.__A3GAME_GAME__?.host.getStats().drawCalls)).toBeGreaterThan(40);
    const before = await page.evaluate(() => window.__A3GAME_GAME__.host.camera.position.toArray());
    await page.locator('#world-rotate').click();
    expect(await page.evaluate(() => window.__A3GAME_GAME__.host.camera.position.toArray())).not.toEqual(before);
    await page.locator('#world-fit').click();
    await page.locator('#world-stage').screenshot({ path: info.outputPath(mobile ? 'courtyard-phone.png' : 'courtyard-desktop.png') });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#world-toggle').click(); await expect(page.locator('#world-stage')).toBeHidden();
    await page.reload(); await expect(page.locator('#world-stage')).toBeHidden();
    await page.locator('#world-toggle').click(); await expect(page.locator('#world-canvas')).toHaveAttribute('data-ready', 'true');
    await page.locator('#leave').click(); await expect(page.locator('#entrance')).toBeVisible();
    expect(await page.locator('#world-canvas canvas').count()).toBe(0);
    await page.locator('#create').click(); await expect(page.locator('#world-canvas')).toHaveAttribute('data-ready', 'true');
    await expect(page.locator('[data-actor3d]')).toHaveCount(1); await page.locator('#leave').click();
    expect(errors).toEqual([]); await context.close();
  }
});

test('WebGL unavailable still lets players create a room, add a computer and play', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type, ...args) { return type.startsWith('webgl') ? null : original.call(this, type, ...args); };
  });
  await page.goto('/projects/GGgame'); await page.locator('#nickname').fill('文字街坊'); await page.locator('#create').click();
  await expect(page.locator('#world-hint')).toContainText('无法显示 3D', { timeout: 20000 });
  await expect(page.locator('#world-stage')).toBeHidden(); await page.locator('#add-bot').click(); await page.locator('#start').click();
  await expect(page.locator('#rps-stage')).toBeVisible(); await page.locator('[data-hand=rock]').click();
  await expect(page.locator('#reveal-stage')).toBeVisible({ timeout: 10000 });
  await page.locator('#leave').click(); await expect(page.locator('#entrance')).toBeVisible();
});
