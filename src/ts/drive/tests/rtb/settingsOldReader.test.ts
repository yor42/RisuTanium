import { describe, expect, test } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RangeSource } from 'src/ts/drive/rtb/rangeSource'
import { classifyRtb as classifyOld } from './oldReader/rtbClassify'
import { classifyRtb } from 'src/ts/drive/rtb/rtbClassify'
import { rangeSourceOfBytes } from './sparseSource'
import { settingsFile } from './settingsFileKit'

const GOLDEN_DIR = path.resolve(process.env.RTB_GOLDENS_DIR ?? path.join(process.cwd(), 'src/ts/drive/tests/rtbGoldens'))

/** A source that records every read and has no way to write: all an older reader is given. */
function recording(bytes: Uint8Array): { source: RangeSource, reads: number } {
    const inner = rangeSourceOfBytes(bytes)
    const seen = { reads: 0 }
    return {
        source: { size: inner.size, read: async (offset, length) => { seen.reads++; return inner.read(offset, length) } },
        get reads() { return seen.reads },
    }
}

describe('T3d and A3 (compatibility guard): the pre-change reader refuses a settings-only file', () => {
    test('a frozen copy of the pre-change classifier calls the written file damaged at the section table, from reads only', async () => {
        const file = await settingsFile({ settings: [{ key: 'theme', value: 'x' }], uiPrefs: [{ key: 'k', value: 'v' }] })
        const probe = recording(file.bytes())
        const old = await classifyOld(probe.source)
        expect(old).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('the required section store2 is missing') })
        expect(probe.reads).toBeGreaterThan(0)
        // The same bytes are a settings file to this build, so the refusal comes from the reader and not from a bad file.
        expect((await classifyRtb(file.source)).kind).toBe('settings')
    })

    test('the same holds for the committed golden', async () => {
        const golden = fs.readFileSync(path.join(GOLDEN_DIR, 'v1-settings-small.rtb'))
        expect(await classifyOld(rangeSourceOfBytes(golden))).toMatchObject({ kind: 'damaged', reason: expect.stringContaining('store2 is missing') })
    })

    test('the frozen copy still reads a whole backup, so its refusal is about the settings row and not a broken copy', async () => {
        const golden = fs.readFileSync(path.join(GOLDEN_DIR, 'v1-sealed-small.plain.rtb'))
        expect((await classifyOld(rangeSourceOfBytes(golden))).kind).toBe('ok')
    })
})
