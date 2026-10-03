import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

// Mock set copied from risuSaveRemoteBlocks.test.ts (see that file's header
// for the full rationale). Kept in its own file, not folded into that one,
// so this file's own module-level `remoteStore` / `checkedRemoteExistence`
// state never interacts with that file's tests.

const remoteStore = new Map<string, Uint8Array>()

const { localCacheSetItem } = vi.hoisted(() => ({
    localCacheSetItem: vi.fn(async (_key: string, _value: unknown) => {}),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async () => null),
            setItem: localCacheSetItem,
            removeItem: vi.fn(async () => {}),
        }),
    },
}))

vi.mock(
    import('src/ts/globalApi.svelte'),
    () =>
        ({
            forageStorage: {
                keys: vi.fn(async () => Array.from(remoteStore.keys())),
                getItem: vi.fn(async (key: string) => remoteStore.get(key) ?? null),
                setItem: vi.fn(async (key: string, value: Uint8Array) => {
                    remoteStore.set(key, value)
                }),
                removeItem: vi.fn(async (key: string) => {
                    remoteStore.delete(key)
                }),
            },
            isPlainHttpFileSrc: vi.fn(() => false),
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
            getDatabase: vi.fn(() => ({ enableRemoteSaving: true })),
            presetTemplate: { name: 'test-preset' },
        }) as unknown as typeof import('src/ts/storage/database.svelte'),
)

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    isNodeServer: true,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(),
    exists: vi.fn(async () => false),
    mkdir: vi.fn(),
    readFile: vi.fn(),
    BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder, decodeRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'
import { forageStorage } from 'src/ts/globalApi.svelte'

beforeEach(() => {
    remoteStore.clear()
    ;(forageStorage.setItem as ReturnType<typeof vi.fn>).mockClear()
    ;(forageStorage.getItem as ReturnType<typeof vi.fn>).mockClear()
    ;(forageStorage.keys as ReturnType<typeof vi.fn>).mockClear()
    localCacheSetItem.mockClear()
})

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string, data: string): CharacterFixture {
    return {
        chaId,
        type: 'character',
        name,
        data,
        chats: [],
    } as unknown as CharacterFixture
}

function makeToSave(character: string[]): toSaveType {
    return {
        character,
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

function buildDb(characters: CharacterFixture[]): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

// MC-078, MC-079: on a remote-block build, a duplicated chaId's block is kept
// unchanged the same way it is on a local-only build -- no new remote file is
// written for it, and its pointer keeps naming the file already written.
describe('a frozen chaId on a remote-block build writes no new remote payload and keeps its pointer', () => {
    test('a marked set() pass over a duplicated key writes no additional remote file', async () => {
        const chaId = 'dup-remote-1'
        const original = makeCharacter(chaId, 'Original', 'v1')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]), { skipRemoteSavingOnCharacters: false })
        const remoteKeysAfterInit = Array.from(remoteStore.keys())
        expect(remoteKeysAfterInit.length).toBe(1)

        const copy = makeCharacter(chaId, 'Copy', 'v2-copy')
        await encoder.set(buildDb([copy, original]), makeToSave([chaId]))

        // No new remote file for this duplicated key -- the file set is
        // exactly what init() already wrote.
        expect(Array.from(remoteStore.keys())).toEqual(remoteKeysAfterInit)

        const decoded = await decodeRisuSave(new Uint8Array(encoder.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original')
    })

    // Drives init()'s own `previous` option directly, not the
    // reloadSaveEncoder() wrapper -- this file's mock set keeps
    // src/ts/globalApi.svelte a lightweight stand-in (see file header), so
    // reloadSaveEncoder() is not importable here for real. `previous` is the
    // exact mechanism reloadSaveEncoder() calls init() with on a full
    // reload; see globalApi.saveSequenceDuplicateChaId.svelte.test.ts for
    // coverage of the wrapper itself.
    test('init()\'s own previous option carries the pointer instead of writing a new remote file for a key with an existing block', async () => {
        const chaId = 'dup-remote-2'
        const original = makeCharacter(chaId, 'Original', 'v1')
        const encoder = new RisuSaveEncoder()
        await encoder.init(buildDb([original]), { skipRemoteSavingOnCharacters: false })
        const remoteKeysAfterInit = Array.from(remoteStore.keys())
        expect(remoteKeysAfterInit.length).toBe(1)

        const copy = makeCharacter(chaId, 'Copy', 'v2-copy')
        const fresh = new RisuSaveEncoder()
        await fresh.init(buildDb([copy, original]), {
            compression: false,
            skipRemoteSavingOnCharacters: false,
            previous: encoder,
        })

        expect(Array.from(remoteStore.keys())).toEqual(remoteKeysAfterInit)

        const decoded = await decodeRisuSave(new Uint8Array(fresh.encode()!))
        const decodedChar = decoded.characters?.find((c: CharacterFixture) => c.chaId === chaId)
        expect(decodedChar?.name).toBe('Original')
    })
})
