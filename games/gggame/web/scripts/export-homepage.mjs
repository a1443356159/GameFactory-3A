import { cp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const destination = process.argv[2];
if (!destination) throw Error('Usage: npm run export:homepage -- /path/to/homepage');
const target = resolve(destination);
const pkg = JSON.parse(await readFile(resolve(target, 'package.json')));
if (pkg.name !== 'homepage') throw Error('Destination must be the homepage repository');
const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
const sourceRoot = new URL('../', import.meta.url);
const ref = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain', '--', '..'], { cwd: sourceRoot, encoding: 'utf8' }).trim();
if (dirty && !process.env.GGGAME_ALLOW_DIRTY_EXPORT) throw Error('Commit GGgame source before exporting a traceable release');
// These directories belong exclusively to this export. Site pages and other public assets are preserved.
await rm(resolve(target, 'public/gggame/assets'), { recursive: true, force: true });
await mkdir(resolve(target, 'gggame-release'), { recursive: true });
await cp(new URL('../dist/assets', import.meta.url), resolve(target, 'public/gggame/assets'), { recursive: true });
await cp(new URL('../dist/fonts', import.meta.url), resolve(target, 'public/gggame/fonts'), { recursive: true });
await writeFile(resolve(target, 'gggame-release/index.html'), html);
await writeFile(resolve(target, 'gggame-release/source.json'), JSON.stringify({
  repository: 'https://github.com/a1443356159/GameFactory-3A',
  path: 'games/gggame/web', commit: ref,
  htmlSha256: createHash('sha256').update(html).digest('hex'),
}, null, 2) + '\n');
await writeFile(resolve(target, 'src/pages/projects/GGgame.astro'), `---\n// Generated release; develop GGgame in GameFactory-3A/games/gggame.\nimport gamePage from '../../../gggame-release/index.html?raw';\n---\n<Fragment set:html={gamePage} />\n`);
console.log(`Exported GGgame ${ref.slice(0, 12)} to ${target}`);
