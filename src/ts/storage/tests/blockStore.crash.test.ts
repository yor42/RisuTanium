// @vitest-environment node
/**
 * Crash-point harness. A crash is modelled as the store being read by a fresh
 * owner right after any single applied write or delete: every mutation of a
 * commit or a replace is a possible last mutation. The store holds exactly
 * what was applied; nothing an owner kept in memory survives.
 *
 * Two writers on one store are interleaved by a scheduler that decides, at every
 * store call, which owner's call goes next, so races between the owners'
 * individual writes are reproduced from a seed.
 */
import { describe, expect, test } from 'vitest'
import { bytesEqual } from 'src/ts/storage/blockFrame'
import type { BlockSetInput, LoadResult, LoadedBlocks } from 'src/ts/storage/blockStore'
import { createMutexHeadSwap } from 'src/ts/storage/headSwap'
import {
    Interleaver,
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    seededPick,
    seedStore,
    withBlock,
    withCharacter,
    withPacked,
    withoutBlock,
    type FakeStore,
    type StoreOp,
} from './blockStoreHarness'

interface Checkpoint {
    op: StoreOp
    result: LoadResult
}

function namedBlocks(input: BlockSetInput): Map<string, Uint8Array> {
    const out = new Map<string, Uint8Array>()
    input.layout.keys.forEach((key, i) => {
        if (key !== 'root') {
            out.set(key, input.layout.blocks[i])
        }
    })
    return out
}

function sameState(loaded: LoadedBlocks, input: BlockSetInput): boolean {
    const wanted = namedBlocks(input)
    if (loaded.directory.length !== wanted.size || !loaded.directory.every((name) => wanted.has(name))) {
        return false
    }
    return loaded.directory.every((name) => {
        const stored = loaded.blocks.get(name)
        return stored !== undefined && bytesEqual(stored, wanted.get(name) as Uint8Array)
    })
}

/** Every listed name resolves: the loaded blocks are, name for name, one of the given versions. */
function eachBlockIsOneOf(loaded: LoadedBlocks, versions: readonly BlockSetInput[]): boolean {
    const maps = versions.map(namedBlocks)
    return loaded.directory.every((name) => {
        const stored = loaded.blocks.get(name)
        return stored !== undefined && maps.some((map) => map.has(name) && bytesEqual(map.get(name) as Uint8Array, stored))
    })
}

function checkedStore(versioned: boolean, checkpoints: Checkpoint[]): FakeStore {
    let store!: FakeStore
    store = createFakeStore({
        versioned,
        onMutation: async (op) => {
            const result = await makeOwner(store.cloneUngated()).owner.load()
            checkpoints.push({ op, result })
        },
    })
    return store
}

function expectNeverDamaged(checkpoints: readonly Checkpoint[], context: string): void {
    for (const checkpoint of checkpoints) {
        expect(checkpoint.result.kind, `${context}: after ${checkpoint.op.kind} ${checkpoint.op.key}`).not.toBe('damaged')
    }
}

const S0 = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }, { chaId: 'quiet' }], packed: ['stubby', 'quiet'], rootFields: { lang: 'en' } })

const SAVES: Array<{ title: string, next: BlockSetInput }> = [
    { title: 'a chat message', next: withBlock(S0, 'alice', characterBlock('alice', '{"chaId":"alice","chats":[1]}')) },
    { title: 'a character added', next: withCharacter(S0, 'carol') },
    { title: 'a character deleted', next: withoutBlock(S0, 'bob') },
    { title: 'an own character archived', next: withPacked(S0, ['stubby', 'quiet', 'alice']) },
    { title: 'an archived character restored', next: withPacked(S0, ['stubby']) },
    { title: 'every archived character restored', next: withPacked(S0, []) },
    { title: 'a stub edited', next: withBlock(S0, 'quiet', characterBlock('quiet', '{"chaId":"quiet","trashed":true}')) },
    { title: 'an archived character deleted', next: withoutBlock(S0, 'stubby') },
    { title: 'archive one, restore another and delete a third at once', next: withoutBlock(withPacked(S0, ['quiet', 'alice']), 'bob') },
]

