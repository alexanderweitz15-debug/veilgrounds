import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  worker: { format: 'es' },
  // three.js as its own long-cached vendor chunk (~530 kB min, shared by the menu backdrop and the game view)
  build: { rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  test: { include: ['tests/**/*.test.ts'] },
});
