// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { HEAD_KEY, characterBlockKey, fixedBlockKey, keptKey, rootKey, stubsKey } from 'src/ts/storage/blockKeys'
import { BlockOwnerStateError, inspectGenerations, retireGeneration, type LoadResult, type ReplaceResult } from 'src/ts/storage/blockStore'
import { createMutexHeadSwap, createNodeHeadSwap, encodeHead, parseHead, type HeadRead, type HeadSwap } from 'src/ts/storage/headSwap'
import { StoreVersionConflictError } from 'src/ts/storage/store/errors'
import {
    InjectedFault,
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    seedStore,
    textOf,
    withBlock,
    withCharacter,
    withoutBlock,
    type FakeStore,
} from './blockStoreHarness'

const OLD = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }], packed: ['stubby'] })
const NEW = withCharacter(withoutBlock(OLD, 'bob'), 'carol')

function headOf(store: FakeStore) {
    const bytes = store.peek(HEAD_KEY)
    return bytes === null ? null : parseHead(bytes)
}

function expectWon(result: ReplaceResult): Extract<ReplaceResult, { kind: 'won' }> {
    expect(result.kind).toBe('won')
    return result as Extract<ReplaceResult, { kind: 'won' }>
}

function directoryOf(result: LoadResult): readonly string[] {
    if (result.kind !== 'loaded') {
        throw new Error(`not loaded: ${result.kind}`)
    }
    return result.loaded.directory
}

describe.each([{ versioned: true }, { versioned: false }])('replaceWholeState with versioned=$versioned', ({ versioned }) => {
    test('a replace over a live state switches to the new generation and deletes the old one, root first', async () => {
        const store = createFakeStore({ versioned })
        const oldGeneration = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const start = store.ops.length
        const won = expectWon(await owner.replaceWholeState(NEW))
        expect(headOf(store)).toMatchObject({ status: 'ok', record: { current: won.generation } })
        expect(won.previous).toEqual({ state: 'deleted', generation: oldGeneration })
        expect(store.keys(`blocks/${oldGeneration}/`)).toEqual([])
        const deletes = store.ops.slice(start).filter((op) => op.kind === 'delete' || op.kind === 'deleteMany')
        expect(deletes[0]).toMatchObject({ kind: 'delete', key: rootKey(oldGeneration) })
        const loaded = await makeOwner(store).owner.load()
        expect(directoryOf(loaded)).toContain('carol')
        expect(directoryOf(loaded)).not.toContain('bob')
    })

    test('the owner is live on the new generation and saves into it at once', async () => {
        const store = createFakeStore({ versioned })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const won = expectWon(await owner.replaceWholeState(NEW))
        const result = await owner.commitSave(withBlock(NEW, 'carol', characterBlock('carol', '{"chaId":"carol","v":2}')))
        expect(result).toMatchObject({ kind: 'committed', wrote: true, seq: 1 })
        expect(textOf(store.peek(characterBlockKey(won.generation, 'carol')))).toContain('"v":2')
    })

    test('a replace on an empty store seeds it, and a second seed attempt loses against the first', async () => {
        const store = createFakeStore({ versioned })
        const a = makeOwner(store)
        const b = makeOwner(store)
        expectWon(await a.owner.replaceWholeState(OLD, { requireAbsentHead: true }))
        const second = await b.owner.replaceWholeState(OLD, { requireAbsentHead: true })
        expect(second).toMatchObject({ kind: 'lost', reason: 'head-exists' })
    })

    test('a conversion records its fingerprint in the head, and a later replace carries it forward', async () => {
        const store = createFakeStore({ versioned })
        const { owner } = makeOwner(store)
        const won = expectWon(await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: 'b1:100:2:aaaaaaaa:bbbbbbbb' }))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: won.generation, convertedFrom: 'b1:100:2:aaaaaaaa:bbbbbbbb', convertedAt: expect.any(Number) } })
        const loaded = await makeOwner(store).owner.load()
        expect(loaded.kind === 'loaded' && loaded.loaded.convertedFrom).toBe('b1:100:2:aaaaaaaa:bbbbbbbb')
        const later = expectWon(await owner.replaceWholeState(NEW))
        expect(headOf(store)).toMatchObject({ status: 'ok' })
        expect(parseHead(store.peek(HEAD_KEY) as Uint8Array)).toEqual({
            status: 'ok',
            record: { current: later.generation, convertedFrom: 'b1:100:2:aaaaaaaa:bbbbbbbb', convertedAt: expect.any(Number) },
        })
    })

    test('the whole state is written before the head moves, root last (invariant R)', async () => {
        const store = createFakeStore({ versioned })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const start = store.ops.length
        const won = expectWon(await owner.replaceWholeState(NEW))
        const writes = store.ops.slice(start).filter((op) => op.kind === 'write').map((op) => op.key)
        const headAt = writes.indexOf(HEAD_KEY)
        const rootAt = writes.indexOf(rootKey(won.generation))
        expect(rootAt).toBeGreaterThan(-1)
        expect(headAt).toBeGreaterThan(rootAt)
        expect(writes.filter((key) => key.startsWith(`blocks/${won.generation}/`)).pop()).toBe(rootKey(won.generation))
        expect(writes.at(-1)).toBe(HEAD_KEY)
    })

    test('a generation removed after it was written is caught by the root read-back, and the head does not move', async () => {
        const store = createFakeStore({ versioned })
        const oldGeneration = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        // Another device's clean-up removes the new root right after it is written.
        let removed = false
        const original = store.write
        store.write = async (key, bytes, condition) => {
            const result = await original(key, bytes, condition)
            if (!removed && key.endsWith('/root') && !key.includes(oldGeneration)) {
                removed = true
                store.unplant(key)
            }
            return result
        }
        const result = await owner.replaceWholeState(NEW)
        expect(result).toMatchObject({ kind: 'lost', reason: 'generation-damaged' })
        expect(headOf(store)).toMatchObject({ status: 'ok', record: { current: oldGeneration } })
    })
})