describe.each([{ versioned: true }, { versioned: false }])('one writer: every crash point of a save resolves (invariants C, 3, versioned=$versioned)', ({ versioned }) => {
    test.each(SAVES)('$title', async ({ next }) => {
        const checkpoints: Checkpoint[] = []
        const store = checkedStore(versioned, checkpoints)
        await seedStore(store, S0)
        checkpoints.length = 0
        const { owner } = makeOwner(store)
        expect((await owner.load()).kind).toBe('loaded')
        const result = await owner.commitSave(next)
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        expect(checkpoints.length).toBeGreaterThan(1)
        expectNeverDamaged(checkpoints, 'save')
        for (const checkpoint of checkpoints) {
            if (checkpoint.result.kind !== 'loaded') {
                throw new Error('unreachable')
            }
            const directoryIsOld = checkpoint.result.loaded.directory.join() === Array.from(namedBlocks(S0).keys()).join()
            const directoryIsNew = checkpoint.result.loaded.directory.join() === Array.from(namedBlocks(next).keys()).join()
            expect(directoryIsOld || directoryIsNew, `directory after ${checkpoint.op.kind} ${checkpoint.op.key}`).toBe(true)
            expect(eachBlockIsOneOf(checkpoint.result.loaded, [S0, next]), `blocks after ${checkpoint.op.kind} ${checkpoint.op.key}`).toBe(true)
        }
        const last = checkpoints[checkpoints.length - 1].result
        expect(last.kind === 'loaded' && sameState(last.loaded, next)).toBe(true)
        const final = await makeOwner(store.cloneUngated()).owner.load()
        expect(final.kind === 'loaded' && sameState(final.loaded, next)).toBe(true)
    })

    test('a write that fails halfway leaves a loadable store, and the retry completes the save', async () => {
        const next = withoutBlock(withPacked(S0, ['quiet', 'alice']), 'bob')
        const probe = createFakeStore({ versioned })
        await seedStore(probe, S0)
        const probeOwner = makeOwner(probe)
        await probeOwner.owner.load()
        const mutationsBefore = probe.mutating().length
        await probeOwner.owner.commitSave(next)
        const keyCount = probe.mutating().length - mutationsBefore
        for (let failAt = 0; failAt < keyCount; failAt++) {
            const checkpoints: Checkpoint[] = []
            const store = checkedStore(versioned, checkpoints)
            await seedStore(store, S0)
            const { owner } = makeOwner(store)
            await owner.load()
            checkpoints.length = 0
            let seen = 0
            store.faults.push({ match: (op) => (op.kind === 'write' || op.kind === 'delete' || op.kind === 'deleteMany') && seen++ === failAt, mode: 'before' })
            const first = await owner.commitSave(next).then((result) => result, () => null)
            const second = first !== null && first.kind === 'committed' ? first : await owner.commitSave(next)
            expect(second.kind, `fail at mutation ${failAt}`).toBe('committed')
            expectNeverDamaged(checkpoints, `fail at ${failAt}`)
            const final = await makeOwner(store.cloneUngated()).owner.load()
            expect(final.kind === 'loaded' && sameState(final.loaded, next), `fail at ${failAt}: the retried save reaches the new state`).toBe(true)
        }
    })
})

describe.each([{ versioned: true }, { versioned: false }])('a whole-state replace: the previous state stays live until the flip (invariant R, versioned=$versioned)', ({ versioned }) => {
    test('every crash point shows the previous state in full or the new state in full', async () => {
        const next = withoutBlock(withCharacter(withPacked(S0, ['stubby']), 'carol'), 'bob')
        const checkpoints: Checkpoint[] = []
        const store = checkedStore(versioned, checkpoints)
        await seedStore(store, S0)
        checkpoints.length = 0
        const { owner } = makeOwner(store)
        await owner.load()
        const result = await owner.replaceWholeState(next)
        expect(result.kind).toBe('won')
        expect(checkpoints.length).toBeGreaterThan(8)
        expectNeverDamaged(checkpoints, 'replace')
        let flipped = false
        for (const checkpoint of checkpoints) {
            if (checkpoint.result.kind !== 'loaded') {
                throw new Error('unreachable')
            }
            const old = sameState(checkpoint.result.loaded, S0)
            const fresh = sameState(checkpoint.result.loaded, next)
            expect(old || fresh, `after ${checkpoint.op.kind} ${checkpoint.op.key}`).toBe(true)
            if (checkpoint.op.kind === 'write' && checkpoint.op.key === 'blocks/head') {
                flipped = true
            }
            expect(fresh, `the new state is live exactly from the flip (after ${checkpoint.op.kind} ${checkpoint.op.key})`).toBe(flipped)
        }
        expect(flipped).toBe(true)
    })

    test('a replace that stops at any single mutation leaves the previous state live', async () => {
        const next = withCharacter(S0, 'carol')
        const probeStore = createFakeStore({ versioned })
        await seedStore(probeStore, S0)
        const probeOwner = makeOwner(probeStore)
        await probeOwner.owner.load()
        const before = probeStore.mutating().length
        await probeOwner.owner.replaceWholeState(next)
        const total = probeStore.mutating().length - before
        for (let failAt = 0; failAt < total; failAt++) {
            const store = createFakeStore({ versioned })
            await seedStore(store, S0)
            const { owner } = makeOwner(store)
            await owner.load()
            let seen = 0
            store.faults.push({ match: (op) => (op.kind === 'write' || op.kind === 'delete' || op.kind === 'deleteMany') && seen++ === failAt, mode: 'before' })
            const result = await owner.replaceWholeState(next).then((value) => value, () => null)
            const reload = await makeOwner(store.cloneUngated()).owner.load()
            expect(reload.kind, `fail at ${failAt}`).toBe('loaded')
            if (reload.kind === 'loaded') {
                const isOld = sameState(reload.loaded, S0)
                const isNew = sameState(reload.loaded, next)
                expect(isOld || isNew, `fail at ${failAt}`).toBe(true)
                if (result === null) {
                    // A rejected replace had not flipped, unless the failing call was a delete after the flip.
                    expect(isOld || store.ops.some((op) => op.kind === 'write' && op.key === 'blocks/head'), `fail at ${failAt}`).toBe(true)
                }
            }
        }
    })
})

