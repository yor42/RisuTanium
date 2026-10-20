// @vitest-environment node
/**
 * The commit conditions of the old-data deletion (`store2/oldData/delete.ts`): a store that fails after some deletes, a
 * pointer replaced, a marker or a fence landing mid-run, a crash before the drop, a drop whose outcome is unknown, a drop
 * the platform did not flush, and a resume after the head is gone. Each run is judged by what was deleted, whether the
 * pointer survived and what the next run does.
 *
 * What is a stand-in: the page store is a memory byte store whose `deleteMany` is hooked; the protocol backend is the
 * memory backend wrapped so a compare-and-write of the commit key can lose its response or report `flushed: false` the way
 * Node and Tauri can. A pass says nothing about a real server's lost response or a real disk's flush.
 *
 * Labels. The engine does not exist on the red base (the W5a commit), so a file here fails at import there, which proves
 * nothing by itself; a "reproducer" is red under the mutant named in the hand-back that removes the rule it pins.
 */
import { beforeEach, describe, expect, test } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, Store2BackendFailureError, Store2UnknownOutcomeError, type Store2Backend } from 'src/ts/storage/store2/backend'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { createCommitter, type Committer } from 'src/ts/storage/store2/commit'
import {
    encodeUnit, newStagingId, newUnitKey, stagingPrefix, tailOfKey, UNIT_TYPE, type DeletionSnapshot, type KeyEnv, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import { runOldDataDeletion, type OldDataDeletionResult, type OldDataSession } from 'src/ts/storage/store2/oldData/delete'
import type { DeleteEntry } from 'src/ts/storage/store/contract'
import { plantFence } from './fenceFixtures'
import { createClock, parsedCommit, peerWrite, seedStore, testEnv, type TestClock } from './commitFixtures'

const HEAD = 'blocks/head'
const PRE = 'database/database.pre-blocks.1'
const COLD_A = 'coldstorage/00000000-0000-4000-8000-0000000000a1'
const blocksOf = (count: number): string[] => Array.from({ length: count }, (_, index) => `blocks/000000000009-cccccccc/f/${String(index).padStart(3, '0')}`)

type CasFault = null | 'lose-response' | 'lose-request' | 'lose-response-and-readback' | 'unflushed'

interface World {
    clock: TestClock
    env: KeyEnv
    raw: Store2Backend
    backend: Store2Backend
    committer: Committer
    store: MemoryByteStore
    session: OldDataSession
    /** Applied to the next compare-and-write of the commit key, then cleared. */
    casFault: CasFault
    /** Makes the next `readCommit` fail, then clears itself. */
    failNextRead: boolean
    calls: string[][]
    before: ((call: number) => Promise<void> | void) | null
    after: ((call: number) => Promise<void> | void) | null
    dropThrows: boolean
    warnings: string[]
}

async function newWorld(seed = 1): Promise<World> {
    const clock = createClock()
    const env = testEnv(clock, seed)
    const raw = createMemoryBackend()
    await seedStore(raw, env)
    const world: World = {
        clock, env, raw, backend: raw, committer: null as never, store: createMemoryByteStore(), session: null as never,
        casFault: null, failNextRead: false, calls: [], before: null, after: null, dropThrows: false, warnings: [],
    }
    world.backend = {
        ...raw,
        async readCommit() {
            if (world.failNextRead) {
                world.failNextRead = false
                throw new Store2BackendFailureError('Injected readCommit failure.')
            }
            return raw.readCommit()
        },
        async casCommit(expected, next) {
            const fault = world.casFault
            world.casFault = null
            switch (fault) {
                case 'lose-request':
                    throw new Store2UnknownOutcomeError('The request was lost.')
                case 'lose-response':
                    await raw.casCommit(expected, next)
                    throw new Store2UnknownOutcomeError('The response was lost.')
                case 'lose-response-and-readback':
                    await raw.casCommit(expected, next)
                    world.failNextRead = true
                    throw new Store2UnknownOutcomeError('The response was lost.')
                case 'unflushed':
                    await raw.casCommit(expected, next)
                    return { flushed: false }
                default:
                    return raw.casCommit(expected, next)
            }
        },
    }
    const real = createCommitter(world.backend, { owner: 'a'.repeat(26), env: testEnv(clock, seed + 1000) })
    world.committer = {
        ...real,
        async dropSnapshot(read, expected) {
            if (world.dropThrows) {
                world.dropThrows = false
                throw new Error('The page ended before the drop.')
            }
            return real.dropSnapshot(read, expected)
        },
    }
    world.session = {
        kind: 'node',
        backend: world.backend,
        committer: world.committer,
        openGate: (deleter) => openDeleterGate(world.backend, deleter, { idleReason: null }),
    }
    world.store.deleteMany = async (entries: readonly DeleteEntry[]) => {
        const keys = entries.map(entry => entry.key)
        world.calls.push(keys)
        await world.before?.(world.calls.length)
        for (const key of keys) {
            world.store.files.delete(key)
        }
        await world.after?.(world.calls.length)
    }
    return world
}

function putFiles(world: World, keys: readonly string[]): void {
    for (const key of keys) {
        world.store.files.set(key, new Uint8Array([1]))
    }
}

async function plant(world: World, keys: string[], kind: DeletionSnapshot['kind'] = 'fork-format-only', upstream: DeletionSnapshot['upstream'] = { main: true, backups: [] }): Promise<SnapshotPointer> {
    const body: DeletionSnapshot = { v: 1, kind, upstream, keys }
    const key = newUnitKey(world.env)
    const bytes = encodeUnit(UNIT_TYPE.deletionSnapshot, body)
    await world.raw.putUnit(key, bytes)
    const pointer: SnapshotPointer = { key, digest: unitDigest(bytes), count: keys.length }
    await peerWrite(world.raw, world.env, { snapshot: pointer })
    return pointer
}

function run(world: World): Promise<OldDataDeletionResult> {
    return runOldDataDeletion(world.session, {
        store: world.store,
        listBackupTimes: async () => [],
        yieldTurn: async () => {},
        warn: message => { world.warnings.push(message) },
    })
}

const fenceBytes = (world: World): Uint8Array => encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: world.clock.now, priorCommits: [], keys: [tailOfKey(newUnitKey(world.env))] })

