import { svelte } from "@sveltejs/vite-plugin-svelte"
import { configDefaults, defineConfig } from 'vitest/config'
import { svelteProxyPatch } from './patches/svelte-5.57.3/plugin.mjs'

export default defineConfig({
  plugins: [
    svelteProxyPatch(),
    svelte({
      compilerOptions: {
        experimental: {
          // Off in this fork: matches vite.config.ts so tests run the shipped scheduler (the async scheduler runs $effect.pre after block updates).
          async: false
        }
      },
      // Only *.asyncFixture.svelte files compile with the async scheduler, so a test can observe a pending markup await.
      dynamicCompileOptions({ filename }) {
        if (filename.endsWith('.asyncFixture.svelte')) return { experimental: { async: true } }
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
