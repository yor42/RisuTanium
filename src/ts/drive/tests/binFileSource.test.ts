/**
 * `binFileOfSource` presents a file another app opened (an `ImportSource`) as the `BinFile` a `.bin` restore reads. The
 * standard of comparison is a `File` over the same bytes: every slice, nested or not, has the same size and bytes.
 *
 * Labels: guard (adapter equals a File; passes only once the adapter is right), reproducer (red against the named mutant).
 */
import { describe, expect, test, vi } from 'vitest'
import { binFileOfSource } from 'src/ts/drive/binFileSource'
import { importSourceOfBytes, type ImportSource, type ImportSourceStat } from 'src/ts/importSource'
import type { BinFile, BinSlice } from 'src/ts/drive/backupContainer'

vi.mock('@tauri-apps/plugin-fs', () => ({ open: vi.fn(), SeekMode: { Start: 0 } }))

const SIZE = 1000

function patterned(): Uint8Array {
    const out = new Uint8Array(SIZE)
    for (let i = 0; i < SIZE; i++) {
        out[i] = (i * 7 + 3) % 251
    }
    return out
}

async function bytesOf(slice: BinFile | BinSlice): Promise<Uint8Array> {
    return new Uint8Array(await (slice as BinSlice).arrayBuffer())
}

type Bounds = [number | undefined, number | undefined]

const BOUNDS: Bounds[] = [
    [0, 10], [10, 20], [0, SIZE], [0, undefined], [5, undefined], [SIZE - 1, SIZE], [SIZE, SIZE + 10],
    [-10, undefined], [-10, -5], [-SIZE * 2, 10], [0, SIZE * 2], [SIZE * 2, SIZE * 3], [30, 10], [10, -2000],
    [undefined, 7], [0, Number.POSITIVE_INFINITY], [Number.NEGATIVE_INFINITY, 5],
]

describe('binFileOfSource against a File over the same bytes', () => {
    const bytes = patterned()
    const file = new File([bytes as unknown as Uint8Array<ArrayBuffer>], 'a.bin')
    const adapter = binFileOfSource(importSourceOfBytes('a.bin', bytes))

    test('guard: size equals', () => {
        expect(adapter.size).toBe(file.size)
    })

    test.each(BOUNDS)('guard: slice(%s, %s) has the File slice\'s size and bytes', async (start, end) => {
        const expected = file.slice(start, end)
        const actual = adapter.slice(start, end)

        expect(actual.size).toBe(expected.size)
        expect(await bytesOf(actual)).toEqual(new Uint8Array(await expected.arrayBuffer()))
    })

    // Reproducer against the mutant whose nested slice is relative to the whole source (the parent's offset is dropped).
    test.each(BOUNDS)('reproducer: a slice of slice(100, 400) cut at (%s, %s) equals the File\'s', async (start, end) => {
        const expected = file.slice(100, 400).slice(start, end)
        const actual = adapter.slice(100, 400).slice(start, end)

        expect(actual.size).toBe(expected.size)
        expect(await bytesOf(actual)).toEqual(new Uint8Array(await expected.arrayBuffer()))
    })

    // Reproducer against the mutant that clamps a nested slice to the whole source and not to its parent.
    test('reproducer: a nested slice never reaches past its parent', async () => {
        const parent = adapter.slice(100, 120)

        expect(parent.slice(0, 500).size).toBe(20)
        expect(await bytesOf(parent.slice(0, 500))).toEqual(bytes.subarray(100, 120))
        expect(parent.slice(25, 30).size).toBe(0)
    })

    test('guard: three levels of nesting equal the File', async () => {
        const expected = file.slice(100, 600).slice(-300, -50).slice(20, 80)
        const actual = adapter.slice(100, 600).slice(-300, -50).slice(20, 80)

        expect(await bytesOf(actual)).toEqual(new Uint8Array(await expected.arrayBuffer()))
    })
})

