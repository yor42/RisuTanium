import { describe, expect, test } from 'vitest'
import { CoalescingSink } from 'src/ts/drive/rtb/coalescingSink'

/** A target that keeps a copy of every block, so a later change of the sink's own buffer cannot alter what it saw. */
function collect(): { blocks: Uint8Array[], target: (chunk: Uint8Array) => void, joined(): Uint8Array } {
    const blocks: Uint8Array[] = []
    return {
        blocks,
        target: (chunk) => {
            blocks.push(chunk.slice())
        },
        joined: () => {
            const out = new Uint8Array(blocks.reduce((sum, block) => sum + block.length, 0))
            let at = 0
            for (const block of blocks) {
                out.set(block, at)
                at += block.length
            }
            return out
        },
    }
}

function pattern(length: number, seed: number): Uint8Array {
    return Uint8Array.from({ length }, (_, i) => (i * 7 + seed) & 255)
}

describe('CoalescingSink (T-S8-11, guard)', () => {
    test('the bytes are identical to an uncoalesced run, whatever the chunk sizes', async () => {
        const chunks = [pattern(10, 1), pattern(300, 2), pattern(64, 3), pattern(0, 4), pattern(900, 5), pattern(40, 6)]
        const direct = collect()
        for (const chunk of chunks) {
            direct.target(chunk)
        }
        const sunk = collect()
        const sink = new CoalescingSink(sunk.target, 512)
        for (const chunk of chunks) {
            await sink.write(chunk)
        }
        await sink.flush()
        expect(Array.from(sunk.joined())).toEqual(Array.from(direct.joined()))
    })

    test('never more than the block size is held, and a small run reaches the target in blocks', async () => {
        const sunk = collect()
        const sink = new CoalescingSink(sunk.target, 100)
        let most = 0
        for (let i = 0; i < 50; i++) {
            await sink.write(pattern(30, i))
            most = Math.max(most, sink.heldBytes)
        }
        expect(most).toBeLessThanOrEqual(100)
        expect(sunk.blocks.length).toBeLessThan(50)
        expect(sunk.blocks.every((block) => block.length <= 100)).toBe(true)
    })

    test('bytes still held reach the target only at flush, and a second flush adds nothing', async () => {
        const sunk = collect()
        const sink = new CoalescingSink(sunk.target, 1000)
        await sink.write(pattern(10, 1))
        expect(sunk.blocks).toHaveLength(0)
        await sink.flush()
        expect(sunk.joined()).toEqual(pattern(10, 1))
        await sink.flush()
        expect(sunk.blocks).toHaveLength(1)
        expect(sink.heldBytes).toBe(0)
    })

    test('a chunk of the block size or more passes through after the held bytes, in order', async () => {
        const sunk = collect()
        const sink = new CoalescingSink(sunk.target, 100)
        await sink.write(pattern(20, 1))
        await sink.write(pattern(250, 2))
        expect(sunk.blocks.map((block) => block.length)).toEqual([20, 250])
        expect(sink.heldBytes).toBe(0)
    })

    test('a chunk mutated after its write resolved leaves the output unchanged', async () => {
        const sunk = collect()
        const sink = new CoalescingSink(sunk.target, 1000)
        const chunk = pattern(40, 9)
        const expected = chunk.slice()
        await sink.write(chunk)
        chunk.fill(0xee)
        await sink.flush()
        expect(sunk.joined()).toEqual(expected)
    })
})
