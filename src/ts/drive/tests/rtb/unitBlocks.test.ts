import { describe, test, expect } from 'vitest'
import { encodeFrame } from 'src/ts/storage/store2/format/frame'
import { UNIT_TYPE } from 'src/ts/storage/store2/format/versions'
import { parseStoreBlockName } from 'src/ts/drive/rtb/entryNames'
import {
    BLOCK_HEADER_BYTES,
    BLOCK_TARGET_BYTES,
    decodeBlock,
    encodeBlock,
    groupBlocks,
    type BlockUnit,
    type PlannedBlock,
} from 'src/ts/drive/rtb/unitBlocks'

const encoder = new TextEncoder()

function unit(tail: string, type: number, payload: Uint8Array | string): BlockUnit {
    const bytes = typeof payload === 'string' ? encoder.encode(payload) : payload
    return { tail, frame: encodeFrame(type as typeof UNIT_TYPE[keyof typeof UNIT_TYPE], bytes) }
}

async function* iterate<T>(items: T[]): AsyncGenerator<T> {
    for (const item of items) {
        yield item
    }
}

async function collect(units: BlockUnit[]): Promise<PlannedBlock[]> {
    const blocks: PlannedBlock[] = []
    for await (const block of groupBlocks(iterate(units))) {
        blocks.push(block)
    }
    return blocks
}

/** A block written by hand, so tails and counts the writer would never produce can be built. */
function handBlock(parts: { tail: Uint8Array, frame: Uint8Array }[], header: { version?: number, reserved?: number[], count?: number } = {}): Uint8Array {
    const total = BLOCK_HEADER_BYTES + parts.reduce((sum, part) => sum + 1 + part.tail.length + part.frame.length, 0)
    const out = new Uint8Array(total)
    out.set(encoder.encode('RTBK'), 0)
    out[4] = header.version ?? 1
    const reserved = header.reserved ?? [0, 0, 0]
    out.set(reserved, 5)
    new DataView(out.buffer).setUint32(8, header.count ?? parts.length, true)
    let at = BLOCK_HEADER_BYTES
    for (const part of parts) {
        out[at++] = part.tail.length
        out.set(part.tail, at)
        at += part.tail.length
        out.set(part.frame, at)
        at += part.frame.length
    }
    return out
}

