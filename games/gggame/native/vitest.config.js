import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['packages/gggame/tests/**/*.test.js'], environment: 'node' } });
