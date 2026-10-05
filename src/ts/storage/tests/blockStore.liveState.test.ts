// @vitest-environment node
/**
 * An owner's live state changes only through its own commit or its own replace
 * (a second load never moves it), a replace whose swap is reported lost but
 * whose head names the new generation is won, a replace that keeps a damaged
 * generation never retires another one, and a read error during the load's
 * race re-read is a read error, not damage.
 */
import { describe, expect, test } from 'vitest'
import { HEAD_KEY, characterBlockKey, generationPrefix, rootKey } from 'src/ts/storage/blockKeys'
import { BlockOwnerStateError, BlockStoreReadError } from 'src/ts/storage/blockStore'
import { encodeHead, type HeadSwap } from 'src/ts/storage/headSwap'
import {
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    seedStore,
    textOf,
    withBlock,
    withCharacter,
    type FakeStore,
} from './blockStoreHarness'

const BASE = makeSet({ characters: [{ chaId: 'alice', data: '{"chaId":"alice","v":"old"}' }] })
const RESTORED = withCharacter(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":"restored"}')), 'carol')
const STALE = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":"stale-edit"}'))

function liveGeneration(store: FakeStore): string {
    const head = store.peek(HEAD_KEY)
    if (head === null) {
        throw new Error('no head')
    }
    return (JSON.parse(textOf(head)) as { current: string }).current
}

describe.each([false, true])('a second load on a live owner (versioned=%s)', (versioned) => {
    test('is refused, and a stale save from the owner still cannot commit over another tab\'s restore', async () => {
        const store = createFakeStore({ versioned })
        await seedStore(store, BASE)
        const a = makeOwner(store)
        const b = makeOwner(store)
        await a.owner.load()
        await b.owner.load()
        const won = await b.owner.replaceWholeState(RESTORED)
        expect(won.kind).toBe('won')
        const restoredGeneration = liveGeneration(store)

        const first = await a.owner.commitSave(STALE)
        expect(first.kind).toBe(versioned ? 'conflict' : 'stopped')

        await expect(a.owner.load()).rejects.toBeInstanceOf(BlockOwnerStateError)
        const second = await a.owner.commitSave(STALE)
        expect(second.kind).toBe(versioned ? 'conflict' : 'stopped')

        expect(textOf(store.peek(characterBlockKey(restoredGeneration, 'alice')))).toContain('restored')
        expect(store.peek(characterBlockKey(restoredGeneration, 'carol'))).not.toBeNull()
        const loadedAgain = await makeOwner(store).owner.load()
        expect(loadedAgain.kind === 'loaded' && loadedAgain.loaded.directory.includes('carol')).toBe(true)
    })

    test('readCommitted reports what the store holds without changing the owner', async () => {
        const store = createFakeStore({ versioned })
        const original = await seedStore(store, BASE)
        const a = makeOwner(store)
        const b = makeOwner(store)
        await a.owner.load()
        await b.owner.load()
        await b.owner.replaceWholeState(RESTORED)

        const read = await a.owner.readCommitted()
        expect(read.kind === 'loaded' && read.loaded.directory.includes('carol')).toBe(true)
        expect(a.owner.committedState()?.generation).toBe(original)
        expect((await a.owner.commitSave(STALE)).kind).toBe(versioned ? 'conflict' : 'stopped')
    })
})

describe('a second load does not clear what the owner recorded (off Node)', () => {
    test('a sticky stop stays after the load is refused and after a non-installing read', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        store.plant(HEAD_KEY, encodeHead({ current: '000000000009-000000ff' }))
        const stopped = await owner.commitSave(STALE)
        expect(stopped).toMatchObject({ kind: 'stopped', reason: 'head-moved' })
        expect(await owner.commitSave(withCharacter(STALE, 'dave'))).toMatchObject({ kind: 'stopped', reason: 'head-moved' })

        store.plant(HEAD_KEY, encodeHead({ current: generation }))
        await expect(owner.load()).rejects.toBeInstanceOf(BlockOwnerStateError)
        await owner.readCommitted()
        expect(await owner.commitSave(withCharacter(STALE, 'erin'))).toMatchObject({ kind: 'stopped', reason: 'head-moved' })
    })

    test('the acknowledged sequence number is not raised to a peer\'s, so the stale save still takes the other-tab path', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        const a = makeOwner(store)
        const b = makeOwner(store)
        await a.owner.load()
        await b.owner.load()
        expect(await b.owner.commitSave(withCharacter(BASE, 'peer'))).toMatchObject({ kind: 'committed', wrote: true, seq: 1 })

        expect(await a.owner.commitSave(STALE)).toMatchObject({ kind: 'stopped', reason: 'peer-commit', peerSeq: 1 })
        await expect(a.owner.load()).rejects.toBeInstanceOf(BlockOwnerStateError)
        await a.owner.readCommitted()
        expect(a.owner.committedState()?.seq).toBe(0)
        expect(await a.owner.commitSave(STALE)).toMatchObject({ kind: 'stopped', reason: 'peer-commit', peerSeq: 1 })
    })
})

