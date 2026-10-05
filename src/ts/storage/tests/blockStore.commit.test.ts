// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { parseJsonObjectBlock } from 'src/ts/storage/blockFrame'
import { HEAD_KEY, characterBlockKey, rootKey, stubsKey } from 'src/ts/storage/blockKeys'
import { BlockSetInvalidError, BlockTooLargeError, createProcessCommitLock, createWebCommitLock, CommitLockTimeoutError, type CommitResult } from 'src/ts/storage/blockStore'
import {
    InjectedFault,
    Interleaver,
    SharedLockCore,
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    passthroughLock,
    seedStore,
    textOf,
    withBlock,
    withCharacter,
    withPacked,
    withRootFields,
    withoutBlock,
    type FakeStore,
} from './blockStoreHarness'

const BASE = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }], packed: ['stubby'], rootFields: { lang: 'en' } })

async function booted(versioned: boolean, input = BASE) {
    const store = createFakeStore({ versioned })
    const generation = await seedStore(store, input)
    const bundle = makeOwner(store)
    const loaded = await bundle.owner.load()
    if (loaded.kind !== 'loaded') {
        throw new Error('seeded store did not load')
    }
    return { store, generation, ...bundle }
}

function seqOf(store: FakeStore, generation: string): number {
    return parseJsonObjectBlock(store.peek(rootKey(generation)) as Uint8Array, 'root').fields.__seq as number
}

function mutations(store: FakeStore, from: number): string[] {
    return store.ops.slice(from).filter((op) => op.kind === 'write' || op.kind === 'delete' || op.kind === 'deleteMany').map((op) =>
        op.kind === 'deleteMany' ? `deleteMany ${op.keys.join(',')}` : `${op.kind} ${op.key}`)
}

