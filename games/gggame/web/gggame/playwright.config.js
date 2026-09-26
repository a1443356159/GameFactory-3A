import { defineConfig } from '@playwright/test';
const proxy = process.env.GGGAME_PROXY ? { server: process.env.GGGAME_PROXY } : undefined;
export default defineConfig({
  testDir: './browser', timeout: 150000, workers: 1,
  outputDir: '../.gggame-test-results',
  use: { baseURL: process.env.GGGAME_WEB_URL || 'http://127.0.0.1:4321', headless: true, trace: 'retain-on-failure',
    proxy, launchOptions: { args: ['--no-sandbox'], proxy } },
});