describe('load is the installing read of an owner that has not loaded', () => {
    test('an owner a replace made live refuses to load', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        expect((await owner.replaceWholeState(BASE, { requireAbsentHead: true })).kind).toBe('won')
        await expect(owner.load()).rejects.toBeInstanceOf(BlockOwnerStateError)
    })

    test('a load that finds no head or damage installs nothing, and the owner may load again', async () => {
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        expect((await owner.load()).kind).toBe('no-head')
        expect(owner.isLive()).toBe(false)
        await seedStore(store, BASE)
        expect((await owner.load()).kind).toBe('loaded')
        expect(owner.isLive()).toBe(true)
    })
})

describe('a replace whose swap is reported lost but whose head names the new generation', () => {
    test('is won, the previous generation goes, and the owner commits on the new one', async () => {
        const store = createFakeStore({ versioned: false })
        const previous = await seedStore(store, BASE)
        const real = makeOwner(store).headSwap
        const replayed: HeadSwap = {
            read: real.read,
            swap: async (expected, next) => {
                await real.swap(expected, next)
                return 'lost'
            },
        }
        const { owner } = makeOwner(store, { headSwap: replayed })
        const result = await owner.replaceWholeState(RESTORED)
        expect(result.kind).toBe('won')
        if (result.kind !== 'won') {
            return
        }
        expect(result.previous).toEqual({ state: 'deleted', generation: previous })
        expect(store.keys(generationPrefix(previous))).toEqual([])
        expect(liveGeneration(store)).toBe(result.generation)
        expect(owner.committedState()?.generation).toBe(result.generation)
        expect(await owner.commitSave(withCharacter(RESTORED, 'dave'))).toMatchObject({ kind: 'committed', wrote: true })
    })

    test('stays lost and leaves the head on the previous generation when the re-read names it', async () => {
        const store = createFakeStore({ versioned: false })
        const previous = await seedStore(store, BASE)
        const real = makeOwner(store).headSwap
        const refusing: HeadSwap = { read: real.read, swap: async () => 'lost' }
        const { owner } = makeOwner(store, { headSwap: refusing })
        const result = await owner.replaceWholeState(RESTORED)
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-mismatch', ownGenerationDeleted: false })
        expect(liveGeneration(store)).toBe(previous)
        expect(owner.isLive()).toBe(false)
    })
})

describe('a replace that keeps a damaged generation', () => {
    test('retires nothing and writes nothing when another tab replaced in between', async () => {
        const store = createFakeStore({ versioned: false })
        const damaged = await seedStore(store, BASE)
        const other = makeOwner(store)
        await other.owner.load()
        const x = makeOwner(store)

        expect((await other.owner.replaceWholeState(RESTORED)).kind).toBe('won')
        const peerGeneration = liveGeneration(store)
        const before = store.mutating().length

        const result = await x.owner.replaceWholeState(withCharacter(BASE, 'xtra'), { keepDamaged: damaged })
        expect(result).toMatchObject({ kind: 'lost', reason: 'head-moved', ownGenerationDeleted: false })
        expect(store.mutating().length).toBe(before)
        expect(liveGeneration(store)).toBe(peerGeneration)
        expect(store.peek(rootKey(peerGeneration))).not.toBeNull()
        const reloaded = await makeOwner(store).owner.load()
        expect(reloaded.kind === 'loaded' && reloaded.loaded.directory.includes('carol')).toBe(true)
    })

    test('keeps the damaged generation and retires nothing else while the head still names it', async () => {
        const store = createFakeStore({ versioned: false })
        const damaged = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        const result = await owner.replaceWholeState(RESTORED, { keepDamaged: damaged })
        expect(result).toMatchObject({ kind: 'won', previous: { state: 'kept', generation: damaged } })
        expect(store.peek(rootKey(damaged))).not.toBeNull()
    })
})

describe('a read error during the load\'s race re-read', () => {
    async function damagedStore(): Promise<{ store: FakeStore, generation: string }> {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        store.unplant(characterBlockKey(generation, 'alice'))
        return { store, generation }
    }

    test('of the head is a read error of the head, not damage, and nothing is installed', async () => {
        const { store } = await damagedStore()
        const { owner } = makeOwner(store)
        let headReads = 0
        store.faults.push({ match: (op) => op.kind === 'read' && op.key === HEAD_KEY && ++headReads > 1, mode: 'before', times: 100 })
        const error = await owner.load().catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(BlockStoreReadError)
        expect((error as BlockStoreReadError).key).toBe(HEAD_KEY)
        expect(owner.isLive()).toBe(false)
    })

    test('of the root is a read error of the root, not damage', async () => {
        const { store, generation } = await damagedStore()
        const { owner } = makeOwner(store)
        let rootReads = 0
        store.faults.push({ match: (op) => op.kind === 'read' && op.key === rootKey(generation) && ++rootReads > 1, mode: 'before', times: 100 })
        const error = await owner.load().catch((caught: unknown) => caught)
        expect(error).toBeInstanceOf(BlockStoreReadError)
        expect((error as BlockStoreReadError).key).toBe(rootKey(generation))
    })

    test('that succeeds on the damaged state reports the damage', async () => {
        const { store } = await damagedStore()
        const result = await makeOwner(store).owner.load()
        expect(result.kind).toBe('damaged')
    })
})
