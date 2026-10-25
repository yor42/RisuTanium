/**
 * `encodeRisuSaveParts` yields msgpack pieces whose concatenation must equal `packr.encode(tree)` byte for byte, because
 * a streamed export is only compatible with upstream's reader when it unpacks to exactly today's msgpack.
 *
 * There is no pre-fix reproducer: the encoder is new and its benefit is memory, which only a diagnostic measures. Every
 * test here is a guard whose red side is a named mutant of the splice rule (count by `Object.keys`, array header
 * boundary, skipping undefined keys, dropping the fallback, not releasing the packr buffer). The main equality is byte
 * equality of the concatenated pieces against the module's own whole encode (`encodeRisuSaveLegacy` without
 * compression); the decode round trip is a secondary check that compares the decoded tree with `toEqual`.
 *
 * Fixture strings of 64+ characters need the scoped `utf8Write` clamp described in `risuSave.msgpackRelease.test.ts`.
 * Platform boundaries are mocked as in the other risuSave tests.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import v8 from 'node:v8'
import vm from 'node:vm'
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

import { decodeRisuSave, encodeRisuSaveLegacy, encodeRisuSaveParts } from 'src/ts/storage/risuSave'

v8.setFlagsFromString('--expose-gc')
const gc = vm.runInNewContext('gc') as () => void

const MIB = 1048576
const HEADER_LENGTH = 11

// msgpackr 1.10.1 passes a length past the buffer's end to `utf8Write` for a string of 64+ characters, which the Node
// running the tests rejects (the browser build has no Buffer). Clamping to the room left changes no byte written.
const proto = Buffer.prototype as unknown as { utf8Write(this: Uint8Array, text: string, position: number, length: number): number }
const nativeUtf8Write = proto.utf8Write
beforeAll(() => {
    proto.utf8Write = function (text, position, length) {
        return nativeUtf8Write.call(this, text, position, Math.min(length, this.length - position))
    }
})
afterAll(() => {
    proto.utf8Write = nativeUtf8Write
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

/** Every piece is copied as it arrives, because a piece is only valid until the next one is requested. */
function piecesOf(tree: object): Uint8Array[] {
    const pieces: Uint8Array[] = []
    for (const piece of encodeRisuSaveParts(tree)) {
        pieces.push(piece.slice())
    }
    return pieces
}

/** The module's own whole encode of `tree`, without the save header. */
function wholeEncode(tree: object): Uint8Array {
    return encodeRisuSaveLegacy(tree, 'noCompression').subarray(HEADER_LENGTH).slice()
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array) {
    expect(actual.length).toBe(expected.length)
    expect(Buffer.from(actual).equals(Buffer.from(expected))).toBe(true)
}

function expectPartsEqualWhole(tree: object): Uint8Array[] {
    const pieces = piecesOf(tree)
    expectSameBytes(concat(pieces), wholeEncode(tree))
    return pieces
}

class Holder {
    a = 1
}
Holder.prototype.inherited = 2
interface Holder { inherited: number }

class WithToJSON {
    hidden = 'internal'
    toJSON() { return { shown: 'visible', n: 3 } }
}

const numbers = (length: number): number[] => Array.from({ length }, (_, i) => i % 100)

