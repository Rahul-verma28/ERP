import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@contracts': fileURLToPath(new URL('../backend/src/contracts', import.meta.url)) } },
  test: { include: ['src/__tests__/**/*.test.ts'], fileParallelism: false, testTimeout: 20_000 },
});
