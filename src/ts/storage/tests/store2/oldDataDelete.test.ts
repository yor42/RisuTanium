// @vitest-environment node
/**
 * The old-data deletion engine (`store2/oldData/delete.ts`): what it deletes from a snapshot, in which order, and every
 * case in which it deletes nothing and keeps the pointer. The commit-condition replay and crash cases are in
 * `oldDataDeleteReplay.test.ts`.
 *
 * What is a stand-in: the page store is a memory byte store whose `deleteMany` records its calls and can fail a key the
 * way the three stores do (IndexedDB and Tauri go on after a failed key and throw at the end, Node stops at the first
 * failed request); the protocol backend is the memory backend. Neither says anything about a real store.
 *
 * Labels. The engine does not exist on the red base (the W5a commit), so a test file here fails at import there, which
 * proves nothing by itself; a "reproducer" is red under the mutant named in the hand-back that removes the rule it pins,
 * a "guard" pins a rule that is also upheld by another layer.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createMemoryByteStore, type MemoryByteStore } from 'src/ts/process/files/tests/memoryByteStore'
import { createMemoryBackend, type Store2Backend } from 'src/ts/storage/store2/backend'
import { openDeleterGate } from 'src/ts/storage/store2/boot'
import { unitDigest } from 'src/ts/storage/store2/codec'
import { firstCommitKey } from 'src/ts/storage/store2/commitKey'
import { createCommitter, type Committer } from 'src/ts/storage/store2/commit'
import {
    encodeUnit, newStagingId, newUnitKey, stagingPrefix, tailOfKey, UNIT_TYPE, type DeletionSnapshot, type KeyEnv, type SnapshotPointer,
} from 'src/ts/storage/store2/format'
import {
    batchPaceOf, NODE_BATCH_PACE_MS, runOldDataDeletion, type OldDataDeletionResult, type OldDataSession,
} from 'src/ts/storage/store2/oldData/delete'
import { backupNamesOf } from 'src/ts/storage/store2/oldData/plan'
import type { DeleteEntry } from 'src/ts/storage/store/contract'
import { StoreDeleteManyError, StoreInvalidKeyError } from 'src/ts/storage/store/errors'
import { plantFence } from './fenceFixtures'
import { createClock, parsedCommit, peerWrite, seedStore, testEnv, treeRequest, type TestClock } from './commitFixtures'

const MAIN = 'database/database.bin'
const backupKey = (time: number) => `database/dbbackup-${time}.bin`
const COLD_A = 'coldstorage/00000000-0000-4000-8000-0000000000a1'
const COLD_B = 'coldstorage/00000000-0000-4000-8000-0000000000a2'
const COLD_KEPT = 'coldstorage/00000000-0000-4000-8000-0000000000a3'
const PRE = 'database/database.pre-blocks.1'
const HEAD = 'blocks/head'
const BLOCK_1 = 'blocks/000000000001-aaaaaaaa/root'
const BLOCK_2 = 'blocks/000000000001-aaaaaaaa/f/config'
const BLOCK_3 = 'blocks/000000000002-bbbbbbbb/root'

/** Keys of other data and of the new format that no snapshot may ever delete (the upstream files are planted by the tests that need them). */
const PROTECTED = ['assets/x', 'inlays/x', 'remotes/x', 'store2-commit']

interface StoreFaults {
    /** Keys whose removal fails. */
    failKeys: Set<string>
    /** Keys the store refuses before any I/O. */
    invalidKeys: Set<string>
    /** `continue`: IndexedDB and Tauri, every key is tried and the call throws at the end. `stop`: Node, the call stops at the first failed key. */
    mode: 'continue' | 'stop'
    before: ((call: number, keys: string[]) => Promise<void> | void) | null
    after: ((call: number, keys: string[]) => Promise<void> | void) | null
}

interface World {
    clock: TestClock
    env: KeyEnv
    backend: Store2Backend
    committer: Committer
    store: MemoryByteStore
    session: OldDataSession
    faults: StoreFaults
    /** The keys of every `deleteMany` call, in order. */
    calls: string[][]
    warnings: string[]
    idleReason: string | null
    backupListings: number
    kind: OldDataSession['kind']
}

