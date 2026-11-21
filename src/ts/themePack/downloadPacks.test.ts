// @vitest-environment node
// The downloadable packs in theme-packs/ are shipped bytes built by Agents/Tools/save-gen/themePackDownloads.harness.ts with the
// real pack builder. The pinned size and SHA-256 are also written in theme-packs/README.md; the three must agree. Every row is a
// compatibility guard: the pack files are read with node:fs only, and nothing in src imports them.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { rangeSourceFrom } from '../drive/rtb/rangeSource'
import { judgeAreaSheet, judgePackSheets, THEME_AREAS, type ThemeArea } from './index'
import { intakePackBytes, readVerifiedFile, type IntakeResult, type PackJudge, type VerifiedPack } from './intake'

const PACKS_DIR = new URL('../../../theme-packs/', import.meta.url)
const DOCS_DIR = new URL('../../../docs/design/', import.meta.url)

const FONT = { path: 'fonts/NanumPenScript-Regular.ttf', size: 3201664, sha256: '6f0d1ab29c7894010dc88831fb7a0a51edb79136e450344183de5b1a8b52bd43' } as const
const OFL = { path: 'fonts/OFL.txt', size: 4534, sha256: 'eeacf16032901d0ed0456876ec77b8f0fda6b3fecec7d972f8543eb602e6c30f' } as const
const FONT_LICENSE = 'SIL Open Font License, Version 1.1 (the full text is fonts/OFL.txt)'
const FONT_ATTRIBUTION = 'Nanum Pen Script. Copyright (c) 2010, NHN Corporation. Reserved Font Names include Nanum and NanumPen (see fonts/OFL.txt). The unmodified file published in google/fonts ofl/nanumpenscript.'

const PACKS = [
    {
        slug: 'scratch-white', file: 'scratch-white.risutheme', id: 'risutanium.scratch-white', name: 'Scratch White',
        size: 1317116, sha256: '63f96bb1163cb7fe1223c0953aa27f0028901398d6afd54fa30e4b21498c673d',
        fonts: [{ file: FONT.path, license: FONT_LICENSE, attribution: FONT_ATTRIBUTION }],
        entries: ['manifest.json', 'chat.css', 'studio.css', 'settings.css', 'home.css', FONT.path, OFL.path],
        fileKeys: [FONT.path],
    },
    {
        slug: 'office-sheet', file: 'office-sheet.risutheme', id: 'risutanium.office-sheet', name: 'Office Sheet',
        size: 6129, sha256: '3f039001c0906949625468baabaf585335553dba2b1a7f171da2589d0fbd591f',
        fonts: [],
        entries: ['manifest.json', 'chat.css', 'studio.css', 'settings.css', 'home.css'],
        fileKeys: [] as string[],
    },
] as const

const judge: PackJudge = async (sheets) => judgePackSheets(sheets)

function packBytes(file: string): Uint8Array {
    return new Uint8Array(readFileSync(new URL(file, PACKS_DIR)))
}

function sha256(bytes: Uint8Array): string {
    return createHash('sha256').update(bytes).digest('hex')
}

function lfDocs(area: ThemeArea, slug: string): string {
    return readFileSync(new URL(`${area}/themes/${slug}.css`, DOCS_DIR), 'utf8').replace(/\r\n/g, '\n')
}

function acceptedPack(result: IntakeResult): VerifiedPack {
    if (result.ok === false) throw new Error(`pack refused: ${JSON.stringify(result.refusals)}`)
    return result.pack
}

describe('D-1 the downloadable packs keep their pinned size and SHA-256, in the test and in the README', () => {
    const readme = readFileSync(new URL('README.md', PACKS_DIR), 'utf8')

    for (const pack of PACKS) {
        it(pack.file, () => {
            const bytes = packBytes(pack.file)
            expect(bytes.length).toBe(pack.size)
            expect(sha256(bytes)).toBe(pack.sha256)
            expect(readme).toContain(pack.sha256)
            expect(readme).toContain(`${pack.size} bytes`)
        })
    }

    it('the font pins are in the README too', () => {
        for (const pin of [FONT, OFL]) {
            expect(readme).toContain(pin.sha256)
            expect(readme).toContain(`${pin.size} bytes`)
        }
    })
})

