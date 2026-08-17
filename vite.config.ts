import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/document-to-markdown/',
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
  },
  test: {
    environment: 'jsdom',
    coverage: { reporter: ['text', 'html'] },
  },
});