function instrument(world: World): void {
    const { store, faults } = world
    store.deleteMany = async (entries: readonly DeleteEntry[]) => {
        const keys = entries.map(entry => entry.key)
        world.calls.push(keys)
        const call = world.calls.length
        await faults.before?.(call, keys)
        for (const key of keys) {
            if (faults.invalidKeys.has(key)) {
                throw new StoreInvalidKeyError(key, 'the store cannot address this key')
            }
        }
        const report = []
        let failed = false
        for (const key of keys) {
            if (failed && faults.mode === 'stop') {
                report.push({ key, outcome: 'unchanged' as const })
            } else if (faults.failKeys.has(key)) {
                failed = true
                report.push({ key, outcome: 'failed' as const, error: new Error('injected') })
            } else {
                store.files.delete(key)
                report.push({ key, outcome: 'removed' as const })
            }
        }
        await faults.after?.(call, keys)
        if (report.some(entry => entry.outcome !== 'removed')) {
            throw new StoreDeleteManyError(report)
        }
    }
}

async function newWorld(kind: OldDataSession['kind'] = 'node', seed = 1): Promise<World> {
    const clock = createClock()
    const env = testEnv(clock, seed)
    const backend = createMemoryBackend()
    await seedStore(backend, env)
    const committer = createCommitter(backend, { owner: 'a'.repeat(26), env: testEnv(clock, seed + 1000) })
    const world: World = {
        clock, env, backend, committer, store: createMemoryByteStore(), faults: { failKeys: new Set(), invalidKeys: new Set(), mode: 'continue', before: null, after: null },
        session: null as never, calls: [], warnings: [], idleReason: null, backupListings: 0, kind,
    }
    world.session = {
        kind,
        backend,
        committer,
        openGate: (deleter) => openDeleterGate(backend, deleter, { idleReason: world.idleReason }),
    }
    instrument(world)
    return world
}

function putFiles(world: World, keys: readonly string[]): void {
    for (const key of keys) {
        world.store.files.set(key, new Uint8Array([1]))
    }
}

function bodyOf(kind: DeletionSnapshot['kind'], keys: string[], upstream: DeletionSnapshot['upstream'] = { main: false, backups: [] }): DeletionSnapshot {
    return { v: 1, kind, upstream, keys }
}

/** Writes the snapshot unit and points the commit key at it, as the installer does. Returns the pointer. */
async function plant(world: World, body: DeletionSnapshot, tweak: { bytes?: Uint8Array, digest?: string, count?: number, skipUnit?: boolean } = {}): Promise<SnapshotPointer> {
    const key = newUnitKey(world.env)
    const bytes = tweak.bytes ?? encodeUnit(UNIT_TYPE.deletionSnapshot, body)
    if (tweak.skipUnit !== true) {
        await world.backend.putUnit(key, bytes)
    }
    const pointer: SnapshotPointer = { key, digest: tweak.digest ?? unitDigest(bytes), count: tweak.count ?? body.keys.length }
    await peerWrite(world.backend, world.env, { snapshot: pointer })
    return pointer
}

function run(world: World, overrides: Partial<Parameters<typeof runOldDataDeletion>[1]> = {}): Promise<OldDataDeletionResult> {
    return runOldDataDeletion(world.session, {
        store: world.store,
        listBackupTimes: async () => {
            world.backupListings++
            return [...world.store.files.keys()]
                .map(key => /^database\/dbbackup-(\d+)\.bin$/.exec(key))
                .filter((match): match is RegExpExecArray => match !== null)
                .map(match => Number(match[1]))
                .sort((a, b) => b - a)
        },
        yieldTurn: async () => {},
        warn: message => { world.warnings.push(message) },
        ...overrides,
    })
}

const flat = (world: World): string[] => world.calls.flat()

/** The numbered keys `blocks/000000000009-cccccccc/f/<n>`, a run of them long enough to need several batches. */
const manyBlocks = (count: number): string[] => Array.from({ length: count }, (_, index) => `blocks/000000000009-cccccccc/f/${String(index).padStart(3, '0')}`)