describe('the size pre-flight (invariant 9, scenario 10)', () => {
    test('on Node a value over the limit refuses the replace before anything is written', async () => {
        const store = createFakeStore({ versioned: true })
        const { owner } = makeOwner(store, { nodeBodyLimit: 500 })
        const big = withBlock(OLD, 'alice', characterBlock('alice', JSON.stringify({ chaId: 'alice', filler: 'x'.repeat(800) })))
        const result = await owner.replaceWholeState(big, { requireAbsentHead: true })
        expect(result).toMatchObject({ kind: 'refused', blockName: 'alice', limit: 500 })
        expect(store.mutating()).toEqual([])
    })

    test('the pack counts as one value', async () => {
        const store = createFakeStore({ versioned: true })
        const { owner } = makeOwner(store, { nodeBodyLimit: 500 })
        const big = withBlock(OLD, 'stubby', characterBlock('stubby', JSON.stringify({ chaId: 'stubby', filler: 'x'.repeat(800) })))
        expect(await owner.replaceWholeState(big)).toMatchObject({ kind: 'refused', blockName: 'stubs' })
        expect(store.mutating()).toEqual([])
    })

    test('a store that is not Node accepts the same value', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store, { nodeBodyLimit: 500 })
        const big = withBlock(OLD, 'alice', characterBlock('alice', JSON.stringify({ chaId: 'alice', filler: 'x'.repeat(800) })))
        expectWon(await owner.replaceWholeState(big, { requireAbsentHead: true }))
    })
})

describe('the damage prompt\'s replace keeps the damaged generation (invariant P, V)', () => {
    test('writes the kept marker first, flips, and leaves the damaged generation on disk', async () => {
        const store = createFakeStore({ versioned: true })
        const damaged = await seedStore(store, OLD)
        store.unplant(characterBlockKey(damaged, 'alice'))
        const { owner } = makeOwner(store)
        const load = await owner.load()
        expect(load.kind).toBe('damaged')
        const start = store.ops.length
        const won = expectWon(await owner.replaceWholeState(NEW, { keepDamaged: damaged }))
        expect(won.previous).toEqual({ state: 'kept', generation: damaged })
        const writes = store.ops.slice(start).filter((op) => op.kind === 'write').map((op) => op.key)
        expect(writes[0]).toBe(keptKey(damaged))
        expect(store.peek(rootKey(damaged))).not.toBeNull()
        expect(store.peek(fixedBlockKey(damaged, 'modules'))).not.toBeNull()
        const inventory = await owner.inventory()
        expect(inventory.kept).toEqual([damaged])
        expect(inventory.leftover).toEqual([])
        expect(inventory.generations.map((info) => info.id)).toContain(won.generation)
    })

    test('stopping at the prompt writes nothing', async () => {
        const store = createFakeStore({ versioned: false })
        const damaged = await seedStore(store, OLD)
        store.unplant(rootKey(damaged))
        const before = store.mutating().length
        const { owner } = makeOwner(store)
        expect((await owner.load()).kind).toBe('damaged')
        expect(store.mutating().length).toBe(before)
    })

    test('a kept marker already present is not rewritten', async () => {
        const store = createFakeStore({ versioned: true })
        const damaged = await seedStore(store, OLD)
        store.plant(keptKey(damaged), new TextEncoder().encode('{"kept":true}'))
        const revision = store.revisionOf(keptKey(damaged))
        const { owner } = makeOwner(store)
        expectWon(await owner.replaceWholeState(NEW, { keepDamaged: damaged }))
        expect(store.revisionOf(keptKey(damaged))).toBe(revision)
    })
})

describe('seeding an empty profile (invariant S2)', () => {
    test('seeds when nothing is found', async () => {
        const store = createFakeStore({ versioned: true })
        const { owner } = makeOwner(store)
        const result = await owner.seedEmptyProfile(OLD)
        expect(result.kind).toBe('replaced')
        expect(headOf(store)).toMatchObject({ status: 'ok' })
    })

    test.each([
        { title: 'a head', key: HEAD_KEY, kind: 'head' },
        { title: 'a main file', key: 'database/database.bin', kind: 'main-file' },
        { title: 'a pre-blocks copy', key: 'database/database.pre-blocks.bin', kind: 'pre-blocks' },
        { title: 'a numbered pre-blocks copy', key: 'database/database.pre-blocks-2.bin', kind: 'pre-blocks' },
        { title: 'a numbered backup', key: 'database/dbbackup-1700000000', kind: 'numbered-backup' },
    ])('does not seed over $title, names what it found, and writes nothing', async ({ key, kind }) => {
        const store = createFakeStore({ versioned: true })
        const value = key === HEAD_KEY ? encodeHead({ current: '000000000001-00000001' }) : new Uint8Array([1, 2, 3])
        store.plant(key, value)
        const before = store.mutating().length
        const { owner } = makeOwner(store)
        const result = await owner.seedEmptyProfile(OLD)
        expect(result.kind).toBe('blocked')
        if (result.kind === 'blocked') {
            expect(result.found.map((found) => found.kind)).toEqual([kind])
            expect(result.found[0].keys).toContain(key)
        }
        expect(store.mutating().length).toBe(before)
    })

    test('keys under blocks/ without a head are garbage: the seed proceeds and the leftovers are reported', async () => {
        const store = createFakeStore({ versioned: true })
        store.plant('blocks/000000000001-00000001/root', characterBlock('x'))
        store.plant('blocks/000000000001-00000001/c/6162', characterBlock('ab'))
        const { owner } = makeOwner(store)
        const result = await owner.seedEmptyProfile(OLD)
        expect(result).toMatchObject({ kind: 'replaced', leftoverGenerations: ['000000000001-00000001'] })
        expect(headOf(store)).toMatchObject({ status: 'ok' })
        expect(store.peek('blocks/000000000001-00000001/root')).not.toBeNull()
    })

    test('an interrupted first seed leaves garbage with no head and the next start seeds', async () => {
        const store = createFakeStore({ versioned: true })
        store.faults.push({ match: (op) => op.kind === 'write' && op.key.endsWith('/root'), mode: 'before' })
        const first = makeOwner(store)
        await expect(first.owner.seedEmptyProfile(OLD)).rejects.toBeInstanceOf(InjectedFault)
        expect(store.peek(HEAD_KEY)).toBeNull()
        const second = makeOwner(store)
        const result = await second.owner.seedEmptyProfile(OLD)
        expect(result).toMatchObject({ kind: 'replaced' })
        if (result.kind === 'replaced') {
            expect(result.result.kind).toBe('won')
            expect(result.leftoverGenerations.length).toBe(1)
        }
    })
})

