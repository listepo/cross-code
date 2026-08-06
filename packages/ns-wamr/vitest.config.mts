import { defineConfig } from 'vitest/config';

export default defineConfig({
  cache: {
    dir: '../../node_modules/.vite/packages/ns-wamr',
  },
  test: {
    environment: 'node',
  },
});
