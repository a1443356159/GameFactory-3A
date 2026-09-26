import { defineConfig, loadEnv } from 'vite';
import { readFileSync } from 'node:fs';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const deployment = JSON.parse(readFileSync(new URL('./gggame/deployment.json', import.meta.url)));
  const endpoint = env.PUBLIC_GGGAME_SERVER || (command === 'serve' ? '' : deployment.server);
  if (endpoint && !/^https?:$/.test(new URL(endpoint).protocol)) throw Error('Game server must use HTTP(S)');
  return {
    base: '/gggame/',
    server: { fs: { allow: ['..'] } },
    plugins: [{
      name: 'gggame-endpoint',
      transformIndexHtml: html => html.replace('__GGGAME_ENDPOINT__', endpoint.replaceAll('&', '&amp;').replaceAll('"', '&quot;')),
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          if (/^\/projects\/GGgame\/?(?:\?|$)/.test(req.url || '')) req.url = '/gggame/index.html' + (req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '');
          next();
        });
      },
    }],
  };
});