/** 65 blocks and the head: calls of 20, 20, 20, 5 and the head alone (five calls). */
const BLOCKS = blocksOf(65)

let world: World

beforeEach(async () => {
    world = await newWorld()
    putFiles(world, [...BLOCKS, HEAD])
})

describe('a store that fails after some deletes', () => {
    test('reproducer: the run stops with the pointer kept and what was deleted gone; the next run, with the store healthy again, completes', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.before = (call) => {
            if (call === 3) {
                throw new Error('The connection dropped.')
            }
        }

        const first = await run(world)

        expect(first).toMatchObject({ status: 'stopped', reason: 'store-failed', deleted: 40 })
        expect(world.store.files.size).toBe(26)
        expect(world.store.files.has(HEAD)).toBe(true)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)

        world.before = null
        const second = await run(world)

        expect(second).toMatchObject({ status: 'completed' })
        expect(world.store.files.size).toBe(0)
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()
    })
})

describe('the commit key moves while a run is between batches', () => {
    test('reproducer: the pointer is replaced by a newer one: the run stops before its next batch and the newer pointer stays', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        const newer: SnapshotPointer = { key: newUnitKey(world.env), digest: 'f'.repeat(32), count: 9 }
        world.after = async (call) => {
            if (call === 1) {
                await peerWrite(world.raw, world.env, { snapshot: newer })
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'pointer-changed', deleted: 20 })
        expect(world.calls).toHaveLength(1)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(newer)
    })

    test('reproducer: the pointer is dropped by a peer: the run stops before its next batch', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                const peer = createCommitter(world.raw, { owner: 'b'.repeat(26), env: testEnv(world.clock, 5) })
                await peer.dropSnapshot(await peer.readCommit(), pointer)
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'pointer-changed' })
        expect(world.calls).toHaveLength(1)
    })

    test('reproducer: a peer\'s marker appears: the run stops before its next batch, the pointer stays', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                const prefix = stagingPrefix(newStagingId(world.env))
                await peerWrite(world.raw, world.env, { staging: { owner: 'b'.repeat(26), prefix, startedAt: world.clock.now, label: 'bulk' } })
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'marker', deleted: 20 })
        expect(world.calls).toHaveLength(1)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)
    })

    test('reproducer: a fence appears: the run stops before its next batch, the pointer stays', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                await plantFence(world.raw, fenceBytes(world))
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'fence', deleted: 20 })
        expect(world.calls).toHaveLength(1)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)
    })

    test('reproducer: the commit key turns unreadable: the run stops before its next batch', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                await world.raw.casCommit((await world.raw.readCommit()).token, Uint8Array.from([1, 2, 3]))
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'commit-unreadable' })
        expect(world.calls).toHaveLength(1)
        expect(pointer.count).toBe(66)
    })

    test('reproducer: the commit key stops naming a current manifest: the run stops before its next batch, the pointer stays', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                await peerWrite(world.raw, world.env, { current: null })
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'commit-unreadable', deleted: 20 })
        expect(world.calls).toHaveLength(1)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)
    })

    test('reproducer: a fence that turns unparsable mid-run stops the run before its next batch, the pointer stays', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                await plantFence(world.raw, Uint8Array.from([9, 9, 9]))
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'fence', deleted: 20 })
        expect(world.calls).toHaveLength(1)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)
    })

    test('reproducer: the same pointer key with another digest mid-run stops the run before its next batch', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                await peerWrite(world.raw, world.env, { snapshot: { ...pointer, digest: 'f'.repeat(32) } })
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'pointer-changed', deleted: 20 })
        expect(world.calls).toHaveLength(1)
    })

    test('characterization of the disclosed residual: a fence landing while a batch is in flight does not undo that batch, and no further batch starts', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 1) {
                await plantFence(world.raw, fenceBytes(world))
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'fence', deleted: 20 })
        expect(world.calls).toHaveLength(1)
        expect(world.store.files.size).toBe(46)
    })
})

