import { defineConfig } from 'vitest/config';

// Separate from vite.config.ts: unit tests do not need the React Router plugin.
export default defineConfig({
  test: {
    include: ['core/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts'],
  },
});
