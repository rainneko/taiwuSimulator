import { fileURLToPath } from 'node:url';
import { cpSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/taiwuSimulator/',
  plugins: [{
    name: 'copy-content',
    closeBundle() { cpSync('content', 'dist/content', { recursive: true }); },
  }],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        paper: fileURLToPath(new URL('./dev/paper.html', import.meta.url)),
        combat: fileURLToPath(new URL('./dev/combat.html', import.meta.url)),
        region: fileURLToPath(new URL('./dev/region.html', import.meta.url)),
        map: fileURLToPath(new URL('./dev/map.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