describe('the end of a run', () => {
    test('reproducer: a crash after the last delete and before the drop keeps the pointer; the next run finds every key absent and drops it', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.dropThrows = true

        const first = await run(world)

        expect(first).toMatchObject({ status: 'stopped', reason: 'drop-failed', deleted: 66 })
        expect(world.store.files.size).toBe(0)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)

        const second = await run(world)

        expect(second).toMatchObject({ status: 'completed' })
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()
    })

    test('reproducer: a newer pointer lands after the last batch: the drop is refused as a mismatch, nothing is dropped, the newer pointer stays', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        const newer: SnapshotPointer = { key: newUnitKey(world.env), digest: 'e'.repeat(32), count: 4 }
        world.after = async (call) => {
            if (call === 5) {
                await peerWrite(world.raw, world.env, { snapshot: newer })
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'ended', reason: 'snapshot-mismatch', deleted: 66 })
        expect((await parsedCommit(world.raw)).snapshot).toEqual(newer)
    })

    test('guard: a marker lands after the last batch: the drop is refused as staging and the pointer stays for the next run', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        world.after = async (call) => {
            if (call === 5) {
                const prefix = stagingPrefix(newStagingId(world.env))
                await peerWrite(world.raw, world.env, { staging: { owner: 'b'.repeat(26), prefix, startedAt: world.clock.now, label: 'bulk' } })
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'ended', reason: 'staging' })
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)
    })

    test('reproducer: the drop\'s response is lost after it landed: one pointer drop in all, no second write', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        const seqBefore = (await parsedCommit(world.raw)).seq
        world.after = (call) => {
            if (call === 5) {
                world.casFault = 'lose-response'
            }
        }

        const result = await run(world)

        expect(result.status).toBe('completed')
        const after = await parsedCommit(world.raw)
        expect(after.snapshot).toBeUndefined()
        expect(after.seq).toBe(seqBefore + 1)
    })

    test('reproducer: the drop\'s request is lost before it landed: the retry on a fresh read drops it once', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        const seqBefore = (await parsedCommit(world.raw)).seq
        world.after = (call) => {
            if (call === 5) {
                world.casFault = 'lose-request'
            }
        }

        const result = await run(world)

        expect(result.status).toBe('completed')
        const after = await parsedCommit(world.raw)
        expect(after.snapshot).toBeUndefined()
        expect(after.seq).toBe(seqBefore + 1)
    })

    test('reproducer: the response is lost and the read-back fails too: the pass re-reads, finds the pointer gone, ends, and does not write again', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        const seqBefore = (await parsedCommit(world.raw)).seq
        world.after = (call) => {
            if (call === 5) {
                world.casFault = 'lose-response-and-readback'
            }
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'ended', reason: 'no-snapshot' })
        const after = await parsedCommit(world.raw)
        expect(after.snapshot).toBeUndefined()
        expect(after.seq).toBe(seqBefore + 1)
    })

    test('reproducer: a Tauri drop reported as not flushed completes harmlessly; if the write did not survive, the replay finds every key absent and drops again', async () => {
        const pointer = await plant(world, [HEAD, ...BLOCKS])
        const held = await world.raw.readCommit()
        world.after = (call) => {
            if (call === 5) {
                world.casFault = 'unflushed'
            }
        }

        const first = await run(world)

        expect(first).toMatchObject({ status: 'completed', flushed: false })
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()

        // The unflushed write is lost with the power: the key holds the pointer again.
        await world.raw.casCommit((await world.raw.readCommit()).token, held.bytes as Uint8Array)
        expect((await parsedCommit(world.raw)).snapshot).toEqual(pointer)
        world.after = null
        const callsBefore = world.calls.length

        const second = await run(world)

        expect(second).toMatchObject({ status: 'completed' })
        expect(world.calls.length).toBeGreaterThan(callsBefore)
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()
    })

    test('guard: three conflicts in a row end the run with the pointer kept; a later run drops it', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        const real = world.backend.casCommit.bind(world.backend)
        let lost = 0
        world.backend.casCommit = async (expected, next) => {
            if (lost < 3 && world.calls.length === 5) {
                lost++
                throw new Store2UnknownOutcomeError('The request was lost.')
            }
            return real(expected, next)
        }

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'drop-failed' })
        expect((await parsedCommit(world.raw)).snapshot).toBeDefined()

        const later = await run(world)

        expect(later).toMatchObject({ status: 'completed' })
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()
    })
})

