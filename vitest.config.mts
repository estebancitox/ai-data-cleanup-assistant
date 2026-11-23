import { defineConfig } from 'vitest/config';

export default defineConfig({
  // A .csv import gives the URL of the file, as in the app (next.config.ts).
  assetsInclude: ['**/*.csv'],
  test: {
    // Component tests (.test.tsx) ask for jsdom themselves, with a `@vitest-environment` line.
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}', 'evals/**/*.test.ts'],
  },
});