const fenceBytes = (world: World): Uint8Array => encodeUnit(UNIT_TYPE.fenceRecord, { v: 1, at: world.clock.now, priorCommits: [], keys: [tailOfKey(newUnitKey(world.env))] })

let world: World

beforeEach(async () => {
    world = await newWorld()
})

describe('a snapshot is deleted in order and the pointer is dropped', () => {
    test('reproducer: fork-only plan: exactly its keys, the phases in four separate sequences of calls, the head alone and last, then the pointer is dropped and the protected keys remain', async () => {
        putFiles(world, [COLD_A, COLD_B, PRE, BLOCK_1, BLOCK_2, BLOCK_3, HEAD, ...PROTECTED])
        // The stored order is deliberately wrong: the pass orders by phase itself.
        await plant(world, bodyOf('fork-only', [HEAD, BLOCK_1, PRE, COLD_A, BLOCK_2, COLD_B, BLOCK_3]))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 7, abandoned: 0 })
        expect(world.calls).toEqual([[COLD_A, COLD_B], [PRE], [BLOCK_1, BLOCK_2, BLOCK_3], [HEAD]])
        expect([...world.store.files.keys()].sort()).toEqual([...PROTECTED].sort())
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
        expect(world.warnings).toEqual([])
    })

    test('reproducer: exclusion plan: only the unreferenced cold units go, the unit an upstream file references stays, and the upstream files stay', async () => {
        putFiles(world, [COLD_A, COLD_KEPT, BLOCK_1, HEAD, MAIN, backupKey(2), backupKey(1)])
        await plant(world, bodyOf('exclusion', [COLD_A, BLOCK_1, HEAD], { main: true, backups: backupNamesOf([2, 1]) }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 3, abandoned: 0 })
        expect([...world.store.files.keys()].sort()).toEqual([COLD_KEPT, MAIN, backupKey(1), backupKey(2)].sort())
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
    })

    test('reproducer: fork-format-only plan: blocks and the pre-blocks file go, a cold unit stays, the pointer is dropped', async () => {
        putFiles(world, [COLD_A, PRE, BLOCK_1, HEAD, MAIN])
        await plant(world, bodyOf('fork-format-only', [PRE, BLOCK_1, HEAD], { main: true, backups: [] }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 3 })
        expect([...world.store.files.keys()].sort()).toEqual([COLD_A, MAIN].sort())
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
    })

    test('reproducer: a key the store does not hold counts as removed: a replayed snapshot completes', async () => {
        await plant(world, bodyOf('fork-format-only', [PRE, BLOCK_1, HEAD], { main: true, backups: [] }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 3 })
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
    })

    test('reproducer: a long list goes in batches of 20 on Node and Tauri, each batch inside one phase, and the head is alone in the last call', async () => {
        const blocks = manyBlocks(45)
        putFiles(world, [...blocks, HEAD])
        await plant(world, bodyOf('fork-format-only', [HEAD, ...blocks], { main: true, backups: [] }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 46 })
        expect(world.calls.map(call => call.length)).toEqual([20, 20, 5, 1])
        expect(world.calls[3]).toEqual([HEAD])
        expect(world.store.files.size).toBe(0)
    })

    test('reproducer: an IndexedDB page deletes in batches of 100', async () => {
        const indexed = await newWorld('indexeddb')
        const blocks = manyBlocks(150)
        putFiles(indexed, [...blocks, HEAD])
        await plant(indexed, bodyOf('fork-format-only', [HEAD, ...blocks], { main: true, backups: [] }))

        const result = await run(indexed)

        expect(result).toMatchObject({ status: 'completed', deleted: 151 })
        expect(indexed.calls.map(call => call.length)).toEqual([100, 50, 1])
    })

    test('reproducer: a peer\'s ordinary commit between two batches does not stop the run, and the drop keeps what the peer wrote', async () => {
        const blocks = manyBlocks(45)
        putFiles(world, [...blocks, HEAD])
        await plant(world, bodyOf('fork-format-only', [HEAD, ...blocks], { main: true, backups: [] }))
        const peer = createCommitter(world.backend, { owner: 'b'.repeat(26), env: testEnv(world.clock, 77) })
        let peerCommitted = false
        world.faults.before = async (call) => {
            if (call === 2) {
                world.clock.advance(1000)
                const done = await peer.commit(await peer.readCommit(), treeRequest(0, { tag: 'peer' }))
                peerCommitted = done.status === 'committed'
            }
        }
        const currentBefore = (await parsedCommit(world.backend)).current

        const result = await run(world)

        expect(peerCommitted).toBe(true)
        expect(result).toMatchObject({ status: 'completed', deleted: 46 })
        const after = await parsedCommit(world.backend)
        expect(after.current?.key).not.toBe(currentBefore?.key)
        expect(after.snapshot).toBeUndefined()
    })
})

