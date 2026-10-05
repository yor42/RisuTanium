// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { HEAD_KEY, characterBlockKey, fixedBlockKey, keptKey, rootKey, stubsKey } from 'src/ts/storage/blockKeys'
import { BlockOwnerStateError, type LoadResult, type ReplaceResult } from 'src/ts/storage/blockStore'
import { createMutexHeadSwap, createNodeHeadSwap, encodeHead, parseHead, type HeadSwap } from 'src/ts/storage/headSwap'
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

    test('a conversion records its fingerprint once in the head, and a later replace carries none', async () => {
        const store = createFakeStore({ versioned })
        const { owner } = makeOwner(store)
        const won = expectWon(await owner.replaceWholeState(OLD, { requireAbsentHead: true, convertedFrom: 'b1:100:2:aaaaaaaa:bbbbbbbb' }))
        expect(headOf(store)).toEqual({ status: 'ok', record: { current: won.generation, convertedFrom: 'b1:100:2:aaaaaaaa:bbbbbbbb' } })
        const loaded = await makeOwner(store).owner.load()
        expect(loaded.kind === 'loaded' && loaded.loaded.convertedFrom).toBe('b1:100:2:aaaaaaaa:bbbbbbbb')
        await owner.replaceWholeState(NEW)
        expect(headOf(store)).toMatchObject({ status: 'ok' })
        expect(parseHead(store.peek(HEAD_KEY) as Uint8Array)).toEqual({ status: 'ok', record: { current: expect.any(String) } })
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