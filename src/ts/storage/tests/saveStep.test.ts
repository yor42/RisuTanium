// @vitest-environment node
import { afterEach, describe, expect, test, vi } from 'vitest'
import { BlockTooLargeError, CommitLockTimeoutError, type BlockLayout, type CommitResult, type ReplaceResult } from 'src/ts/storage/blockStore'
import { fingerprintMainFile } from 'src/ts/storage/mainFileFingerprint'
import { getPageStorageMode, resetPageStorageModeForTests, setPageStorageMode } from 'src/ts/storage/pageStorageMode'
import { packedForLayout, performSaveStep, type SaveStepOwner } from 'src/ts/storage/saveStep'
import { createFakeStore, makeSet, textOf } from './blockStoreHarness'

afterEach(() => {
    resetPageStorageModeForTests()
})

const INPUT = makeSet({ characters: [{ chaId: 'alice' }] })

function layoutOf(...keys: string[]): BlockLayout {
    return { keys, blocks: keys.map(() => new Uint8Array([1])) }
}

/** An owner whose answers the test chooses; the calls it received are the evidence. */
function stubOwner(answers: { commit?: () => Promise<CommitResult>, replace?: () => Promise<ReplaceResult>, live?: boolean, seq?: number }) {
    const commitSave = vi.fn<SaveStepOwner['commitSave']>(async () => (answers.commit ? answers.commit() : { kind: 'committed', wrote: true, seq: 1, cleanup: null }))
    const replaceWholeState = vi.fn<SaveStepOwner['replaceWholeState']>(async () => (answers.replace ? answers.replace() : { kind: 'won', generation: 'g', previous: { state: 'none' } }))
    const owner: SaveStepOwner = {
        isLive: () => answers.live ?? true,
        commitSave,
        replaceWholeState,
        committedState: () => (answers.seq === undefined ? null : { seq: answers.seq } as ReturnType<SaveStepOwner['committedState']>),
    }
    return { owner, commitSave, replaceWholeState }
}

describe('packedForLayout', () => {
    test('keeps the archived characters whose block the layout holds and leaves out those it does not', () => {
        const characters = [
            { chaId: 'in-layout', coldstorage: 'unit-1' },
            { chaId: 'appended-meanwhile', coldstorage: 'unit-2' },
            { chaId: 'loaded' },
        ]
        const packed = packedForLayout(layoutOf('root', 'in-layout', 'loaded', 'config'), characters, new Set())
        expect([...packed]).toEqual(['in-layout'])
    })

    test('leaves out a frozen key and a name held twice, as the packing rule does', () => {
        const characters = [
            { chaId: 'frozen', coldstorage: 'unit-1' },
            { chaId: 'twice', coldstorage: 'unit-2' },
            { chaId: 'twice', coldstorage: 'unit-3' },
            { chaId: 'fine', coldstorage: 'unit-4' },
        ]
        const packed = packedForLayout(layoutOf('root', 'frozen', 'twice', 'fine', 'config'), characters, new Set(['frozen']))
        expect([...packed]).toEqual(['fine'])
    })
})

describe('performSaveStep on a block page', () => {
    test('maps a landed commit, and carries Save mine through only when asked', async () => {
        const { owner, commitSave } = stubOwner({ commit: async () => ({ kind: 'committed', wrote: false, seq: 4, cleanup: null }) })
        const store = createFakeStore({ versioned: false })
        setPageStorageMode({ kind: 'block' })
        expect(await performSaveStep({ owner, store }, { input: INPUT })).toEqual({ kind: 'saved', wrote: false, seq: 4, converted: false, mainFileLeftInPlace: false })
        expect(commitSave).toHaveBeenLastCalledWith(INPUT, {})
        await performSaveStep({ owner, store }, { input: INPUT, saveMine: { peerSeq: 7 } })
        expect(commitSave).toHaveBeenLastCalledWith(INPUT, { saveMine: { peerSeq: 7 } })
    })

    test.each([
        ['peer-commit', 3],
        ['head-moved', null],
        ['generation-gone', null],
    ] as const)('maps a commit stopped for %s', async (reason, peerSeq) => {
        const { owner } = stubOwner({ commit: async () => ({ kind: 'stopped', reason, peerSeq }) })
        setPageStorageMode({ kind: 'block' })
        expect(await performSaveStep({ owner, store: createFakeStore({ versioned: false }) }, { input: INPUT })).toEqual({ kind: 'stopped', reason, peerSeq })
    })

    test('maps a Node conflict, a block over the limit and a commit lock that timed out to values', async () => {
        const store = createFakeStore({ versioned: true })
        setPageStorageMode({ kind: 'block' })
        const conflict = stubOwner({ commit: async () => ({ kind: 'conflict', key: 'blocks/x/root' }) })
        expect(await performSaveStep({ owner: conflict.owner, store }, { input: INPUT })).toEqual({ kind: 'conflict', key: 'blocks/x/root' })
        const big = stubOwner({ commit: async () => { throw new BlockTooLargeError('alice', 9000, 4096) } })
        expect(await performSaveStep({ owner: big.owner, store }, { input: INPUT })).toEqual({ kind: 'too-large', blockName: 'alice', length: 9000, limit: 4096 })
        const slow = stubOwner({ commit: async () => { throw new CommitLockTimeoutError(true) } })
        expect(await performSaveStep({ owner: slow.owner, store }, { input: INPUT })).toEqual({ kind: 'lock-timeout' })
    })

    test('lets any other failure reach the caller, which classifies it', async () => {
        const { owner } = stubOwner({ commit: async () => { throw new Error('the disk is full') } })
        setPageStorageMode({ kind: 'block' })
        await expect(performSaveStep({ owner, store: createFakeStore({ versioned: false }) }, { input: INPUT })).rejects.toThrow('the disk is full')
    })

    test('a read-only page does not save', async () => {
        const { owner, commitSave, replaceWholeState } = stubOwner({})
        setPageStorageMode({ kind: 'read-only' })
        await expect(performSaveStep({ owner, store: createFakeStore({ versioned: false }) }, { input: INPUT })).rejects.toThrow('read-only')
        expect(commitSave).not.toHaveBeenCalled()
        expect(replaceWholeState).not.toHaveBeenCalled()
    })

    test('a page whose owner is live commits even while its mode still says legacy', async () => {
        const { owner, commitSave, replaceWholeState } = stubOwner({ live: true })
        setPageStorageMode({ kind: 'legacy', convertedFrom: 'x' })
        await performSaveStep({ owner, store: createFakeStore({ versioned: false }) }, { input: INPUT })
        expect(commitSave).toHaveBeenCalledTimes(1)
        expect(replaceWholeState).not.toHaveBeenCalled()
    })
})