describe.each([{ versioned: true }, { versioned: false }])('commitSave with versioned=$versioned', ({ versioned }) => {
    test('a chat message writes that character\'s key and the root, nothing else (scenario 1, invariants 5 and 7)', async () => {
        const { store, generation, owner } = await booted(versioned)
        const start = store.ops.length
        const changed = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","chats":[{"m":"hi"}]}'))
        const result = await owner.commitSave(changed)
        expect(result).toMatchObject({ kind: 'committed', wrote: true, seq: 1 })
        const writes = mutations(store, start)
        expect(writes).toEqual([`write ${characterBlockKey(generation, 'alice')}`, `write ${rootKey(generation)}`])
        expect(seqOf(store, generation)).toBe(1)
        expect(textOf(store.peek(characterBlockKey(generation, 'alice')))).toBe(textOf(characterBlock('alice', '{"chaId":"alice","chats":[{"m":"hi"}]}')))
    })

    test('the root is written with the sequence plus one even when its own content is unchanged', async () => {
        const { store, generation, owner } = await booted(versioned)
        await owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","n":1}')))
        await owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","n":2}')))
        expect(seqOf(store, generation)).toBe(2)
    })

    test('a save with nothing changed writes nothing and reads nothing (scenario 2)', async () => {
        const { store, owner } = await booted(versioned)
        const start = store.ops.length
        expect(await owner.commitSave(BASE)).toMatchObject({ kind: 'committed', wrote: false })
        expect(await owner.commitSave(BASE)).toMatchObject({ kind: 'committed', wrote: false })
        expect(store.ops.slice(start)).toEqual([])
    })

    test('the first save of an unchanged character after a changed one writes it again (return to origin, invariant 10)', async () => {
        const { store, generation, owner } = await booted(versioned)
        const original = BASE
        const changed = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}'))
        await owner.commitSave(changed)
        const start = store.ops.length
        await owner.commitSave(original)
        expect(mutations(store, start)).toEqual([`write ${characterBlockKey(generation, 'alice')}`, `write ${rootKey(generation)}`])
        expect(store.peek(characterBlockKey(generation, 'alice'))).toEqual(characterBlock('alice'))
        expect(seqOf(store, generation)).toBe(2)
    })

    test('a root field changed and changed back writes the root each time (return to origin, invariant 10)', async () => {
        const { store, generation, owner } = await booted(versioned)
        const rootBytesOf = () => store.peek(rootKey(generation)) as Uint8Array
        const original = rootBytesOf()
        await owner.commitSave(withRootFields(BASE, { lang: 'ko' }))
        expect(parseJsonObjectBlock(rootBytesOf(), 'root').fields.lang).toBe('ko')
        await owner.commitSave(withRootFields(BASE, { lang: 'en' }))
        expect(parseJsonObjectBlock(rootBytesOf(), 'root').fields.lang).toBe('en')
        expect(seqOf(store, generation)).toBe(2)
        expect(rootBytesOf().length).toBe(original.length)
    })

    test('a write that threw is rewritten by the next save even when the bytes equal what was stored before', async () => {
        const { store, generation, owner } = await booted(versioned)
        const key = characterBlockKey(generation, 'alice')
        const changed = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}'))
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === key, mode: 'before' })
        await expect(owner.commitSave(changed)).rejects.toBeInstanceOf(InjectedFault)
        // The caller gives up on the change and the next iteration offers the original bytes again.
        const start = store.ops.length
        await owner.commitSave(BASE)
        expect(mutations(store, start)).toContain(`write ${key}`)
        expect(store.peek(key)).toEqual(characterBlock('alice'))
    })

    test('a throwing root write leaves the root unacknowledged, so the next save writes it again', async () => {
        const { store, generation, owner } = await booted(versioned)
        const changed = withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","v":2}'))
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === rootKey(generation), mode: 'before' })
        await expect(owner.commitSave(changed)).rejects.toBeInstanceOf(InjectedFault)
        const result = await owner.commitSave(changed)
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        expect(seqOf(store, generation)).toBe(1)
    })

    test('a root write that landed and then threw is not taken for a save with nothing to write when the next save equals the acknowledged state (return to origin, invariant 10)', async () => {
        const { store, generation, owner } = await booted(versioned)
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === rootKey(generation), mode: 'after' })
        await expect(owner.commitSave(withRootFields(BASE, { lang: 'ko' }))).rejects.toBeInstanceOf(InjectedFault)
        expect(parseJsonObjectBlock(store.peek(rootKey(generation)) as Uint8Array, 'root').fields.lang).toBe('ko')
        // The caller goes back to the state it last had acknowledged; the store holds the other one.
        const result = await owner.commitSave(BASE)
        expect(result).not.toMatchObject({ kind: 'committed', wrote: false })
        if (versioned) {
            expect(result).toMatchObject({ kind: 'conflict', key: rootKey(generation) })
        } else {
            expect(result).toMatchObject({ kind: 'stopped', reason: 'peer-commit', peerSeq: 1 })
        }
        expect(parseJsonObjectBlock(store.peek(rootKey(generation)) as Uint8Array, 'root').fields.lang).toBe('ko')
    })

    test('adding a character writes its key then the root; deleting one removes it only after the root commits', async () => {
        const { store, generation, owner } = await booted(versioned)
        let start = store.ops.length
        await owner.commitSave(withCharacter(BASE, 'carol'))
        expect(mutations(store, start)).toEqual([`write ${characterBlockKey(generation, 'carol')}`, `write ${rootKey(generation)}`])
        start = store.ops.length
        await owner.commitSave(withoutBlock(withCharacter(BASE, 'carol'), 'alice'))
        expect(mutations(store, start)).toEqual([`write ${rootKey(generation)}`, `deleteMany ${characterBlockKey(generation, 'alice')}`])
        expect(store.peek(characterBlockKey(generation, 'alice'))).toBeNull()
    })

    test('archiving writes the pack with the old and new members, then the root, then removes the own key; the pack is never trimmed first', async () => {
        const { store, generation, owner } = await booted(versioned)
        const start = store.ops.length
        await owner.commitSave(withPacked(BASE, ['stubby', 'alice']))
        const writes = mutations(store, start)
        expect(writes[0]).toBe(`write ${stubsKey(generation)}`)
        expect(writes[1]).toBe(`write ${rootKey(generation)}`)
        expect(writes[2]).toBe(`deleteMany ${characterBlockKey(generation, 'alice')}`)
        const root = parseJsonObjectBlock(store.peek(rootKey(generation)) as Uint8Array, 'root').fields
        expect(root.__packed).toEqual(['alice', 'stubby'].sort((a, b) => ['alice', 'bob', 'stubby'].indexOf(a) - ['alice', 'bob', 'stubby'].indexOf(b)))
    })

    test('restoring an archived character writes its own key, then the root, then trims the pack', async () => {
        const { store, generation, owner } = await booted(versioned)
        await owner.commitSave(withPacked(BASE, ['stubby', 'alice']))
        const start = store.ops.length
        await owner.commitSave(BASE)
        const writes = mutations(store, start)
        expect(writes[0]).toBe(`write ${characterBlockKey(generation, 'alice')}`)
        expect(writes[1]).toBe(`write ${rootKey(generation)}`)
        expect(writes[2]).toBe(`write ${stubsKey(generation)}`)
    })

    test('emptying the pack removes the pack key after the root', async () => {
        const { store, generation, owner } = await booted(versioned)
        const start = store.ops.length
        await owner.commitSave(withPacked(BASE, []))
        const writes = mutations(store, start)
        expect(writes).toEqual([`write ${characterBlockKey(generation, 'stubby')}`, `write ${rootKey(generation)}`, `deleteMany ${stubsKey(generation)}`])
    })

    test('a stub edited in place rewrites the pack and the root', async () => {
        const { store, generation, owner } = await booted(versioned)
        const start = store.ops.length
        await owner.commitSave(withBlock(BASE, 'stubby', characterBlock('stubby', '{"chaId":"stubby","trashed":true}')))
        expect(mutations(store, start)).toEqual([`write ${stubsKey(generation)}`, `write ${rootKey(generation)}`])
    })

    test('a fixed block missing from the save is refused before anything is written', async () => {
        const { store, owner } = await booted(versioned)
        const start = store.ops.length
        await expect(owner.commitSave(withoutBlock(BASE, 'preset'))).rejects.toBeInstanceOf(BlockSetInvalidError)
        expect(store.ops.slice(start)).toEqual([])
    })

    test('nothing in a save ever writes the main file or the head (invariant H)', async () => {
        const { store, owner } = await booted(versioned)
        await owner.commitSave(withCharacter(BASE, 'carol'))
        await owner.commitSave(withPacked(BASE, ['alice']))
        const touched = store.mutating().map((op) => (op.kind === 'deleteMany' ? op.keys : [op.key])).flat()
        expect(touched).not.toContain('database/database.bin')
        expect(store.ops.slice(-20).filter((op) => op.kind === 'write' && op.key === HEAD_KEY)).toEqual([])
    })
})