describe('pacing between the removal requests', () => {
    afterEach(() => {
        vi.useRealTimers()
    })

    test('reproducer: the pace hook runs before every request after the first, across the phases, and not before the first', async () => {
        const blocks = manyBlocks(45)
        putFiles(world, [...blocks, HEAD])
        await plant(world, bodyOf('fork-format-only', [HEAD, ...blocks], { main: true, backups: [] }))
        const events: string[] = []
        world.faults.before = () => { events.push('delete') }

        const result = await run(world, { pace: async () => { events.push('pace') } })

        expect(result).toMatchObject({ status: 'completed', deleted: 46 })
        expect(events).toEqual(['delete', 'pace', 'delete', 'pace', 'delete', 'pace', 'delete'])
    })

    test('guard: without a pace hook the run asks for nothing between requests (today\'s behaviour)', async () => {
        const blocks = manyBlocks(45)
        putFiles(world, [...blocks, HEAD])
        await plant(world, bodyOf('fork-format-only', [HEAD, ...blocks], { main: true, backups: [] }))

        // Fake timers: a hidden timer-based default pace would hold the later calls back.
        vi.useFakeTimers()
        const running = run(world)
        await vi.advanceTimersByTimeAsync(0)

        expect(world.calls).toHaveLength(4)
        expect(await running).toMatchObject({ status: 'completed', deleted: 46 })
    })

    test('reproducer: a Node run with the Node pace waits the floor between requests (fake timers)', async () => {
        vi.useFakeTimers()
        const blocks = manyBlocks(45)
        putFiles(world, [...blocks, HEAD])
        await plant(world, bodyOf('fork-format-only', [HEAD, ...blocks], { main: true, backups: [] }))

        const running = run(world, { pace: batchPaceOf('node') })
        await vi.advanceTimersByTimeAsync(0)
        expect(world.calls).toHaveLength(1)

        await vi.advanceTimersByTimeAsync(NODE_BATCH_PACE_MS - 1)
        expect(world.calls).toHaveLength(1)
        await vi.advanceTimersByTimeAsync(1)
        expect(world.calls).toHaveLength(2)

        await vi.advanceTimersByTimeAsync(NODE_BATCH_PACE_MS * 2)
        expect(await running).toMatchObject({ status: 'completed', deleted: 46 })
        expect(world.calls).toHaveLength(4)
    })
})

