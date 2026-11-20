/**
 * Generator of the downloadable packs `theme-packs/scratch-white.risutheme` and `theme-packs/office-sheet.risutheme`:
 * the chat, studio, settings and home sheets of docs/design (Scratch White's chat sheet ends with the font block
 * theme-packs/scratch-white.chat-font.css), and for Scratch White the unmodified Nanum Pen Script font and its OFL text.
 * Built with the shared builder src/ts/themePack/fixtures/packBuilder.ts (fflate zipSync, deflate level 9, a local-field
 * DOS time so the bytes are the same in every time zone, fixed entry order).
 *
 * The font files are read from THEMEPACK_FONT_DIR (outside every repository) and the build refuses unless their size and
 * SHA-256 equal the pins. Writes only through `writeGoldenFile` (exclusive create, refused under any repository) and only
 * when THEMEPACK_DOWNLOADS_GENERATE=1, so a run of the whole save-gen folder generates nothing. The packs are copied into
 * theme-packs/ by hand, and the size and SHA-256 this harness prints are written by hand into theme-packs/README.md and
 * into the constants of src/ts/themePack/downloadPacks.test.ts.
 *
 * Run (repository root; RTB_GOLDENS_OUT names an output directory outside every repository, else a fresh temp one is used):
 *   $env:THEMEPACK_DOWNLOADS_GENERATE = '1'
 *   $env:THEMEPACK_FONT_DIR = '<directory holding NanumPenScript-Regular.ttf and OFL.txt>'
 *   node node_modules/vitest/vitest.mjs run --config Agents/Tools/vitest.harness.config.ts Agents/Tools/save-gen/themePackDownloads.harness.ts
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { goldenOutDir, writeGoldenFile } from 'src/ts/drive/tests/rtb/goldenOut'
import { zipPack } from 'src/ts/themePack/fixtures/packBuilder'

const GENERATE = process.env.THEMEPACK_DOWNLOADS_GENERATE === '1'
/** The repository root: the run command starts there. */
const ROOT = `${process.cwd().replace(/\\/g, '/')}/`
const AREAS = ['chat', 'studio', 'settings', 'home'] as const

const FONT_FILE = 'NanumPenScript-Regular.ttf'
const FONT_SIZE = 3201664
const FONT_SHA256 = '6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43'
const OFL_FILE = 'OFL.txt'
const OFL_SIZE = 4534
const OFL_SHA256 = 'eeacf16032901d0ed0456876ec77b8f0fda6b3fecec7d972f8543eb602e6c30f'

interface FontEntry {
    readonly file: string
    readonly license: string
    readonly attribution: string
}

interface PackSpec {
    readonly theme: string
    readonly id: string
    readonly name: string
    /** Appended to the chat sheet. */
    readonly chatTail: string | null
    readonly fonts: readonly FontEntry[]
}

const SPECS: readonly PackSpec[] = [
    {
        theme: 'scratch-white',
        id: 'risutanium.scratch-white',
        name: 'Scratch White',
        chatTail: 'theme-packs/scratch-white.chat-font.css',
        fonts: [{
            file: `fonts/${FONT_FILE}`,
            license: 'SIL Open Font License, Version 1.1 (the full text is fonts/OFL.txt)',
            attribution: 'Nanum Pen Script. Copyright (c) 2010, NHN Corporation. Reserved Font Names include Nanum and NanumPen (see fonts/OFL.txt). The unmodified file published in google/fonts ofl/nanumpenscript.',
        }],
    },
    { theme: 'office-sheet', id: 'risutanium.office-sheet', name: 'Office Sheet', chatTail: null, fonts: [] },
]

/** The working tree is CRLF under autocrlf while the index is LF; the pack carries LF. */
function lfText(path: string): string {
    const text = readFileSync(`${ROOT}${path}`, 'utf8').replace(/\r\n/g, '\n')
    expect(text.includes('\r'), `${path} still holds a CR`).toBe(false)
    return text
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

function pinnedFont(file: string, size: number, sha: string): Uint8Array {
    const dir = process.env.THEMEPACK_FONT_DIR
    if (!dir) {
        throw new Error('THEMEPACK_FONT_DIR must name the directory that holds the two font files')
    }
    const bytes = new Uint8Array(readFileSync(`${dir.replace(/\\/g, '/').replace(/\/$/, '')}/${file}`))
    expect(bytes.length, `${file} size`).toBe(size)
    expect(sha256(bytes), `${file} sha256`).toBe(sha)
    return bytes
}

/** Entry order: manifest.json, chat.css, studio.css, settings.css, home.css, then fonts/<ttf>, fonts/OFL.txt. */
function buildPack(spec: PackSpec): Uint8Array {
    const manifest = {
        kind: 'risutheme',
        format: 1,
        id: spec.id,
        name: spec.name,
        version: '1.0.0',
        license: 'GPL-3.0',
        attribution: 'RisuTanium contributors',
        modes: ['light'],
        fonts: spec.fonts,
    }
    const files: Record<string, string | Uint8Array> = { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n` }
    for (const area of AREAS) {
        const sheet = lfText(`docs/design/${area}/themes/${spec.theme}.css`)
        files[`${area}.css`] = area === 'chat' && spec.chatTail !== null ? sheet + lfText(spec.chatTail) : sheet
    }
    if (spec.fonts.length > 0) {
        files[`fonts/${FONT_FILE}`] = pinnedFont(FONT_FILE, FONT_SIZE, FONT_SHA256)
        files[`fonts/${OFL_FILE}`] = pinnedFont(OFL_FILE, OFL_SIZE, OFL_SHA256)
    }
    return zipPack(files)
}

describe.skipIf(!GENERATE)('downloadable theme pack generation (THEMEPACK_DOWNLOADS_GENERATE=1)', () => {
    test('writes scratch-white.risutheme and office-sheet.risutheme', () => {
        const dir = goldenOutDir()
        for (const spec of SPECS) {
            const bytes = buildPack(spec)
            expect(buildPack(spec), `${spec.theme} is not deterministic`).toEqual(bytes)
            const file = writeGoldenFile(dir, `${spec.theme}.risutheme`, bytes)
            process.stdout.write(`pack file: ${file}\n`)
            process.stdout.write(`pack ${spec.theme} size: ${bytes.length} bytes\n`)
            process.stdout.write(`pack ${spec.theme} sha256: ${sha256(bytes)}\n`)
        }
    }, 120_000)
})