describe('return to origin after a replace, without a load (invariant 10)', () => {
    test.each([{ versioned: true }, { versioned: false }])('a root field changed and changed back is written each time (versioned=$versioned)', async ({ versioned }) => {
        const store = createFakeStore({ versioned })
        const { owner } = makeOwner(store)
        const won = await owner.replaceWholeState(BASE, { requireAbsentHead: true })
        if (won.kind !== 'won') {
            throw new Error('seed failed')
        }
        const langOf = () => parseJsonObjectBlock(store.peek(rootKey(won.generation)) as Uint8Array, 'root').fields.lang
        expect(langOf()).toBe('en')
        await owner.commitSave(withRootFields(BASE, { lang: 'ko' }))
        expect(langOf()).toBe('ko')
        await owner.commitSave(withRootFields(BASE, { lang: 'en' }))
        expect(langOf()).toBe('en')
    })

    test.each([{ versioned: true }, { versioned: false }])('a stub edited and edited back rewrites the pack each time (trash and untrash, versioned=$versioned)', async ({ versioned }) => {
        const { store, generation, owner } = await booted(versioned)
        const packOf = () => store.peek(stubsKey(generation)) as Uint8Array
        const original = packOf()
        await owner.commitSave(withBlock(BASE, 'stubby', characterBlock('stubby', '{"chaId":"stubby","trashed":true}')))
        expect(packOf()).not.toEqual(original)
        await owner.commitSave(BASE)
        expect(packOf()).toEqual(original)
        expect(seqOf(store, generation)).toBe(2)
    })
})

