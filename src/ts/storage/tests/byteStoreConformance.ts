/**
 * The scenarios every `ByteStore` adapter must pass, run by one test file per
 * adapter through `describeByteStoreConformance`. These are conformance checks
 * of new code: they pin the contract in `src/ts/storage/store/contract.ts`, and
 * a pass against a fake backend is no evidence about the native backend.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import {
    StoreDeleteManyError,
    StoreInvalidConditionError,
    StoreInvalidKeyError,
    StoreUnsupportedConditionError,
    StoreVersionConflictError,
} from 'src/ts/storage/store/errors'

export interface ConformanceHarness {
    /** Describes the adapter in test titles. */
    name: string
    /** Whether the adapter enforces `ifVersion`; decides which half of the condition scenarios runs. */
    conditionalWrites: boolean
    /** Resets the backing store to empty and returns the store under test. Runs before every test. */
    create(): Promise<ByteStore>
    /** Puts an entry in the backing store directly, the way upstream wrote it. */
    plant(key: string, bytes: Uint8Array): Promise<void>
    /** Reads the backing store directly: the bytes under `key`, or `null` when absent. */
    peek(key: string): Promise<Uint8Array | null>
    /** How many calls the backing store has received since the harness was set up. */
    backendCalls(): number
    /** Keys that `read`, `has`, `delete` and `write` all refuse on this adapter. */
    invalidEverywhere: string[]
    /** Prefixes that `list` refuses. */
    invalidPrefixes: string[]
    /** Further keys that `write` refuses but `read`, `has` and `delete` accept. */
    writeOnlyInvalid: string[]
    /** Keys that are addressable but not creatable on this adapter, for planting. */
    oddKeys: string[]
    /** Makes removing `key` fail in the backing store, for adapters without conditions; returns the undo. */
    failDeleteOf?(key: string): () => void
}

/** Keys that fail the shared rule for creating a key; every adapter's `write` must refuse them. */
export const COMMON_UNCREATABLE_KEYS: readonly string[] = [
    '/a',
    'a/',
    'a//b',
    'a/./b',
    'a/../b',
    '.hidden',
    'a/.b',
    'a\\b',
    'a\u0000b',
    'a\nb',
    'a\uD800b',
    'a/risu-write-0123456789abcdef.tmp',
]

let uniqueCounter = 0

/** A key no test has used before, so a version scenario starts from a key the backend never saw. */
function uniqueKey(label: string): string {
    uniqueCounter++
    return `${label}/${Date.now().toString(36)}-${uniqueCounter}`
}

