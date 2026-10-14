import { describe, expect, test } from 'vitest'
import { COMMIT_KEY, FENCE_KEY, SWEEP_KEY } from 'src/ts/storage/store2/format/keys'
import {
    BULK_UNIT_THRESHOLD,
    REMOVE_BATCH_MAX,
    Store2CommitConflictError,
    Store2FenceConflictError,
    Store2OverwriteRefusedError,
    type CompareToken,
    type Store2Backend,
    type UnitWrite,
} from 'src/ts/storage/store2/backend'

/** One empty backend under test, and a way to plant an entry the backend itself never writes (the sweep key, sibling prefixes). */
export interface BackendFixture {
    backend: Store2Backend
    plant(key: string, bytes: Uint8Array): Promise<void>
}

export type BackendFixtureFactory = () => Promise<BackendFixture>

/**
 * How the backend compares: 'bytes' is a compare of the full stored bytes (the
 * memory and IndexedDB backends), 'revision' a compare of a revision the backend
 * reports with each read (Node). The byte-specific cases run only for 'bytes'.
 */
export interface BackendConformanceOptions {
    compare: 'bytes' | 'revision'
}

/** The token of an absent commit key, as the backend reads it now; a token is never built by hand. */
export async function absentCommit(backend: Store2Backend): Promise<CompareToken> {
    return (await backend.readCommit()).token
}

/** The token of an absent fence, as the backend reads it now. */
export async function absentFence(backend: Store2Backend): Promise<CompareToken> {
    return (await backend.readFence()).token
}

/** A token of given bytes. Only the byte-comparing backends accept one; used by the cases gated on compare: 'bytes'. */
export function tokenOf(bytes: Uint8Array | null): CompareToken {
    return { kind: 'bytes', bytes }
}

export function bytesOf(...values: number[]): Uint8Array {
    return Uint8Array.from(values)
}

/** A valid store2 unit key made from a number: 26 digits of the key alphabet. */
export function unitKey(n: number): string {
    return `store2/u-${n.toString(32).padStart(26, '0')}`
}

export function unit(n: number, ...values: number[]): UnitWrite {
    return { key: unitKey(n), bytes: values.length === 0 ? bytesOf(n % 256, 7) : bytesOf(...values) }
}

async function contents(backend: Store2Backend, keys: readonly string[]): Promise<(number[] | null)[]> {
    const read = await backend.readUnits(keys)
    return keys.map((key) => {
        const bytes = read.get(key) ?? null
        return bytes === null ? null : [...bytes]
    })
}

/**
 * The behaviour every store2 backend has: atomic compare-and-write of the commit
 * key and the fence, all-or-nothing ordinary commits, create-only units and
 * guarded batch removal. The memory, IndexedDB, Node and Tauri backends each run
 * this suite against their own fixture.
 */
