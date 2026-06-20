import { defineConfig } from 'vitest/config';

// Unit tests for the pure logic in src/lib (cache / security / runtime).
// Node env, no Astro/Vite app config needed — these modules have no runtime
// framework deps (runtime.ts's only @etus/ads import is type-only, erased).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