describe('performSaveStep on a legacy page: the conversion', () => {
    const MAIN = new TextEncoder().encode('the legacy main file')

    test('asks for a replace against "no head" that names the main file boot read, and a win makes the page a block page and moves the main file aside', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant('database/database.bin', MAIN)
        const { owner, replaceWholeState } = stubOwner({ live: false, seq: 0 })
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(MAIN) })
        const before = Date.now()
        const step = await performSaveStep({ owner, store }, { input: INPUT })
        expect(step).toEqual({ kind: 'saved', wrote: true, seq: 0, converted: true, mainFileLeftInPlace: false })
        const options = replaceWholeState.mock.calls[0][1]!
        expect(options.requireAbsentHead).toBe(true)
        expect(options.convertedFrom).toBe(fingerprintMainFile(MAIN))
        expect(options.convertedAt).toBeGreaterThanOrEqual(before)
        expect(getPageStorageMode()).toEqual({ kind: 'block' })
        expect(store.peek('database/database.bin')).toBeNull()
        const moved = store.keys('database/').filter((key) => key.startsWith('database/database.pre-blocks'))
        expect(moved).toHaveLength(1)
        expect(textOf(store.peek(moved[0]))).toBe('the legacy main file')
    })

    test('a profile with no main file converts without naming one', async () => {
        const { owner, replaceWholeState } = stubOwner({ live: false })
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        await performSaveStep({ owner, store: createFakeStore({ versioned: false }) }, { input: INPUT })
        const options = replaceWholeState.mock.calls[0][1]!
        expect(options.convertedFrom).toBeUndefined()
        expect(options.convertedAt).toBeUndefined()
    })

    test('a main file the Node server would refuse to copy stays where it is and the result says so', async () => {
        const store = createFakeStore({ versioned: true })
        const big = new Uint8Array(5000).fill(7)
        store.plant('database/database.bin', big)
        const { owner } = stubOwner({ live: false })
        setPageStorageMode({ kind: 'legacy', convertedFrom: fingerprintMainFile(big) })
        const step = await performSaveStep({ owner, store, nodeBodyLimit: 4096 }, { input: INPUT })
        expect(step).toMatchObject({ kind: 'saved', converted: true, mainFileLeftInPlace: true })
        expect(store.peek('database/database.bin')).not.toBeNull()
    })

    test.each([
        ['head-exists'],
        ['head-moved'],
        ['head-mismatch'],
    ] as const)('a replace lost with %s means another page converted the profile', async (reason) => {
        const { owner } = stubOwner({ live: false, replace: async () => ({ kind: 'lost', reason, generation: null, ownGenerationDeleted: false }) })
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        expect(await performSaveStep({ owner, store: createFakeStore({ versioned: false }) }, { input: INPUT })).toEqual({ kind: 'stopped', reason: 'converted-elsewhere', peerSeq: null })
        expect(getPageStorageMode().kind).toBe('legacy')
    })

    test('a generation that did not read back is removed and reported as a storage failure, not as another page', async () => {
        const store = createFakeStore({ versioned: false })
        store.plant('blocks/0123456789ab-01234567/root', new Uint8Array([1]))
        store.plant('blocks/0123456789ab-01234567/f/preset', new Uint8Array([2]))
        const { owner } = stubOwner({
            live: false,
            replace: async () => ({ kind: 'lost', reason: 'generation-damaged', generation: '0123456789ab-01234567', ownGenerationDeleted: false }),
        })
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        expect(await performSaveStep({ owner, store }, { input: INPUT })).toEqual({ kind: 'conversion-damaged', generation: '0123456789ab-01234567' })
        expect(store.keys('blocks/')).toEqual([])
        expect(getPageStorageMode().kind).toBe('legacy')
    })

    test('an unconfirmed switch and a block over the limit are reported as such', async () => {
        const store = createFakeStore({ versioned: false })
        setPageStorageMode({ kind: 'legacy', convertedFrom: null })
        const unconfirmed = stubOwner({ live: false, replace: async () => ({ kind: 'unconfirmed', reason: 'unchanged', generation: 'g' }) })
        expect(await performSaveStep({ owner: unconfirmed.owner, store }, { input: INPUT })).toEqual({ kind: 'unconfirmed' })
        const refused = stubOwner({ live: false, replace: async () => ({ kind: 'refused', blockName: 'alice', length: 9000, limit: 4096 }) })
        expect(await performSaveStep({ owner: refused.owner, store }, { input: INPUT })).toEqual({ kind: 'too-large', blockName: 'alice', length: 9000, limit: 4096 })
        expect(getPageStorageMode().kind).toBe('legacy')
    })
})