describe('a whole-state replace that lands during a save (invariant G)', () => {
    test('the save is followed by a stop, and later saves write nothing', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const b = makeOwner(store)
        await b.owner.load()
        let fired = false
        const view = new Proxy(store, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver)
                if (property !== 'write') {
                    return value
                }
                return async (key: string, bytes: Uint8Array, condition: Parameters<typeof store.write>[2]) => {
                    if (!fired && key === rootKey(generation)) {
                        fired = true
                        expect((await b.owner.replaceWholeState(withCharacter(BASE, 'newcomer'))).kind).toBe('won')
                    }
                    return await (value as typeof store.write).call(target, key, bytes, condition)
                }
            },
        })
        const a = makeOwner(view)
        await a.owner.load()
        const edited = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}'))
        expect(await a.owner.commitSave(edited)).toEqual({ kind: 'stopped', reason: 'head-moved', peerSeq: null })
        const start = store.ops.length
        expect(await a.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":3}')))).toMatchObject({ kind: 'stopped', reason: 'head-moved' })
        expect(store.ops.slice(start)).toEqual([])
    })

    test('a head that could not be read after the commit is checked before the next save', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        let rootWritten = false
        const original = store.write
        store.write = async (key, bytes, condition) => {
            const result = await original(key, bytes, condition)
            if (key.endsWith('/root')) {
                rootWritten = true
            }
            return result
        }
        store.faults.push({ match: (op) => rootWritten && op.kind === 'read' && op.key === HEAD_KEY, mode: 'before', times: 99 })
        const edited = withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","v":2}'))
        await expect(owner.commitSave(edited)).rejects.toMatchObject({ name: 'BlockStoreReadError' })
        store.faults.length = 0
        const start = store.ops.length
        expect(await owner.commitSave(edited)).toMatchObject({ kind: 'committed', wrote: false })
        expect(store.ops.slice(start).some((op) => op.kind === 'read' && op.key === HEAD_KEY)).toBe(true)
        expect(mutations(store, start)).toEqual([])
    })

    test('a head that moved while it could not be read stops the next save', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        let rootWritten = false
        const original = store.write
        store.write = async (key, bytes, condition) => {
            const result = await original(key, bytes, condition)
            if (key.endsWith('/root')) {
                rootWritten = true
            }
            return result
        }
        store.faults.push({ match: (op) => rootWritten && op.kind === 'read' && op.key === HEAD_KEY, mode: 'before', times: 99 })
        const edited = withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","v":2}'))
        await expect(owner.commitSave(edited)).rejects.toMatchObject({ name: 'BlockStoreReadError' })
        store.faults.length = 0
        await makeOwner(store).owner.replaceWholeState(withCharacter(BASE, 'newcomer'))
        expect(await owner.commitSave(edited)).toMatchObject({ kind: 'stopped', reason: 'head-moved' })
    })
})
describe('Node: conditional writes (invariants 4, 8, MC-159)', () => {
    test('a stale device\'s root write is refused after a peer committed, and its earlier writes may have landed (scenario 7)', async () => {
        const store = createFakeStore({ versioned: true })
        const generation = await seedStore(store, BASE)
        const a = makeOwner(store)
        const b = makeOwner(store)
        await a.owner.load()
        await b.owner.load()
        await b.owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","by":"b"}')))
        const result = await a.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","by":"a"}')))
        expect(result).toEqual({ kind: 'conflict', key: rootKey(generation) })
        expect(textOf(store.peek(characterBlockKey(generation, 'bob')))).toContain('"by":"b"')
        expect(seqOf(store, generation)).toBe(1)
    })

    test('a write that landed and then threw is retried on the old revision, gets a conflict, and a peer\'s bytes survive (invariant 4)', async () => {
        const store = createFakeStore({ versioned: true })
        const generation = await seedStore(store, BASE)
        const a = makeOwner(store)
        await a.owner.load()
        const key = characterBlockKey(generation, 'alice')
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === key, mode: 'after' })
        const mine = withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","by":"a"}'))
        await expect(a.owner.commitSave(mine)).rejects.toBeInstanceOf(InjectedFault)
        // A peer writes the same key on the revision the landed write created.
        const peerBytes = characterBlock('alice', '{"chaId":"alice","by":"peer"}')
        await store.write(key, peerBytes, { ifVersion: store.revisionOf(key) })
        const readsBefore = store.ops.filter((op) => op.kind === 'read' && op.key === key).length
        const result = await a.owner.commitSave(mine)
        expect(result).toEqual({ kind: 'conflict', key })
        expect(store.peek(key)).toEqual(peerBytes)
        expect(store.ops.filter((op) => op.kind === 'read' && op.key === key).length, 'no revision is re-read to overwrite a listed key').toBe(readsBefore)
    })

    test('an orphan own key left by an interrupted archive is read, written on the revision read, and saves (invariant 8)', async () => {
        const store = createFakeStore({ versioned: true })
        const generation = await seedStore(store, BASE)
        const orphan = characterBlockKey(generation, 'zed')
        store.plant(orphan, characterBlock('zed', '{"chaId":"zed","old":true}'))
        const { owner } = makeOwner(store)
        await owner.load()
        const start = store.ops.length
        const result = await owner.commitSave(withCharacter(BASE, 'zed', '{"chaId":"zed","restored":true}'))
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        const ops = store.ops.slice(start)
        const readIndex = ops.findIndex((op) => op.kind === 'read' && op.key === orphan)
        const writeIndex = ops.findIndex((op) => op.kind === 'write' && op.key === orphan)
        expect(readIndex).toBeGreaterThanOrEqual(0)
        expect(writeIndex).toBeGreaterThan(readIndex)
        expect(textOf(store.peek(orphan))).toContain('restored')
    })

    test('a character deleted and created again under the same key saves on the tombstone\'s revision (invariant 8)', async () => {
        const input = makeSet({ characters: [{ chaId: '§playground' }] })
        const store = createFakeStore({ versioned: true })
        const generation = await seedStore(store, input)
        const { owner } = makeOwner(store)
        await owner.load()
        expect(await owner.commitSave(withoutBlock(input, '§playground'))).toMatchObject({ kind: 'committed' })
        const key = characterBlockKey(generation, '§playground')
        expect(store.peek(key)).toBeNull()
        const again = await owner.commitSave(withCharacter(withoutBlock(input, '§playground'), '§playground', '{"chaId":"§playground","again":true}'))
        expect(again).toMatchObject({ kind: 'committed', wrote: true })
        expect(textOf(store.peek(key))).toContain('again')
    })

    test('post-commit deletes are conditional on the recorded revision and a conflict is ignored', async () => {
        const store = createFakeStore({ versioned: true })
        const generation = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        const key = characterBlockKey(generation, 'alice')
        // A peer touches the key the owner is about to delete.
        await store.write(key, characterBlock('alice', '{"chaId":"alice","peer":true}'), { ifVersion: store.revisionOf(key) })
        const result = await owner.commitSave(withoutBlock(BASE, 'alice'))
        expect(result).toMatchObject({ kind: 'committed', wrote: true })
        expect(textOf(store.peek(key))).toContain('peer')
        if (result.kind === 'committed') {
            expect(result.cleanup?.failed).toBeGreaterThan(0)
        }
    })
})

