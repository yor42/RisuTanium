// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { characterBlockKey, stubsKey } from 'src/ts/storage/blockKeys'
import type { BlockSetInput } from 'src/ts/storage/blockStore'
import { StoreDeleteManyError } from 'src/ts/storage/store/errors'
import {
    characterBlock,
    createFakeStore,
    makeOwner,
    makeSet,
    passthroughLock,
    seedStore,
    textOf,
    withPacked,
    type FakeStore,
} from './blockStoreHarness'

const FULL = '{"chaId":"x","full":1}'
const FULL2 = '{"chaId":"x","full":2}'
const PEER = '{"chaId":"x","peer":1}'
const STUB1 = '{"chaId":"x","stub":1}'

function setWith(xData: string, packed: string[]): BlockSetInput {
    return withPacked(makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'x', data: xData }] }), packed)
}

async function boot(versioned: boolean, lockAvailable = true) {
    const store = createFakeStore({ versioned })
    const generation = await seedStore(store, setWith(FULL, []))
    const { owner } = makeOwner(store, { commitLock: passthroughLock(lockAvailable) })
    const loaded = await owner.load()
    if (loaded.kind !== 'loaded') {
        throw new Error('seeded store did not load')
    }
    return { store, generation, owner }
}

/** The stored text of `x` as a fresh page would load it, or a DAMAGED marker. */
async function reloadX(store: FakeStore): Promise<string> {
    const { owner } = makeOwner(store.cloneUngated())
    const result = await owner.load()
    if (result.kind === 'loaded') {
        return textOf(result.loaded.blocks.get('x') ?? null)
    }
    if (result.kind !== 'damaged') {
        return `NOT-LOADED ${result.kind}`
    }
    return `DAMAGED ${JSON.stringify(result.damage.map((d) => [d.part, d.name, d.kind]))}`
}

function payloadOf(text: string): string {
    const match = /\{"chaId"[^}]*\}/.exec(text)
    return match === null ? text : match[0]
}

const BOTH = [{ versioned: false }, { versioned: true }]

describe.each(BOTH)('a cleanup delete that landed but was reported uncertain, versioned=$versioned', ({ versioned }) => {
    const cases = [
        { label: 'generic throw', report: (_key: string) => undefined },
        { label: "StoreDeleteManyError 'unknown'", report: (key: string) => new StoreDeleteManyError([{ key, outcome: 'unknown' }]) },
        { label: "StoreDeleteManyError 'failed'", report: (key: string) => new StoreDeleteManyError([{ key, outcome: 'failed' }]) },
    ]

    describe.each(cases)('$label', ({ report }) => {
        test('regression reproducer: own key, equal-bytes restore reloads without damage', async () => {
            const { store, generation, owner } = await boot(versioned)
            const error = report(characterBlockKey(generation, 'x'))
            store.faults.push({ match: (op) => op.kind === 'deleteMany', mode: 'after', error })
            expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
            expect(store.peek(characterBlockKey(generation, 'x'))).toBeNull()
            expect((await owner.commitSave(setWith(FULL, []))).kind).toBe('committed')
            expect(payloadOf(await reloadX(store))).toBe(FULL)
        })

        test('regression reproducer: pack, equal-stub put-back reloads without damage', async () => {
            const { store, generation, owner } = await boot(versioned)
            expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
            const error = report(stubsKey(generation))
            store.faults.push({ match: (op) => op.kind === 'deleteMany', mode: 'after', error })
            expect((await owner.commitSave(setWith(FULL, []))).kind).toBe('committed')
            expect(store.peek(stubsKey(generation))).toBeNull()
            expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
            expect(payloadOf(await reloadX(store))).toBe(STUB1)
        })
    })
})

