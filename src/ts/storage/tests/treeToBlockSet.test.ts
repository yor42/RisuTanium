// @vitest-environment node
/**
 * A decoded tree becomes the block set a whole-state replace takes, through a
 * fresh encoder that has no cache, no remote files and no store behind it.
 * Module mocks as in blockStore.compat.test.ts; the platform flags are
 * switchable so that a Node-server page can be shown to write no remote file.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'

const h = vi.hoisted(() => ({
    platform: { isTauri: false, isNodeServer: false },
    cacheWrites: [] as string[],
    cacheReads: [] as string[],
    storeWrites: [] as string[],
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => { h.cacheReads.push(key); return null }),
            setItem: vi.fn(async (key: string) => { h.cacheWrites.push(key) }),
            removeItem: vi.fn(async () => { }),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => []),
                getItem: vi.fn(async () => null),
                setItem: vi.fn(async (key: string) => { h.storeWrites.push(key) }),
                removeItem: vi.fn(async (key: string) => { h.storeWrites.push(key) }),
            },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: null, version: null }),
        write: async (key: string) => { h.storeWrites.push(key); return { version: null } },
        delete: async (key: string) => { h.storeWrites.push(key) },
        deleteMany: async () => { h.storeWrites.push('deleteMany') },
        list: async () => [],
        has: async () => false,
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => ({ enableRemoteSaving: true })),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    get isTauri() { return h.platform.isTauri },
    get isNodeServer() { return h.platform.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { decodeRisuSave } from '../risuSave'
import type { Database } from '../database.svelte'
import { assembleLegacyFile } from '../blockStore'
import { treeToBlockSet } from '../treeToBlockSet'
import { createFakeStore, makeOwner } from './blockStoreHarness'

beforeEach(() => {
    h.platform.isTauri = false
    h.platform.isNodeServer = false
    h.cacheWrites.length = 0
    h.cacheReads.length = 0
    h.storeWrites.length = 0
})

type CharacterFixture = Database['characters'][number]

function character(chaId: string, extra: Record<string, unknown> = {}): CharacterFixture {
    return { chaId, type: 'character', name: `Name of ${chaId}`, chats: [{ message: [{ role: 'user', data: `hello ${chaId}` }] }], ...extra } as unknown as CharacterFixture
}

function tree(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'p' }],
        botPresetsId: 0,
        modules: [{ name: 'm', id: 'm1' }],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: { a: 1 },
        mainPrompt: 'prompt',
        enableRemoteSaving: true,
        characters,
    } as unknown as Database
}

describe('a decoded tree as a block set', () => {
    test('has the encoder\'s block order, root first and config last, and one block per character', async () => {
        const input = await treeToBlockSet(tree([character('a'), character('b')]))
        expect(input.layout.keys).toEqual(['root', 'preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'a', 'b', 'config'])
        expect(input.layout.blocks).toHaveLength(input.layout.keys.length)
        expect(input.packed.size).toBe(0)
    })

    test('performs zero store writes and zero cache writes, and reads no cache entry', async () => {
        await treeToBlockSet(tree([character('a'), character('b', { coldstorage: 'unit' })]))
        expect(h.storeWrites).toEqual([])
        expect(h.cacheWrites).toEqual([])
        expect(h.cacheReads).toEqual([])
    })

    test.each([{ isTauri: true, isNodeServer: false }, { isTauri: false, isNodeServer: true }])('writes no remote file on a page where remote saving is possible (%j)', async (platform) => {
        h.platform.isTauri = platform.isTauri
        h.platform.isNodeServer = platform.isNodeServer
        await treeToBlockSet(tree([character('a'), character('b')]))
        expect(h.storeWrites).toEqual([])
        expect(h.cacheWrites).toEqual([])
    })

    test('names the archived characters that have one holder as packed, and nobody else', async () => {
        const input = await treeToBlockSet(tree([
            character('plain'),
            character('archived', { coldstorage: 'unit-1' }),
            character('twin', { coldstorage: 'unit-2' }),
            character('twin'),
        ]))
        expect(Array.from(input.packed)).toEqual(['archived'])
    })

    test('is accepted by a whole-state replace and loads back as the tree it came from', async () => {
        const source = tree([character('a'), character('b', { coldstorage: 'unit' })])
        const input = await treeToBlockSet(source)
        const store = createFakeStore({ versioned: false })
        const { owner } = makeOwner(store)
        expect((await owner.replaceWholeState(input, { requireAbsentHead: true })).kind).toBe('won')
        const loaded = await makeOwner(store).owner.load()
        if (loaded.kind !== 'loaded') {
            throw new Error('not loaded')
        }
        expect(loaded.loaded.packed).toEqual(['b'])
        const decoded = await decodeRisuSave(assembleLegacyFile(loaded.loaded))
        expect(decoded.characters?.map((c: CharacterFixture) => c.chaId)).toEqual(['a', 'b'])
        expect((decoded as unknown as { mainPrompt: string }).mainPrompt).toBe('prompt')
        expect(h.cacheWrites).toEqual([])
    })

    test('a second call shares nothing with the first', async () => {
        const first = await treeToBlockSet(tree([character('a'), character('b')]))
        const second = await treeToBlockSet(tree([character('c')]))
        expect(second.layout.keys).toEqual(['root', 'preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'c', 'config'])
        expect(first.layout.keys).toContain('a')
        expect(second.layout.keys).not.toContain('a')
    })

    test('a tree whose chaId is held twice keeps one block for it and packs it never', async () => {
        const input = await treeToBlockSet(tree([character('dup', { coldstorage: 'u1' }), character('dup', { coldstorage: 'u2' })]))
        expect(input.layout.keys.filter((key) => key === 'dup')).toHaveLength(1)
        expect(input.packed.size).toBe(0)
    })
})
