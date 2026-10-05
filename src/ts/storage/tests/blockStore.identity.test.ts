// @vitest-environment node
/**
 * An unchanged block held as another object than the acknowledged one is
 * compared byte for byte once; after that the caller's object is the
 * acknowledged one and later saves settle it by identity.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { characterBlockKey } from 'src/ts/storage/blockKeys'
import { characterBlock, createFakeStore, makeOwner, makeSet, seedStore, withBlock, type FakeStore } from './blockStoreHarness'
import type { BlockSetInput } from 'src/ts/storage/blockStore'

const comparisons: Array<{ identical: boolean, length: number }> = vi.hoisted(() => [])

vi.mock('src/ts/storage/blockFrame', async (importOriginal) => {
    const original = await importOriginal<typeof import('src/ts/storage/blockFrame')>()
    return {
        ...original,
        bytesEqual: (a: Uint8Array, b: Uint8Array) => {
            comparisons.push({ identical: a === b, length: a.length })
            return original.bytesEqual(a, b)
        },
    }
})

function copyOf(input: BlockSetInput): BlockSetInput {
    return { layout: { keys: input.layout.keys, blocks: input.layout.blocks.map((block) => block.slice()) }, packed: input.packed }
}

function byteComparisons(): number {
    return comparisons.filter((entry) => !entry.identical).length
}

const BASE = makeSet({ characters: [{ chaId: 'alice' }, { chaId: 'bob' }, { chaId: 'stubby' }], packed: ['stubby'] })

beforeEach(() => {
    comparisons.length = 0
})

describe.each([false, true])('the second save of an unchanged set (versioned=%s)', (versioned) => {
    test('compares no bytes once the first unchanged save has adopted the caller\'s objects', async () => {
        const store = createFakeStore({ versioned })
        await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        const held = copyOf(BASE)

        expect(await owner.commitSave(held)).toMatchObject({ kind: 'committed', wrote: false })
        expect(byteComparisons()).toBeGreaterThan(0)

        comparisons.length = 0
        const writesBefore = store.mutating().length
        expect(await owner.commitSave(held)).toMatchObject({ kind: 'committed', wrote: false })
        expect(byteComparisons()).toBe(0)
        expect(store.mutating().length).toBe(writesBefore)
    })

    test('still writes a block that changes and then returns to the adopted content', async () => {
        const store = createFakeStore({ versioned })
        const generation = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        const original = characterBlock('alice')
        const changed = characterBlock('alice', '{"chaId":"alice","chats":["x"]}')

        await owner.commitSave(copyOf(BASE))
        await owner.commitSave(copyOf(BASE))
        expect(await owner.commitSave(withBlock(BASE, 'alice', changed))).toMatchObject({ kind: 'committed', wrote: true })
        expect(store.peek(characterBlockKey(generation, 'alice'))).toEqual(changed)
        expect(await owner.commitSave(withBlock(BASE, 'alice', original.slice()))).toMatchObject({ kind: 'committed', wrote: true })
        expect(store.peek(characterBlockKey(generation, 'alice'))).toEqual(original)
    })

    test('still rewrites a block after a write of it threw and the content returns to what was adopted', async () => {
        const store: FakeStore = createFakeStore({ versioned })
        const generation = await seedStore(store, BASE)
        const { owner } = makeOwner(store)
        await owner.load()
        const original = characterBlock('alice')
        const changed = characterBlock('alice', '{"chaId":"alice","chats":["x"]}')
        await owner.commitSave(copyOf(BASE))

        const key = characterBlockKey(generation, 'alice')
        store.faults.push({ match: (op) => op.kind === 'write' && op.key === key, mode: versioned ? 'before' : 'after' })
        await expect(owner.commitSave(withBlock(BASE, 'alice', changed))).rejects.toThrow()
        expect(store.peek(key)).toEqual(versioned ? original : changed)

        expect(await owner.commitSave(withBlock(BASE, 'alice', original.slice()))).toMatchObject({ kind: 'committed', wrote: true })
        expect(store.peek(key)).toEqual(original)
    })
})
