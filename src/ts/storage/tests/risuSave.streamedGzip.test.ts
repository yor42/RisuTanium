/**
 * `encodeRisuSaveStreamed` and the gzip sink under it turn the parts encoder's msgpack into the compressed
 * `database.risudat` data of an export: an 11-byte header piece, then one gzip member held as compressed blocks. The
 * inflated bytes must equal today's msgpack, because upstream's reader inflates the entry with one `decompressSync`.
 *
 * There is no pre-fix reproducer: the benefit is memory, which only a diagnostic measures. Most tests here are guards
 * whose red side is a named scratch mutant of the sink (drop the final push, leave the header out of `length`, push
 * whole pieces, emit the block still being filled, no size check in `push`, hand out the shared header constant). The
 * tests on reuse and on finish are plain guards with no red side.
 * Compressed bytes may differ from `encodeRisuSaveLegacy(..., 'compression')`; the compared bytes are the inflated ones.
 * `node:zlib` is a second gzip implementation; it reads concatenated members, so only the fflate equality and the ISIZE
 * check prove there is one member.
 */
import { describe, expect, test, vi, afterEach } from 'vitest'
import { gunzipSync } from 'node:zlib'
import * as fflate from 'fflate'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => {}),
            removeItem: vi.fn(async () => {}),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
        removeItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { createRisuSaveGzipSink, encodeRisuSaveLegacy, encodeRisuSaveParts, encodeRisuSaveStreamed } from 'src/ts/storage/risuSave'

const MIB = 1048576
const HEADER = [0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8]
const HEADER_LENGTH = HEADER.length

afterEach(() => {
    vi.restoreAllMocks()
})

function concat(pieces: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(pieces.reduce((sum, piece) => sum + piece.length, 0))
    let at = 0
    for (const piece of pieces) {
        out.set(piece, at)
        at += piece.length
    }
    return out
}

/** Deterministic bytes that do not compress, so a few MiB of them make several MiB of compressed output. */
function noise(length: number, seed: number): Uint8Array {
    const out = new Uint8Array(length)
    let state = seed >>> 0
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        out[i] = state >>> 24
    }
    return out
}

/** The module's own whole encode of `tree`, without the save header: today's msgpack. */
function wholeEncode(tree: object): Uint8Array {
    return encodeRisuSaveLegacy(tree, 'noCompression').subarray(HEADER_LENGTH).slice()
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array) {
    expect(actual.length).toBe(expected.length)
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
}

const smallTree = () => ({
    name: 'card',
    n: 7,
    characters: [{ chaId: 'a', blob: noise(3000, 1) }, { chaId: 'b', blob: noise(2000, 2) }],
    nested: { deep: { deeper: [1, 2, { x: 1 }] } },
    nothing: undefined,
})

const largeTree = () => ({
    before: 1,
    characters: [noise(1500000, 11), noise(1500000, 12), noise(1000000, 13)],
    after: 'end',
})

