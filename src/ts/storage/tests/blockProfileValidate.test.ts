// @vitest-environment node
/**
 * The validation hook of a block-store boot (`src/ts/storage/blockProfileValidate.ts`):
 * the loaded blocks decoded strictly, a block whose payload is not JSON named as
 * "unreadable content", and a failure no block explains reported for the save
 * as a whole. Module mocks as in treeToBlockSet.test.ts.
 */
import { describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: vi.fn(async () => { }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => { }),
        removeItem: vi.fn(async () => { }),
    },
    isPlainHttpFileSrc: vi.fn(() => false),
}) as unknown as typeof import('src/ts/globalApi.svelte'))

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: null, version: null }),
        write: async () => ({ version: null }),
        delete: async () => { },
        deleteMany: async () => { },
        list: async () => [],
        has: async () => false,
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { BLOCK_TYPE_CHARACTER_WITH_CHAT, frameBlock } from 'src/ts/storage/blockFrame'
import { ownBlockKey, rootKey, stubsKey } from 'src/ts/storage/blockKeys'
import type { DamagedItem, LoadedBlocks } from 'src/ts/storage/blockStore'
import { validateLoadedBlocks } from 'src/ts/storage/blockProfileValidate'
import type { Database } from 'src/ts/storage/database.svelte'
import { treeToBlockSet } from 'src/ts/storage/treeToBlockSet'
import { createFakeStore, makeOwner } from './blockStoreHarness'

type Character = Database['characters'][number]

function character(chaId: string, extra: Record<string, unknown> = {}): Character {
    return { chaId, type: 'character', name: chaId, chats: [], ...extra } as unknown as Character
}

function tree(characters: Character[]): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'p' }],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

async function loadedOf(value: Database): Promise<LoadedBlocks> {
    const store = createFakeStore({ versioned: false })
    const { owner } = makeOwner(store)
    await owner.replaceWholeState(await treeToBlockSet(value), { requireAbsentHead: true })
    const read = await makeOwner(store).owner.readCommitted()
    if (read.kind !== 'loaded') {
        throw new Error(`not loaded: ${read.kind}`)
    }
    return read.loaded
}

function withBlock(loaded: LoadedBlocks, name: string, bytes: Uint8Array): LoadedBlocks {
    const blocks = new Map(loaded.blocks)
    blocks.set(name, bytes)
    return { ...loaded, blocks }
}

function broken(name: string, payload: string): Uint8Array {
    return frameBlock(BLOCK_TYPE_CHARACTER_WITH_CHAT, name, new TextEncoder().encode(payload))
}

describe('validateLoadedBlocks', () => {
    test('returns the tree the blocks decode to, so boot decodes once', async () => {
        const loaded = await loadedOf(tree([character('a'), character('b')]))

        const verdict = await validateLoadedBlocks(loaded)

        expect(Array.isArray(verdict)).toBe(false)
        expect((verdict as Database).characters.map((c) => c.chaId)).toEqual(['a', 'b'])
    })

    test('names a character block whose payload is not JSON, with its own key', async () => {
        const loaded = await loadedOf(tree([character('a'), character('b')]))

        const verdict = await validateLoadedBlocks(withBlock(loaded, 'b', broken('b', '{not json'))) as DamagedItem[]

        expect(verdict).toHaveLength(1)
        expect(verdict[0]).toMatchObject({ part: 'character', name: 'b', key: ownBlockKey(loaded.generation, 'b'), kind: 'unreadable-content' })
    })

    test('names every such block, not only the first the decode met', async () => {
        const loaded = await loadedOf(tree([character('a'), character('b'), character('c')]))
        const damaged = withBlock(withBlock(loaded, 'a', broken('a', '{x')), 'c', broken('c', '{y'))

        const verdict = await validateLoadedBlocks(damaged) as DamagedItem[]

        expect(verdict.map((item) => item.name).sort()).toEqual(['a', 'c'])
    })

    test('a packed stub is reported against the pack, not an own key', async () => {
        const loaded = await loadedOf(tree([character('a'), character('stubbed', { coldstorage: 'unit-1' })]))
        expect(loaded.packed).toEqual(['stubbed'])

        const verdict = await validateLoadedBlocks(withBlock(loaded, 'stubbed', broken('stubbed', '{x'))) as DamagedItem[]

        expect(verdict).toHaveLength(1)
        expect(verdict[0]).toMatchObject({ part: 'stub', name: 'stubbed', key: stubsKey(loaded.generation), kind: 'unreadable-content' })
    })

    test('a root that is not JSON is reported as the root', async () => {
        const loaded = await loadedOf(tree([character('a')]))
        const rootBlock = frameBlock(1, 'root', new TextEncoder().encode('{nope'))

        const verdict = await validateLoadedBlocks({ ...loaded, root: rootBlock }) as DamagedItem[]

        expect(verdict[0]).toMatchObject({ part: 'root', name: 'root', key: rootKey(loaded.generation), kind: 'unreadable-content' })
    })

    test('a failure no block explains (a directory entry with no block) is reported once, against the save as a whole', async () => {
        const loaded = await loadedOf(tree([character('a')]))
        const blocks = new Map(loaded.blocks)
        blocks.delete('a')

        const verdict = await validateLoadedBlocks({ ...loaded, blocks }) as DamagedItem[]

        expect(verdict).toHaveLength(1)
        expect(verdict[0]).toMatchObject({ part: 'root', kind: 'unreadable-content' })
        expect(verdict[0].detail.length).toBeGreaterThan(0)
    })

    test('the plugin-storage block with no payload is how an absent field is written, not damage', async () => {
        const value = tree([character('a')])
        delete (value as unknown as Record<string, unknown>).pluginCustomStorage
        const loaded = await loadedOf(value)

        const verdict = await validateLoadedBlocks(loaded)

        expect(Array.isArray(verdict)).toBe(false)
    })
})