describe('the three outcomes of the flip (invariant U)', () => {
    function swapped(store: FakeStore, wrap: (inner: HeadSwap) => HeadSwap): HeadSwap {
        return wrap(createNodeHeadSwap(store))
    }

    test('the head write lands and the response is lost: the re-read finds the new generation, the replace keeps it and deletes the old one', async () => {
        const store = createFakeStore({ versioned: true })
        const oldGeneration = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'after' })
        const won = expectWon(await owner.replaceWholeState(NEW))
        expect(headOf(store)).toMatchObject({ record: { current: won.generation } })
        expect(store.keys(`blocks/${oldGeneration}/`)).toEqual([])
        expect(store.keys(`blocks/${won.generation}/`).length).toBeGreaterThan(5)
        expect(owner.isLive()).toBe(true)
    })

    test('the head write lands and the head cannot be read afterwards: nothing is deleted, the owner is closed, and a reload sees the new state', async () => {
        const store = createFakeStore({ versioned: true })
        const oldGeneration = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'after' })
        let landed = false
        const original = store.write
        store.write = async (key, bytes, condition) => {
            try {
                return await original(key, bytes, condition)
            } finally {
                if (key === HEAD_KEY) {
                    landed = true
                }
            }
        }
        store.faults.push({ match: (op) => landed && op.kind === 'read' && op.key === HEAD_KEY, mode: 'before', times: 99 })
        const swapAt = store.ops.length
        const result = await owner.replaceWholeState(NEW)
        expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'unreadable' })
        expect(store.ops.slice(swapAt).filter((op) => op.kind === 'delete' || op.kind === 'deleteMany')).toEqual([])
        expect(store.keys(`blocks/${oldGeneration}/`).length).toBeGreaterThan(5)
        expect(owner.isClosed()).toBe(true)
        await expect(owner.commitSave(NEW)).rejects.toBeInstanceOf(BlockOwnerStateError)
        await expect(owner.replaceWholeState(NEW)).rejects.toBeInstanceOf(BlockOwnerStateError)
        store.faults.length = 0
        const reloaded = await makeOwner(store).owner.load()
        expect(directoryOf(reloaded)).toContain('carol')
    })

    test('the head write fails and the re-read still names the old state: could not be confirmed, nothing deleted, the owner closed', async () => {
        const store = createFakeStore({ versioned: true })
        const oldGeneration = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before' })
        const start = store.ops.length
        const result = await owner.replaceWholeState(NEW)
        expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'unchanged' })
        expect(store.ops.slice(start).filter((op) => op.kind === 'delete' || op.kind === 'deleteMany')).toEqual([])
        expect(store.keys(`blocks/${oldGeneration}/`).length).toBeGreaterThan(5)
        expect(owner.isClosed()).toBe(true)
    })

    test('an unknown outcome that re-reads as a third generation is lost and deletes nothing', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const third = '0000000000ff-000000ff'
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before' })
        const original = store.write
        store.write = async (key, bytes, condition) => {
            if (key === HEAD_KEY) {
                store.plant(HEAD_KEY, encodeHead({ current: third }))
            }
            return await original(key, bytes, condition)
        }
        const start = store.ops.length
        const result = await owner.replaceWholeState(NEW)
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-moved', ownGenerationDeleted: false })
        expect(store.ops.slice(start).filter((op) => op.kind === 'delete' || op.kind === 'deleteMany')).toEqual([])
        expect(owner.isClosed()).toBe(false)
    })

    test('a definite mismatch with a third generation in the head deletes this replace\'s own generation only', async () => {
        const store = createFakeStore({ versioned: true })
        const oldGeneration = await seedStore(store, OLD)
        const rival = makeOwner(store)
        await rival.owner.load()
        const racing = swapped(store, (inner) => ({
            read: inner.read,
            swap: async (expected, next) => {
                // A rival replace flips first.
                const rivalWon = await rival.owner.replaceWholeState(withCharacter(OLD, 'rival'))
                expect(rivalWon.kind).toBe('won')
                return await inner.swap(expected, next)
            },
        }))
        const { owner } = makeOwner(store, { headSwap: racing })
        await owner.load()
        const result = await owner.replaceWholeState(NEW)
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-mismatch', ownGenerationDeleted: true })
        const head = headOf(store)
        expect(head).toMatchObject({ status: 'ok' })
        const current = head?.status === 'ok' ? head.record.current : ''
        expect(current).not.toBe(oldGeneration)
        const loaded = await makeOwner(store).owner.load()
        expect(directoryOf(loaded)).toContain('rival')
        expect(directoryOf(loaded)).not.toContain('carol')
    })

    test('a definite mismatch whose re-read names the generation the replace started from leaves its own generation as garbage', async () => {
        const store = createFakeStore({ versioned: true })
        const oldGeneration = await seedStore(store, OLD)
        const inner = createNodeHeadSwap(store)
        const replayed: HeadSwap = { read: inner.read, swap: async () => 'lost' }
        const { owner } = makeOwner(store, { headSwap: replayed })
        await owner.load()
        const result = await owner.replaceWholeState(NEW)
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-mismatch', ownGenerationDeleted: false })
        expect(headOf(store)).toMatchObject({ record: { current: oldGeneration } })
        const inventory = await owner.inventory()
        expect(inventory.leftover.length).toBe(1)
    })

    test('a losing replace reports that it did not happen: the old generation is untouched and still loads', async () => {
        const store = createFakeStore({ versioned: false })
        const oldGeneration = await seedStore(store, OLD)
        const inner = createMutexHeadSwap(store)
        const { owner } = makeOwner(store, { headSwap: { read: inner.read, swap: async () => 'lost' } })
        await owner.load()
        const result = await owner.replaceWholeState(NEW)
        expect(result.kind).toBe('lost')
        const loaded = await makeOwner(store).owner.load()
        expect(loaded.kind === 'loaded' && loaded.loaded.generation).toBe(oldGeneration)
    })

    test('a 409 on the head write is a definite loss', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before', error: new StoreVersionConflictError(HEAD_KEY, 9) })
        const result = await owner.replaceWholeState(NEW)
        expect(result.kind).toBe('lost')
        expect(result).toMatchObject({ reason: 'head-mismatch' })
    })
})

