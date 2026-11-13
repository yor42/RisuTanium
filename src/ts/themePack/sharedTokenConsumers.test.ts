// @vitest-environment node
// T0a-25 (GUARD, hygiene): SHARED_TOKEN_CONSUMERS equals the recomputation from the source, and nothing outside the validator reads
// a --pack-* helper. A miss on this list is a hygiene finding, not a claim.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { allowedTokenNames } from './appThemeNames'
import { SHARED_TOKEN_CONSUMERS } from './sharedTokenConsumers'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const SRC = path.resolve(ROOT, 'src')

function walk(dir: string, into: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full, into)
        else if (/\.(svelte|ts|css|js|mjs)$/.test(entry.name)) into.push(full)
    }
    return into
}
const relative = (file: string): string => 'src/' + path.relative(SRC, file).replace(/\\/g, '/')
const isTestFile = (rel: string): boolean => /\.test\.|test-helpers|testHost|(^|\/)tests\/|\.scenarios\.|Harness|Stub/.test(rel)
const AREA_DIRECTORY = /^src\/(lib\/ChatShell\/|lib\/ChatScreens\/|ts\/chatShell\/|lib\/Studio\/|ts\/studio\/)/
const VALIDATOR_DIRECTORY = /^src\/ts\/themePack\//

const files = walk(SRC).map((file) => ({ rel: relative(file), text: fs.readFileSync(file, 'utf8') })).filter((f) => !isTestFile(f.rel))
const outside = files.filter((f) => !AREA_DIRECTORY.test(f.rel) && !VALIDATOR_DIRECTORY.test(f.rel))
const tokens = new Set<string>([...allowedTokenNames('chat'), ...allowedTokenNames('studio')])

// One derived-token hop: a stylesheet declaration `--X: ... var(--token)` makes every reader of --X outside the screens a reader of the token.
const derivedFrom: Record<string, Set<string>> = {}
for (const f of files.filter((file) => file.rel.endsWith('.css'))) {
    for (const declaration of f.text.matchAll(/(--[\w-]+)\s*:([^;{}]*)/g)) {
        for (const read of declaration[2].matchAll(/var\(\s*(--[\w-]+)/g)) {
            if (!tokens.has(read[1]) || declaration[1] === read[1]) continue
            derivedFrom[declaration[1]] ??= new Set()
            derivedFrom[declaration[1]].add(read[1])
        }
    }
}

const recomputed: Record<string, string[]> = {}
const addConsumer = (token: string, rel: string): void => {
    recomputed[token] ??= []
    if (!recomputed[token].includes(rel)) recomputed[token].push(rel)
}
for (const f of outside) {
    for (const m of f.text.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (tokens.has(m[1])) addConsumer(m[1], f.rel)
        for (const token of derivedFrom[m[1]] ?? []) addConsumer(token, f.rel)
    }
}
const asConstant = (map: Record<string, string[]>): string => `{\n${Object.keys(map).sort().map((name) => `    '${name}': [${map[name].sort().map((f) => `'${f}'`).join(', ')}],`).join('\n')}\n}`

describe('T0a-25: the outside readers of the tokens a stylesheet may set', () => {
    it('reads the source tree', () => {
        expect(files.length).toBeGreaterThan(500)
        expect(outside.length).toBeGreaterThan(200)
    })

    it('SHARED_TOKEN_CONSUMERS equals the recomputation (a mismatch prints the expected constant)', () => {
        const sortedActual = Object.fromEntries(Object.keys(SHARED_TOKEN_CONSUMERS).sort().map((name) => [name, [...SHARED_TOKEN_CONSUMERS[name]].sort()]))
        const sortedExpected = Object.fromEntries(Object.keys(recomputed).sort().map((name) => [name, [...recomputed[name]].sort()]))
        expect(sortedActual, `expected SHARED_TOKEN_CONSUMERS (${Object.keys(recomputed).length} names) =\n${asConstant(recomputed)}`).toEqual(sortedExpected)
    })

    it('a reader of a derived token counts as a reader of the token it is declared from', () => {
        expect(derivedFrom['--chat-dur-base']?.has('--dur-base-nominal')).toBe(true)
        expect(SHARED_TOKEN_CONSUMERS['--dur-base-nominal']).toEqual(expect.arrayContaining(['src/lib/SideBars/Sidebar.svelte', 'src/lib/SettingsShell/SettingsShellPage.svelte']))
    })

    it('the list names real tokens and real files', () => {
        for (const [name, list] of Object.entries(SHARED_TOKEN_CONSUMERS)) {
            expect(tokens.has(name), name).toBe(true)
            expect(list.length, name).toBeGreaterThan(0)
            for (const rel of list) expect(fs.existsSync(path.resolve(ROOT, rel)), rel).toBe(true)
        }
    })

    it('no source outside the validator reads a --pack-* helper', () => {
        const readers = files.filter((f) => !VALIDATOR_DIRECTORY.test(f.rel) && /var\(\s*--pack-/.test(f.text)).map((f) => f.rel)
        expect(readers).toEqual([])
    })
})
