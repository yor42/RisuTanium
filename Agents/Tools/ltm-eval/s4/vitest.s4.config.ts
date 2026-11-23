/**
 * Vitest config for the S4 lore-recall harness.
 *
 * The harness loads the app's own `pickHashRand` from `src/ts/util.ts`, whose import graph needs the same Svelte plugins as
 * the repository's `vitest.config.ts` (the proxy patch and the async-mode default); `vitest.ltm.config.ts` omits them. This
 * file mirrors the repository config with `root` pinned to the repo root and `include` narrowed to the S4 harness, which
 * `pnpm test` never collects. Output is silenced as in the other ltm-eval configs.
 *
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/s4/vitest.s4.config.ts Agents/Tools/ltm-eval/s4/lore.harness.ts
 */
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { svelteProxyPatch } from '../../../../patches/svelte-5.57.3/plugin.mjs'

// Agents/Tools/ltm-eval/s4/vitest.s4.config.ts -> repo root is four levels up.
const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url))

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
    root: REPO_ROOT,
    plugins: [
        svelteProxyPatch(),
        svelte({ compilerOptions: { experimental: { async: true } } }),
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
        include: ['Agents/Tools/ltm-eval/s4/*.harness.ts'],
        silent: true,
        onConsoleLog: () => false,
    },
})