describe('lock order (invariant W)', () => {
    const neverGranted = {
        available: true,
        run: async () => { throw new Error('the commit lock must not be taken here') },
    }

    test('load, seed, replace and the inventory never take the commit lock, so a conversion cannot wait for other tabs', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store, { commitLock: neverGranted })
        expect((await owner.seedEmptyProfile(OLD)).kind).toBe('replaced')
        expect((await owner.readCommitted()).kind).toBe('loaded')
        expect((await makeOwner(store, { commitLock: neverGranted }).owner.load()).kind).toBe('loaded')
        expectWon(await owner.replaceWholeState(NEW))
        await owner.inventory()
    })

    test('a page without Web Locks converts as well', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store, { commitLock: { available: false, run: (work) => work() } })
        expectWon(await owner.replaceWholeState(OLD, { requireAbsentHead: true }))
        expect(await owner.commitSave(withCharacter(OLD, 'late'))).toMatchObject({ kind: 'committed', wrote: true })
    })

    test('a save takes the commit lock exactly once and holds it for every write it makes', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, OLD)
        const events: string[] = []
        const tracing = { available: true, run: async <T>(work: () => Promise<T>) => { events.push('enter'); try { return await work() } finally { events.push('exit') } } }
        const { owner } = makeOwner(store, { commitLock: tracing })
        await owner.load()
        const original = store.write
        store.write = async (key, bytes, condition) => { events.push(`write ${key}`); return await original(key, bytes, condition) }
        await owner.commitSave(withCharacter(OLD, 'dave'))
        expect(events[0]).toBe('enter')
        expect(events.filter((event) => event === 'enter').length).toBe(1)
        expect(events.at(-1)).toBe('exit')
        expect(events.filter((event) => event.startsWith('write')).length).toBe(2)
    })
})

describe('a refused replace leaves no marker behind', () => {
    test('the kept marker is written only after the pre-flight passed', async () => {
        const store = createFakeStore({ versioned: true })
        const damaged = await seedStore(store, OLD)
        const { owner } = makeOwner(store, { nodeBodyLimit: 400 })
        const big = withBlock(NEW, 'carol', characterBlock('carol', JSON.stringify({ chaId: 'carol', filler: 'x'.repeat(900) })))
        const before = store.mutating().length
        expect((await owner.replaceWholeState(big, { keepDamaged: damaged })).kind).toBe('refused')
        expect(store.mutating().length).toBe(before)
        expect(store.peek(keptKey(damaged))).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// A head that is not binary data
// ---------------------------------------------------------------------------

const NOT_BINARY: HeadRead = { kind: 'not-binary' }
const GARBAGE = new TextEncoder().encode('garbage')

/** A head swap over `store` that reports a non-binary head until it is replaced, and accepts only a swap that expects exactly that. */
function notBinaryHead(store: FakeStore): HeadSwap & { replaced(): boolean } {
    const real = createMutexHeadSwap(store)
    let replaced = false
    return {
        replaced: () => replaced,
        read: async () => (replaced ? await real.read() : NOT_BINARY),
        swap: async (expected, next) => {
            if (replaced || expected.kind !== 'not-binary') {
                return 'lost'
            }
            await store.write(HEAD_KEY, next, 'unconditional')
            replaced = true
            return 'won'
        },
    }
}

describe('a head that is not binary data', () => {
    test('load reports it as bad-head damage naming no generation, and installs nothing', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store, { headSwap: notBinaryHead(store) })
        const result = await owner.load()
        expect(result).toMatchObject({ kind: 'damaged', generation: null })
        expect(result.kind === 'damaged' && result.damage.map((item) => item.kind)).toEqual(['bad-head'])
        expect(owner.isLive()).toBe(false)
    })

    test('a whole-state replace wins over it, with no previous generation to retire', async () => {
        const store = createFakeStore({ versioned: false })
        const older = await seedStore(store, OLD)
        const swap = notBinaryHead(store)
        const { owner } = makeOwner(store, { headSwap: swap })
        const won = expectWon(await owner.replaceWholeState(NEW))
        expect(won.previous).toEqual({ state: 'none' })
        expect(swap.replaced()).toBe(true)
        expect(headOf(store)).toMatchObject({ status: 'ok', record: { current: won.generation } })
        expect(store.peek(rootKey(older))).not.toBeNull()
        const loaded = await makeOwner(store).owner.load()
        expect(directoryOf(loaded)).toContain('carol')
    })

    test('a conversion or seed, which needs an absent head, treats it as present and writes nothing', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store, { headSwap: notBinaryHead(store) })
        const result = await owner.replaceWholeState(OLD, { requireAbsentHead: true })
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-exists' })
        expect(store.mutating()).toEqual([])
    })

    test('seeding is blocked by it and names the head', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store, { headSwap: notBinaryHead(store) })
        const result = await owner.seedEmptyProfile(OLD)
        expect(result).toMatchObject({ kind: 'blocked', found: [{ kind: 'head', keys: [HEAD_KEY] }] })
        expect(store.mutating()).toEqual([])
    })

    test('a live owner whose head turns non-binary stops its commit as head-moved, and keeps stopping', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, OLD)
        const real = createMutexHeadSwap(store)
        let broken = false
        const { owner } = makeOwner(store, { headSwap: { read: async () => (broken ? NOT_BINARY : await real.read()), swap: real.swap } })
        await owner.load()
        broken = true
        const edited = withBlock(OLD, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}'))
        expect(await owner.commitSave(edited)).toMatchObject({ kind: 'stopped', reason: 'head-moved' })
        broken = false
        expect(await owner.commitSave(edited)).toMatchObject({ kind: 'stopped', reason: 'head-moved' })
    })

    test('a load whose head changes from non-binary to bytes between two attempts starts over instead of reporting damage', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, OLD)
        const real = createMutexHeadSwap(store)
        let reads = 0
        const { owner } = makeOwner(store, { headSwap: { read: async () => (reads++ === 0 ? NOT_BINARY : await real.read()), swap: real.swap } })
        const result = await owner.load()
        expect(result.kind).toBe('loaded')
    })
})

