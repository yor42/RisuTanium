// Long PCT runner, vitest config. One worker process = one vitest run of pct-worker.test.mjs, which walks a stride of seeds
// through the in-tree `runRegion` unchanged. The only in-memory edit is an observation hook in regions.ts' `observe` closure (it
// calls globalThis.__l7step, which reads the scheduler fingerprint); behaviour is not changed. No repository file is written.
//
// Environment: RISU_ROOT (repository root; default: found relative to this file), RISU_SCRATCH (cache directory; default: an OS
// temp subdirectory), L7_CACHE_TAG (cache directory suffix), L7_PROF_DIR (optional CPU profile directory).
// Run vitest with the repository root as the working directory, or the setup file `/vitest.setup.ts` is not found.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url)).replace(/\\/g, '/')
const ROOT = (process.env.RISU_ROOT ?? resolve(HERE, '../../../..')).replace(/\\/g, '/')
const SCRATCH = (process.env.RISU_SCRATCH ?? join(tmpdir(), 'risu-replay-tools')).replace(/\\/g, '/')
const REGIONS = `${ROOT}/src/ts/storage/tests/store2/replay/regions.ts`.toLowerCase()

const { svelte } = await import(pathToFileURL(`${ROOT}/node_modules/@sveltejs/vite-plugin-svelte/src/index.js`).href)

const FROM = 'const observe = (info: StepInfo): void => {\n'
const TO = FROM + '        try { globalThis.__l7step?.(info, () => rig) } catch { /* l7 hook */ }\n'

const hookPlugin = {
    name: 'l7-hook',
    enforce: 'pre',
    load(id) {
        const clean = id.split('?')[0].replace(/\\/g, '/')
        if (clean.toLowerCase() !== REGIONS) {
            return null
        }
        const text = readFileSync(clean, 'utf8').replace(/\r\n/g, '\n')
        if (text.split(FROM).length - 1 !== 1) {
            throw new Error('l7-hook: observe site does not match exactly once')
        }
        return text.replace(FROM, () => TO)
    },
}

const inc = process.env.L7_CACHE_TAG ?? 'x'

export default {
    root: ROOT,
    cacheDir: `${SCRATCH}/vite-cache-pct-${inc}`,
    plugins: [svelte(), hookPlugin],
    resolve: {
        alias: { src: '/src' },
        conditions: ['browser'],
    },
    server: { fs: { strict: false } },
    test: {
        globals: true,
        environment: 'node',
        dir: HERE,
        include: ['pct-worker.test.mjs'],
        setupFiles: [`${ROOT}/vitest.setup.ts`],
        exclude: ['**/node_modules/**', '**/.claude/**'],
        experimental: { fsModuleCache: false },
        testTimeout: 0,
        execArgv: process.env.L7_PROF_DIR ? ['--cpu-prof', '--cpu-prof-dir=' + process.env.L7_PROF_DIR] : [],
        hookTimeout: 0,
        reporters: ['dot'],
    },
}
