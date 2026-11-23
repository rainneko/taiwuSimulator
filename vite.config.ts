import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        paper: fileURLToPath(new URL('./dev/paper.html', import.meta.url)),
        combat: fileURLToPath(new URL('./dev/combat.html', import.meta.url)),
        region: fileURLToPath(new URL('./dev/region.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
