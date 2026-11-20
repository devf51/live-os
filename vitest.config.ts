import { defineConfig } from 'vitest/config'

// DB tests share one database (testDb drops/recreates tables), so files must not run in parallel.
export default defineConfig({ test: { fileParallelism: false } })