describe('encodeRisuSaveParts: concatenated pieces equal the whole encode', () => {
    // Guard: passes with the splice; red under the mutants named in each row's comment.
    test('guard: an empty root and a small mixed root', () => {
        expectPartsEqualWhole({})
        expectPartsEqualWhole({ name: 'card', n: 7, ratio: 0.5, flag: true, none: null, list: ['a', 'b'], nested: { deep: { deeper: [1, 2, { x: 1 }] } } })
    })

    // Mutant: array header boundary moved (`0xdc` at 65536); fixarray bound moved at 16.
    test.each([0, 15, 16, 65535, 65536])('guard: a top-level array value of length %i', (length) => {
        const pieces = expectPartsEqualWhole({ before: 1, list: numbers(length), after: 2 })
        // map header, key, value-less 'before' pair (2 pieces), key, array header, elements, key, value
        expect(pieces.length).toBe(1 + 2 + 1 + 1 + length + 2)
    })

    // Mutant: walk the elements with `for...in` (an enumerable property on the array becomes an extra element).
    test('guard: a top-level array with an extra enumerable property encodes its elements only', () => {
        const list = [1, 2, 3] as number[] & { extra?: string }
        list.extra = 'x'
        expectPartsEqualWhole({ before: 1, list, after: 2 })
    })

    // Mutant: skip undefined keys (the key count and the 0xc0 value are both part of the encoding).
    test('guard: undefined values are counted and written', () => {
        const pieces = expectPartsEqualWhole({ a: undefined, b: 1, c: undefined, list: [undefined, 1, undefined] })
        expect(pieces[0]).toEqual(Uint8Array.of(0xde, 0, 4))
    })

    test('guard: the export copy shape with `account: undefined`', () => {
        const db = { name: 'x', account: { id: 'a' }, characters: [{ chaId: 'c1' }, { chaId: 'c2' }] }
        expectPartsEqualWhole({ ...db, account: undefined })
    })

    test('guard: holes in an array encode as undefined, like the whole encode', () => {
        // eslint-disable-next-line no-sparse-arrays
        expectPartsEqualWhole({ list: [1, , 3, , ,] })
        expectPartsEqualWhole({ list: new Array(20) })
    })

    test('guard: Date, Map, Set, Uint8Array and nested values', () => {
        expectPartsEqualWhole({
            when: new Date(1700000000000),
            map: new Map<string, number>([['a', 1], ['b', 2]]),
            set: new Set([1, 2, 3]),
            bytes: Uint8Array.of(1, 2, 3, 250),
            list: [new Date(5), new Map([['k', [1, 2]]]), Uint8Array.of(9)],
            nested: { a: { b: { c: [new Uint8Array(40)] } } },
        })
    })

    test('guard: strings of 64 or more characters as keys and values', () => {
        expectPartsEqualWhole({
            ['k'.repeat(70)]: 'v'.repeat(300),
            list: ['w'.repeat(64), 'ü'.repeat(100), 'x'.repeat(63)],
        })
    })

    test('guard: pieces of exactly 65536 bytes and of more than 65536 bytes', () => {
        // A string of 65533 characters is a 3-byte header and 65533 bytes.
        const exact = expectPartsEqualWhole({ exact: 'a'.repeat(65533) })
        expect(exact.some((piece) => piece.length === 65536)).toBe(true)
        const over = expectPartsEqualWhole({ over: 'b'.repeat(70000), bytes: new Uint8Array(100000).fill(7) })
        expect(over.some((piece) => piece.length > 65536)).toBe(true)
    })

    // Mutant: count keys by `Object.keys` (the header says one key, the body holds two).
    test('guard: a plain object that inherits an enumerable key through its prototype counts it', () => {
        const tree = Object.create({ x: 1 }) as Record<string, number>
        tree.y = 2
        const pieces = expectPartsEqualWhole(tree)
        expect(pieces[0]).toEqual(Uint8Array.of(0xde, 0, 2))
        expect(pieces.length).toBeGreaterThan(1)
    })

    test('guard: 65535 keys are split, with a u16 count in the header', () => {
        const tree: Record<string, number> = {}
        for (let i = 0; i < 65535; i++) tree['k' + i] = i & 0x7f
        const pieces = expectPartsEqualWhole(tree)
        expect(pieces[0]).toEqual(Uint8Array.of(0xde, 0xff, 0xff))
        expect(pieces.length).toBe(1 + 2 * 65535)
    })
})

describe('encodeRisuSaveParts: a root msgpackr would not write as a plain-object map is one whole encode', () => {
    // Mutant: drop the fallback (the splice then writes a different map, or none for an Array or an empty Map).
    test.each([
        ['a class instance with an enumerable prototype key', () => Object.assign(new Holder(), { own: 3 })],
        ['a class instance with toJSON', () => new WithToJSON()],
        ['a Map root', () => new Map<string, number>([['a', 1], ['b', 2]])],
        ['an Array root', () => [1, 'two', { three: 3 }]],
        ['a null-prototype root', () => Object.assign(Object.create(null) as Record<string, number>, { a: 1, b: 2 })],
        ['a root whose own constructor key is not Object', () => ({ constructor: 'x', a: 1 })],
    ])('guard: %s', (_label, build) => {
        const tree = build()
        const pieces = expectPartsEqualWhole(tree)
        expect(pieces.length).toBe(1)
    })

    // Mutant: drop the key-limit fallback (a u16 count cannot hold 65536 keys).
    test('guard: a root of 65536 keys is one whole encode', () => {
        const tree: Record<string, number> = {}
        for (let i = 0; i < 65536; i++) tree['k' + i] = i & 0x7f
        const pieces = expectPartsEqualWhole(tree)
        expect(pieces.length).toBe(1)
        // msgpackr's plain-object path always writes map 16, so its count wraps at 65536; the whole encode is the reference.
        expect(pieces[0][0]).toBe(0xde)
    })
})

