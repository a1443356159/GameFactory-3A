// Translate the adapter's json:path reporter spelling for current Playwright.
import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2), env = { ...process.env };
const reporter = args.indexOf('--reporter');
if (reporter >= 0 && args[reporter + 1]?.startsWith('json:')) {
  env.PLAYWRIGHT_JSON_OUTPUT_NAME = args[reporter + 1].slice(5);
  args.splice(reporter, 2, '--reporter=list,json');
}
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'gggame/playwright.config.js', ...args], { stdio: 'inherit', env });
process.exit(result.status ?? 1);
