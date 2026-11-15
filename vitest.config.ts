import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Only the factory's own tests; example-target-repo/ has its own node:test suite.
  test: { include: ['test/**/*.test.ts'] },
});
