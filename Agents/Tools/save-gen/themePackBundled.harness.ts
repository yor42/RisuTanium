/**
 * Generator of the bundled built-in theme packs `src/ts/themePack/bundled/<slug>.risutheme` for Origin Navy, Banana Cocoa,
 * Scratch White and Office Sheet: each archive holds a manifest and, for each area its SPECS row names, the docs sheet of
 * docs/design/<area>/themes (preprocessed to LF, as preprocessCss does), plus the fonts and extra files that row names. Built with the shared builder src/ts/themePack/fixtures/packBuilder.ts (fflate
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
    /** The areas whose docs sheet (docs/design/<area>/themes/<slug>.css) the archive carries. */
    readonly areas: readonly BundledArea[]
    /** Manifest `fonts` entries, as data. */
    readonly fonts?: readonly Record<string, unknown>[]
    /** Extra archive entries (fonts, images) as repository-relative source paths keyed by archive path, written after the sheets. */
    readonly files?: Readonly<Record<string, string>>
}

/** The area sheets in archive entry order. */
const AREA_ORDER = ['chat', 'settings', 'studio', 'home'] as const
type BundledArea = (typeof AREA_ORDER)[number]

const SPECS: readonly BundledSpec[] = [
    { slug: 'origin-navy', name: 'Origin Navy', modes: ['dark'], areas: ['chat'] },
    { slug: 'banana-cocoa', name: 'Banana Cocoa', modes: ['light'], areas: ['chat'] },
    { slug: 'scratch-white', name: 'Scratch White', modes: ['light'], areas: ['chat'] },
    { slug: 'office-sheet', name: 'Office Sheet', modes: ['light'], areas: ['chat'] },
]

/** The same input-stream preprocessing as preprocessCss in src/ts/themePack/index.ts, kept local so the harness does not load the validator. */
function preprocess(css: string): string {
    return css.replace(/\r\n|\r|\f/g, '\n').replace(/\u0000/g, '\ufffd')
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

/** Entry order: manifest.json, the area sheets in AREA_ORDER, then the extra files. Each sheet is the preprocessed docs sheet, so the working tree's CRLF never reaches the pack. */
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
        fonts: spec.fonts ?? [],
    }
    const entries: Record<string, string | Uint8Array> = { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` }
    for (const area of AREA_ORDER.filter((a) => spec.areas.includes(a))) {
        const sheet = preprocess(readFileSync(`${ROOT}docs/design/${area}/themes/${spec.slug}.css`, 'utf8'))
        expect(sheet.includes('\r'), `${spec.slug} ${area} still holds a CR`).toBe(false)
        entries[`${area}.css`] = sheet
    }
    for (const [archivePath, source] of Object.entries(spec.files ?? {})) entries[archivePath] = new Uint8Array(readFileSync(`${ROOT}${source}`))
    return zipPack(entries)
}

describe.skipIf(!GENERATE)('bundled built-in theme pack generation (THEMEPACK_BUNDLED_GENERATE=1)', () => {
    test('writes one .risutheme archive per SPECS row', () => {
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
