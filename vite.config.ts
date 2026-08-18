import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/document-to-markdown/',
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