// ---------------------------------------------------------------------------
// An unreadable head keeps every generation that has a root
// ---------------------------------------------------------------------------

/** Puts a second complete generation into `store` without touching the head. */
async function plantGeneration(store: FakeStore, input = OLD): Promise<string> {
    const side = createFakeStore({ versioned: store.versioned })
    const generation = await seedStore(side, input)
    for (const [key, value] of side.snapshotValues()) {
        if (key !== HEAD_KEY) {
            store.plant(key, value)
        }
    }
    return generation
}

/** A store with two rooted generations and a head that is garbage. */
async function twoRootedGenerationsUnderGarbage(versioned: boolean): Promise<{ store: FakeStore, older: string, newer: string }> {
    const store = createFakeStore({ versioned })
    const older = await seedStore(store, OLD)
    const newer = await plantGeneration(store, withCharacter(OLD, 'second'))
    store.plant(HEAD_KEY, GARBAGE)
    return { store, older, newer }
}

describe.each([{ versioned: true }, { versioned: false }])('a keep-all replace over an unreadable head, versioned=$versioned', ({ versioned }) => {
    test('marks every rooted generation kept before it writes anything of its own, then wins', async () => {
        const { store, older, newer } = await twoRootedGenerationsUnderGarbage(versioned)
        const { owner } = makeOwner(store)
        const start = store.ops.length
        const won = expectWon(await owner.replaceWholeState(NEW, { keepAll: true }))
        expect(won.previous).toEqual({ state: 'none' })
        const writes = store.ops.slice(start).filter((op) => op.kind === 'write').map((op) => op.key)
        expect(writes.slice(0, 2).sort()).toEqual([keptKey(older), keptKey(newer)].sort())
        expect(writes.indexOf(rootKey(won.generation))).toBeGreaterThan(1)
        expect(writes.at(-1)).toBe(HEAD_KEY)
        for (const generation of [older, newer]) {
            expect(store.peek(rootKey(generation))).not.toBeNull()
            expect(store.peek(fixedBlockKey(generation, 'modules'))).not.toBeNull()
        }
        const inventory = await owner.inventory()
        expect([...inventory.kept].sort()).toEqual([older, newer].sort())
        expect(inventory.kept).not.toContain(won.generation)
        expect(inventory.leftover).toEqual([])
    })

    test('writes a head that carries neither a fingerprint nor a conversion time', async () => {
        const { store } = await twoRootedGenerationsUnderGarbage(versioned)
        const { owner } = makeOwner(store)
        const won = expectWon(await owner.replaceWholeState(NEW, { keepAll: true }))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: won.generation } })
    })

    test('does not mark a generation that has no root', async () => {
        const { store, older, newer } = await twoRootedGenerationsUnderGarbage(versioned)
        const halfDeleted = '000000000003-00000003'
        store.plant(`blocks/${halfDeleted}/c/6162`, characterBlock('ab'))
        const { owner } = makeOwner(store)
        expectWon(await owner.replaceWholeState(NEW, { keepAll: true }))
        expect(store.peek(keptKey(halfDeleted))).toBeNull()
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(newer))).not.toBeNull()
        expect((await owner.inventory()).leftover).toEqual([halfDeleted])
    })

    test('leaves an existing marker as it is', async () => {
        const { store, older } = await twoRootedGenerationsUnderGarbage(versioned)
        store.plant(keptKey(older), new TextEncoder().encode('{"kept":true,"at":1}'))
        const revision = store.revisionOf(keptKey(older))
        const { owner } = makeOwner(store)
        expectWon(await owner.replaceWholeState(NEW, { keepAll: true }))
        expect(store.revisionOf(keptKey(older))).toBe(revision)
    })

    test('only proceeds while the head is unreadable: a readable head loses and nothing is written', async () => {
        const store = createFakeStore({ versioned })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        const before = store.mutating().length
        expect(await owner.replaceWholeState(NEW, { keepAll: true })).toMatchObject({ kind: 'lost', reason: 'head-moved' })
        expect(store.mutating().length).toBe(before)
    })

    test('an absent head loses as well', async () => {
        const store = createFakeStore({ versioned })
        const { owner } = makeOwner(store)
        expect(await owner.replaceWholeState(NEW, { keepAll: true })).toMatchObject({ kind: 'lost', reason: 'head-moved' })
        expect(store.mutating()).toEqual([])
    })

    test.runIf(versioned)('a replace refused by the size pre-flight writes no marker', async () => {
        const { store, older, newer } = await twoRootedGenerationsUnderGarbage(versioned)
        const { owner } = makeOwner(store, { nodeBodyLimit: 400 })
        const big = withBlock(NEW, 'carol', characterBlock('carol', JSON.stringify({ chaId: 'carol', filler: 'x'.repeat(900) })))
        const before = store.mutating().length
        expect((await owner.replaceWholeState(big, { keepAll: true })).kind).toBe('refused')
        expect(store.mutating().length).toBe(before)
        expect(store.peek(keptKey(older))).toBeNull()
        expect(store.peek(keptKey(newer))).toBeNull()
    })
})

