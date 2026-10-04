import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks -- copied from risuSaveDuplicateChaId.test.ts (see
// risuSave.test.ts for the full rationale; not repeated here).

const { store, cacheSetItem, cacheGetItem, cacheRemoveItem } = vi.hoisted(() => {
    const store = new Map<string, unknown>()
    return {
        store,
        cacheSetItem: vi.fn(async (key: string, value: unknown) => {
            store.set(key, value)
        }),
        cacheGetItem: vi.fn(async (key: string) => store.get(key) ?? null),
        cacheRemoveItem: vi.fn(async (key: string) => {
            store.delete(key)
        }),
    }
})

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: cacheGetItem,
            setItem: cacheSetItem,
            removeItem: cacheRemoveItem,
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

import { RisuSaveEncoder } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'

beforeEach(() => {
    store.clear()
})

type CharacterFixture = Database['characters'][number]

function makeCharacter(chaId: string, name: string): CharacterFixture {
    return { chaId, type: 'character', name, chats: [] } as unknown as CharacterFixture
}

function makeToSave(character: string[] = []): toSaveType {
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

function buildDb(characters: CharacterFixture[], mainPrompt = 'prompt'): Database {
    return {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        mainPrompt,
        characters,
    } as unknown as Database
}

const fileOf = (encoder: RisuSaveEncoder) => new Uint8Array(encoder.encode()!)
const sameBytes = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((value, i) => value === b[i])

async function committedEncoder(characters: CharacterFixture[], mainPrompt = 'prompt') {
    const db = buildDb(characters, mainPrompt)
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, makeToSave())
    encoder.markLayoutCommitted(encoder.snapshotLayout()!)
    return { encoder, db }
}

describe('RisuSaveEncoder committed layout', () => {
    test('a fresh encoder has nothing committed, and nothing equals it', async () => {
        const db = buildDb([makeCharacter('a', 'A')])
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        await encoder.set(db, makeToSave())
        expect(encoder.hasCommittedLayout()).toBe(false)
        expect(encoder.layoutEqualsCommitted(encoder.snapshotLayout()!)).toBe(false)
    })

    test('the layout is null while the encoder has no file to encode', () => {
        expect(new RisuSaveEncoder().snapshotLayout()).toBeNull()
    })

    test('an unchanged encoder equals its committed layout, and the file bytes are equal', async () => {
        const { encoder } = await committedEncoder([makeCharacter('a', 'A'), makeCharacter('b', 'B')])
        const before = fileOf(encoder)
        await encoder.set(buildDb([makeCharacter('a', 'A'), makeCharacter('b', 'B')]), makeToSave(['a', 'b']))
        expect(encoder.layoutEqualsCommitted(encoder.snapshotLayout()!)).toBe(true)
        expect(sameBytes(fileOf(encoder), before)).toBe(true)
    })

    test('a changed block differs, and a change set back is equal again though its block is a new array', async () => {
        const { encoder } = await committedEncoder([makeCharacter('a', 'A')])
        const before = fileOf(encoder)
        const committed = encoder.snapshotLayout()!
        await encoder.set(buildDb([makeCharacter('a', 'changed')]), makeToSave(['a']))
        expect(encoder.layoutEqualsCommitted(encoder.snapshotLayout()!)).toBe(false)
        await encoder.set(buildDb([makeCharacter('a', 'A')]), makeToSave(['a']))
        const layout = encoder.snapshotLayout()!
        const index = layout.keys.indexOf('a')
        expect(layout.blocks[index]).not.toBe(committed.blocks[index])
        expect(encoder.layoutEqualsCommitted(layout)).toBe(true)
        expect(sameBytes(fileOf(encoder), before)).toBe(true)
    })

    test('a block deleted and added back moves to the end of the file, so the layout differs although every block is equal', async () => {
        const characters = () => [makeCharacter('a', 'A'), makeCharacter('b', 'B'), makeCharacter('c', 'C')]
        const { encoder } = await committedEncoder(characters())
        const before = fileOf(encoder)
        await encoder.set(buildDb([makeCharacter('a', 'A'), makeCharacter('c', 'C')]), makeToSave(['b']))
        await encoder.set(buildDb(characters()), makeToSave())
        expect(encoder.layoutEqualsCommitted(encoder.snapshotLayout()!)).toBe(false)
        expect(sameBytes(fileOf(encoder), before)).toBe(false)
    })

    test('building the encoder, setting it and encoding it never move the committed layout', async () => {
        const { encoder } = await committedEncoder([makeCharacter('a', 'A')])
        const committed = encoder.snapshotLayout()!
        await encoder.set(buildDb([makeCharacter('a', 'changed')]), makeToSave(['a']))
        encoder.encode()
        expect(encoder.layoutEqualsCommitted(committed)).toBe(true)
        expect(encoder.layoutEqualsCommitted(encoder.snapshotLayout()!)).toBe(false)
    })
})
