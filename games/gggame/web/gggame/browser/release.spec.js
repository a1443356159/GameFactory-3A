import { test, expect } from '@playwright/test';

// Can run against production without adding test matches to the leaderboard.
test('release smoke: leaderboard loads and host closure cleans an unstarted room', async ({ browser }, info) => {
  const ca = await browser.newContext(), cb = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const a = await ca.newPage(), b = await cb.newPage();
  for (const page of [a, b]) await page.addInitScript(() => localStorage.setItem('gggame-world', 'off'));
  const name = `发布检查${Date.now().toString(36)}`;
  await a.goto('/projects/GGgame'); await a.locator('#nickname').fill(name);
  await a.locator('#leaderboard-open').click(); await expect(a.locator('#leaderboard-status')).toHaveText(/已更新|还没有战绩/);
  await expect(a.locator('#leaderboard-personal')).toContainText('暂无战绩');
  await expect(a.locator('#leaderboard thead')).toContainText('穿裤子');
  await a.locator('#leaderboard-close').click(); await a.locator('#create').click();
  await expect(a.locator('#room-label')).toHaveText(/^[A-F0-9]{12}$/); const code = await a.locator('#room-label').textContent();
  await b.goto(`/projects/GGgame?room=${code}`); await b.locator('#nickname').fill('检查访客'); await b.locator('#join-form [type=submit]').click();
  await expect(a.locator('.member')).toHaveCount(2);
  await a.reload(); await expect(a.locator('.member')).toHaveCount(2); await a.close();
  await expect(b.locator('#entrance')).toBeVisible({ timeout: 22000 });
  await b.locator('#leaderboard-open').click(); await b.locator('#leaderboard-name').fill(name); await b.locator('#leaderboard-search button').click();
  await expect(b.locator('#leaderboard-personal')).toContainText('暂无战绩');
  await b.evaluate(() => document.fonts.ready); await b.screenshot({ path: info.outputPath('release-leaderboard-mobile.png') });
  expect(await b.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await ca.close(); await cb.close();
});
