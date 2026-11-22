// @vitest-environment node
// Format guard: the two committed v1 packs are frozen bytes, and every later build must still accept them. The pinned
// size and SHA-256 are also written in goldens/README.md; the three must agree. The goldens are never regenerated.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { judgePackSheets, lintAreaPack } from './index'
import { intakePackBytes, type IntakeResult, type PackJudge } from './intake'
import { checkPackIcon, inspectIcon } from './packIcon'

const GOLDENS = new URL('./goldens/', import.meta.url)

const PINNED = [
    { file: 'origin-navy.risutheme', id: 'risutanium.origin-navy', name: 'Origin Navy', modes: ['dark'], size: 7083, sha256: 'a3572fc7b4dfea788566a3bf707a806c91b4a26116470ccbc402ad62fb90a06b' },
    { file: 'banana-cocoa.risutheme', id: 'risutanium.banana-cocoa', name: 'Banana Cocoa', modes: ['light'], size: 13148, sha256: 'd8bda3ae97e300e619d13096eb6a79b56ee3d7fc1ded426080e2e04b6b9327d5' },
] as const

const judge: PackJudge = async (sheets) => judgePackSheets(sheets)

function bytesOf(file: string): Uint8Array {
    return new Uint8Array(readFileSync(new URL(file, GOLDENS)))
}

function acceptedPack(result: IntakeResult) {
    if (result.ok === false) throw new Error(`golden refused: ${JSON.stringify(result.refusals)}`)
    return result.pack
}

describe('T3-11 golden tile-v1 pack (icon and colours)', () => {
    const file = 'tile-v1.risutheme'
    const size = 2770
    const sha256 = '1c8ed6148098f26f8e58d71bcb7f21f39557f4f15d8b9300808c993f800ae3e3'

    it('keeps its pinned size and SHA-256, in the test and in the README', () => {
        const bytes = bytesOf(file)
        const readme = readFileSync(new URL('README.md', GOLDENS), 'utf8')
        expect(bytes.length).toBe(size)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(sha256)
        expect(readme).toContain(sha256)
        expect(readme).toContain(`${size} bytes`)
    })

    it('is accepted with its colours and icon read, and the icon passes the install-time check', async () => {
        const bytes = bytesOf(file)
        const pack = acceptedPack(await intakePackBytes(bytes, judge))
        expect(pack.manifest.tile).toStrictEqual({
            main: { kind: 'ok', value: '#3366ff' },
            secondary: { kind: 'ok', value: '#101820' },
            icon: { kind: 'ok', value: 'images/icon.png' },
        })
        expect([...pack.files.keys()]).toEqual(['images/icon.png'])

        const checked = await checkPackIcon(bytes, pack, 'images/icon.png')

        expect(checked.ok && checked.ext).toBe('png')
        expect(checked.ok && inspectIcon(checked.bytes, 'image/png')).toEqual({ width: 64, height: 64, animated: false })
    })
})

describe('T1-31 golden v1 packs', () => {
    const readme = readFileSync(new URL('README.md', GOLDENS), 'utf8')

    for (const golden of PINNED) {
        it(`${golden.file} keeps its pinned size and SHA-256, in the test and in the README`, () => {
            const bytes = bytesOf(golden.file)
            expect(bytes.length).toBe(golden.size)
            expect(createHash('sha256').update(bytes).digest('hex')).toBe(golden.sha256)
            expect(readme).toContain(golden.sha256)
            expect(readme).toContain(`${golden.size} bytes`)
        })

        // The frozen Banana Cocoa studio.css breaks the plain-paint rule; its verdict is pinned below (RG1), so only Origin Navy is accepted whole.
        if (golden.file !== 'origin-navy.risutheme') {
            continue
        }
        it(`${golden.file} is accepted with its chat, studio and settings sheets judged and home skipped`, async () => {
            const pack = acceptedPack(await intakePackBytes(bytesOf(golden.file), judge))
            expect(pack.manifest).toStrictEqual({
                format: 1,
                packId: golden.id,
                name: golden.name,
                version: '1.0.0',
                license: 'GPL-3.0',
                attribution: 'RisuTanium contributors',
                modes: [...golden.modes],
                fonts: [],
                tile: { main: { kind: 'absent' }, secondary: { kind: 'absent' }, icon: { kind: 'absent' } },
            })
            expect(pack.sheets.chat?.result.ok).toBe(true)
            expect(pack.sheets.studio?.result.ok).toBe(true)
            expect(pack.sheets.settings?.result.ok).toBe(true)
            expect(pack.skippedAreas).toEqual(['home'])
            expect(pack.files.size).toBe(0)
            expect(pack.size.warn).toBe(false)
        })
    }
})

// Intake judges studio.css whole at install (MC-3121), so the frozen Banana Cocoa archive is refused by its Studio sheet (MC-2313, MC-2370):
// MC-2370 accepted that cost; the refusal is pinned so a change to it is deliberate.
describe('the frozen Studio sheets under the plain-paint rule', () => {
    it('RG3: intake refuses the frozen Banana Cocoa archive by studio.css alone, with the three plain-paint errors', async () => {
        const result = await intakePackBytes(bytesOf('banana-cocoa.risutheme'), judge)
        if (result.ok === true) throw new Error('expected the frozen Banana Cocoa archive to be refused')
        expect(result.refusals).toHaveLength(1)
        expect(result.refusals[0]).toMatchObject({ code: 'sheetRefused', sheet: 'studio.css' })
        const errors = result.refusals[0].code === 'sheetRefused' ? result.refusals[0].errors : []
        expect(errors.map((e) => `${e.selector} ${e.prop}`).sort()).toEqual([
            '[data-part="studio-side-tab"] background',
            '[data-part="studio-tree-row"] background',
            '[data-part="studio-tree-row"] color',
        ])
    })

    const PLAIN_PAINT = /\(MC-2313, MC-2370\)/
    const studioSheet = (file: string): string => strFromU8(unzipSync(bytesOf(file))['studio.css'])

    it('RG1 (REPRO): the Banana Cocoa Studio sheet is refused with exactly three plain-paint errors', () => {
        const result = lintAreaPack('studio', studioSheet('banana-cocoa.risutheme'), 'banana-cocoa')
        expect(result.ok).toBe(false)
        const plain = result.errors.filter((e) => PLAIN_PAINT.test(e.why))
        expect(plain.map((e) => `${e.selector} ${e.prop}`).sort(), JSON.stringify(result.errors)).toEqual([
            '[data-part="studio-side-tab"] background',
            '[data-part="studio-tree-row"] background',
            '[data-part="studio-tree-row"] color',
        ])
    })

    it('RG2 (GUARD, accepted before and after): the Origin Navy Studio sheet is accepted', () => {
        const result = lintAreaPack('studio', studioSheet('origin-navy.risutheme'), 'origin-navy')
        expect(result.ok, JSON.stringify(result.errors)).toBe(true)
    })
})