describe('a snapshot that cannot be used deletes nothing and keeps the pointer', () => {
    async function expectKept(result: OldDataDeletionResult, reason: string, pointer: SnapshotPointer): Promise<void> {
        expect(result).toEqual({ status: 'kept', reason })
        expect(world.calls).toEqual([])
        expect(world.store.files.size).toBeGreaterThan(0)
        expect((await parsedCommit(world.backend)).snapshot).toEqual(pointer)
        expect(world.warnings).toHaveLength(1)
    }

    beforeEach(() => {
        putFiles(world, [COLD_A, PRE, BLOCK_1, HEAD, MAIN])
    })

    test('guard: the unit is absent', async () => {
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A, PRE, BLOCK_1, HEAD]), { skipUnit: true })
        await expectKept(await run(world), 'absent', pointer)
    })

    test('reproducer: the unit\'s digest is not the pointer\'s', async () => {
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A, PRE, BLOCK_1, HEAD]), { digest: '0'.repeat(32) })
        await expectKept(await run(world), 'digest-mismatch', pointer)
    })

    test('guard: the unit is another type, with a matching digest', async () => {
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A]), { bytes: encodeUnit(UNIT_TYPE.preset, { v: 1 }), count: 1 })
        await expectKept(await run(world), 'not-a-snapshot', pointer)
    })

    test('guard: the unit\'s body is damaged, with a matching digest', async () => {
        const bytes = encodeUnit(UNIT_TYPE.deletionSnapshot, bodyOf('fork-only', [COLD_A, PRE, BLOCK_1, HEAD]))
        const damaged = bytes.slice()
        damaged[20] ^= 0xff
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A, PRE, BLOCK_1, HEAD]), { bytes: damaged })
        await expectKept(await run(world), 'not-a-snapshot', pointer)
    })

    test('reproducer: the pointer counts more keys than the unit lists', async () => {
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A, PRE, BLOCK_1, HEAD]), { count: 5 })
        await expectKept(await run(world), 'count-mismatch', pointer)
    })

    test('guard: a key listed twice (the decoder is a seam, the pass checks it too)', async () => {
        const body = bodyOf('fork-only', [BLOCK_1, BLOCK_1])
        const pointer = await plant(world, body)
        await expectKept(await run(world, { decodeForTests: () => body }), 'duplicate-key', pointer)
    })

    test.each([
        ['the upstream main file', MAIN],
        ['a numbered backup', backupKey(1)],
        ['an asset', 'assets/x'],
        ['an inlay', 'inlays/x'],
        ['a remote block', 'remotes/x'],
        ['the store2 commit key', 'store2-commit'],
        ['a store2 unit', 'store2/u-abcdefghijklmnopqrstuvwxyz'],
        ['a traversal out of blocks/', 'blocks/../assets/x'],
        ['a traversal that stays under blocks/', 'blocks/a/../b'],
        ['a backslash spelling', 'blocks\\x'],
    ])('reproducer: %s in the list: the pass checks the allowlist itself, whatever the decoder accepts, and deletes nothing', async (_name, outside) => {
        putFiles(world, [outside])
        const body = bodyOf('fork-only', [COLD_A, BLOCK_1, outside, HEAD])
        const pointer = await plant(world, body)

        await expectKept(await run(world, { decodeForTests: () => body }), 'outside-allowlist', pointer)

        expect(world.store.files.has(outside)).toBe(true)
    })

    test.each([
        ['the upstream main file', MAIN],
        ['an asset', 'assets/x'],
        ['the store2 commit key', 'store2-commit'],
        ['a traversal', 'blocks/../assets/x'],
    ])('guard: %s in the unit is refused by the format parser before the pass sees a list', async (_name, outside) => {
        putFiles(world, [outside])
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A, BLOCK_1, outside, HEAD]))
        await expectKept(await run(world), 'not-a-snapshot', pointer)
        expect(world.store.files.has(outside)).toBe(true)
    })
})

