/**
 * Compatibility guard: the root opt-out key `archiveCharacters` is an ordinary
 * root field of the save. Both a `false` and a `true` value must come back from
 * the block encoder (`RisuSaveEncoder` to `decodeRisuSave`, the main database
 * file) and from the legacy whole-database encoding that the local `.bin`
 * backup entry `database.risudat` is written with (`encodeRisuSaveLegacy` to
 * `decodeRisuSave`, as `SaveLocalBackup` and `LoadLocalBackup` use them).
 *
 * An absent key must stay absent through both, so a profile that never saw the
 * setting does not gain a value from a round trip.
 *
 * The root `coldstorage` field, a separate switch, travels alongside and keeps
 * its own value.
 *
 * These tests run the real encoder and decoder with the storage backends
 * mocked; they say nothing about a native Tauri backend.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks, as in risuSave.test.ts

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

import { RisuSaveEncoder, decodeRisuSave, encodeRisuSaveLegacy } from '../risuSave'
import type { Database } from '../database.svelte'

/** The root fields under test. */
type ArchiveFields = { archiveCharacters?: boolean; coldstorage?: boolean }

function fixtureDb(fields: ArchiveFields): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: [
            { chaId: 'char1', type: 'character', name: 'Test Character', chats: [] },
        ],
        ...fields,
    } as unknown as Database
}

async function throughBlockEncoder(fields: ArchiveFields): Promise<Database & ArchiveFields> {
    const encoder = new RisuSaveEncoder()
    await encoder.init(fixtureDb(fields))
    const encoded = encoder.encode()
    expect(encoded).not.toBeNull()
    return await decodeRisuSave(new Uint8Array(encoded!)) as Database & ArchiveFields
}

async function throughBackupEncoding(fields: ArchiveFields): Promise<Database & ArchiveFields> {
    const dbWithoutAccount = { ...fixtureDb(fields), account: undefined }
    return await decodeRisuSave(encodeRisuSaveLegacy(dbWithoutAccount, 'compression')) as Database & ArchiveFields
}

const encodings: [string, (fields: ArchiveFields) => Promise<Database & ArchiveFields>][] = [
    ['the block encoder', throughBlockEncoder],
    ['the local backup encoding', throughBackupEncoding],
]

beforeEach(() => {
    store.clear()
})

describe.each(encodings)('guard: archiveCharacters through %s', (_name, roundTrip) => {
    test('a false key comes back false and root coldstorage keeps its value', async () => {
        const decoded = await roundTrip({ archiveCharacters: false, coldstorage: true })

        expect(decoded.archiveCharacters).toBe(false)
        expect(decoded.coldstorage).toBe(true)
    })

    test('a true key comes back true and root coldstorage keeps its value', async () => {
        const decoded = await roundTrip({ archiveCharacters: true, coldstorage: false })

        expect(decoded.archiveCharacters).toBe(true)
        expect(decoded.coldstorage).toBe(false)
    })

    test('an absent key stays absent', async () => {
        const decoded = await roundTrip({ coldstorage: true })

        expect('archiveCharacters' in decoded && decoded.archiveCharacters !== undefined).toBe(false)
        expect(decoded.coldstorage).toBe(true)
    })
})
