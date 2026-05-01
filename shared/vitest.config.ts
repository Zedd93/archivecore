import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    typecheck: { tsconfig: './tsconfig.test.json' },
  },
});