describe('Node: the size guard (invariant 9)', () => {
    test('a value over the body limit stops the commit before any write, naming the block', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store, { nodeBodyLimit: 400 })
        await owner.load()
        const start = store.ops.length
        const big = withBlock(BASE, 'alice', characterBlock('alice', JSON.stringify({ chaId: 'alice', filler: 'x'.repeat(600) })))
        const error = await owner.commitSave(big).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(BlockTooLargeError)
        expect((error as BlockTooLargeError).blockName).toBe('alice')
        expect(store.mutating().filter((op) => store.ops.indexOf(op) >= start)).toEqual([])
    })

    test('a root over the limit is refused too, and so is an over-limit pack', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store, { nodeBodyLimit: 600 })
        await owner.load()
        const rootBig = withRootFields(BASE, { lang: 'y'.repeat(900) })
        await expect(owner.commitSave(rootBig)).rejects.toMatchObject({ name: 'BlockTooLargeError', blockName: 'root' })
        const packBig = withBlock(BASE, 'stubby', characterBlock('stubby', JSON.stringify({ chaId: 'stubby', filler: 'z'.repeat(700) })))
        await expect(owner.commitSave(packBig)).rejects.toMatchObject({ name: 'BlockTooLargeError' })
    })

    test('a store that is not Node has no size guard', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store, { nodeBodyLimit: 10 })
        await owner.load()
        const big = withBlock(BASE, 'alice', characterBlock('alice', JSON.stringify({ chaId: 'alice', filler: 'x'.repeat(600) })))
        expect(await owner.commitSave(big)).toMatchObject({ kind: 'committed', wrote: true })
    })
})