export function runBackendConformance(name: string, makeFixture: BackendFixtureFactory, options: BackendConformanceOptions): void {
    const byteTokens = options.compare === 'bytes'

    describe(`store2 backend conformance: ${name}`, () => {
        describe('commit key', () => {
            test('an empty backend reads the commit key and the fence as absent', async () => {
                const { backend } = await makeFixture()
                expect((await backend.readCommit()).bytes).toBeNull()
                expect((await backend.readFence()).bytes).toBeNull()
            })

            test.runIf(byteTokens)('an absent read carries a null-bytes token and a present read the bytes', async () => {
                const { backend } = await makeFixture()
                expect((await backend.readCommit()).token).toEqual(tokenOf(null))
                await backend.casCommit(await absentCommit(backend), bytesOf(1, 2))
                expect((await backend.readCommit()).token).toEqual(tokenOf(bytesOf(1, 2)))
            })

            test('first life: an absent expectation creates, and its token reads back the bytes', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1, 2, 3))
                const read = await backend.readCommit()
                expect([...read.bytes!]).toEqual([1, 2, 3])
            })

            test('an absent expectation never overwrites an existing commit key', async () => {
                const { backend } = await makeFixture()
                const absent = await absentCommit(backend)
                await backend.casCommit(absent, bytesOf(1))
                const error = await backend.casCommit(absent, bytesOf(2)).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2CommitConflictError)
                expect([...(error as Store2CommitConflictError).current.bytes!]).toEqual([1])
                expect([...(await backend.readCommit()).bytes!]).toEqual([1])
            })

            test('replace succeeds on the read token and conflicts on a stale one', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const first = await backend.readCommit()
                await backend.casCommit(first.token, bytesOf(2))
                const error = await backend.casCommit(first.token, bytesOf(3)).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2CommitConflictError)
                expect([...(error as Store2CommitConflictError).current.bytes!]).toEqual([2])
                expect([...(await backend.readCommit()).bytes!]).toEqual([2])
            })

            test.runIf(byteTokens)('the compare is of the full bytes: equal length and equal head with one differing byte conflicts', async () => {
                const { backend } = await makeFixture()
                const stored = Uint8Array.from({ length: 64 }, (_, i) => i)
                await backend.casCommit(await absentCommit(backend), stored)
                const lookalike = new Uint8Array(stored)
                lookalike[63] ^= 1
                await expect(backend.casCommit(tokenOf(lookalike), bytesOf(9))).rejects.toBeInstanceOf(Store2CommitConflictError)
                const shorter = stored.slice(0, 32)
                await expect(backend.casCommit(tokenOf(shorter), bytesOf(9))).rejects.toBeInstanceOf(Store2CommitConflictError)
                expect([...(await backend.readCommit()).bytes!]).toEqual([...stored])
            })

            test.runIf(byteTokens)('an expectation of bytes against an absent key conflicts and creates nothing', async () => {
                const { backend } = await makeFixture()
                await expect(backend.casCommit(tokenOf(bytesOf(1)), bytesOf(2))).rejects.toBeInstanceOf(Store2CommitConflictError)
                expect((await backend.readCommit()).bytes).toBeNull()
            })

            test('the caller keeping or changing its buffers afterwards does not change what was stored', async () => {
                const { backend } = await makeFixture()
                const mine = bytesOf(5, 5, 5)
                await backend.casCommit(await absentCommit(backend), mine)
                mine[0] = 9
                const read = await backend.readCommit()
                expect([...read.bytes!]).toEqual([5, 5, 5])
                read.bytes![1] = 9
                expect([...(await backend.readCommit()).bytes!]).toEqual([5, 5, 5])
            })
        })

        describe('fence', () => {
            test('create, replace, and conflict with what is there now', async () => {
                const { backend } = await makeFixture()
                const absent = await absentFence(backend)
                await backend.casFence(absent, bytesOf(1))
                const error = await backend.casFence(absent, bytesOf(2)).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2FenceConflictError)
                expect([...(error as Store2FenceConflictError).current.bytes!]).toEqual([1])
                const read = await backend.readFence()
                await backend.casFence(read.token, bytesOf(3))
                await expect(backend.casFence(read.token, bytesOf(4))).rejects.toBeInstanceOf(Store2FenceConflictError)
                expect([...(await backend.readFence()).bytes!]).toEqual([3])
            })

            test('the fence and the commit key are separate keys', async () => {
                const { backend } = await makeFixture()
                await backend.casFence(await absentFence(backend), bytesOf(1))
                expect((await backend.readCommit()).bytes).toBeNull()
                await backend.casCommit(await absentCommit(backend), bytesOf(2))
                expect([...(await backend.readFence()).bytes!]).toEqual([1])
            })

            test('delete removes at the bytes read, and conflicts (keeping the fence) at any other bytes', async () => {
                const { backend } = await makeFixture()
                await backend.casFence(await absentFence(backend), bytesOf(1, 2))
                if (byteTokens) {
                    await expect(backend.casFence(tokenOf(bytesOf(1, 3)), null)).rejects.toBeInstanceOf(Store2FenceConflictError)
                    expect([...(await backend.readFence()).bytes!]).toEqual([1, 2])
                }
                await backend.casFence((await backend.readFence()).token, null)
                expect((await backend.readFence()).bytes).toBeNull()
            })

            test('delete expecting an absent fence is a no-op while absent and a conflict once one exists', async () => {
                const { backend } = await makeFixture()
                const absent = await absentFence(backend)
                await backend.casFence(absent, null)
                expect((await backend.readFence()).bytes).toBeNull()
                await backend.casFence(absent, bytesOf(1))
                await expect(backend.casFence(absent, null)).rejects.toBeInstanceOf(Store2FenceConflictError)
                expect([...(await backend.readFence()).bytes!]).toEqual([1])
            })

            test('a deleted fence can be created again from an absent expectation', async () => {
                const { backend } = await makeFixture()
                await backend.casFence(await absentFence(backend), bytesOf(1))
                await backend.casFence((await backend.readFence()).token, null)
                await backend.casFence(await absentFence(backend), bytesOf(2))
                expect([...(await backend.readFence()).bytes!]).toEqual([2])
            })
        })

        describe('commitOrdinary', () => {
            test('writes every unit and the new commit key', async () => {
                const { backend } = await makeFixture()
                const units = [unit(1), unit(2), unit(3)]
                await backend.commitOrdinary(await absentCommit(backend), units, bytesOf(9))
                expect(await contents(backend, units.map((u) => u.key))).toEqual(units.map((u) => [...u.bytes]))
                expect([...(await backend.readCommit()).bytes!]).toEqual([9])
            })

            test('a stale commit key conflicts, writes no unit and keeps the commit key', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const stale = await backend.readCommit()
                await backend.casCommit(stale.token, bytesOf(2))
                const units = [unit(1), unit(2)]
                const error = await backend.commitOrdinary(stale.token, units, bytesOf(3)).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2CommitConflictError)
                expect([...(error as Store2CommitConflictError).current.bytes!]).toEqual([2])
                expect(await contents(backend, units.map((u) => u.key))).toEqual([null, null])
                expect([...(await backend.readCommit()).bytes!]).toEqual([2])
            })

            test('an absent expectation against an existing commit key conflicts and writes no unit', async () => {
                const { backend } = await makeFixture()
                const absent = await absentCommit(backend)
                await backend.casCommit(absent, bytesOf(1))
                await expect(backend.commitOrdinary(absent, [unit(1)], bytesOf(2))).rejects.toBeInstanceOf(Store2CommitConflictError)
                expect(await contents(backend, [unitKey(1)])).toEqual([null])
            })

            test('a unit key that already exists fails the whole step: no unit, no commit key', async () => {
                const { backend } = await makeFixture()
                await backend.putUnit(unitKey(2), bytesOf(42))
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const base = await backend.readCommit()
                const error = await backend.commitOrdinary(base.token, [unit(1), unit(2), unit(3)], bytesOf(2)).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2OverwriteRefusedError)
                expect((error as Store2OverwriteRefusedError).key).toBe(unitKey(2))
                expect(await contents(backend, [unitKey(1), unitKey(2), unitKey(3)])).toEqual([null, [42], null])
                expect([...(await backend.readCommit()).bytes!]).toEqual([1])
            })

            test('a commit conflict is reported before an existing unit', async () => {
                const { backend } = await makeFixture()
                await backend.putUnit(unitKey(1), bytesOf(42))
                const absent = await absentCommit(backend)
                await backend.casCommit(absent, bytesOf(1))
                await expect(backend.commitOrdinary(absent, [unit(1)], bytesOf(2))).rejects.toBeInstanceOf(Store2CommitConflictError)
            })

            test('repeated commits chain on the token of the previous one', async () => {
                const { backend } = await makeFixture()
                await backend.commitOrdinary(await absentCommit(backend), [unit(1)], bytesOf(1))
                await backend.commitOrdinary((await backend.readCommit()).token, [unit(2)], bytesOf(2))
                expect(await contents(backend, [unitKey(1), unitKey(2)])).toEqual([[...unit(1).bytes], [...unit(2).bytes]])
                expect([...(await backend.readCommit()).bytes!]).toEqual([2])
            })

            test('a duplicate unit key or a key outside store2 is refused before anything is written', async () => {
                const { backend } = await makeFixture()
                const absent = await absentCommit(backend)
                await expect(backend.commitOrdinary(absent, [unit(1), unit(1)], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
                await expect(backend.commitOrdinary(absent, [{ key: 'assets/a', bytes: bytesOf(1) }], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
                await expect(backend.commitOrdinary(absent, [{ key: COMMIT_KEY, bytes: bytesOf(1) }], bytesOf(1))).rejects.toBeInstanceOf(RangeError)
                expect(await backend.listStore2()).toEqual([])
                expect((await backend.readCommit()).bytes).toBeNull()
            })

            test('more than the bulk threshold of units and one 4.48 MiB unit are each one ordinary step', async () => {
                const { backend } = await makeFixture()
                const many = Array.from({ length: BULK_UNIT_THRESHOLD + 1 }, (_, i) => unit(100 + i))
                await backend.commitOrdinary(await absentCommit(backend), many, bytesOf(1))
                expect((await backend.listStore2()).length).toBe(many.length)
                const big = { key: unitKey(999), bytes: new Uint8Array(Math.round(4.48 * 1024 * 1024)).fill(7) }
                await backend.commitOrdinary((await backend.readCommit()).token, [big], bytesOf(2))
                const stored = (await backend.readUnits([big.key])).get(big.key)!
                expect(stored.length).toBe(big.bytes.length)
                expect(stored[stored.length - 1]).toBe(7)
            })
        })

        describe('putUnit', () => {
            test('creates a unit and refuses to overwrite it', async () => {
                const { backend } = await makeFixture()
                await backend.putUnit(unitKey(1), bytesOf(1))
                await expect(backend.putUnit(unitKey(1), bytesOf(2))).rejects.toBeInstanceOf(Store2OverwriteRefusedError)
                expect(await contents(backend, [unitKey(1)])).toEqual([[1]])
            })

            test('a key outside store2 is refused', async () => {
                const { backend } = await makeFixture()
                await expect(backend.putUnit(FENCE_KEY, bytesOf(1))).rejects.toBeInstanceOf(RangeError)
                await expect(backend.putUnit('store2/', bytesOf(1))).rejects.toBeInstanceOf(RangeError)
            })
        })

        describe('readUnits', () => {
            test('reports absent keys as null and keeps every requested key', async () => {
                const { backend } = await makeFixture()
                await backend.putUnit(unitKey(1), bytesOf(1))
                await backend.putUnit(unitKey(3), bytesOf(3))
                const read = await backend.readUnits([unitKey(1), unitKey(2), unitKey(3)])
                expect([...read.keys()]).toEqual([unitKey(1), unitKey(2), unitKey(3)])
                expect(read.get(unitKey(2))).toBeNull()
                expect([...read.get(unitKey(3))!]).toEqual([3])
            })

            test('reads more keys than one batch holds, and an empty list', async () => {
                const { backend } = await makeFixture()
                const keys = Array.from({ length: 30 }, (_, i) => unitKey(i))
                for (const key of keys.filter((_, i) => i % 2 === 0)) {
                    await backend.putUnit(key, bytesOf(1))
                }
                const read = await backend.readUnits(keys)
                expect(keys.map((key) => read.get(key) !== null)).toEqual(keys.map((_, i) => i % 2 === 0))
                expect((await backend.readUnits([])).size).toBe(0)
            })
        })

        describe('removeBatch', () => {
            async function seeded(backend: Store2Backend, count: number): Promise<string[]> {
                const keys = Array.from({ length: count }, (_, i) => unitKey(i))
                for (const key of keys) {
                    await backend.putUnit(key, bytesOf(1))
                }
                return keys
            }

            test('deletes every key when the commit key and the absent fence match', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const keys = await seeded(backend, 5)
                await backend.removeBatch(keys.slice(0, 3), (await backend.readCommit()).token, await absentFence(backend))
                expect(await backend.listStore2()).toEqual(keys.slice(3))
            })

            test('deletes when a present fence still has the bytes that were read', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                await backend.casFence(await absentFence(backend), bytesOf(7, 7))
                const keys = await seeded(backend, 2)
                await backend.removeBatch(keys, (await backend.readCommit()).token, (await backend.readFence()).token)
                expect(await backend.listStore2()).toEqual([])
            })

            test('matches an absent commit key against an absent expectation', async () => {
                const { backend } = await makeFixture()
                const keys = await seeded(backend, 2)
                await backend.removeBatch(keys, await absentCommit(backend), await absentFence(backend))
                expect(await backend.listStore2()).toEqual([])
            })

            test('a changed commit key deletes nothing', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const keys = await seeded(backend, 4)
                const stale = await backend.readCommit()
                await backend.casCommit(stale.token, bytesOf(2))
                await expect(backend.removeBatch(keys, stale.token, await absentFence(backend))).rejects.toBeInstanceOf(Store2CommitConflictError)
                expect(await backend.listStore2()).toEqual(keys)
            })

            test('a fence that appeared deletes nothing', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const keys = await seeded(backend, 4)
                const commit = await backend.readCommit()
                const absent = await absentFence(backend)
                await backend.casFence(absent, bytesOf(1))
                const error = await backend.removeBatch(keys, commit.token, absent).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2FenceConflictError)
                expect([...(error as Store2FenceConflictError).current.bytes!]).toEqual([1])
                expect(await backend.listStore2()).toEqual(keys)
            })

            test('with no commit key, a fence that appeared deletes nothing', async () => {
                const { backend } = await makeFixture()
                const keys = await seeded(backend, 3)
                const noCommit = await absentCommit(backend)
                const noFence = await absentFence(backend)
                await backend.casFence(noFence, bytesOf(1))
                const error = await backend.removeBatch(keys, noCommit, noFence).catch((e: unknown) => e)
                expect(error).toBeInstanceOf(Store2FenceConflictError)
                expect(await backend.listStore2()).toEqual(keys)
            })

            test('a fence whose bytes changed, or that was discarded, deletes nothing', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                await backend.casFence(await absentFence(backend), bytesOf(1))
                const keys = await seeded(backend, 3)
                const commit = await backend.readCommit()
                const fence = await backend.readFence()
                await backend.casFence(fence.token, bytesOf(2))
                await expect(backend.removeBatch(keys, commit.token, fence.token)).rejects.toBeInstanceOf(Store2FenceConflictError)
                await backend.casFence((await backend.readFence()).token, null)
                await expect(backend.removeBatch(keys, commit.token, fence.token)).rejects.toBeInstanceOf(Store2FenceConflictError)
                expect(await backend.listStore2()).toEqual(keys)
            })

            test('a key with no entry is not an error, and a batch over the limit is refused', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const keys = await seeded(backend, 1)
                const token = (await backend.readCommit()).token
                const noFence = await absentFence(backend)
                await backend.removeBatch([...keys, unitKey(500)], token, noFence)
                expect(await backend.listStore2()).toEqual([])
                const tooMany = Array.from({ length: REMOVE_BATCH_MAX + 1 }, (_, i) => unitKey(i))
                await expect(backend.removeBatch(tooMany, token, noFence)).rejects.toBeInstanceOf(RangeError)
                const exactly = Array.from({ length: REMOVE_BATCH_MAX }, (_, i) => unitKey(i))
                await backend.removeBatch(exactly, token, noFence)
            })

            test('only unit keys can be removed, never the commit key or the fence', async () => {
                const { backend } = await makeFixture()
                await backend.casCommit(await absentCommit(backend), bytesOf(1))
                const token = (await backend.readCommit()).token
                const noFence = await absentFence(backend)
                await expect(backend.removeBatch([COMMIT_KEY], token, noFence)).rejects.toBeInstanceOf(RangeError)
                await expect(backend.removeBatch([FENCE_KEY], token, noFence)).rejects.toBeInstanceOf(RangeError)
                expect([...(await backend.readCommit()).bytes!]).toEqual([1])
            })
        })

        describe('listing', () => {
            test('lists only store2/ keys in ordinal order and never the three top-level keys or sibling prefixes', async () => {
                const { backend, plant } = await makeFixture()
                await backend.commitOrdinary(await absentCommit(backend), [unit(3), unit(1)], bytesOf(1))
                await backend.casFence(await absentFence(backend), bytesOf(1))
                await backend.putUnit(unitKey(2), bytesOf(1))
                for (const key of [SWEEP_KEY, 'store2', 'store20/x', 'store1/z', 'store2.', 'assets/a.png']) {
                    await plant(key, bytesOf(1))
                }
                expect(await backend.listStore2()).toEqual([unitKey(1), unitKey(2), unitKey(3)])
            })

            test('an empty backend lists nothing', async () => {
                const { backend } = await makeFixture()
                expect(await backend.listStore2()).toEqual([])
                expect(await backend.countPrefix('store2/')).toBe(0)
            })

            test('countPrefix matches the list for store2/ and for a narrower prefix', async () => {
                const { backend, plant } = await makeFixture()
                await backend.commitOrdinary(await absentCommit(backend), [unit(1), unit(2), unit(3)], bytesOf(1))
                await backend.casFence(await absentFence(backend), bytesOf(1))
                await plant(SWEEP_KEY, bytesOf(1))
                await plant('store20/x', bytesOf(1))
                await plant('store2/g-0000000000000000-s0000000000000000', bytesOf(1))
                const listed = await backend.listStore2()
                expect(await backend.countPrefix('store2/')).toBe(listed.length)
                expect(listed.length).toBe(4)
                expect(await backend.countPrefix('store2/u-')).toBe(3)
                expect(await backend.countPrefix('store2/g-')).toBe(1)
                expect(await backend.countPrefix('store2/zz')).toBe(0)
                expect(await backend.countPrefix('store2-')).toBe(3)
            })
        })
    })
}