describe('a gate refusal deletes nothing and keeps the pointer', () => {
    let pointer: SnapshotPointer

    beforeEach(async () => {
        putFiles(world, [COLD_A, BLOCK_1, HEAD])
        pointer = await plant(world, bodyOf('fork-only', [COLD_A, BLOCK_1, HEAD]))
    })

    async function expectUntouched(result: OldDataDeletionResult, reason: string): Promise<void> {
        expect(result).toEqual({ status: 'gate-refused', reason })
        expect(world.calls).toEqual([])
        expect(world.store.files.size).toBe(3)
        expect((await parsedCommit(world.backend)).snapshot).toEqual(pointer)
    }

    test('guard: a fence stands', async () => {
        await plantFence(world.backend, fenceBytes(world))
        await expectUntouched(await run(world), 'fenced')
    })

    test('guard: a fence that cannot be read', async () => {
        await plantFence(world.backend, Uint8Array.from([9, 9, 9]))
        await expectUntouched(await run(world), 'fence-unparsable')
    })

    test('guard: a marker of any owner stands', async () => {
        const prefix = stagingPrefix(newStagingId(world.env))
        await peerWrite(world.backend, world.env, { staging: { owner: 'b'.repeat(26), prefix, startedAt: world.clock.now, label: 'bulk' } })
        await expectUntouched(await run(world), 'staging')
    })

    test('guard: the deleters are idle', async () => {
        world.idleReason = 'The commit key could not be flushed.'
        await expectUntouched(await run(world), 'idle')
    })

    async function expectUntouchedWithoutPointer(result: OldDataDeletionResult, reason: string): Promise<void> {
        expect(result).toEqual({ status: 'gate-refused', reason })
        expect(world.calls).toEqual([])
        expect(world.store.files.size).toBe(3)
    }

    test('guard: the commit key is damaged', async () => {
        await world.backend.casCommit((await world.backend.readCommit()).token, Uint8Array.from([1, 2, 3]))
        const result = await run(world)
        expect(result).toEqual({ status: 'gate-refused', reason: 'commit-unparsable' })
        expect(world.calls).toEqual([])
        expect(world.store.files.size).toBe(3)
    })

    test('guard: the commit key names no current manifest', async () => {
        const bare = firstCommitKey({ current: null, staging: null, manifests: [] }, world.env)
        await world.backend.casCommit((await world.backend.readCommit()).token, encodeUnit(UNIT_TYPE.commit, bare))
        await expectUntouchedWithoutPointer(await run(world), 'no-current')
    })

    test('guard: the commit key is absent', async () => {
        const empty = await newWorld()
        empty.session = { ...empty.session, backend: createMemoryBackend(), openGate: (deleter) => openDeleterGate(createMemoryBackend(), deleter, { idleReason: null }) }
        putFiles(empty, [COLD_A, BLOCK_1, HEAD])
        const result = await run(empty)
        expect(result).toEqual({ status: 'gate-refused', reason: 'commit-absent' })
        expect(empty.calls).toEqual([])
        expect(empty.store.files.size).toBe(3)
    })

    test('guard: no pointer on the commit key is nothing to do', async () => {
        const fresh = await newWorld()
        putFiles(fresh, [COLD_A, BLOCK_1, HEAD])
        const result = await run(fresh)
        expect(result).toEqual({ status: 'no-pointer' })
        expect(fresh.calls).toEqual([])
        expect(fresh.store.files.size).toBe(3)
    })
})

describe('the upstream files are observed again before the cold units go', () => {
    const COLD_PLAN = (): DeletionSnapshot => bodyOf('exclusion', [COLD_A, COLD_B, BLOCK_1, HEAD], { main: true, backups: backupNamesOf([2, 1]) })

    beforeEach(() => {
        putFiles(world, [COLD_A, COLD_B, COLD_KEPT, BLOCK_1, HEAD, MAIN, backupKey(2), backupKey(1)])
    })

    test('reproducer: unchanged upstream files, listed in another order: the cold units go (the comparison is order-free)', async () => {
        await plant(world, bodyOf('exclusion', [COLD_A, COLD_B, BLOCK_1, HEAD], { main: true, backups: [backupKey(2), backupKey(1)] }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 4, abandoned: 0 })
        expect(world.store.files.has(COLD_A)).toBe(false)
    })

    test('reproducer: a numbered backup appears after planning: no cold unit goes, the blocks go, the pointer is dropped', async () => {
        world.store.files.set(backupKey(3), new Uint8Array([1]))
        await plant(world, COLD_PLAN())

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 2, abandoned: 2 })
        expect(world.store.files.has(COLD_A)).toBe(true)
        expect(world.store.files.has(COLD_B)).toBe(true)
        expect(world.store.files.has(BLOCK_1)).toBe(false)
        expect(world.store.files.has(HEAD)).toBe(false)
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
    })

    test('reproducer: a numbered backup is gone after planning: no cold unit goes either', async () => {
        world.store.files.delete(backupKey(1))
        await plant(world, COLD_PLAN())

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 2, abandoned: 2 })
        expect(world.store.files.has(COLD_A)).toBe(true)
    })

    test('reproducer: the main file appears after planning (a fork-only plan): no cold unit goes, the blocks go, the pointer is dropped', async () => {
        world.store.files.delete(MAIN)
        world.store.files.delete(backupKey(2))
        world.store.files.delete(backupKey(1))
        await plant(world, bodyOf('fork-only', [COLD_A, COLD_B, BLOCK_1, HEAD], { main: false, backups: [] }))
        world.store.files.set(MAIN, new Uint8Array([1]))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 2, abandoned: 2 })
        expect(world.store.files.has(COLD_A)).toBe(true)
        expect(world.store.files.has(BLOCK_1)).toBe(false)
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
    })

    test('reproducer: a probe that cannot be answered counts as a difference: no cold unit goes', async () => {
        await plant(world, COLD_PLAN())

        const result = await run(world, { listBackupTimes: async () => { throw new Error('the listing failed') } })

        expect(result).toMatchObject({ status: 'completed', deleted: 2, abandoned: 2 })
        expect(world.store.files.has(COLD_A)).toBe(true)
    })

    test('guard: a plan that lists no cold unit never looks at the upstream files: the recorded record is not consulted', async () => {
        // The record claims no main file and no backup, the store holds both: a plan without cold keys deletes its blocks all the same.
        await plant(world, bodyOf('fork-format-only', [BLOCK_1, HEAD], { main: false, backups: [] }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 2, abandoned: 0 })
        expect(world.backupListings).toBe(0)
    })

    test('guard: a fork-format-only unit that lists a cold key abandons it: the pass never deletes a cold unit for that kind', async () => {
        await plant(world, bodyOf('fork-format-only', [COLD_A, BLOCK_1, HEAD], { main: true, backups: backupNamesOf([2, 1]) }))

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', deleted: 2, abandoned: 1 })
        expect(world.store.files.has(COLD_A)).toBe(true)
    })
})