describe('uncertain cleanup delete on a versioned store', () => {
    test("regression reproducer: own key 'unknown' after the delete landed, restore with different bytes commits", async () => {
        const { store, generation, owner } = await boot(true)
        const key = characterBlockKey(generation, 'x')
        store.faults.push({ match: (op) => op.kind === 'deleteMany', mode: 'after', error: new StoreDeleteManyError([{ key, outcome: 'unknown' }]) })
        expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
        expect((await owner.commitSave(setWith(FULL2, []))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(FULL2)
    })

    test("regression reproducer: 'conflict' on a doomed key written by another writer, equal-bytes restore is refused", async () => {
        const { store, generation, owner } = await boot(true)
        const key = characterBlockKey(generation, 'x')
        store.plant(key, characterBlock('x', PEER))
        const putBack = await owner.commitSave(setWith(STUB1, ['x']))
        expect(putBack.kind === 'committed' && putBack.cleanup.failed).toBe(1)
        const restore = await owner.commitSave(setWith(FULL, []))
        expect(restore.kind).toBe('conflict')
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
    })

    test("guard: 'unknown' where the delete did not land reloads correctly and the key is reabsorbed on restore", async () => {
        const { store, generation, owner } = await boot(true)
        const key = characterBlockKey(generation, 'x')
        store.faults.push({ match: (op) => op.kind === 'deleteMany', mode: 'before', error: new StoreDeleteManyError([{ key, outcome: 'unknown' }]) })
        expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
        expect(store.peek(key)).not.toBeNull()
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
        expect((await owner.commitSave(setWith(FULL, []))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(FULL)
        expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
        expect(store.peek(key)).toBeNull()
    })
})

describe('guard: a failed cleanup delete on a store without versions', () => {
    test("'failed' keeps the key doomed and the delete is retried at the next cleanup", async () => {
        const { store, generation, owner } = await boot(false)
        const key = characterBlockKey(generation, 'x')
        store.faults.push({ match: (op) => op.kind === 'deleteMany', mode: 'before', error: new StoreDeleteManyError([{ key, outcome: 'failed' }]) })
        const first = await owner.commitSave(setWith(STUB1, ['x']))
        expect(first.kind === 'committed' && first.cleanup.failed).toBe(1)
        expect(store.peek(key)).not.toBeNull()
        const next = await owner.commitSave(withPacked(makeSet({ characters: [{ chaId: 'alice', data: '{"chaId":"alice","v":2}' }, { chaId: 'x', data: STUB1 }] }), ['x']))
        expect(next.kind === 'committed' && next.cleanup.deleted).toBe(1)
        expect(store.peek(key)).toBeNull()
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
    })
})

describe.each(BOTH)('guard: a cleanup delete that threw before it landed, versioned=$versioned', ({ versioned }) => {
    test('nothing is lost across a restore and a second put-back', async () => {
        const { store, generation, owner } = await boot(versioned)
        store.faults.push({ match: (op) => op.kind === 'deleteMany', mode: 'before' })
        expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
        expect(store.peek(characterBlockKey(generation, 'x'))).not.toBeNull()
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
        expect((await owner.commitSave(setWith(FULL, []))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(FULL)
        expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
    })
})

describe.each([
    { versioned: false, title: 'cleanup skipped (commit lock unavailable)' },
    { versioned: true, title: 'no cleanup fault, lock flag ignored' },
])('guard: repeated cycles, $title, versioned=$versioned', ({ versioned }) => {
    // Off Node cleanup is skipped only without the lock; a versioned store runs it regardless.
    test.each([['equal', STUB1], ['different', '{"chaId":"x","stub":2}']])('put-back, restore, put-back with %s stub, restore, each reload correct', async (_label, second) => {
        const { store, owner } = await boot(versioned, false)
        expect((await owner.commitSave(setWith(STUB1, ['x']))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(STUB1)
        expect((await owner.commitSave(setWith(FULL, []))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(FULL)
        expect((await owner.commitSave(setWith(second, ['x']))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(second)
        expect((await owner.commitSave(setWith(FULL, []))).kind).toBe('committed')
        expect(payloadOf(await reloadX(store))).toBe(FULL)
    })
})