describe('a keep-all replace over a head that is not binary data', () => {
    test('marks every rooted generation kept and wins', async () => {
        const store = createFakeStore({ versioned: false })
        const older = await seedStore(store, OLD)
        const newer = await plantGeneration(store, withCharacter(OLD, 'second'))
        const { owner } = makeOwner(store, { headSwap: notBinaryHead(store) })
        const won = expectWon(await owner.replaceWholeState(NEW, { keepAll: true }))
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(newer))).not.toBeNull()
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: won.generation } })
    })
})

describe('a keep-all replace that loses to a rival', () => {
    /** A store view whose first listing first lets `rival` finish its own keep-all replace. */
    function racedView(store: FakeStore, rival: () => Promise<unknown>): FakeStore {
        let raced = false
        return Object.assign(Object.create(store) as FakeStore, {
            list: async (prefix: string) => {
                if (!raced) {
                    raced = true
                    await rival()
                }
                return await store.list(prefix)
            },
        })
    }

    async function arrange(versioned = false, afterRival?: (store: FakeStore, generation: string) => void) {
        const { store, older, newer } = await twoRootedGenerationsUnderGarbage(versioned)
        const winner = makeOwner(store)
        let winnerResult: ReplaceResult | null = null
        const view = racedView(store, async () => {
            winnerResult = await winner.owner.replaceWholeState(withCharacter(OLD, 'rival'), { keepAll: true })
            if (winnerResult.kind === 'won') {
                afterRival?.(store, winnerResult.generation)
            }
        })
        /** The generation the rival won with, `null` before the rival has finished. */
        const peekWinner = (): string | null => (winnerResult !== null && winnerResult.kind === 'won' ? winnerResult.generation : null)
        const winningGeneration = (): string => {
            const won = peekWinner()
            if (won === null) {
                throw new Error('the rival did not win')
            }
            return won
        }
        return { store, older, newer, winner, view, winningGeneration, peekWinner }
    }

    test('removes the markers it wrote on the winner\'s generation, and the winner is never reported as kept', async () => {
        const { store, older, newer, winner, view, winningGeneration } = await arrange()
        const loser = makeOwner(view)
        const result = await loser.owner.replaceWholeState(NEW, { keepAll: true })
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-mismatch', ownGenerationDeleted: true })
        const won = winningGeneration()
        expect(store.peek(keptKey(won))).toBeNull()
        expect((await winner.owner.inventory()).kept).toEqual([older, newer].sort())
        expect((await inspectGenerations(store, won)).kept).not.toContain(won)
        expect(store.peek(rootKey(won))).not.toBeNull()
        expect(headOf(store)).toMatchObject({ record: { current: won } })
    })

    test('keeps the markers the winner wrote on the older generations', async () => {
        const { store, older, newer, view } = await arrange()
        await makeOwner(view).owner.replaceWholeState(NEW, { keepAll: true })
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(newer))).not.toBeNull()
    })

    test('when the head write\'s outcome is unknown and the head moved, it removes its own markers on the winner as well', async () => {
        const { store, older, newer, view, winningGeneration } = await arrange()
        const real = createMutexHeadSwap(store)
        const loser = makeOwner(view, { headSwap: { read: real.read, swap: async () => { throw new Error('connection reset') } } })
        const result = await loser.owner.replaceWholeState(NEW, { keepAll: true })
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-moved' })
        const won = winningGeneration()
        expect(store.peek(keptKey(won))).toBeNull()
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(newer))).not.toBeNull()
        expect((await inspectGenerations(store, won)).kept).toEqual([older, newer].sort())
    })

    test('when the marker cannot be removed the winner is still not reported as kept', async () => {
        const { store, older, newer, view, winningGeneration, peekWinner } = await arrange()
        const loser = makeOwner(view)
        store.faults.push({
            match: (op) => {
                const won = peekWinner()
                return op.kind === 'delete' && won !== null && op.key === keptKey(won)
            },
            mode: 'before',
            times: 9,
        })
        const result = await loser.owner.replaceWholeState(NEW, { keepAll: true })
        expect(result.kind).toBe('lost')
        const won = winningGeneration()
        expect(store.peek(keptKey(won))).not.toBeNull()
        const inventory = await inspectGenerations(store, won)
        expect(inventory.kept).toEqual([older, newer].sort())
        expect(inventory.leftover).not.toContain(won)
    })

    test('a marker that was already on the winner before this replace ran is not this replace\'s to remove', async () => {
        const marker = new TextEncoder().encode('{"kept":true,"at":1}')
        const { store, view, winningGeneration } = await arrange(false, (planted, generation) => planted.plant(keptKey(generation), marker))
        const result = await makeOwner(view).owner.replaceWholeState(NEW, { keepAll: true })
        expect(result.kind).toBe('lost')
        expect(Array.from(store.peek(keptKey(winningGeneration())) ?? [])).toEqual(Array.from(marker))
    })

    /** Both exits leave the winner unmarked, and the next replace over the winner retires it. */
    async function expectWinnerUnmarkedAndRetirable(store: FakeStore, won: string): Promise<void> {
        expect(store.peek(keptKey(won))).toBeNull()
        const next = makeOwner(store)
        expect((await next.owner.load()).kind).toBe('loaded')
        const later = expectWon(await next.owner.replaceWholeState(NEW))
        expect(later.previous).toEqual({ state: 'deleted', generation: won })
        expect(store.peek(rootKey(won))).toBeNull()
    }

    test('a new root that does not read back removes its markers from a winner that flipped meanwhile', async () => {
        const { store, view, winningGeneration } = await arrange()
        const original = view.write
        view.write = async (key, bytes, condition) => {
            const result = await original(key, bytes, condition)
            // The rival writes through the store itself, so the only root written through the view is this replace's own.
            if (key.endsWith('/root')) {
                store.unplant(key)
            }
            return result
        }
        const result = await makeOwner(view).owner.replaceWholeState(NEW, { keepAll: true })
        expect(result).toMatchObject({ kind: 'lost', reason: 'generation-damaged' })
        await expectWinnerUnmarkedAndRetirable(store, winningGeneration())
    })

    test('a pre-flip refusal removes its markers from a winner that flipped meanwhile', async () => {
        const { store, view, winningGeneration } = await arrange()
        const result = await makeOwner(view).owner.replaceWholeState(NEW, { keepAll: true, preFlip: () => false })
        expect(result).toMatchObject({ kind: 'aborted' })
        await expectWinnerUnmarkedAndRetirable(store, winningGeneration())
    })

    test('a head re-read that fails after a lost flip is tried again before the markers are given up', async () => {
        const { store, view, winningGeneration } = await arrange()
        const real = createMutexHeadSwap(store)
        let afterSwap = 0
        const swap: HeadSwap = {
            read: async () => {
                if (afterSwap === 1) {
                    afterSwap = 2
                    throw new Error('head unreadable once')
                }
                return await real.read()
            },
            swap: async (expected, next) => {
                const outcome = await real.swap(expected, next)
                afterSwap = 1
                return outcome
            },
        }
        const result = await makeOwner(view, { headSwap: swap }).owner.replaceWholeState(NEW, { keepAll: true })
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-mismatch' })
        await expectWinnerUnmarkedAndRetirable(store, winningGeneration())
    })

    test('an unconfirmed outcome leaves its markers in place and closes the owner', async () => {
        const { store, older, newer } = await twoRootedGenerationsUnderGarbage(false)
        const real = createMutexHeadSwap(store)
        const { owner } = makeOwner(store, { headSwap: { read: real.read, swap: async () => { throw new Error('connection reset') } } })
        const result = await owner.replaceWholeState(NEW, { keepAll: true })
        expect(result).toMatchObject({ kind: 'unconfirmed', reason: 'unchanged' })
        expect(owner.isClosed()).toBe(true)
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(newer))).not.toBeNull()
    })

    test('a new root that does not read back leaves the head unreadable and the older generations kept', async () => {
        const { store, older, newer } = await twoRootedGenerationsUnderGarbage(false)
        const { owner } = makeOwner(store)
        let removed = false
        const original = store.write
        store.write = async (key, bytes, condition) => {
            const result = await original(key, bytes, condition)
            if (!removed && key.endsWith('/root') && !key.includes(older) && !key.includes(newer)) {
                removed = true
                store.unplant(key)
            }
            return result
        }
        expect(await owner.replaceWholeState(NEW, { keepAll: true })).toMatchObject({ kind: 'lost', reason: 'generation-damaged' })
        expect(Array.from(store.peek(HEAD_KEY) as Uint8Array)).toEqual(Array.from(GARBAGE))
        expect(store.peek(keptKey(older))).not.toBeNull()
        expect(store.peek(keptKey(newer))).not.toBeNull()
    })
})

