import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts', 'eval/**/*.test.ts'],
    // Integration tests (Postgres, live providers) are opt-in via vitest.integration.config.ts
    exclude: ['**/*.int.test.ts', 'node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
  },
});
