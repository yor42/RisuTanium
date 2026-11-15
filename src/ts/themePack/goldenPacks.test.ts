// @vitest-environment node
// Format guard: the two committed v1 packs are frozen bytes, and every later build must still accept them. The pinned
// size and SHA-256 are also written in goldens/README.md; the three must agree. The goldens are never regenerated.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { judgePackSheets } from './index'
import { intakePackBytes, type IntakeResult, type PackJudge } from './intake'

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

        it(`${golden.file} is accepted with its chat sheet judged and the other three areas skipped`, async () => {
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
            })
            expect(pack.sheets.chat.result.ok).toBe(true)
            expect(pack.skippedAreas).toEqual(['home', 'settings', 'studio'])
            expect(pack.files.size).toBe(0)
            expect(pack.size.warn).toBe(false)
        })
    }
})