describe('the generation the head names outranks a kept marker', () => {
    test('inspectGenerations lists the current generation as current and never as kept or leftover', async () => {
        const store = createFakeStore({ versioned: false })
        const live = await seedStore(store, OLD)
        const other = await plantGeneration(store)
        store.plant(keptKey(live), new TextEncoder().encode('{"kept":true}'))
        store.plant(keptKey(other), new TextEncoder().encode('{"kept":true}'))
        const inventory = await inspectGenerations(store, live)
        expect(inventory.kept).toEqual([other])
        expect(inventory.leftover).toEqual([])
        expect(inventory.generations.find((info) => info.id === live)).toMatchObject({ current: true, kept: false, hasRoot: true })
        expect(inventory.generations.find((info) => info.id === other)).toMatchObject({ current: false, kept: true })
    })

    test('an owner that holds a generation reports it as current in its inventory even when a marker was left on it', async () => {
        const store = createFakeStore({ versioned: false })
        const live = await seedStore(store, OLD)
        store.plant(keptKey(live), new TextEncoder().encode('{"kept":true}'))
        const { owner } = makeOwner(store)
        await owner.load()
        expect((await owner.inventory()).kept).toEqual([])
    })

    test('retireGeneration deletes nothing of the generation it is told is live', async () => {
        const store = createFakeStore({ versioned: false })
        const live = await seedStore(store, OLD)
        const before = store.keys(`blocks/${live}/`).length
        expect(await retireGeneration(store, live, live)).toBe('kept')
        expect(store.keys(`blocks/${live}/`).length).toBe(before)
        const other = await plantGeneration(store)
        expect(await retireGeneration(store, other, live)).toBe('deleted')
        expect(store.keys(`blocks/${other}/`)).toEqual([])
    })

    test('a replace never retires the generation the head names after the flip', async () => {
        const store = createFakeStore({ versioned: false })
        const first = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const won = expectWon(await owner.replaceWholeState(NEW))
        expect(store.peek(rootKey(won.generation))).not.toBeNull()
        expect(store.peek(rootKey(first))).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// The pre-flip check
// ---------------------------------------------------------------------------

describe('the pre-flip check', () => {
    test('a check that refuses stops the replace before the flip, deletes its generation and leaves the owner as it was', async () => {
        const store = createFakeStore({ versioned: false })
        const first = await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const before = owner.committedState()
        expect(before).not.toBeNull()
        const start = store.ops.length
        const result = await owner.replaceWholeState(NEW, { preFlip: () => false })
        expect(result).toEqual({ kind: 'aborted', ownGenerationDeleted: true })
        const writes = store.ops.slice(start).filter((op) => op.kind === 'write').map((op) => op.key)
        expect(writes).not.toContain(HEAD_KEY)
        expect(headOf(store)).toMatchObject({ record: { current: first } })
        expect(store.keys('blocks/').filter((key) => !key.startsWith(`blocks/${first}/`) && key !== HEAD_KEY)).toEqual([])
        expect(owner.committedState()).toMatchObject({
            generation: first,
            seq: before?.seq,
            directory: before?.directory,
            packed: before?.packed,
            convertedFrom: before?.convertedFrom,
        })
        expect(owner.isLive()).toBe(true)
        const committed = await owner.commitSave(withBlock(OLD, 'alice', characterBlock('alice', '{"chaId":"alice","v":3}')))
        expect(committed).toMatchObject({ kind: 'committed', wrote: true })
    })

    test('the check runs once, after the new root reads back and before the head write', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const events: string[] = []
        const original = store.write
        store.write = async (key, bytes, condition) => {
            events.push(key === HEAD_KEY ? 'head' : key.endsWith('/root') ? 'root' : 'value')
            return await original(key, bytes, condition)
        }
        const won = expectWon(await owner.replaceWholeState(NEW, { preFlip: () => { events.push('check'); return true } }))
        expect(won.kind).toBe('won')
        expect(events.filter((event) => event === 'check')).toEqual(['check'])
        expect(events.indexOf('check')).toBeGreaterThan(events.lastIndexOf('root'))
        expect(events.indexOf('check')).toBeLessThan(events.indexOf('head'))
    })

    test('a check that allows the replace changes nothing about it', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, OLD)
        const { owner } = makeOwner(store)
        await owner.load()
        const won = expectWon(await owner.replaceWholeState(NEW, { preFlip: () => true }))
        expect(headOf(store)).toMatchObject({ record: { current: won.generation } })
    })

    test('a refusing check on an owner that has not loaded leaves it unloaded and writes no head', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        const result = await owner.replaceWholeState(OLD, { requireAbsentHead: true, preFlip: () => false })
        expect(result).toMatchObject({ kind: 'aborted' })
        expect(owner.isLive()).toBe(false)
        expect(store.peek(HEAD_KEY)).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// The conversion fields a head carries
// ---------------------------------------------------------------------------

describe('the conversion fields of the head', () => {
    const FROM = 'b1:100:2:aaaaaaaa:bbbbbbbb'

    test('a conversion writes the fingerprint and the time it was given', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        const won = expectWon(await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM, convertedAt: 1_650_000_000_000 }))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: won.generation, convertedFrom: FROM, convertedAt: 1_650_000_000_000 } })
    })

    test('a conversion that is given no time stamps the clock of the owner', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        expectWon(await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM }))
        const head = headOf(store)
        expect(head?.status === 'ok' && head.record.convertedAt).toBeGreaterThanOrEqual(1_700_000_000_000)
    })

    test('every later replace writes both fields from the head it read, including the damage prompt\'s', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM, convertedAt: 1_650_000_000_000 })
        const second = expectWon(await owner.replaceWholeState(NEW))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: second.generation, convertedFrom: FROM, convertedAt: 1_650_000_000_000 } })
        const third = expectWon(await owner.replaceWholeState(OLD, { keepDamaged: second.generation }))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: third.generation, convertedFrom: FROM, convertedAt: 1_650_000_000_000 } })
    })

    test('a caller that passes new fields replaces the carried ones, both together', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM, convertedAt: 1_650_000_000_000 })
        const next = expectWon(await owner.replaceWholeState(NEW, { convertedFrom: 'b1:9:9:cccccccc:dddddddd', convertedAt: 1_660_000_000_000 }))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: next.generation, convertedFrom: 'b1:9:9:cccccccc:dddddddd', convertedAt: 1_660_000_000_000 } })
    })

    test('a head that never had them stays without them', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        await owner.replaceWholeState(OLD, { requireAbsentHead: true })
        const next = expectWon(await owner.replaceWholeState(NEW))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: next.generation } })
    })

    test('an owner that took the state over reports the fields it carries, and a load reports them', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM, convertedAt: 1_650_000_000_000 })
        expectWon(await owner.replaceWholeState(NEW))
        expect(owner.committedState()).toMatchObject({ convertedFrom: FROM, convertedAt: 1_650_000_000_000 })
        const loaded = await makeOwner(store).owner.load()
        expect(loaded.kind === 'loaded' && [loaded.loaded.convertedFrom, loaded.loaded.convertedAt]).toEqual([FROM, 1_650_000_000_000])
    })

    test('a commit never writes the head, so the fields stay as the replace wrote them', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM, convertedAt: 1_650_000_000_000 })
        const headBefore = store.peek(HEAD_KEY)
        const start = store.ops.length
        const result = await owner.commitSave(withBlock(OLD, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}')))
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        expect(store.ops.slice(start).filter((op) => op.kind !== 'read' && op.key === HEAD_KEY)).toEqual([])
        expect(store.peek(HEAD_KEY)).toEqual(headBefore)
    })

    test('an unknown outcome that re-reads the unchanged head, fields included, is unconfirmed', async () => {
        const store = createFakeStore({ versioned: true })
        const { owner } = makeOwner(store)
        await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: FROM, convertedAt: 1_650_000_000_000 })
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === HEAD_KEY, mode: 'before' })
        expect(await owner.replaceWholeState(NEW)).toMatchObject({ kind: 'unconfirmed', reason: 'unchanged' })
    })
})