/**
 * A service key lives in its connection. The 13 legacy positions are written only by the slot table, which the
 * migration and the `.bin` translation walk, by the upstream-shaped defaults and by the secret-field list. A reader
 * or editor that touches a legacy position again would write or read a value the next load moves away, so it is
 * found here. A source-text guard: the per-site reader and editor tests are the behavioural evidence.
 */
import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const SRC = path.resolve(process.cwd(), 'src')

/** Files that may name a legacy position: the table, the secret-field list and the upstream-shaped defaults. */
const ALLOWED = new Set([
    'src/ts/connections/slotTable.ts',
    'src/ts/secretFields.ts',
    'src/ts/storage/database.svelte.ts',
])

const LEGACY_PATHS: ReadonlyArray<readonly [name: string, pattern: RegExp]> = [
    ...['elevenLabKey', 'huggingfaceKey', 'fishSpeechKey', 'NAIApiKey', 'stabilityKey', 'falToken', 'supaMemoryKey', 'voyageApiKey']
        .map((field) => [field, new RegExp(`\\.${field}\\b`)] as const),
    ...['openaiCompatImage', 'wavespeedImage', 'deeplOptions', 'hypaCustomSettings']
        .map((root) => [`${root}.key`, new RegExp(`\\.${root}\\??\\.key\\b`)] as const),
    ['deeplXOptions.token', /\.deeplXOptions\??\.token\b/],
]

function sourceFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
            if (entry.name !== 'node_modules') {
                sourceFiles(full, out)
            }
        } else if (/\.(ts|svelte)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name) && !/[\\/]tests?[\\/]/.test(full)) {
            out.push(full)
        }
    }
    return out
}

describe('T-SCAN: the legacy positions of the service keys', () => {
    test('are named only by the slot table, the secret-field list and the database defaults', () => {
        const hits: string[] = []
        for (const file of sourceFiles(SRC)) {
            const rel = path.relative(process.cwd(), file).split(path.sep).join('/')
            if (ALLOWED.has(rel)) {
                continue
            }
            const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
            lines.forEach((text, index) => {
                for (const [name, pattern] of LEGACY_PATHS) {
                    if (pattern.test(text)) {
                        hits.push(`${rel}:${index + 1} ${name}`)
                    }
                }
            })
        }
        expect(hits).toEqual([])
    })

    test('the scan finds a planted legacy read, so it is not vacuous', () => {
        const planted = 'const key = db.elevenLabKey; const b = db.wavespeedImage?.key; const c = db.deeplXOptions.token'
        const found = LEGACY_PATHS.filter(([, pattern]) => pattern.test(planted)).map(([name]) => name)
        expect(found).toEqual(['elevenLabKey', 'wavespeedImage.key', 'deeplXOptions.token'])
    })
})