describe('encodeBlock and decodeBlock (T14b, T-blk)', () => {
    test('the header is RTBK, version 1, three zero bytes and the count; units come back in order', () => {
        const units = [unit('alpha', UNIT_TYPE.shard, 'one'), unit('beta', UNIT_TYPE.shard, 'two'), unit('gamma', UNIT_TYPE.shard, '')]
        const bytes = encodeBlock(units)
        expect(Array.from(bytes.subarray(0, 12))).toEqual([0x52, 0x54, 0x42, 0x4B, 1, 0, 0, 0, 3, 0, 0, 0])
        const decoded = decodeBlock(bytes)
        expect(decoded.kind).toBe('ok')
        if (decoded.kind !== 'ok') {
            return
        }
        expect(decoded.units.map((u) => u.tail)).toEqual(['alpha', 'beta', 'gamma'])
        expect(decoded.units.map((u) => u.type)).toEqual([UNIT_TYPE.shard, UNIT_TYPE.shard, UNIT_TYPE.shard])
        decoded.units.forEach((u, i) => expect(Array.from(u.frame)).toEqual(Array.from(units[i].frame)))
    })

    test('the frame type byte is the authority for the type of each unit', () => {
        const decoded = decodeBlock(encodeBlock([unit('a', UNIT_TYPE.lore, 'x'), unit('b', UNIT_TYPE.preset, 'y')]))
        expect(decoded.kind === 'ok' && decoded.units.map((u) => u.type)).toEqual([UNIT_TYPE.lore, UNIT_TYPE.preset])
    })

    test('a version byte other than 1 is damaged', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        for (const version of [0, 2, 255]) {
            expect(decodeBlock(handBlock([{ tail: encoder.encode('a'), frame }], { version })).kind).toBe('damaged')
        }
    })

    test('a nonzero reserved byte is damaged, in each of the three positions', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        for (const reserved of [[1, 0, 0], [0, 1, 0], [0, 0, 1]]) {
            expect(decodeBlock(handBlock([{ tail: encoder.encode('a'), frame }], { reserved })).kind).toBe('damaged')
        }
    })

    test('a wrong magic and a block shorter than its header are damaged', () => {
        const good = encodeBlock([unit('a', UNIT_TYPE.shard, 'x')])
        const wrong = good.slice()
        wrong[0] = 0x58
        expect(decodeBlock(wrong).kind).toBe('damaged')
        expect(decodeBlock(good.subarray(0, 11)).kind).toBe('damaged')
        expect(decodeBlock(new Uint8Array(0)).kind).toBe('damaged')
    })

    test('a tail of length 0 is damaged and a tail of 255 bytes is accepted', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        expect(decodeBlock(handBlock([{ tail: new Uint8Array(0), frame }])).kind).toBe('damaged')
        const long = encoder.encode('t'.repeat(255))
        const decoded = decodeBlock(handBlock([{ tail: long, frame }]))
        expect(decoded.kind).toBe('ok')
        expect(decoded.kind === 'ok' && decoded.units[0].tail).toBe('t'.repeat(255))
    })

    test('a tail with a byte outside ASCII is damaged', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        expect(decodeBlock(handBlock([{ tail: Uint8Array.of(0x61, 0xC3), frame }])).kind).toBe('damaged')
    })

    test('a repeated tail is damaged, inside a block and against tails already seen', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        const tail = encoder.encode('same')
        expect(decodeBlock(handBlock([{ tail, frame }, { tail, frame }])).kind).toBe('damaged')

        const seen = new Set<string>()
        const first = encodeBlock([unit('one', UNIT_TYPE.shard, 'x')])
        expect(decodeBlock(first, seen).kind).toBe('ok')
        expect(seen.has('one')).toBe(true)
        expect(decodeBlock(first, seen).kind).toBe('damaged')
    })

    test('a frame that runs past the end of the block is damaged', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'payload').frame
        const block = handBlock([{ tail: encoder.encode('a'), frame }])
        const overrun = decodeBlock(block.subarray(0, block.length - 1))
        expect(overrun.kind).toBe('damaged')
        expect(overrun.kind === 'damaged' && overrun.reason).toMatch(/runs past/)
        expect(decodeBlock(block.subarray(0, BLOCK_HEADER_BYTES + 1 + 1 + 10)).kind).toBe('damaged')
    })

    test('a header count one above the units present is damaged', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        expect(decodeBlock(handBlock([{ tail: encoder.encode('a'), frame }], { count: 2 })).kind).toBe('damaged')
    })

    test('one byte after the last counted unit is damaged', () => {
        const block = encodeBlock([unit('a', UNIT_TYPE.shard, 'x')])
        const padded = new Uint8Array(block.length + 1)
        padded.set(block, 0)
        expect(decodeBlock(padded).kind).toBe('damaged')
    })

    test('the writer refuses a tail that is empty, over 48 bytes or not ASCII, and a frame that is not a frame', () => {
        const frame = unit('a', UNIT_TYPE.shard, 'x').frame
        expect(() => encodeBlock([{ tail: '', frame }])).toThrow()
        expect(() => encodeBlock([{ tail: 't'.repeat(49), frame }])).toThrow()
        expect(() => encodeBlock([{ tail: 'é', frame }])).toThrow()
        expect(() => encodeBlock([{ tail: 't'.repeat(48), frame }])).not.toThrow()
        expect(() => encodeBlock([{ tail: 'a', frame: frame.subarray(0, 10) }])).toThrow()
        expect(() => encodeBlock([{ tail: 'a', frame: frame.subarray(0, frame.length - 1) }])).toThrow()
    })
})