describe('off Node: the sequence check and the commit lock (invariants 5, G, W)', () => {
    test('a peer that committed since this tab\'s last root stops this commit before it writes anything (scenario 8)', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const lock = new SharedLockCore()
        const a = makeOwner(store, { commitLock: lock.lockFor() })
        const b = makeOwner(store, { commitLock: lock.lockFor() })
        await a.owner.load()
        await b.owner.load()
        await b.owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","by":"b"}')))
        const start = store.ops.length
        const result = await a.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","by":"a"}')))
        expect(result).toEqual({ kind: 'stopped', reason: 'peer-commit', peerSeq: 1 })
        expect(mutations(store, start)).toEqual([])
        expect(seqOf(store, generation)).toBe(1)
    })

    test('the sequence is read inside the commit lock, and every write happens inside it', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        const events: string[] = []
        const lock = { available: true, run: async <T>(work: () => Promise<T>) => { events.push('lock'); try { return await work() } finally { events.push('unlock') } } }
        const { owner } = makeOwner(store, { commitLock: lock })
        await owner.load()
        const observed = new Proxy(store, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver)
                if (property === 'write' || property === 'read') {
                    return (...args: unknown[]) => { events.push(`${String(property)} ${String(args[0])}`); return (value as (...inner: unknown[]) => unknown).apply(target, args) }
                }
                return value
            },
        })
        const second = makeOwner(observed, { commitLock: lock })
        await second.owner.load()
        events.length = 0
        await second.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":9}')))
        const first = events.indexOf('lock')
        const last = events.lastIndexOf('unlock')
        expect(first).toBe(0)
        expect(events.slice(first + 1, last).every((event) => event.startsWith('read') || event.startsWith('write'))).toBe(true)
        expect(events.filter((event) => event.startsWith('write')).length).toBeGreaterThan(0)
        expect(events.filter((event) => event.startsWith('write')).every((_, i, all) => events.indexOf(all[i]) > first && events.indexOf(all[i]) < last)).toBe(true)
    })

    test('a page without Web Locks makes no post-commit deletes or pack trims and leaves the keys as garbage', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const { owner } = makeOwner(store, { commitLock: passthroughLock(false) })
        await owner.load()
        const result = await owner.commitSave(withoutBlock(BASE, 'alice'))
        expect(result).toMatchObject({ kind: 'committed', wrote: true, cleanup: { skipped: true } })
        expect(store.peek(characterBlockKey(generation, 'alice'))).not.toBeNull()
        expect(store.mutating().some((op) => op.kind === 'delete' || op.kind === 'deleteMany')).toBe(false)
    })

    test('with Web Locks the deletes happen', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const { owner } = makeOwner(store, { commitLock: passthroughLock(true) })
        await owner.load()
        await owner.commitSave(withoutBlock(BASE, 'alice'))
        expect(store.peek(characterBlockKey(generation, 'alice'))).toBeNull()
    })

    test('two tabs committing at once through the commit lock never leave a root that lists a missing value (scenario 8)', async () => {
        for (let seed = 1; seed <= 25; seed++) {
            const store = createFakeStore({ versioned: false })
            await seedStore(store, BASE)
            const interleaver = new Interleaver((waiting, step) => waiting[(step * 7 + seed) % waiting.length])
            const gated = (task: number) => new Proxy(store, {
                get(target, property, receiver) {
                    const value = Reflect.get(target, property, receiver)
                    if (typeof value !== 'function' || !['read', 'write', 'delete', 'deleteMany', 'list', 'has'].includes(String(property))) {
                        return value
                    }
                    return async (...args: unknown[]) => { await interleaver.gate(task)(); return (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args) }
                },
            })
            const a = makeOwner(gated(0), { commitLock: interleaver.lockFor(0) })
            const b = makeOwner(gated(1), { commitLock: interleaver.lockFor(1) })
            await a.owner.load()
            await b.owner.load()
            const results = await interleaver.run([
                () => a.owner.commitSave(withoutBlock(BASE, 'alice')),
                () => b.owner.commitSave(withCharacter(BASE, 'dave')),
            ])
            expect(results.filter((result) => result.kind === 'committed').length, `seed ${seed}: exactly one wins the root`).toBe(1)
            expect(results.filter((result) => result.kind === 'stopped').length).toBe(1)
            const check = makeOwner(store.cloneUngated())
            expect((await check.owner.load()).kind, `seed ${seed}`).toBe('loaded')
        }
    })
})

describe('Save mine (off Node, invariant S)', () => {
    test('after the peer deleted a value, Save mine rewrites everything its root lists and the reload is not damaged', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const lock = new SharedLockCore()
        const mine = makeOwner(store, { commitLock: lock.lockFor() })
        const peer = makeOwner(store, { commitLock: lock.lockFor() })
        await mine.owner.load()
        await peer.owner.load()
        // The peer deletes alice and commits.
        const peerResult = await peer.owner.commitSave(withoutBlock(BASE, 'alice'))
        expect(peerResult).toMatchObject({ kind: 'committed' })
        expect(store.peek(characterBlockKey(generation, 'alice'))).toBeNull()
        // This tab still has alice and edits bob.
        const edited = withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","edited":true}'))
        const stopped = await mine.owner.commitSave(edited)
        expect(stopped).toMatchObject({ kind: 'stopped', reason: 'peer-commit' })
        if (stopped.kind !== 'stopped' || stopped.peerSeq === null) {
            throw new Error('expected a peer sequence')
        }
        const saved = await mine.owner.commitSave(edited, { saveMine: { peerSeq: stopped.peerSeq } })
        expect(saved).toMatchObject({ kind: 'committed', wrote: true })
        const reloaded = await makeOwner(store).owner.load()
        expect(reloaded.kind).toBe('loaded')
        if (reloaded.kind === 'loaded') {
            expect(reloaded.loaded.directory).toContain('alice')
            expect(textOf(reloaded.loaded.blocks.get('alice') ?? null)).toBe(textOf(characterBlock('alice')))
            expect(textOf(reloaded.loaded.blocks.get('bob') ?? null)).toContain('edited')
        }
    })

    test('Save mine keeps the stubs the peer\'s pack holds until its own root is durable', async () => {
        const store = createFakeStore({ versioned: false })
        const generation = await seedStore(store, BASE)
        const lock = new SharedLockCore()
        const mine = makeOwner(store, { commitLock: lock.lockFor() })
        const peer = makeOwner(store, { commitLock: lock.lockFor() })
        await mine.owner.load()
        await peer.owner.load()
        await peer.owner.commitSave(withPacked(BASE, ['stubby', 'alice']))
        const edited = withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","edited":true}'))
        const stopped = await mine.owner.commitSave(edited)
        if (stopped.kind !== 'stopped' || stopped.peerSeq === null) {
            throw new Error('expected a peer sequence')
        }
        const start = store.ops.length
        await mine.owner.commitSave(edited, { saveMine: { peerSeq: stopped.peerSeq } })
        const writes = store.ops.slice(start).filter((op) => op.kind === 'write')
        const packIndex = writes.findIndex((op) => op.key === stubsKey(generation))
        const rootIndex = writes.findIndex((op) => op.key === rootKey(generation))
        expect(packIndex).toBeGreaterThanOrEqual(0)
        expect(packIndex).toBeLessThan(rootIndex)
        const reloaded = await makeOwner(store).owner.load()
        expect(reloaded.kind).toBe('loaded')
    })

    test('Node offers no Save mine', async () => {
        const { owner } = await booted(true)
        await expect(owner.commitSave(BASE, { saveMine: { peerSeq: 0 } })).rejects.toMatchObject({ name: 'BlockOwnerStateError' })
    })
})