function bytesOf(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

function patternBytes(length: number, seed: number): Uint8Array {
    const bytes = new Uint8Array(length)
    let state = seed >>> 0
    for (let i = 0; i < length; i++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0
        bytes[i] = state >>> 24
    }
    return bytes
}

async function readBytes(store: ByteStore, key: string): Promise<number[] | null> {
    const { bytes } = await store.read(key)
    return bytes === null ? null : Array.from(bytes)
}

export function describeByteStoreConformance(harness: ConformanceHarness): void {
    describe(`${harness.name} conformance`, () => {
        let store: ByteStore

        beforeEach(async () => {
            store = await harness.create()
        })

        describe('S1 an absent key', () => {
            test('reads as null, is not held and is not listed', async () => {
                const result = await store.read('missing/key')
                expect(result.bytes).toBeNull()
                expect(await store.has('missing/key')).toBe(false)
                expect(await store.list('missing/')).not.toContain('missing/key')
            })
        })

        describe('S2 round trip', () => {
            test('one byte is returned as one byte', async () => {
                await store.write('rt/one', bytesOf(7), 'unconditional')
                expect(await readBytes(store, 'rt/one')).toEqual([7])
            })

            test('all 256 byte values come back in order', async () => {
                const all = Uint8Array.from({ length: 256 }, (_, index) => index)
                await store.write('rt/all', all, 'unconditional')
                expect(await readBytes(store, 'rt/all')).toEqual(Array.from(all))
            })

            test('a value of more than 8 MiB comes back byte for byte', { timeout: 60_000 }, async () => {
                const big = patternBytes(8 * 1024 * 1024 + 3, 42)
                await store.write('rt/big', big, 'unconditional')
                const { bytes } = await store.read('rt/big')
                expect(bytes?.byteLength).toBe(big.byteLength)
                expect(Buffer.compare(bytes as Uint8Array, big)).toBe(0)
            })

            test('read returns an array that owns exactly the value\'s bytes', async () => {
                await store.write('rt/own', bytesOf(1, 2, 3), 'unconditional')
                const { bytes } = await store.read('rt/own')
                expect(bytes?.byteOffset).toBe(0)
                expect(bytes?.buffer.byteLength).toBe(3)
            })
        })

        describe('S3 overwrite', () => {
            test('the second value replaces the first, also when it is shorter', async () => {
                await store.write('ow/k', bytesOf(1, 2, 3, 4), 'unconditional')
                await store.write('ow/k', bytesOf(9), 'unconditional')
                expect(await readBytes(store, 'ow/k')).toEqual([9])
            })
        })

        describe('S4 delete', () => {
            test('removes the value and is idempotent', async () => {
                await store.write('del/k', bytesOf(1), 'unconditional')
                await store.delete('del/k', 'unconditional')
                expect((await store.read('del/k')).bytes).toBeNull()
                expect(await store.has('del/k')).toBe(false)
                expect(await store.list('del/')).not.toContain('del/k')
                await store.delete('del/k', 'unconditional')
                expect(await store.has('del/k')).toBe(false)
            })

            test('deleting a key that never existed resolves', async () => {
                await expect(store.delete('del/never', 'unconditional')).resolves.toBeUndefined()
            })
        })

        describe('S5 listing', () => {
            const KEYS = ['a/b/1', 'a/b/2', 'a/b/c', 'a/c', 'a/bx', 'ab/d']

            beforeEach(async () => {
                for (const key of KEYS) {
                    await store.write(key, bytesOf(1), 'unconditional')
                }
            })

            test('a prefix ending in / returns exactly the keys beneath it, once each', async () => {
                expect((await store.list('a/')).sort()).toEqual(['a/b/1', 'a/b/2', 'a/b/c', 'a/bx', 'a/c'])
            })

            test('a prefix ending in the middle of a name matches names that continue it and excludes siblings', async () => {
                expect((await store.list('a/b')).sort()).toEqual(['a/b/1', 'a/b/2', 'a/b/c', 'a/bx'])
            })

            test('a sibling prefix is excluded', async () => {
                expect(await store.list('ab/')).toEqual(['ab/d'])
                expect((await store.list('a/')).includes('ab/d')).toBe(false)
            })

            test('a deleted key is gone from the listing', async () => {
                await store.delete('a/b/1', 'unconditional')
                expect((await store.list('a/b/')).sort()).toEqual(['a/b/2', 'a/b/c'])
            })

            test('a name that is only a parent of keys holds no value', async () => {
                expect(await store.has('a/b')).toBe(false)
                expect(await store.has('a')).toBe(false)
            })
        })

        describe('S6 empty values', () => {
            test('a zero-length value round-trips as a zero-length array, distinct from an absent key', async () => {
                await store.write('empty/k', new Uint8Array(0), 'unconditional')
                const { bytes } = await store.read('empty/k')
                expect(bytes).not.toBeNull()
                expect(bytes?.byteLength).toBe(0)
                expect(await store.has('empty/k')).toBe(true)
                expect(await store.list('empty/')).toEqual(['empty/k'])
                expect((await store.read('empty/other')).bytes).toBeNull()
            })

            test('a zero-length value replaces a longer one', async () => {
                await store.write('empty/k', bytesOf(1, 2, 3), 'unconditional')
                await store.write('empty/k', new Uint8Array(0), 'unconditional')
                expect((await store.read('empty/k')).bytes?.byteLength).toBe(0)
            })
        })

        describe('S7 invalid keys', () => {
            test('every key invalid everywhere is refused by every operation before any backend call', async () => {
                const before = harness.backendCalls()
                for (const key of harness.invalidEverywhere) {
                    await expect(store.read(key), `read ${JSON.stringify(key)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                    await expect(store.has(key), `has ${JSON.stringify(key)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                    await expect(store.delete(key, 'unconditional'), `delete ${JSON.stringify(key)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                    await expect(store.write(key, bytesOf(1), 'unconditional'), `write ${JSON.stringify(key)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                    await expect(
                        store.deleteMany([{ key, condition: 'unconditional' }]),
                        `deleteMany ${JSON.stringify(key)}`,
                    ).rejects.toBeInstanceOf(StoreInvalidKeyError)
                }
                for (const prefix of harness.invalidPrefixes) {
                    await expect(store.list(prefix), `list ${JSON.stringify(prefix)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                }
                expect(harness.backendCalls()).toBe(before)
            })

            test('every key that cannot be created is refused by write before any backend call', async () => {
                const before = harness.backendCalls()
                for (const key of [...COMMON_UNCREATABLE_KEYS, ...harness.writeOnlyInvalid]) {
                    await expect(store.write(key, bytesOf(1), 'unconditional'), `write ${JSON.stringify(key)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                }
                expect(harness.backendCalls()).toBe(before)
            })

            test('a key that cannot be created but can be addressed is accepted by read, has and delete', async () => {
                const addressable = [...COMMON_UNCREATABLE_KEYS, ...harness.writeOnlyInvalid]
                    .filter((key) => !harness.invalidEverywhere.includes(key))
                expect(addressable.length).toBeGreaterThan(0)
                for (const key of addressable) {
                    expect((await store.read(key)).bytes, `read ${JSON.stringify(key)}`).toBeNull()
                    expect(await store.has(key), `has ${JSON.stringify(key)}`).toBe(false)
                    await expect(store.delete(key, 'unconditional'), `delete ${JSON.stringify(key)}`).resolves.toBeUndefined()
                }
            })

            test('a deleteMany with one invalid key removes nothing', async () => {
                await store.write('inv/keep', bytesOf(1), 'unconditional')
                await expect(
                    store.deleteMany([
                        { key: 'inv/keep', condition: 'unconditional' },
                        { key: harness.invalidEverywhere[0], condition: 'unconditional' },
                    ]),
                ).rejects.toBeInstanceOf(StoreInvalidKeyError)
                expect(await store.has('inv/keep')).toBe(true)
            })

            test('a deleteMany that lists a key twice is refused and removes nothing', async () => {
                await store.write('inv/dup', bytesOf(1), 'unconditional')
                const before = harness.backendCalls()
                await expect(
                    store.deleteMany([
                        { key: 'inv/dup', condition: 'unconditional' },
                        { key: 'inv/dup', condition: 'unconditional' },
                    ]),
                ).rejects.toBeInstanceOf(StoreInvalidKeyError)
                expect(harness.backendCalls()).toBe(before)
                expect(await store.has('inv/dup')).toBe(true)
            })
        })

        describe('S8 conditions', () => {
            const INVALID_VERSIONS: Array<[string, number]> = [
                ['null', null as unknown as number],
                ['undefined', undefined as unknown as number],
                ['NaN', NaN],
                ['-1', -1],
                ['1.5', 1.5],
                ['Infinity', Infinity],
                ['a string', '3' as unknown as number],
            ]

            test('a malformed ifVersion is refused as invalid before any backend call, whatever the adapter', async () => {
                await store.write('cond/k', bytesOf(1), 'unconditional')
                const before = harness.backendCalls()
                for (const [label, version] of INVALID_VERSIONS) {
                    await expect(store.write('cond/k', bytesOf(2), { ifVersion: version }), `write ${label}`).rejects.toBeInstanceOf(StoreInvalidConditionError)
                    await expect(store.delete('cond/k', { ifVersion: version }), `delete ${label}`).rejects.toBeInstanceOf(StoreInvalidConditionError)
                    await expect(
                        store.deleteMany([{ key: 'cond/k', condition: { ifVersion: version } }]),
                        `deleteMany ${label}`,
                    ).rejects.toBeInstanceOf(StoreInvalidConditionError)
                }
                expect(harness.backendCalls()).toBe(before)
                expect(await readBytes(store, 'cond/k')).toEqual([1])
            })

            test('a missing condition is a type error and is refused at run time', async () => {
                const before = harness.backendCalls()
                // @ts-expect-error a condition is required
                await expect(store.write('cond/k', bytesOf(1))).rejects.toBeInstanceOf(StoreInvalidConditionError)
                // @ts-expect-error a condition is required
                await expect(store.delete('cond/k')).rejects.toBeInstanceOf(StoreInvalidConditionError)
                expect(harness.backendCalls()).toBe(before)
            })

            if (!harness.conditionalWrites) {
                test('reports that it cannot enforce conditions', () => {
                    expect(store.capabilities.conditionalWrites).toBe(false)
                })

                test('every ifVersion is rejected as unsupported and changes nothing', async () => {
                    await store.write('cond/k', bytesOf(1), 'unconditional')
                    await expect(store.write('cond/k', bytesOf(2), { ifVersion: 0 })).rejects.toBeInstanceOf(StoreUnsupportedConditionError)
                    await expect(store.write('cond/k', bytesOf(2), { ifVersion: 5 })).rejects.toBeInstanceOf(StoreUnsupportedConditionError)
                    await expect(store.delete('cond/k', { ifVersion: 5 })).rejects.toBeInstanceOf(StoreUnsupportedConditionError)
                    await expect(
                        store.deleteMany([{ key: 'cond/k', condition: { ifVersion: 5 } }]),
                        'deleteMany',
                    ).rejects.toBeInstanceOf(StoreUnsupportedConditionError)
                    expect(await readBytes(store, 'cond/k')).toEqual([1])
                })

                test('read and write report no version', async () => {
                    expect((await store.write('cond/k', bytesOf(1), 'unconditional')).version).toBeNull()
                    expect((await store.read('cond/k')).version).toBeNull()
                    expect((await store.read('cond/absent')).version).toBeNull()
                })
                return
            }

            test('reports that it enforces conditions', () => {
                expect(store.capabilities.conditionalWrites).toBe(true)
            })

            test('a matching version writes and returns a new version; a stale one conflicts and keeps the value', async () => {
                const key = uniqueKey('cond')
                const absent = await store.read(key)
                expect(absent.bytes).toBeNull()
                expect(absent.version).toBe(0)
                const created = await store.write(key, bytesOf(1), { ifVersion: absent.version })
                expect(created.version).toBeGreaterThan(absent.version)

                const stale = await store.write(key, bytesOf(2), { ifVersion: absent.version }).catch((error: unknown) => error)
                expect(stale).toBeInstanceOf(StoreVersionConflictError)
                expect((stale as StoreVersionConflictError).currentVersion).toBe(created.version)
                expect((stale as StoreVersionConflictError).key).toBe(key)
                expect(await readBytes(store, key)).toEqual([1])

                const replaced = await store.write(key, bytesOf(3), { ifVersion: created.version })
                expect(replaced.version).toBeGreaterThan(created.version)
                expect(await readBytes(store, key)).toEqual([3])
                expect((await store.read(key)).version).toBe(replaced.version)
            })

            test('delete honours its version and keeps the value on a conflict', async () => {
                const key = uniqueKey('cond')
                const created = await store.write(key, bytesOf(1), 'unconditional')
                await expect(store.delete(key, { ifVersion: created.version + 5 })).rejects.toBeInstanceOf(StoreVersionConflictError)
                expect(await readBytes(store, key)).toEqual([1])
                await store.delete(key, { ifVersion: (await store.read(key)).version })
                expect((await store.read(key)).bytes).toBeNull()
            })

            test('deleteMany reports a stale entry as a conflict and removes nothing of its request', async () => {
                const first = uniqueKey('cond')
                const second = uniqueKey('cond')
                const firstWritten = await store.write(first, bytesOf(1), 'unconditional')
                const secondWritten = await store.write(second, bytesOf(2), 'unconditional')
                const error = await store.deleteMany([
                    { key: first, condition: { ifVersion: firstWritten.version } },
                    { key: second, condition: { ifVersion: secondWritten.version + 7 } },
                ]).catch((caught: unknown) => caught)
                expect(error).toBeInstanceOf(StoreDeleteManyError)
                const report = (error as StoreDeleteManyError).report
                expect(report.find((entry) => entry.key === second)?.outcome).toBe('conflict')
                expect(report.find((entry) => entry.key === second)?.currentVersion).toBe(secondWritten.version)
                expect(report.find((entry) => entry.key === first)?.outcome).toBe('unchanged')
                expect(await readBytes(store, first)).toEqual([1])
                expect(await readBytes(store, second)).toEqual([2])

                await store.deleteMany([
                    { key: first, condition: { ifVersion: firstWritten.version } },
                    { key: second, condition: { ifVersion: secondWritten.version } },
                ])
                expect(await store.has(first)).toBe(false)
                expect(await store.has(second)).toBe(false)
            })

            test('a never-written key accepts ifVersion 0 once, then conflicts', async () => {
                const key = uniqueKey('cond')
                await store.write(key, bytesOf(1), { ifVersion: 0 })
                await expect(store.write(key, bytesOf(2), { ifVersion: 0 })).rejects.toBeInstanceOf(StoreVersionConflictError)
                expect(await readBytes(store, key)).toEqual([1])
            })

            test('a deleted key reads as absent with its tombstone version, which a create must present once', async () => {
                const key = uniqueKey('cond')
                const created = await store.write(key, bytesOf(1), 'unconditional')
                await store.delete(key, { ifVersion: created.version })
                const tombstone = await store.read(key)
                expect(tombstone.bytes).toBeNull()
                expect(tombstone.version).toBeGreaterThan(created.version)
                await expect(store.write(key, bytesOf(2), { ifVersion: 0 })).rejects.toBeInstanceOf(StoreVersionConflictError)
                await store.write(key, bytesOf(2), { ifVersion: tombstone.version })
                await expect(store.write(key, bytesOf(3), { ifVersion: tombstone.version })).rejects.toBeInstanceOf(StoreVersionConflictError)
                expect(await readBytes(store, key)).toEqual([2])
            })

            test('a file the server holds without a revision reads as present at version 0 and accepts ifVersion 0', async () => {
                const key = uniqueKey('cond')
                await harness.plant(key, bytesOf(5))
                const planted = await store.read(key)
                expect(Array.from(planted.bytes)).toEqual([5])
                expect(planted.version).toBe(0)
                await store.write(key, bytesOf(6), { ifVersion: 0 })
                expect(await readBytes(store, key)).toEqual([6])
            })
        })

        describe('S9 no aliasing', () => {
            test('changing the array passed to write after it resolved does not change the stored value', async () => {
                const input = bytesOf(1, 2, 3)
                await store.write('alias/k', input, 'unconditional')
                input.fill(9)
                expect(await readBytes(store, 'alias/k')).toEqual([1, 2, 3])
            })

            test('changing the array read returned does not change the stored value', async () => {
                await store.write('alias/k', bytesOf(1, 2, 3), 'unconditional')
                const { bytes } = await store.read('alias/k')
                bytes.fill(9)
                expect(await readBytes(store, 'alias/k')).toEqual([1, 2, 3])
            })

            test('a view over a larger buffer stores exactly the view\'s bytes', async () => {
                const larger = Uint8Array.from({ length: 64 }, (_, index) => index)
                await store.write('alias/view', larger.subarray(10, 15), 'unconditional')
                expect(await readBytes(store, 'alias/view')).toEqual([10, 11, 12, 13, 14])
            })
        })

        describe('S10 deleteMany', () => {
            test('removes several keys, including one that holds no value', async () => {
                await store.write('many/a', bytesOf(1), 'unconditional')
                await store.write('many/b', bytesOf(2), 'unconditional')
                await store.write('many/keep', bytesOf(3), 'unconditional')
                await store.deleteMany([
                    { key: 'many/a', condition: 'unconditional' },
                    { key: 'many/b', condition: 'unconditional' },
                    { key: 'many/never', condition: 'unconditional' },
                ])
                expect(await store.has('many/a')).toBe(false)
                expect(await store.has('many/b')).toBe(false)
                expect(await store.has('many/keep')).toBe(true)
            })

            test('an empty list resolves and changes nothing', async () => {
                await store.write('many/keep', bytesOf(3), 'unconditional')
                await expect(store.deleteMany([])).resolves.toBeUndefined()
                expect(await store.has('many/keep')).toBe(true)
            })

            if (harness.failDeleteOf !== undefined) {
                test('a key that fails to delete is reported as failed while the others are removed', async () => {
                    await store.write('many/a', bytesOf(1), 'unconditional')
                    await store.write('many/bad', bytesOf(2), 'unconditional')
                    await store.write('many/c', bytesOf(3), 'unconditional')
                    const undo = harness.failDeleteOf('many/bad')
                    let error: unknown
                    try {
                        error = await store.deleteMany([
                            { key: 'many/a', condition: 'unconditional' },
                            { key: 'many/bad', condition: 'unconditional' },
                            { key: 'many/c', condition: 'unconditional' },
                        ]).catch((caught: unknown) => caught)
                    } finally {
                        undo()
                    }
                    expect(error).toBeInstanceOf(StoreDeleteManyError)
                    const report = (error as StoreDeleteManyError).report
                    expect(report.map((entry) => [entry.key, entry.outcome])).toEqual([
                        ['many/a', 'removed'],
                        ['many/bad', 'failed'],
                        ['many/c', 'removed'],
                    ])
                    expect(await store.has('many/a')).toBe(false)
                    expect(await store.has('many/bad')).toBe(true)
                    expect(await store.has('many/c')).toBe(false)
                })
            }
        })

        describe('S11 keys that exist but cannot be created', () => {
            test('are listed, readable and deletable, and write to them is refused', async () => {
                expect(harness.oddKeys.length).toBeGreaterThan(0)
                for (const [index, key] of harness.oddKeys.entries()) {
                    await harness.plant(key, bytesOf(index + 1))
                }
                const listed = await store.list('assets/')
                for (const key of harness.oddKeys) {
                    expect(listed, `list ${JSON.stringify(key)}`).toContain(key)
                }
                for (const [index, key] of harness.oddKeys.entries()) {
                    expect(await readBytes(store, key), `read ${JSON.stringify(key)}`).toEqual([index + 1])
                    expect(await store.has(key), `has ${JSON.stringify(key)}`).toBe(true)
                    await expect(store.write(key, bytesOf(9), 'unconditional'), `write ${JSON.stringify(key)}`).rejects.toBeInstanceOf(StoreInvalidKeyError)
                    expect(await readBytes(store, key), `read after refused write ${JSON.stringify(key)}`).toEqual([index + 1])
                }
                for (const key of harness.oddKeys) {
                    await store.delete(key, 'unconditional')
                    expect(await store.has(key), `has after delete ${JSON.stringify(key)}`).toBe(false)
                    expect(await harness.peek(key), `backing store after delete ${JSON.stringify(key)}`).toBeNull()
                }
                expect(await store.list('assets/')).toEqual([])
            })
        })
    })
}