describe('D-2 intake accepts each pack with its chat and studio sheets judged and the other two areas skipped', () => {
    for (const pack of PACKS) {
        it(pack.file, async () => {
            const accepted = acceptedPack(await intakePackBytes(packBytes(pack.file), judge))
            expect(accepted.manifest).toStrictEqual({
                format: 1,
                packId: pack.id,
                name: pack.name,
                version: '1.0.0',
                license: 'GPL-3.0',
                attribution: 'RisuTanium contributors',
                modes: ['light'],
                fonts: pack.fonts,
                tile: { main: { kind: 'absent' }, secondary: { kind: 'absent' }, icon: { kind: 'absent' } },
            })
            expect(accepted.sheets.chat?.result.ok).toBe(true)
            expect(accepted.sheets.studio?.result.ok).toBe(true)
            expect(accepted.skippedAreas).toEqual(['home', 'settings'])
            expect(accepted.size.warn).toBe(false)
            expect([...accepted.files.keys()]).toEqual(pack.fileKeys)
        })
    }
})

describe('D-3 the Scratch White archive: the font and its licence are the pinned bytes, in the harness entry order', () => {
    const pack = PACKS[0]

    it('the font passes the second-pass read as font/ttf with the pinned size and SHA-256', async () => {
        const bytes = packBytes(pack.file)
        const accepted = acceptedPack(await intakePackBytes(bytes, judge))
        const source = rangeSourceFrom({ size: bytes.length, read: async (start, end) => bytes.subarray(start, end) })
        const read = await readVerifiedFile(source, accepted, FONT.path)
        expect(read.ok).toBe(true)
        if (read.ok) {
            expect(read.mime).toBe('font/ttf')
            expect(read.bytes.length).toBe(FONT.size)
            expect(sha256(read.bytes)).toBe(FONT.sha256)
        }
    })

    it('fonts/OFL.txt is present and pinned', () => {
        const ofl = unzipSync(packBytes(pack.file))[OFL.path]
        expect(ofl.length).toBe(OFL.size)
        expect(sha256(ofl)).toBe(OFL.sha256)
    })

    for (const each of PACKS) {
        it(`${each.file}: entry order`, () => {
            expect(Object.keys(unzipSync(packBytes(each.file)))).toEqual(each.entries)
        })
    }

    it('the chat sheet ends with the font block file and registers the one family', () => {
        const chat = strFromU8(unzipSync(packBytes(pack.file))['chat.css'])
        const block = readFileSync(new URL('scratch-white.chat-font.css', PACKS_DIR), 'utf8').replace(/\r\n/g, '\n')
        expect(chat.endsWith(block)).toBe(true)
        expect(chat.startsWith(lfDocs('chat', 'scratch-white'))).toBe(true)
    })
})

describe('D-4 the studio, settings and home entries are the docs sheets and name no image', () => {
    for (const pack of PACKS) {
        for (const area of THEME_AREAS.filter((each) => each !== 'chat')) {
            it(`${pack.slug} / ${area}`, () => {
                const entry = strFromU8(unzipSync(packBytes(pack.file))[`${area}.css`])
                expect(entry).toBe(lfDocs(area, pack.slug))
                expect(entry).not.toContain('images/')
                expect(entry).not.toContain('pack-nanumpen')
                const judged = judgeAreaSheet(area, entry)
                expect(judged.result.errors).toEqual([])
                expect(judged.result.ok).toBe(true)
            })
        }
    }

    it('the Office Sheet chat entry is the docs sheet', () => {
        expect(strFromU8(unzipSync(packBytes('office-sheet.risutheme'))['chat.css'])).toBe(lfDocs('chat', 'office-sheet'))
    })
})