describe('Save mine keeps every durable root resolvable at each step (invariant S)', () => {
    test('the peer\'s pack and the peer\'s root stay loadable between this tab\'s pack write and its root write', async () => {
        const checkpoints: Checkpoint[] = []
        const store = checkedStore(false, checkpoints)
        await seedStore(store, S0)
        const mine = makeOwner(store)
        const peer = makeOwner(store)
        await mine.owner.load()
        await peer.owner.load()
        await peer.owner.commitSave(withPacked(S0, ['stubby', 'quiet', 'alice']))
        const edited = withBlock(S0, 'bob', characterBlock('bob', '{"chaId":"bob","edited":true}'))
        const stopped = await mine.owner.commitSave(edited)
        if (stopped.kind !== 'stopped' || stopped.peerSeq === null) {
            throw new Error('expected a peer sequence')
        }
        checkpoints.length = 0
        const saved = await mine.owner.commitSave(edited, { saveMine: { peerSeq: stopped.peerSeq } })
        expect(saved).toMatchObject({ kind: 'committed', wrote: true })
        expect(checkpoints.length).toBeGreaterThan(2)
        expectNeverDamaged(checkpoints, 'save mine')
        const final = await makeOwner(store.cloneUngated()).owner.load()
        expect(final.kind).toBe('loaded')
    })
})
describe('two writers on one store (invariants C and G)', () => {
    function viewOf(store: FakeStore, interleaver: Interleaver, task: number): FakeStore {
        return new Proxy(store, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver)
                if (typeof value !== 'function' || !['read', 'write', 'delete', 'deleteMany', 'list', 'has'].includes(String(property))) {
                    return value
                }
                return async (...args: unknown[]) => {
                    await interleaver.gate(task)()
                    return (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args)
                }
            },
        })
    }

    const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1)

    test.each([{ versioned: false }, { versioned: true }])('two tabs or devices committing different changes: no crash point loses a listed name (versioned=$versioned)', async ({ versioned }) => {
        const outcomes = new Map<string, number>()
        for (const seed of SEEDS) {
            const checkpoints: Checkpoint[] = []
            const store = checkedStore(versioned, checkpoints)
            await seedStore(store, S0)
            const interleaver = new Interleaver(seededPick(seed))
            const a = makeOwner(viewOf(store, interleaver, 0), { commitLock: interleaver.lockFor(0) })
            const b = makeOwner(viewOf(store, interleaver, 1), { commitLock: interleaver.lockFor(1) })
            await a.owner.load()
            await b.owner.load()
            checkpoints.length = 0
            const results = await interleaver.run([
                () => a.owner.commitSave(withoutBlock(withPacked(S0, ['quiet', 'alice']), 'bob')),
                () => b.owner.commitSave(withBlock(withCharacter(S0, 'dave'), 'bob', characterBlock('bob', '{"chaId":"bob","by":"b"}'))),
            ])
            expectNeverDamaged(checkpoints, `seed ${seed}`)
            expect((await makeOwner(store.cloneUngated()).owner.load()).kind, `seed ${seed} final`).toBe('loaded')
            const key = results.map((result) => result.kind).join('+')
            outcomes.set(key, (outcomes.get(key) ?? 0) + 1)
        }
        // The scheduler must actually produce more than one race outcome, or the seeds explore nothing.
        expect(outcomes.size).toBeGreaterThan(1)
    })

    test.each([{ versioned: false }, { versioned: true }])('a save racing a whole-state replace: the save is followed by a stop or refused, and the store loads (versioned=$versioned)', async ({ versioned }) => {
        for (const seed of SEEDS) {
            const checkpoints: Checkpoint[] = []
            const store = checkedStore(versioned, checkpoints)
            await seedStore(store, S0)
            const interleaver = new Interleaver(seededPick(seed * 31))
            const saver = makeOwner(viewOf(store, interleaver, 0), { commitLock: interleaver.lockFor(0) })
            const replacer = makeOwner(viewOf(store, interleaver, 1))
            await saver.owner.load()
            await replacer.owner.load()
            checkpoints.length = 0
            const replacement = withCharacter(S0, 'newcomer')
            const results = await interleaver.run<{ kind: string }>([
                () => saver.owner.commitSave(withBlock(S0, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}'))),
                () => replacer.owner.replaceWholeState(replacement),
            ])
            expect(results[1].kind, `seed ${seed}`).toBe('won')
            expect(['committed', 'stopped', 'conflict'], `seed ${seed}`).toContain(results[0].kind)
            expectNeverDamaged(checkpoints, `seed ${seed}`)
            const final = await makeOwner(store.cloneUngated()).owner.load()
            expect(final.kind === 'loaded' && sameState(final.loaded, replacement), `seed ${seed}: the replacement is what loads`).toBe(true)
            // After the replace, the saver's next commit is refused or stopped, never accepted into the retired generation.
            const next = await saver.owner.commitSave(withBlock(S0, 'alice', characterBlock('alice', '{"chaId":"alice","v":3}'))).then((result) => result.kind, () => 'rejected')
            expect(['stopped', 'conflict', 'rejected'], `seed ${seed}: next commit`).toContain(next)
        }
    })

    test('two converters racing against no head: exactly one generation becomes live and it loads (invariant H)', async () => {
        for (const versioned of [false, true]) {
            for (const seed of SEEDS.slice(0, 30)) {
                const checkpoints: Checkpoint[] = []
                const store = checkedStore(versioned, checkpoints)
                const interleaver = new Interleaver(seededPick(seed))
                // Every owner shares one store object in production, so the desktop mutex is shared; the views here are per task.
                const headSwap = versioned ? undefined : createMutexHeadSwap(store)
                const a = makeOwner(viewOf(store, interleaver, 0), { headSwap })
                const b = makeOwner(viewOf(store, interleaver, 1), { headSwap })
                const inputA = withCharacter(S0, 'from-a')
                const inputB = withCharacter(S0, 'from-b')
                const results = await interleaver.run([
                    () => a.owner.replaceWholeState(inputA, { requireAbsentHead: true }),
                    () => b.owner.replaceWholeState(inputB, { requireAbsentHead: true }),
                ])
                expect(results.filter((result) => result.kind === 'won').length, `versioned=${versioned} seed ${seed}`).toBe(1)
                expect(results.filter((result) => result.kind === 'lost').length).toBe(1)
                expectNeverDamaged(checkpoints, `seed ${seed}`)
                const winner = results[0].kind === 'won' ? inputA : inputB
                const final = await makeOwner(store.cloneUngated()).owner.load()
                expect(final.kind === 'loaded' && sameState(final.loaded, winner), `versioned=${versioned} seed ${seed}`).toBe(true)
            }
        }
    })

    test('a boot racing another owner\'s commit does not report damage (scenario 12)', async () => {
        for (const seed of SEEDS.slice(0, 30)) {
            const store = createFakeStore({ versioned: false })
            await seedStore(store, S0)
            const interleaver = new Interleaver(seededPick(seed))
            const writer = makeOwner(viewOf(store, interleaver, 0), { commitLock: interleaver.lockFor(0) })
            const booter = makeOwner(viewOf(store, interleaver, 1))
            await writer.owner.load()
            const results = await interleaver.run<{ kind: string }>([
                () => writer.owner.commitSave(withoutBlock(withPacked(S0, ['quiet', 'alice']), 'bob')),
                () => booter.owner.load(),
            ])
            expect(results[1].kind, `seed ${seed}`).toBe('loaded')
        }
    })
})
