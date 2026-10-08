// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('localforage', () => ({
    default: { createInstance: () => ({ getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) }) },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: { keys: vi.fn(async () => []), getItem: vi.fn(async () => null), setItem: vi.fn(async () => { }), removeItem: vi.fn(async () => { }) },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), () => ({
    getAppStore: async () => ({
        capabilities: { conditionalWrites: false },
        read: async () => ({ bytes: null, version: null }), write: async () => ({ version: null }),
        delete: async () => { }, deleteMany: async () => { }, list: async () => [], has: async () => false,
    }),
}) as unknown as typeof import('src/ts/storage/store/appStore'))
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})), presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: false }) as unknown as typeof import('src/ts/platform'))
vi.mock('@tauri-apps/plugin-fs', () => ({ writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 } }))

import type { Database } from 'src/ts/storage/database.svelte'
import { treeToBlockSet, treeToBlockSetReported } from 'src/ts/storage/treeToBlockSet'
import { packedNamesOf } from 'src/ts/storage/packedNames'
import { validateLoadedBlocks } from 'src/ts/storage/blockProfileValidate'
import { createFakeStore, makeOwner, seedStore, type FakeStore } from 'src/ts/storage/tests/blockStoreHarness'

type Entry = Record<string, unknown>

function character(chaId: string): Entry {
    return { chaId, type: 'character', name: `N ${chaId}`, chats: [{ message: [{ role: 'char', data: `hi ${chaId}`, saying: chaId }] }] }
}

function tree(characters: unknown, over: Entry = {}): Database {
    return {
        formatversion: 5, botPresets: [{ name: 'p1' }], botPresetsId: 0, modules: [], loadouts: [], plugins: [], pluginCustomStorage: {},
        characterOrder: ['a', 'b'], characters, ...over,
    } as unknown as Database
}

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'error').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

async function bootedStore() {
    const store = createFakeStore({ versioned: false })
    await seedStore(store, await treeToBlockSet(tree([character('a'), character('b')])))
    const { owner } = makeOwner(store)
    const loaded = await owner.load({ validate: validateLoadedBlocks })
    if (loaded.kind !== 'loaded') {
        throw new Error(`the seeded store did not load: ${loaded.kind}`)
    }
    return { store, owner }
}

async function nextStart(store: FakeStore): Promise<string> {
    const { owner } = makeOwner(store)
    try {
        const again = await owner.load({ validate: validateLoadedBlocks })
        if (again.kind !== 'loaded') {
            return `not loaded: ${again.kind}`
        }
        return (again.tree.characters as unknown as Entry[]).map((c) => String(c.chaId)).join(',')
    } catch (error) {
        return `THROWS ${error instanceof Error ? error.message : String(error)}`
    }
}

describe('a tree with an entry that is not a character (regression: S1)', () => {
    test('the committed save loads on the next start with the two characters', async () => {
        const { store, owner } = await bootedStore()
        const set = await treeToBlockSet(tree([character('a'), 5, character('b')]))
        const result = await owner.commitSave(set)
        expect(result.kind).toBe('committed')
        expect(await nextStart(store)).toBe('a,b')
    })

    test('an empty-list entry is left out the same way', async () => {
        const { store, owner } = await bootedStore()
        await owner.commitSave(await treeToBlockSet(tree([character('a'), [], character('b')])))
        expect(await nextStart(store)).toBe('a,b')
    })
})

describe('containers that are not lists (regression: S7)', () => {
    test('modules holding an object parks with a named error before any block exists', async () => {
        await expect(treeToBlockSet(tree([character('a')], { modules: {} }))).rejects.toMatchObject({ kind: 'container-not-list' })
    })

    test('a tree with modules undefined becomes a save that loads', async () => {
        const { store, owner } = await bootedStore()
        await owner.commitSave(await treeToBlockSet(tree([character('a'), character('b')], { modules: undefined })))
        expect(await nextStart(store)).toBe('a,b')
    })
})

describe('the packing rule reads a list that changed during the pass (R)', () => {
    test('(R) an entry that is not a character and an id that is not text or a number belong to no block and do not throw', () => {
        const list = [
            null,
            5,
            { chaId: Symbol('id'), coldstorage: 'u1' },
            { chaId: {}, coldstorage: 'u2' },
            { coldstorage: 'u3' },
            { chaId: 'a', coldstorage: 'u4' },
            { chaId: 'b' },
        ]
        expect(Array.from(packedNamesOf(list as never))).toEqual(['a'])
    })

    test('(G) a numeric id is packed under its text form, as the encoder keys its block', () => {
        expect(Array.from(packedNamesOf([{ chaId: 7, coldstorage: 'u' }] as never))).toEqual(['7'])
    })
})

describe('the report a restore reads (unit of the new API)', () => {
    test('reports the excluded entries next to the set', async () => {
        const { set, report } = await treeToBlockSetReported(tree([character('a'), 5, character('b')]))
        expect(set.layout.keys).not.toContain('undefined')
        expect(report.excluded.map((item) => item.reason)).toEqual(['not-character'])
    })

    test('a clean tree reports nothing', async () => {
        const { report } = await treeToBlockSetReported(tree([character('a'), character('b')]))
        expect(report.excluded).toEqual([])
    })
})
