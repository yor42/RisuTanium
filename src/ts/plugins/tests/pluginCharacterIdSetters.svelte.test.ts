/**
 * A plugin's write to the character list is refused when it would leave the
 * page with something that cannot be saved: `characters` or `modules` that is
 * not a list, an entry that is not a character, or an id that cannot be saved
 * (the fork's difference from upstream; see `plugins.md`).
 *
 * Drives the REAL V2 setters (`src/ts/plugins/plugins.svelte.ts`, through the
 * `getDatabase()` wrapper they hand out) over a real reactive `DBState.db`;
 * every other module `plugins.svelte.ts` imports is mocked so it loads. The
 * rejected writes use detached objects, so a refusal is the only thing that
 * keeps the page's list unchanged.
 *
 * Title labels: (R) marks a reproducer that fails against setters with no
 * check; (G) marks a guard that passes with or without it.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import type { Database } from '../../storage/database.svelte'

//#region module mocks

const memStore = new Map<string, unknown>()

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => memStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                memStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                memStore.delete(key)
            }),
        }),
    },
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

vi.mock(import('../../platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}) as unknown as typeof import('../../platform'))

vi.mock(import('../../storage/database.svelte'), () => ({
    getCurrentCharacter: vi.fn(),
    getDatabase: vi.fn(() => (globalThis as unknown as { __testDB: Database }).__testDB),
    setDatabase: vi.fn((db: Database) => {
        ;(globalThis as unknown as { __testDB: Database }).__testDB = db
        const state = (globalThis as unknown as { __testDBState: { db: Database } }).__testDBState
        state.db = db
    }),
    setDatabaseLite: vi.fn(),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('../../storage/database.svelte'))

vi.mock(import('../../alert'), () => ({
    alertConfirm: vi.fn(async () => true),
    alertError: vi.fn(),
    alertPluginConfirm: vi.fn(async () => true),
}) as unknown as typeof import('../../alert'))

vi.mock(import('../../util'), () => ({
    selectSingleFile: vi.fn(),
    sleep: vi.fn(async () => {}),
}) as unknown as typeof import('../../util'))

vi.mock(import('../../globalApi.svelte'), () => ({
    fetchNative: vi.fn(),
    globalFetch: vi.fn(),
    readImage: vi.fn(),
    saveAsset: vi.fn(),
    toGetter: vi.fn((obj: unknown) => obj),
    forageStorage: {
        keys: vi.fn(async () => []),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}) as unknown as typeof import('../../globalApi.svelte'))

vi.mock(import('../../stores.svelte'), () => {
    const state = $state({ db: {} as unknown as Database })
    ;(globalThis as unknown as { __testDBState: { db: Database } }).__testDBState = state
    return {
        DBState: state,
        hotReloading: writable(false),
        pluginAlertModalStore: writable(null),
        selectedCharID: writable(-1),
    } as unknown as typeof import('../../stores.svelte')
})

vi.mock(import('../pluginSafety'), () => ({
    checkCodeSafety: vi.fn(async () => true),
}) as unknown as typeof import('../pluginSafety'))

vi.mock(import('../pluginSafeClass'), () => ({
    SafeDocument: class {},
    SafeIdbFactory: class {},
    SafeLocalStorage: class {
        getItem = vi.fn()
        setItem = vi.fn()
        removeItem = vi.fn()
        clear = vi.fn()
        key = vi.fn()
        keys = vi.fn()
    },
}) as unknown as typeof import('../pluginSafeClass'))

vi.mock(import('../apiV3/v3.svelte'), () => ({
    loadV3Plugins: vi.fn(async () => {}),
}) as unknown as typeof import('../apiV3/v3.svelte'))

vi.mock(import('../apiV3/transpiler'), () => ({
    pluginCodeTranspiler: vi.fn((code: string) => code),
}) as unknown as typeof import('../apiV3/transpiler'))

//#endregion

import { getV2PluginAPIs } from '../plugins.svelte'
import { DBState, selectedCharID } from '../../stores.svelte'

type Entry = Record<string, unknown>

function installDb(extra: Entry[] = []): void {
    DBState.db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characterOrder: [],
        characters: [
            { chaId: 'a', name: 'A', type: 'character', chats: [] },
            { chaId: 'b', name: 'B', type: 'character', chats: [] },
            ...extra,
        ],
    } as unknown as Database
    ;(globalThis as unknown as { __testDB: Database }).__testDB = DBState.db
    selectedCharID.set(0)
}

const live = () => DBState.db.characters as unknown as Entry[]
const liveIds = () => live().map((c) => c.chaId)

const api = () => getV2PluginAPIs()

beforeEach(() => {
    installDb()
})

describe('malformed whole-database writes are refused (S11)', () => {
    const SHAPES: Array<[string, () => Entry]> = [
        ['characters that is not a list', () => ({ characters: {} })],
        ['characters that is a string', () => ({ characters: 'text' })],
        ['an entry that is a number', () => ({ characters: [{ chaId: 'a' }, 5] })],
        ['an entry that is null', () => ({ characters: [{ chaId: 'a' }, null] })],
        ['an entry that is a list', () => ({ characters: [[]] })],
        ['an id that is a block name', () => ({ characters: [{ chaId: 'a' }, { chaId: 'preset' }] })],
        ['an id of 300 characters', () => ({ characters: [{ chaId: 'x'.repeat(300) }] })],
        ['an id that is a Symbol', () => ({ characters: [{ chaId: Symbol('id') }] })],
        ['an id that is an object', () => ({ characters: [{ chaId: {} }] })],
        ['modules that is not a list', () => ({ modules: {} })],
    ]

    test.each(SHAPES)('(R) setDatabase rejects %s and leaves the page as it was', async (_label, shape) => {
        await expect(api().setDatabase(shape())).rejects.toThrow()
        expect(liveIds()).toEqual(['a', 'b'])
        expect(Array.isArray(DBState.db.modules)).toBe(true)
    })

    test.each(SHAPES)('(R) setDatabaseLite rejects %s with a rejected promise and leaves the page as it was', async (_label, shape) => {
        const result = api().setDatabaseLite(shape())
        await expect(Promise.resolve(result)).rejects.toThrow()
        expect(liveIds()).toEqual(['a', 'b'])
        expect(Array.isArray(DBState.db.modules)).toBe(true)
    })

    test('(R) assigning characters or modules through the wrapper is refused', () => {
        const wrapper = api().getDatabase() as unknown as Entry
        expect(() => { wrapper.characters = 5 }).toThrow()
        expect(() => { wrapper.characters = [3] }).toThrow()
        expect(() => { wrapper.characters = [{ chaId: 'config' }] }).toThrow()
        expect(() => { wrapper.modules = {} }).toThrow()
        expect(liveIds()).toEqual(['a', 'b'])
    })

    test('(R) setChar rejects an object that is not a character and an id that cannot be saved', () => {
        expect(() => api().setChar(5)).toThrow()
        expect(() => api().setChar({ chaId: 'preset', name: 'bad', type: 'character', chats: [] })).toThrow()
        expect(() => api().setChar({ chaId: Symbol('id'), name: 'bad', type: 'character', chats: [] })).toThrow()
        expect(liveIds()).toEqual(['a', 'b'])
    })
})

describe('well-formed writes behave as before (G)', () => {
    test('(G) a list with a new well-formed character is written', async () => {
        await api().setDatabase({ characters: [...live().map((c) => ({ ...c })), { chaId: 'c', name: 'C', type: 'character', chats: [] }] })
        expect(liveIds()).toEqual(['a', 'b', 'c'])
    })

    test('(G) an entry with no id is written and given one', async () => {
        await api().setDatabase({ characters: [{ name: 'No id', type: 'character', chats: [] }] })
        expect(typeof live()[0].chaId).toBe('string')
        expect(live()[0].chaId).not.toBe('')
    })

    test('(G) a numeric id and a name that Object.prototype also has are accepted', async () => {
        await api().setDatabase({ characters: [{ chaId: 7, name: 'Seven', type: 'character', chats: [] }, { chaId: 'constructor', name: 'C', type: 'character', chats: [] }] })
        expect(liveIds()).toEqual([7, 'constructor'])
    })

    test('(G) setChar replaces the selected character', () => {
        api().setChar({ chaId: 'a', name: 'A edited', type: 'character', chats: [] })
        expect(live()[0].name).toBe('A edited')
    })

    test('(G) the round trip of the wrapper itself is accepted', async () => {
        await expect(api().setDatabase(api().getDatabase())).resolves.toBeUndefined()
        expect(liveIds()).toEqual(['a', 'b'])
    })
})

describe('while a character holds an id that cannot be saved (S20)', () => {
    beforeEach(() => {
        live()[1].chaId = 'config'
    })

    test('(G) the round trip still works: the id is already on the page', async () => {
        const snapshot = $state.snapshot(DBState.db) as Database
        await expect(api().setDatabase(snapshot)).resolves.toBeUndefined()
        await expect(Promise.resolve(api().setDatabaseLite(snapshot))).resolves.toBeUndefined()
        await expect(api().setDatabase(api().getDatabase())).resolves.toBeUndefined()
        expect(liveIds()).toEqual(['a', 'config'])
    })

    test('(G) setChar of the selected character that carries the held id back is accepted', () => {
        selectedCharID.set(1)
        expect(() => api().setChar({ chaId: 'config', name: 'B edited', type: 'character', chats: [] })).not.toThrow()
        expect(live()[1].name).toBe('B edited')
    })

    test('(R) a write that adds another holder of the same id is refused', async () => {
        const snapshot = $state.snapshot(DBState.db.characters) as unknown as Entry[]
        await expect(api().setDatabase({ characters: [...snapshot, { chaId: 'config', name: 'second', type: 'character', chats: [] }] })).rejects.toThrow()
        expect(live()).toHaveLength(2)
    })

    test('(R) setChar cannot move the held id onto another slot', () => {
        selectedCharID.set(0)
        expect(() => api().setChar({ chaId: 'config', name: 'A renamed', type: 'character', chats: [] })).toThrow()
        expect(live()[0].chaId).toBe('a')
    })

    test('(R) a different id that cannot be saved is still refused', async () => {
        const snapshot = $state.snapshot(DBState.db.characters) as unknown as Entry[]
        await expect(api().setDatabase({ characters: [snapshot[0], { ...snapshot[1], chaId: 'preset' }] })).rejects.toThrow()
        expect(liveIds()).toEqual(['a', 'config'])
    })
})