describe('groupBlocks (T-blk grouping and names)', () => {
    test('units of one type share a block, and each type gets its own with seq from 0', async () => {
        const blocks = await collect([
            unit('a1', UNIT_TYPE.shard, 'x'),
            unit('b1', UNIT_TYPE.lore, 'y'),
            unit('a2', UNIT_TYPE.shard, 'z'),
        ])
        expect(blocks.map((b) => b.name).sort()).toEqual([`u/${UNIT_TYPE.shard}/0.blk`, `u/${UNIT_TYPE.lore}/0.blk`].sort())
        const shard = blocks.find((b) => b.type === UNIT_TYPE.shard)
        expect(shard?.units).toBe(2)
        const decoded = decodeBlock(shard?.bytes ?? new Uint8Array(0))
        expect(decoded.kind === 'ok' && decoded.units.map((u) => u.tail)).toEqual(['a1', 'a2'])
    })

    test('a block holds at most 4 MiB: four 1 MiB units become a block of three and a block of one', async () => {
        const payload = new Uint8Array(1024 * 1024)
        const blocks = await collect([0, 1, 2, 3].map((i) => unit(`t${i}`, UNIT_TYPE.chatChunk, payload)))
        expect(blocks.map((b) => b.units)).toEqual([3, 1])
        expect(blocks.map((b) => b.name)).toEqual([`u/${UNIT_TYPE.chatChunk}/0.blk`, `u/${UNIT_TYPE.chatChunk}/1.blk`])
        for (const block of blocks) {
            expect(block.bytes.length).toBeLessThanOrEqual(BLOCK_TARGET_BYTES)
        }
    })

    test('a unit larger than 4 MiB gets its own block between its neighbours', async () => {
        const big = new Uint8Array(BLOCK_TARGET_BYTES + 10)
        const blocks = await collect([
            unit('small1', UNIT_TYPE.chatChunk, 'a'),
            unit('big', UNIT_TYPE.chatChunk, big),
            unit('small2', UNIT_TYPE.chatChunk, 'b'),
        ])
        expect(blocks.map((b) => b.units)).toEqual([1, 1, 1])
        expect(blocks.map((b) => b.seq)).toEqual([0, 1, 2])
        expect(blocks[1].bytes.length).toBeGreaterThan(BLOCK_TARGET_BYTES)
    })

    test('a unit larger than 4 MiB is emitted as soon as it arrives, before the next unit is pulled', async () => {
        let pulled = 0
        async function* source(): AsyncGenerator<BlockUnit> {
            pulled++
            yield unit('big', UNIT_TYPE.chatChunk, new Uint8Array(BLOCK_TARGET_BYTES + 10))
            pulled++
            yield unit('small', UNIT_TYPE.shard, 'a')
        }
        const blocks = groupBlocks(source())
        const first = await blocks.next()
        expect(first.done).toBe(false)
        expect(first.value?.type).toBe(UNIT_TYPE.chatChunk)
        expect(pulled).toBe(1)
    })

    test('block names have no leading zeros and parse as canonical store block names', async () => {
        const payload = new Uint8Array(900 * 1024)
        const units: BlockUnit[] = []
        for (let i = 0; i < 12; i++) {
            units.push(unit(`tail${i}`, UNIT_TYPE.chatChunk, payload))
        }
        const blocks = await collect(units)
        expect(blocks.length).toBeGreaterThan(2)
        for (const block of blocks) {
            expect(block.name).toMatch(/^u\/[1-9][0-9]*\/(0|[1-9][0-9]*)\.blk$/)
            expect(parseStoreBlockName(block.name)).toEqual({ type: block.type, seq: block.seq })
        }
        expect(blocks.map((b) => b.seq)).toEqual(blocks.map((_, i) => i))
    })

    test('a tail that repeats across units fails the export', async () => {
        await expect(collect([unit('dup', UNIT_TYPE.shard, 'a'), unit('dup', UNIT_TYPE.lore, 'b')])).rejects.toThrow(/dup/)
    })

    test('no units give no blocks', async () => {
        expect(await collect([])).toEqual([])
    })
})
