import { svelte } from "@sveltejs/vite-plugin-svelte"
import { configDefaults, defineConfig } from 'vitest/config'
import type { Plugin } from 'vite'
import { svelteProxyPatch } from './patches/svelte-5.57.3/plugin.mjs'

// Every svelte instance in a test run, including one re-created by vi.resetModules, starts on the async scheduler the app ships. The compiler enables it only from compiled components; this covers module-only graphs and resets. Fails loudly if svelte renames the function.
const svelteAsyncFlagDefault: Plugin = {
  name: 'svelte-async-flag-default',
  enforce: 'pre',
  transform(code, id) {
    if (!/[\\/]svelte[\\/]src[\\/]internal[\\/]flags[\\/]index\.js$/.test(id.split('?')[0])) return
    if (!/export function enable_async_mode_flag\(\)/.test(code)) {
      throw new Error(`svelte-async-flag-default: enable_async_mode_flag not found in ${id}`)
    }
    return { code: `${code}\nenable_async_mode_flag();\n`, map: null }
  },
}

export default defineConfig({
  plugins: [
    svelteProxyPatch(),
    svelte({
      compilerOptions: {
        experimental: {
          // On, as upstream: vitest matches so tests run the shipped scheduler.
          async: true
        }
      }
    }),
    svelteAsyncFlagDefault,
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
