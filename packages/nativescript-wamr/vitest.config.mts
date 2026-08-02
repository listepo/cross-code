import { defineConfig } from 'vitest/config';

export default defineConfig({
  cache: {
    dir: '../../node_modules/.vite/packages/nativescript-wamr',
  },
  test: {
    environment: 'node',
  },
});