describe('encodeRisuSaveStreamed: one gzip member that inflates to today\'s msgpack', () => {
    // Mutants: drop the final push (the member is cut short, no trailer); header piece left out.
    test('guard: header piece, one member equal to the whole encode under fflate and node:zlib', () => {
        const tree = smallTree()
        const expected = wholeEncode(tree)
        const { pieces } = encodeRisuSaveStreamed(tree)

        expect(Array.from(pieces[0])).toEqual(HEADER)
        const data = concat(pieces)
        const body = data.subarray(HEADER_LENGTH)
        expectSameBytes(fflate.decompressSync(body), expected)
        expectSameBytes(new Uint8Array(gunzipSync(body)), expected)
    })

    // Mutant: drop the final push (the trailer carrying the size is never written).
    test('guard: the gzip ISIZE field equals the msgpack length mod 2^32', () => {
        const tree = smallTree()
        const expected = wholeEncode(tree)
        const data = concat(encodeRisuSaveStreamed(tree).pieces)
        const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
        expect(view.getUint32(data.length - 4, true)).toBe(expected.length % 2 ** 32)
        // mtime 0 keeps the gzip header free of the wall clock.
        expect(Array.from(data.subarray(HEADER_LENGTH + 4, HEADER_LENGTH + 8))).toEqual([0, 0, 0, 0])
    })

    // Mutant: header piece not counted in `length`.
    test('guard: length equals the sum of the piece lengths', () => {
        const result = encodeRisuSaveStreamed(largeTree())
        expect(result.length).toBe(result.pieces.reduce((sum, piece) => sum + piece.length, 0))
        expect(result.length).toBe(concat(result.pieces).length)
    })

    test('guard: an empty root is a complete member', () => {
        const { pieces, length } = encodeRisuSaveStreamed({})
        const data = concat(pieces)
        expect(data.length).toBe(length)
        expectSameBytes(fflate.decompressSync(data.subarray(HEADER_LENGTH)), wholeEncode({}))
    })

    // Mutant: pieces[0] is the module's shared header constant (a caller that changes it would change every later export).
    test('guard: pieces[0] is a fresh copy of the header, not shared between results', () => {
        const first = encodeRisuSaveStreamed({ a: 1 })
        first.pieces[0].fill(0xff)
        const second = encodeRisuSaveStreamed({ a: 1 })
        expect(Array.from(second.pieces[0])).toEqual(HEADER)
        const sink = createRisuSaveGzipSink()
        expect(sink.finish().pieces[0]).not.toBe(second.pieces[0])
    })

    // The parts encoder yields one piece above fflate's 98304-byte input buffer; the sink must still inflate to the same bytes.
    test('guard: a single piece above 98304 bytes', () => {
        const tree = { first: 1, big: noise(300000, 5), last: 2 }
        const sizes = [...encodeRisuSaveParts(tree)].map((piece) => piece.length)
        expect(Math.max(...sizes)).toBeGreaterThan(98304)
        const { pieces } = encodeRisuSaveStreamed(tree)
        expectSameBytes(fflate.decompressSync(concat(pieces).subarray(HEADER_LENGTH)), wholeEncode(tree))
    })

    // Mutant: push whole pieces, no slicing (fflate's input buffer then grows to the piece and stays until the final push).
    test('guard: every chunk handed to fflate is at most 65536 bytes', () => {
        const push = vi.spyOn(fflate.Gzip.prototype, 'push')
        const tree = { first: 1, big: noise(300000, 5), last: 2 }
        encodeRisuSaveStreamed(tree)
        const sizes = push.mock.calls.map((call) => call[0].length)
        expect(sizes.length).toBeGreaterThan(300000 / 65536)
        expect(Math.max(...sizes)).toBeLessThanOrEqual(65536)
        expect(push.mock.calls.at(-1)?.[1]).toBe(true)
    })
})

describe('the gzip sink: compressed output blocks', () => {
    // Mutant: emit the block being filled itself (every block is then the same, later-overwritten buffer).
    test('guard: blocks are at least 1 MiB except the last, and no two pieces share a buffer', () => {
        const tree = largeTree()
        const { pieces } = encodeRisuSaveStreamed(tree)
        const blocks = pieces.slice(1)
        expect(blocks.length).toBeGreaterThanOrEqual(3)
        for (const block of blocks.slice(0, -1)) {
            expect(block.length).toBeGreaterThanOrEqual(MIB)
        }
        expect(blocks.at(-1)!.length).toBeGreaterThan(0)
        expect(new Set(pieces.map((piece) => piece.buffer)).size).toBe(pieces.length)
        expectSameBytes(fflate.decompressSync(concat(pieces).subarray(HEADER_LENGTH)), wholeEncode(tree))
    })

    // Plain guard, no red-side mutant: a later encode must leave the bytes of an earlier result unchanged.
    test('plain guard: a result is unchanged by a later encode', () => {
        const first = encodeRisuSaveStreamed(largeTree())
        const before = concat(first.pieces)
        encodeRisuSaveStreamed({ other: noise(2000000, 99) })
        expectSameBytes(concat(first.pieces), before)
    })

    // Plain guard, no red-side mutant: a sink refuses pushes and a second finish once it has finished.
    test('plain guard: a sink cannot be pushed to or finished again after finish', () => {
        const sink = createRisuSaveGzipSink()
        sink.push(Uint8Array.of(1, 2, 3))
        sink.finish()
        expect(() => sink.push(Uint8Array.of(1))).toThrow(/database\.risudat/)
        expect(() => sink.finish()).toThrow(/database\.risudat/)
    })
})

describe('the gzip sink: size limit', () => {
    // Mutant: no size check in `push`. The limit is injected; the production default is 2^32.
    test('sink-oversize-throws: a total at the limit throws an error naming database.risudat and the limit', () => {
        const push = vi.spyOn(fflate.Gzip.prototype, 'push')
        const sink = createRisuSaveGzipSink(100)
        sink.push(new Uint8Array(60))
        sink.push(new Uint8Array(39))
        const callsBefore = push.mock.calls.length
        expect(() => sink.push(new Uint8Array(1))).toThrowError(/database\.risudat.*100/)
        // The failing piece is refused before any of it reaches the compressor.
        expect(push.mock.calls.length).toBe(callsBefore)
    })

    test('sink-oversize-throws: one piece past the limit throws before any compression', () => {
        const push = vi.spyOn(fflate.Gzip.prototype, 'push')
        const sink = createRisuSaveGzipSink(100)
        expect(() => sink.push(new Uint8Array(500))).toThrowError(/database\.risudat/)
        expect(push).not.toHaveBeenCalled()
    })
})
