import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

// DB tests share one database (testDb drops/recreates tables), so files must not run in parallel.
export default defineConfig({
  test: { fileParallelism: false },
  resolve: { alias: { '@': fileURLToPath(new URL('./packages/web/src', import.meta.url)) } },
})
