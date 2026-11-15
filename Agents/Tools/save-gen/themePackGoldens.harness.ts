/**
 * Generator of the two golden v1 theme packs, `origin-navy.risutheme` and `banana-cocoa.risutheme`: the shipped
 * themes of docs/design (chat, studio, settings and home sheets) in the v1 archive layout, built with the shared
 * builder src/ts/themePack/fixtures/packBuilder.ts (fflate zipSync, deflate level 9, a local-field DOS time so the
 * bytes are the same in every time zone, fixed entry order).
 *
 * Writes only through `writeGoldenFile` (exclusive create, refused under any repository) and only when
 * THEMEPACK_GENERATE=1, so a run of the whole save-gen folder generates nothing. The goldens are never regenerated:
 * the checked-in copies are made by a deliberate hand copy into src/ts/themePack/goldens/, and the SHA-256 and size
 * this harness prints are written by hand into goldens/README.md and into the constants of goldenPacks.test.ts.
 *
 * Run (repository root):
 *   $env:THEMEPACK_GENERATE = '1'
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/themePackGoldens.harness.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { goldenOutDir, writeGoldenFile } from 'src/ts/drive/tests/rtb/goldenOut'
import { zipPack } from 'src/ts/themePack/fixtures/packBuilder'

const GENERATE = process.env.THEMEPACK_GENERATE === '1'
/** The repository root: the run command starts there. */
const ROOT = `${process.cwd().replace(/\\/g, '/')}/`
const AREAS = ['chat', 'studio', 'settings', 'home'] as const

interface GoldenSpec {
    readonly theme: string
    readonly id: string
    readonly name: string
    readonly modes: readonly ('light' | 'dark')[]
}

const SPECS: readonly GoldenSpec[] = [
    { theme: 'origin-navy', id: 'risutanium.origin-navy', name: 'Origin Navy', modes: ['dark'] },
    { theme: 'banana-cocoa', id: 'risutanium.banana-cocoa', name: 'Banana Cocoa', modes: ['light'] },
]

/** The working tree is CRLF under autocrlf while the index is LF; the pack carries LF. */
function sheetOf(area: string, theme: string): string {
    const text = readFileSync(`${ROOT}docs/design/${area}/themes/${theme}.css`, 'utf8').replace(/\r\n/g, '\n')
    expect(text.includes('\r'), `${area}/${theme} still holds a CR`).toBe(false)
    return text
}

function buildGolden(spec: GoldenSpec): Uint8Array {
    const manifest = {
        kind: 'risutheme',
        format: 1,
        id: spec.id,
        name: spec.name,
        version: '1.0.0',
        license: 'GPL-3.0',
        attribution: 'RisuTanium contributors',
        modes: spec.modes,
        fonts: [],
    }
    const files: Record<string, string> = { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` }
    for (const area of AREAS) {
        files[`${area}.css`] = sheetOf(area, spec.theme)
    }
    return zipPack(files)
}

describe.skipIf(!GENERATE)('theme pack golden generation (THEMEPACK_GENERATE=1)', () => {
    test('writes origin-navy.risutheme and banana-cocoa.risutheme', () => {
        const dir = goldenOutDir()
        for (const spec of SPECS) {
            const bytes = buildGolden(spec)
            expect(buildGolden(spec), `${spec.theme} is not deterministic`).toEqual(bytes)
            const file = writeGoldenFile(dir, `${spec.theme}.risutheme`, bytes)
            const sha = createHash('sha256').update(bytes).digest('hex')
            process.stdout.write(`golden file: ${file}\n`)
            process.stdout.write(`golden ${spec.theme} size: ${bytes.length} bytes\n`)
            process.stdout.write(`golden ${spec.theme} sha256: ${sha}\n`)
        }
    })
})
