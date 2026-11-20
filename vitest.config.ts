import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['packages/**/*.test.ts', 'services/**/*.test.ts', 'worker/**/*.test.ts', 'apps/web/**/*.test.ts'],
  },
})
