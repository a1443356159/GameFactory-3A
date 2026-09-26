// Adapt the facade's reporter-path argument to Playwright's documented env option.
import { spawnSync } from 'node:child_process';
const raw = process.argv.slice(2); const args = []; const env = { ...process.env };
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === '--reporter' && raw[i + 1]?.startsWith('json:')) {
    env.PLAYWRIGHT_JSON_OUTPUT_FILE = raw[++i].slice(5); args.push('--reporter=json');
  } else args.push(raw[i]);
}
const result = spawnSync(process.execPath, ['./node_modules/@playwright/test/cli.js', 'test', ...args], { env, stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