describe('reads', () => {
    test('a slice does no I/O until arrayBuffer, and an empty slice never reads', async () => {
        const read = vi.fn(async () => new Uint8Array(0))
        const source = { ...importSourceOfBytes('a.bin', patterned()), read }
        const adapter = binFileOfSource(source)

        const slice = adapter.slice(10, 20).slice(2, 5)
        adapter.slice(50, 50)
        expect(read).not.toHaveBeenCalled()

        expect((await adapter.slice(7, 7).arrayBuffer()).byteLength).toBe(0)
        expect(read).not.toHaveBeenCalled()

        await slice.arrayBuffer()
        expect(read).toHaveBeenCalledExactlyOnceWith(12, 15)
    })

    // Reproducer against the mutant that returns the source's view buffer as it is: a subarray's buffer is the whole parent.
    test('reproducer: a view into a larger buffer comes back as an exact-length ArrayBuffer', async () => {
        const backing = patterned()
        const source = importSourceOfBytes('a.bin', backing)

        const buffer = await binFileOfSource(source).slice(100, 110).arrayBuffer()

        expect(buffer.byteLength).toBe(10)
        expect(new Uint8Array(buffer)).toEqual(backing.subarray(100, 110))
        new Uint8Array(buffer).fill(0)
        expect(backing[100]).not.toBe(0)
    })

    // Reproducer against the mutant that pads a short read to the requested length.
    test('reproducer: a short read stays short', async () => {
        const inner = importSourceOfBytes('a.bin', patterned())
        const source: ImportSource = { ...inner, read: async (start, end) => (await inner.read(start, end)).subarray(0, 3) }

        const slice = binFileOfSource(source).slice(0, 50)

        expect(slice.size).toBe(50)
        expect((await slice.arrayBuffer()).byteLength).toBe(3)
    })

    test('a read error propagates and a later read still runs', async () => {
        const inner = importSourceOfBytes('a.bin', patterned())
        let failNext = true
        const source: ImportSource = {
            ...inner,
            read: async (start, end) => {
                if (failNext) {
                    failNext = false
                    throw new Error('scratch: provider failed')
                }
                return inner.read(start, end)
            },
        }
        const adapter = binFileOfSource(source)

        await expect(adapter.slice(0, 5).arrayBuffer()).rejects.toThrow('provider failed')
        expect((await adapter.slice(0, 5).arrayBuffer()).byteLength).toBe(5)
    })

    // Reproducer against the mutant without the promise queue: two reads would be in flight at once.
    test('reproducer: concurrent arrayBuffer calls reach the source one at a time, in call order', async () => {
        const inner = importSourceOfBytes('a.bin', patterned())
        let inFlight = 0
        let most = 0
        const order: number[] = []
        const source: ImportSource = {
            ...inner,
            read: async (start, end) => {
                inFlight++
                most = Math.max(most, inFlight)
                order.push(start)
                await new Promise((resolve) => setTimeout(resolve, 5))
                inFlight--
                return inner.read(start, end)
            },
        }
        const adapter = binFileOfSource(source)

        await Promise.all([adapter.slice(0, 4).arrayBuffer(), adapter.slice(10, 14).arrayBuffer(), adapter.slice(20, 24).arrayBuffer()])

        expect(most).toBe(1)
        expect(order).toEqual([0, 10, 20])
    })
})

describe('changed()', () => {
    function statSource(stats: ImportSourceStat[], size = SIZE): ImportSource {
        let call = 0
        return { ...importSourceOfBytes('a.bin', new Uint8Array(size)), stat: async () => stats[Math.min(call++, stats.length - 1)] }
    }

    test('guard: the same size and time is not changed', async () => {
        const adapter = binFileOfSource(statSource([{ size: SIZE, modified: 5 }, { size: SIZE, modified: 5 }]))

        expect(await adapter.changed()).toBe(false)
    })

    test('reproducer: a different size is changed', async () => {
        const adapter = binFileOfSource(statSource([{ size: SIZE, modified: 5 }, { size: SIZE + 1, modified: 5 }]))

        expect(await adapter.changed()).toBe(true)
    })

    test('reproducer: a different modification time is changed', async () => {
        const adapter = binFileOfSource(statSource([{ size: SIZE, modified: 5 }, { size: SIZE, modified: 6 }]))

        expect(await adapter.changed()).toBe(true)
    })

    test('guard: a platform with no modification time is compared by size only', async () => {
        const adapter = binFileOfSource(statSource([{ size: SIZE, modified: null }, { size: SIZE, modified: 9 }]))

        expect(await adapter.changed()).toBe(false)
    })

    test('reproducer: a stat that fails is changed, not unchanged', async () => {
        const inner = importSourceOfBytes('a.bin', new Uint8Array(SIZE))
        let call = 0
        const source: ImportSource = {
            ...inner,
            stat: async () => {
                if (call++ > 0) {
                    throw new Error('scratch: the grant is gone')
                }
                return { size: SIZE, modified: 5 }
            },
        }
        vi.spyOn(console, 'error').mockImplementation(() => { })

        expect(await binFileOfSource(source).changed()).toBe(true)
    })
})