describe('resuming', () => {
    test('reproducer: the head is already gone and no blocks key is left: the pointer alone is the trigger, the run completes and drops it', async () => {
        world.store.files.clear()
        await plant(world, [HEAD, ...BLOCKS])

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed' })
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()
    })

    test('reproducer: the head went after a run that abandoned a cold unit: the next run abandons it again and drops the pointer', async () => {
        world.store.files.clear()
        putFiles(world, [COLD_A])
        await plant(world, [COLD_A, HEAD, ...BLOCKS.slice(0, 3)], 'exclusion', { main: false, backups: [] })
        // The store now holds an upstream main file the plan never saw.
        world.store.files.set('database/database.bin', new Uint8Array([1]))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', abandoned: 1 })
        expect(world.store.files.has(COLD_A)).toBe(true)
        expect((await parsedCommit(world.raw)).snapshot).toBeUndefined()
    })

    test('guard: a second tab after the first finished finds no pointer and does nothing', async () => {
        await plant(world, [HEAD, ...BLOCKS])
        await run(world)
        const callsBefore = world.calls.length

        const second = await run(world)

        expect(second).toEqual({ status: 'no-pointer' })
        expect(world.calls).toHaveLength(callsBefore)
    })

    test('reproducer: two tabs running together delete idempotently and the pointer is dropped exactly once', async () => {
        await plant(world, [PRE, HEAD, ...BLOCKS])
        putFiles(world, [PRE])
        const seqBefore = (await parsedCommit(world.raw)).seq

        const [a, b] = await Promise.all([run(world), run(world)])

        expect([a.status, b.status].filter(status => status === 'completed')).toHaveLength(1)
        expect(world.store.files.size).toBe(0)
        const after = await parsedCommit(world.raw)
        expect(after.snapshot).toBeUndefined()
        expect(after.seq).toBe(seqBefore + 1)
    })
})