describe('encodeRisuSaveParts: the save round trip', () => {
    // Guard: the header plus a gzip of the concatenated pieces is a save the reader decodes, and equals today's bytes.
    test('guard: header plus compressSync of the pieces decodes and equals the legacy compressed encode', async () => {
        const tree = { name: 'card', chats: Array.from({ length: 20 }, (_, i) => ({ message: 'hello', index: i })), n: 7, list: numbers(40) }
        const header = Uint8Array.of(0, 82, 73, 83, 85, 83, 65, 86, 69, 0, 8)
        const bytes = concat([header, fflate.compressSync(concat(piecesOf(tree)), { mtime: 0 })])
        expect(await decodeRisuSave(bytes)).toEqual(tree)
        expectSameBytes(bytes, encodeRisuSaveLegacy(tree, 'compression'))
    })
})

describe('encodeRisuSaveParts: wrapper and buffer release', () => {
    /** Array-buffer memory still held after `run`'s result is dropped, relative to a baseline taken just before it. */
    async function retainedAfter(run: (input: Uint8Array) => void): Promise<number> {
        const input = new Uint8Array(32 * MIB).fill(1)
        const settle = async () => {
            for (let i = 0; i < 3; i++) {
                await new Promise((resolve) => setTimeout(resolve, 0))
                gc()
            }
        }
        // Start from a small packr buffer, so nothing an earlier test left behind is in the baseline: the whole encode
        // releases the buffer in its finally, which a leaking row before this one would otherwise carry into the baseline.
        encodeRisuSaveLegacy({}, 'noCompression')
        run(new Uint8Array(1))
        await settle()
        const before = process.memoryUsage().arrayBuffers
        run(input)
        await settle()
        // The input stays alive through the measurement, so only what the codec itself holds counts as retained.
        const after = process.memoryUsage().arrayBuffers
        expect(input.length).toBe(32 * MIB)
        return after - before
    }

    // Mutant: no `releasePackrBuffer()` in the generator's finally.
    test('parts-releases-packr-buffer: after the generator ends', async () => {
        const retained = await retainedAfter((input) => {
            let total = 0
            for (const piece of encodeRisuSaveParts({ big: input })) total += piece.length
            expect(total).toBeGreaterThan(input.length - 1)
        })
        expect(retained).toBeLessThan(8 * MIB)
    })

    // Mutant: release only at the normal end (after the loop, not in a finally).
    test('parts-releases-packr-buffer: after an early return()', async () => {
        const retained = await retainedAfter((input) => {
            const parts = encodeRisuSaveParts({ big: input, tail: 'after' })
            // Map header, key, then the large value: the packr has grown by the third piece.
            parts.next()
            parts.next()
            const big = parts.next()
            expect(big.done).toBe(false)
            parts.return()
        })
        expect(retained).toBeLessThan(8 * MIB)
    })

    // Mutant: release only at the normal end (after the loop, not in a finally).
    test('parts-releases-packr-buffer: after a throw from inside the iteration', async () => {
        class Throwing {
            toJSON(): never {
                throw new Error('boom')
            }
        }
        const retained = await retainedAfter((input) => {
            expect(() => {
                for (const piece of encodeRisuSaveParts({ big: input, bad: new Throwing() })) void piece
            }).toThrow('boom')
        })
        expect(retained).toBeLessThan(8 * MIB)
    })

    // Mutant: make the wrapper a generator function (a check placed in it would then run at the first `next()`).
    test('guard: the wrapper is a plain function that returns a generator', () => {
        const GeneratorFunction = Object.getPrototypeOf(function* () {}).constructor as new () => unknown
        expect(encodeRisuSaveParts instanceof GeneratorFunction).toBe(false)
        const parts = encodeRisuSaveParts({ a: 1 })
        expect(typeof parts.next).toBe('function')
        expect(parts.next().done).toBe(false)
    })
})
