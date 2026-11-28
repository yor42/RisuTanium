/**
 * Generator of the bundled built-in theme packs `src/ts/themePack/bundled/<slug>.risutheme` for Origin Navy, Banana Cocoa,
 * Scratch White and Office Sheet: each archive holds a manifest and exactly the built-in chat sheet of docs/design/chat/themes
 * (preprocessed to LF, as preprocessCss does), and nothing else. Built with the shared builder src/ts/themePack/fixtures/packBuilder.ts (fflate
 * zipSync, deflate level 9, a local-field DOS time so the bytes are the same in every time zone, fixed entry order).
 *
 * Writes only through `writeGoldenFile` (exclusive create, refused under any repository) and only when
 * THEMEPACK_BUNDLED_GENERATE=1, so a run of the whole save-gen folder generates nothing. The archives are copied into
 * src/ts/themePack/bundled/ by hand, and the size and SHA-256 this harness prints are written by hand into
 * src/ts/themePack/builtins.ts and src/ts/themePack/bundled/README.md.
 *
 * Run (repository root; RTB_GOLDENS_OUT names an output directory outside every repository, else a fresh temp one is used):
 *   $env:THEMEPACK_BUNDLED_GENERATE = '1'
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/themePackBundled.harness.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { goldenOutDir, writeGoldenFile } from 'src/ts/drive/tests/rtb/goldenOut'
import { zipPack } from 'src/ts/themePack/fixtures/packBuilder'

const GENERATE = process.env.THEMEPACK_BUNDLED_GENERATE === '1'
/** The repository root: the run command starts there. */
const ROOT = `${process.cwd().replace(/\\/g, '/')}/`

interface BundledSpec {
    readonly slug: string
    readonly name: string
    readonly modes: readonly ('light' | 'dark')[]
}

const SPECS: readonly BundledSpec[] = [
    { slug: 'origin-navy', name: 'Origin Navy', modes: ['dark'] },
    { slug: 'banana-cocoa', name: 'Banana Cocoa', modes: ['light'] },
    { slug: 'scratch-white', name: 'Scratch White', modes: ['light'] },
    { slug: 'office-sheet', name: 'Office Sheet', modes: ['light'] },
]

/** The same input-stream preprocessing as preprocessCss in src/ts/themePack/index.ts, kept local so the harness does not load the validator. */
function preprocess(css: string): string {
    return css.replace(/\r\n|\r|\f/g, '\n').replace(/\u0000/g, '\ufffd')
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

/** Entry order: manifest.json, chat.css. The sheet is the preprocessed docs sheet, so the working tree's CRLF never reaches the pack. */
function buildPack(spec: BundledSpec): Uint8Array {
    const manifest = {
        kind: 'risutheme',
        format: 1,
        id: `risutanium.${spec.slug}`,
        name: spec.name,
        version: '1.0.0',
        license: 'GPL-3.0',
        attribution: 'RisuTanium contributors',
        modes: spec.modes,
        fonts: [],
    }
    const sheet = preprocess(readFileSync(`${ROOT}docs/design/chat/themes/${spec.slug}.css`, 'utf8'))
    expect(sheet.includes('\r'), `${spec.slug} still holds a CR`).toBe(false)
    return zipPack({ 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`, 'chat.css': sheet })
}

describe.skipIf(!GENERATE)('bundled built-in theme pack generation (THEMEPACK_BUNDLED_GENERATE=1)', () => {
    test('writes the four bundled .risutheme archives', () => {
        const dir = goldenOutDir()
        for (const spec of SPECS) {
            const bytes = buildPack(spec)
            expect(buildPack(spec), `${spec.slug} is not deterministic`).toEqual(bytes)
            const file = writeGoldenFile(dir, `${spec.slug}.risutheme`, bytes)
            process.stdout.write(`pack file: ${file}\n`)
            process.stdout.write(`pack ${spec.slug} size: ${bytes.length} bytes\n`)
            process.stdout.write(`pack ${spec.slug} sha256: ${sha256(bytes)}\n`)
        }
    }, 120_000)
})
