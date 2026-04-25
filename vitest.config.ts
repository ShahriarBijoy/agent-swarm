import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/setup.ts'],
    // Integration tests share the Neon DB. Parallel file execution causes
    // seed rows from one suite to leak into another's cosine-similarity
    // queries. Disable file-level parallelism; tests within a file still run
    // sequentially inside their own describe block.
    fileParallelism: false,
    // Neon HTTP cold-start + cleanup-by-metadata-jsonb sometimes pushes
    // single tests past the default 5s. 15s gives headroom without
    // hiding actual hangs.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
