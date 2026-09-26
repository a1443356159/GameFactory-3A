import { defineConfig } from '@playwright/test';
if (!process.env.GGGAME_URL) throw new Error('Set GGGAME_URL to the URL returned by ThreeClient.');
export default defineConfig({
  testDir: './tests/browser', timeout: 180000, workers: 1,
  outputDir: '../.tmp/browser',
  use: { baseURL: process.env.GGGAME_URL, viewport: { width: 1280, height: 850 },
    launchOptions: { args: ['--no-sandbox', '--enable-unsafe-swiftshader'] },
    video: { mode: 'on', size: { width: 960, height: 640 } }, screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
