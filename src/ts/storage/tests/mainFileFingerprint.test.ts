// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { BLOCK_TYPE_CHARACTER_WITH_CHAT, FILE_HEADER_V1, frameBlock } from 'src/ts/storage/blockFrame'
import { PRE_BLOCKS_PREFIX } from 'src/ts/storage/blockKeys'
import { fingerprintMainFile, isPreBlocksKey } from 'src/ts/storage/mainFileFingerprint'
import { assemble, breakDataChecksum, parseBlocks } from './risuSaveBlockFile'

function blockFile(contents: string[]): Uint8Array {
    const blocks = contents.map((text, i) => frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, `c${i}`, new TextEncoder().encode(text)))
    const out = new Uint8Array(FILE_HEADER_V1.length + blocks.reduce((sum, block) => sum + block.length, 0))
    out.set(FILE_HEADER_V1, 0)
    let offset = FILE_HEADER_V1.length
    for (const block of blocks) {
        out.set(block, offset)
        offset += block.length
    }
    return out
}

describe('the conversion fingerprint (invariant M, pure part)', () => {
    test('is a function of the bytes alone', () => {
        const file = blockFile(['one', 'two'])
        expect(fingerprintMainFile(file)).toBe(fingerprintMainFile(file.slice()))
        expect(fingerprintMainFile(file)).toMatch(/^b1:/)
    })

    test('a changed block, a changed length and a reordered file give different fingerprints', () => {
        const a = blockFile(['one', 'two'])
        expect(fingerprintMainFile(blockFile(['one', 'twp']))).not.toBe(fingerprintMainFile(a))
        expect(fingerprintMainFile(blockFile(['one', 'two', 'three']))).not.toBe(fingerprintMainFile(a))
        expect(fingerprintMainFile(blockFile(['two', 'one']))).not.toBe(fingerprintMainFile(a))
    })

    test('the block-format fingerprint is built from stored checksums without a pass over the payloads', () => {
        const a = blockFile(['one', 'two'])
        // A payload byte changed with its stored checksum left alone: the header walk cannot see it, a payload pass would.
        const blocks = parseBlocks(a)
        blocks[1].payload = new TextEncoder().encode('twx')
        blocks[1].storedDataChecksum = parseBlocks(a)[1].storedDataChecksum
        const tampered = assemble(a, blocks)
        expect(fingerprintMainFile(tampered)).toBe(fingerprintMainFile(a))
        // The same file with a broken stored checksum is a different file.
        expect(fingerprintMainFile(breakDataChecksum(a, 'c1'))).not.toBe(fingerprintMainFile(a))
    })

    test('a legacy file is identified by its length and one CRC pass', () => {
        const raw = Uint8Array.from([0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 7, 1, 2, 3, 4, 5])
        const print = fingerprintMainFile(raw)
        expect(print).toMatch(/^c1:16:[0-9a-f]{8}$/)
        const changed = raw.slice()
        changed[12] ^= 1
        expect(fingerprintMainFile(changed)).not.toBe(print)
        const longer = new Uint8Array(17)
        longer.set(raw)
        expect(fingerprintMainFile(longer)).not.toBe(print)
    })

    test('a block file whose walk fails falls back to the whole-file form, deterministically', () => {
        const cut = blockFile(['one', 'two']).subarray(0, 40)
        const print = fingerprintMainFile(cut)
        expect(print).toMatch(/^c1:/)
        expect(fingerprintMainFile(cut.slice())).toBe(print)
    })
})

describe('the pre-blocks copy names', () => {
    test('pre-blocks names are recognised', () => {
        expect(isPreBlocksKey(`${PRE_BLOCKS_PREFIX}.bin`)).toBe(true)
        expect(isPreBlocksKey(`${PRE_BLOCKS_PREFIX}-3.bin`)).toBe(true)
        expect(isPreBlocksKey('database/database.bin')).toBe(false)
        expect(isPreBlocksKey('database/database.pre-blocksX.bin')).toBe(false)
    })
})