describe('whole-state replace elsewhere stops this tab (invariant G)', () => {
    test('off Node the other tab\'s replace retires the generation and the next commit stops without writing', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        const a = makeOwner(store)
        const b = makeOwner(store)
        await a.owner.load()
        await b.owner.load()
        expect((await b.owner.replaceWholeState(withCharacter(BASE, 'newcomer'))).kind).toBe('won')
        const start = store.ops.length
        const result = await a.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}')))
        expect(result).toMatchObject({ kind: 'stopped', reason: 'generation-gone' })
        expect(mutations(store, start)).toEqual([])
    })

    test('on Node the stale device\'s root write is refused after the old generation was removed', async () => {
        const store = createFakeStore({ versioned: true })
        await seedStore(store, BASE)
        const a = makeOwner(store)
        const b = makeOwner(store)
        await a.owner.load()
        await b.owner.load()
        await b.owner.replaceWholeState(withCharacter(BASE, 'newcomer'))
        const result = await a.owner.commitSave(withBlock(BASE, 'alice', characterBlock('alice', '{"chaId":"alice","v":2}')))
        expect(result.kind).toBe('conflict')
    })

    test('a replace whose flip lands between this tab\'s checks and its root write is followed by a stop (head check after the root)', async () => {
        // Off Node. Task 0 commits; the other replaces after task 0's sequence read, before its writes.
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        const interleaver = new Interleaver((waiting, step) => (step < 1 ? 0 : waiting.includes(1) ? 1 : 0))
        const view = (task: number) => new Proxy(store, {
            get(target, property, receiver) {
                const value = Reflect.get(target, property, receiver)
                if (typeof value !== 'function' || !['read', 'write', 'delete', 'deleteMany', 'list', 'has'].includes(String(property))) {
                    return value
                }
                return async (...args: unknown[]) => { await interleaver.gate(task)(); return (value as (...inner: unknown[]) => Promise<unknown>).apply(target, args) }
            },
        })
        const a = makeOwner(store)
        await a.owner.load()
        const committing = makeOwner(view(0))
        await committing.owner.load()
        const replacing = makeOwner(view(1))
        const results = await interleaver.run<CommitResult | { kind: string }>([
            () => committing.owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","v":2}'))),
            () => replacing.owner.replaceWholeState(withCharacter(BASE, 'newcomer')),
        ])
        expect(results[1].kind).toBe('won')
        expect(['stopped']).toContain(results[0].kind)
    })
})

describe('the commit lock', () => {
    test('a request that is not granted in time rejects, and reports whether a live holder exists', async () => {
        const manager = {
            request: (_name: string, options: { signal?: AbortSignal }) => new Promise<never>((_, reject) => {
                options.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
            }),
            query: async () => ({ held: [{ name: 'risu-block-commit' }] }),
        }
        const lock = createWebCommitLock(manager, { timeoutMs: 5 })
        const error = await lock.run(async () => 1).then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(CommitLockTimeoutError)
        expect((error as CommitLockTimeoutError).holderLive).toBe(true)
    })

    test('without a lock manager the lock is unavailable and runs the work', async () => {
        const lock = createWebCommitLock(undefined)
        expect(lock.available).toBe(false)
        expect(await lock.run(async () => 7)).toBe(7)
    })

    test('a granted lock runs the work and passes its result', async () => {
        const manager = { request: async <T>(_name: string, _options: unknown, callback: (lock: unknown) => Promise<T>) => await callback({}) }
        expect(await createWebCommitLock(manager).run(async () => 9)).toBe(9)
    })
})

