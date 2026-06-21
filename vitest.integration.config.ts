import { defineConfig } from 'vitest/config';

// Integration tests require external services:
//   - SENTINEL_TEST_DATABASE_URL (Postgres)  -> store integration
//   - ANTHROPIC_API_KEY / OPENAI_API_KEY     -> live provider integration
// Run with: npm run test:int
export default defineConfig({
  test: {
    include: ['**/*.int.test.ts'],
    exclude: ['node_modules/**', 'dist/**'],
    environment: 'node',
    globals: false,
    setupFiles: ['./test/setup.int.ts'],
    // Integration files share one Postgres DB (with TRUNCATE) — run them serially.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
