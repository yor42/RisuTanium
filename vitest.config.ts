import { svelte } from "@sveltejs/vite-plugin-svelte"
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    svelte(),
  ],
  resolve: {
    alias: {
      src: '/src',
    },
    conditions: ['browser'],
  },
  test: {
    environment: 'happy-dom',
    setupFiles: ['vitest.setup.ts'],
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    // Many files reset modules and import the boot graph cold in their first test; under a
    // loaded full run that cold cost alone can pass 5 s, so the default leaves room for it.
    testTimeout: 20000,
  },
})
