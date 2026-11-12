import { svelte } from "@sveltejs/vite-plugin-svelte"
import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    svelte({
      compilerOptions: {
        experimental: {
          // Off in this fork: matches vite.config.ts so tests run the shipped scheduler (the async scheduler runs $effect.pre after block updates).
          async: false
        }
      }
    }),
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
    // The theme-pack validator bundles the design token stylesheets with ?raw; Vitest empties a CSS import unless it is listed here.
    css: { include: [/docs\/design\/.+\.css/] },
  },
})
