import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
  },
  resolve: {
    alias: {
      '@archivecore/shared': path.resolve(__dirname, '../shared/dist/index.js'),
    },
  },
});
