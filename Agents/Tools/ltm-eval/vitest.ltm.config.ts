/**
 * Vitest config for the ltm-eval harnesses.
 *
 * It mirrors Agents/Tools/vitest.harness.config.ts (same plugin, alias, environment, setupFiles) with
 * `root` pinned to the repo root, so the `src` alias and the app modules the analyzer imports resolve,
 * and `include` narrowed to the ltm-eval harness files. `pnpm test` never collects `*.harness.ts`.
 *
 * Privacy: `silent` and `onConsoleLog` discard everything a worker prints, and no file reporter,
 * output file or coverage is configured. The real `.bin` run must still go through run-real.mjs.
 *
 * Run one harness file at a time from the repo root:
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/ltm-eval/vitest.ltm.config.ts Agents/Tools/ltm-eval/eval.harness.ts
 */
import { fileURLToPath } from 'node:url'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vitest/config'

// Agents/Tools/ltm-eval/vitest.ltm.config.ts -> repo root is three levels up.
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))

export default defineConfig({
    root: REPO_ROOT,
    plugins: [svelte()],
    resolve: {
        alias: {
            src: '/src',
        },
        conditions: ['browser'],
    },
    test: {
        environment: 'happy-dom',
        setupFiles: ['vitest.setup.ts'],
        include: [
            'Agents/Tools/ltm-eval/*.harness.ts',
        ],
        silent: true,
        onConsoleLog: () => false,
    },
})