describe('the in-process commit lock', () => {
    function gate() {
        let open!: () => void
        const opened = new Promise<void>((resolve) => { open = resolve })
        return { open, opened }
    }

    test('is available, and passes the work\'s result and its failure through', async () => {
        const store = createFakeStore({ versioned: false })
        const lock = createProcessCommitLock(store)
        expect(lock.available).toBe(true)
        expect(await lock.run(async () => 4)).toBe(4)
        await expect(lock.run(async () => { throw new Error('boom') })).rejects.toThrow('boom')
        expect(await lock.run(async () => 5)).toBe(5)
    })

    test('two acquisitions on one store run one after the other, in the order they asked', async () => {
        const store = createFakeStore({ versioned: false })
        const first = createProcessCommitLock(store)
        const second = createProcessCommitLock(store)
        const events: string[] = []
        const hold = gate()
        const a = first.run(async () => { events.push('a in'); await hold.opened; events.push('a out') })
        const b = second.run(async () => { events.push('b in'); events.push('b out') })
        for (let i = 0; i < 10; i++) {
            await Promise.resolve()
        }
        expect(events).toEqual(['a in'])
        hold.open()
        await Promise.all([a, b])
        expect(events).toEqual(['a in', 'a out', 'b in', 'b out'])
    })

    test('a failing holder still lets the next one in', async () => {
        const store = createFakeStore({ versioned: false })
        const lock = createProcessCommitLock(store)
        const failing = lock.run(async () => { throw new Error('boom') })
        const next = lock.run(async () => 'ran')
        await expect(failing).rejects.toThrow('boom')
        expect(await next).toBe('ran')
    })

    test('stores do not wait for each other', async () => {
        const hold = gate()
        const one = createProcessCommitLock(createFakeStore({ versioned: false }))
        const two = createProcessCommitLock(createFakeStore({ versioned: false }))
        const events: string[] = []
        const a = one.run(async () => { events.push('a in'); await hold.opened })
        await two.run(async () => { events.push('b ran') })
        expect(events).toEqual(['a in', 'b ran'])
        hold.open()
        await a
    })

    test('a request that waits longer than the timeout rejects as live-holder timeout and leaves the queue intact', async () => {
        const store = createFakeStore({ versioned: false })
        const lock = createProcessCommitLock(store, { timeoutMs: 5 })
        const hold = gate()
        const holder = lock.run(async () => { await hold.opened })
        const error = await lock.run(async () => 'never').then(() => null, (thrown: unknown) => thrown)
        expect(error).toBeInstanceOf(CommitLockTimeoutError)
        expect((error as CommitLockTimeoutError).holderLive).toBe(true)
        hold.open()
        await holder
        expect(await lock.run(async () => 'after')).toBe('after')
    })

    test('an owner that commits with it takes it once per commit and the commits of two owners on one store do not overlap', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        let inside = 0
        let acquisitions = 0
        let overlapped = false
        const counted = (lock: ReturnType<typeof createProcessCommitLock>) => ({
            available: lock.available,
            run: <T,>(work: () => Promise<T>) => lock.run(async () => {
                acquisitions++
                inside++
                overlapped ||= inside > 1
                try {
                    return await work()
                } finally {
                    inside--
                }
            }),
        })
        const a = makeOwner(store, { commitLock: counted(createProcessCommitLock(store)) })
        const b = makeOwner(store, { commitLock: counted(createProcessCommitLock(store)) })
        await a.owner.load()
        await b.owner.load()
        await Promise.all([
            a.owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","v":2}'))),
            b.owner.commitSave(withBlock(BASE, 'bob', characterBlock('bob', '{"chaId":"bob","v":3}'))),
        ])
        expect(overlapped).toBe(false)
        expect(acquisitions).toBe(2)
    })

    test('an owner on it deletes the keys that left its directory after a commit, because the lock is available', async () => {
        const store = createFakeStore({ versioned: false })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store, { commitLock: createProcessCommitLock(store) })
        await owner.load()
        const result = await owner.commitSave(withoutBlock(BASE, 'bob'))
        expect(result).toMatchObject({ kind: 'committed', wrote: true, cleanup: { skipped: false } })
    })
})
