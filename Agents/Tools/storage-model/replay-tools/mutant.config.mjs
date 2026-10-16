// Vitest config of the store2 mutant runner. One in-memory mutant, picked by l7_MUTANT, is applied while a module loads;
// no repository file is changed. The repository's own Vite settings are used (svelte plugin, alias, conditions, environment,
// setup file) with a cache directory of its own and the file-system module cache off, so no earlier run's transform is reused.
//
// Environment: RISU_ROOT (repository root; default: found relative to this file), RISU_SCRATCH (output and cache directory;
// default: an OS temp subdirectory), l7_MUTANT (mutant name, default `none`), L7_TAG (cache directory suffix, default the name).
// Run vitest with the repository root as the working directory, or the setup file `/vitest.setup.ts` is not found.
//
// A patched module must actually be loaded: every applied edit prints `l7-LOAD <mutant> <file>`, and when the run ends a
// mutant whose files were not all loaded sets exit code 97 and prints `l7-NOT-LOADED`. An edit whose `from` text does not
// match exactly once throws, so the module fails to load and the run is not mistaken for a green one.
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MUTANTS } from './mutants.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = (process.env.RISU_ROOT ?? resolve(HERE, '../../../..')).replace(/\\/g, '/')
const SCRATCH = (process.env.RISU_SCRATCH ?? join(tmpdir(), 'risu-replay-tools')).replace(/\\/g, '/')

const name = process.env.l7_MUTANT ?? 'none'
const edits = MUTANTS[name]
if (edits === undefined) {
    throw new Error(`l7-mutant: unknown mutant ${name}`)
}

const { svelte } = await import(pathToFileURL(`${ROOT}/node_modules/@sveltejs/vite-plugin-svelte/src/index.js`).href)

const loaded = new Set()
const wantedFiles = new Set(edits.map((edit) => edit.file.toLowerCase()))

process.on('exit', (code) => {
    const missing = [...wantedFiles].filter((file) => !loaded.has(file))
    if (missing.length > 0) {
        console.log(`l7-NOT-LOADED ${name} ${missing.join(',')}`)
        if (code === 0) {
            process.exitCode = 97
        }
    }
})

const mutantPlugin = {
    name: 'l7-mutant',
    enforce: 'pre',
    load(id) {
        const clean = id.split('?')[0].replace(/\\/g, '/')
        const mine = edits.filter((edit) => clean.toLowerCase() === `${ROOT}/${edit.file}`.toLowerCase())
        if (mine.length === 0) {
            return null
        }
        let text = readFileSync(clean, 'utf8').replace(/\r\n/g, '\n')
        for (const edit of mine) {
            if (edit.whole === true) { text = edit.to; continue }
            const count = text.split(edit.from).length - 1
            if (count !== 1) {
                throw new Error(`l7-mutant: ${edit.file} has ${count} matches of a mutation site of ${name}`)
            }
            text = text.replace(edit.from, () => edit.to)
        }
        loaded.add(mine[0].file.toLowerCase())
        console.log(`l7-LOAD ${name} ${mine[0].file}`)
        return text
    },
}

export default {
    root: ROOT,
    cacheDir: `${SCRATCH}/vite-cache-mutant-${process.env.L7_TAG ?? name}`,
    plugins: [svelte(), mutantPlugin],
    resolve: {
        alias: { src: '/src' },
        conditions: ['browser'],
    },
    test: {
        environment: 'happy-dom',
        setupFiles: [`${ROOT}/vitest.setup.ts`],
        exclude: ['**/node_modules/**', '**/.claude/**'],
        experimental: { fsModuleCache: false },
    },
}