describe('a failed phase ends the run before the next phase', () => {
    test.each([
        ['IndexedDB and Tauri (every key is tried, the call throws at the end)', 'continue' as const],
        ['Node (the call stops at the failed key)', 'stop' as const],
    ])('reproducer: %s: one cold unit fails inside a batch and no blocks key is deleted in that run, the pointer is kept', async (_name, mode) => {
        putFiles(world, [COLD_A, COLD_B, PRE, BLOCK_1, BLOCK_2, HEAD])
        const pointer = await plant(world, bodyOf('fork-only', [COLD_A, COLD_B, PRE, BLOCK_1, BLOCK_2, HEAD]))
        world.faults.failKeys.add(COLD_A)
        world.faults.mode = mode

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'store-failed' })
        expect(flat(world).filter(key => key.startsWith('blocks/'))).toEqual([])
        expect(world.calls).toHaveLength(1)
        for (const key of [PRE, BLOCK_1, BLOCK_2, HEAD]) {
            expect(world.store.files.has(key), key).toBe(true)
        }
        expect((await parsedCommit(world.backend)).snapshot).toEqual(pointer)
    })

    test('reproducer: the head is never in a call with other keys: a failing non-head block keeps the head, the pointer is kept', async () => {
        putFiles(world, [BLOCK_1, BLOCK_2, HEAD])
        const pointer = await plant(world, bodyOf('fork-format-only', [BLOCK_1, BLOCK_2, HEAD], { main: true, backups: [] }))
        world.faults.failKeys.add(BLOCK_1)

        const result = await run(world)

        expect(result).toMatchObject({ status: 'stopped', reason: 'store-failed' })
        expect(world.store.files.has(HEAD)).toBe(true)
        expect((await parsedCommit(world.backend)).snapshot).toEqual(pointer)
    })
})

describe('a key the store cannot address', () => {
    test('reproducer: it is reported once and left, the rest is deleted, and the run completes instead of retrying it forever', async () => {
        const blocks = manyBlocks(5)
        putFiles(world, [...blocks, HEAD])
        await plant(world, bodyOf('fork-format-only', [...blocks, HEAD], { main: true, backups: [] }))
        world.faults.invalidKeys.add(blocks[2])

        const result = await run(world)

        expect(result).toMatchObject({ status: 'completed', abandoned: 1 })
        expect([...world.store.files.keys()]).toEqual([blocks[2]])
        expect(world.warnings).toHaveLength(1)
        expect(world.warnings[0]).toContain(blocks[2])
        expect((await parsedCommit(world.backend)).snapshot).toBeUndefined()
        // The refused call, the same call without the key, then the head.
        expect(world.calls).toHaveLength(3)
    })
})
