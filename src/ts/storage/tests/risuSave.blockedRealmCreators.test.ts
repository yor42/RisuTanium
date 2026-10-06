import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks -- same isolation as risuSave.test.ts

const { store } = vi.hoisted(() => ({ store: new Map<string, unknown>() }))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => store.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { store.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { store.delete(key) }),
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
                setItem: vi.fn(async () => {}),
            },
        }) as unknown as typeof import('src/ts/globalApi.svelte'),
)

vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})

vi.mock(
    import('src/ts/storage/database.svelte'),
    () =>
        ({
            getDatabase: vi.fn(() => { throw new Error('no live database in tests') }),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: false,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

//#endregion

import { RisuSaveEncoder, decodeRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { BlockedRealmCreator, Database } from '../database.svelte'

beforeEach(() => {
    store.clear()
})

function buildDb(blocked: BlockedRealmCreator[]): Database {
    return {
        formatversion: 5,
        blockedRealmCreators: blocked,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [
            {
                chaId: 'char1',
                type: 'character',
                name: 'Test Character',
                chats: [],
            },
        ],
    } as unknown as Database
}

const nothingToSave: toSaveType = {
    character: [],
    chat: [],
    botPreset: false,
    modules: false,
    loadouts: false,
    plugins: false,
    pluginCustomStorage: false,
}

// Compatibility guards for the block encoder (RisuSaveEncoder / decodeRisuSave) only: the root
// block carries blockedRealmCreators through the generic root encoding. They say nothing about
// the .bin export or import path.
describe('compatibility guard: blockedRealmCreators in the save root', () => {
    test('guard: survives a full encode and decode', async () => {
        const blocked = [{ id: 'creator-a', name: 'Creator A' }]
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb(blocked))
        const encoded = encoder.encode()
        expect(encoded).not.toBeNull()

        const decoded = await decodeRisuSave(new Uint8Array(encoded!))

        expect(decoded.blockedRealmCreators).toEqual(blocked)
    })

    test('guard: an incremental set() that saves no block still writes the changed field into the root', async () => {
        const db = buildDb([{ id: 'creator-a', name: 'Creator A' }])
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)

        db.blockedRealmCreators = [
            ...db.blockedRealmCreators,
            { id: 'creator-b', name: 'Creator B' },
        ]
        await encoder.set(db, nothingToSave)
        const encoded = encoder.encode()
        expect(encoded).not.toBeNull()

        const decoded = await decodeRisuSave(new Uint8Array(encoded!))

        expect(decoded.blockedRealmCreators).toEqual([
            { id: 'creator-a', name: 'Creator A' },
            { id: 'creator-b', name: 'Creator B' },
        ])
    })

    test('guard: a save without the field decodes without it', async () => {
        const db = buildDb([])
        delete (db as Partial<Database>).blockedRealmCreators
        const encoder = new RisuSaveEncoder()
        await encoder.init(db)
        const encoded = encoder.encode()

        const decoded = await decodeRisuSave(new Uint8Array(encoded!))

        expect(decoded.blockedRealmCreators).toBeUndefined()
        expect(decoded.characters?.[0]?.chaId).toBe('char1')
    })
})
