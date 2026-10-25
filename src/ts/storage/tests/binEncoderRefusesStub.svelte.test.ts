import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'

//#region module mocks -- the same set risuSave.characterIds.test.ts uses.

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

// buildRestoreSet only needs treeToBlockSetReported and SaveParkError; the rest of restoreReplace's imports are the
// replace machinery, which these rows never reach.
vi.mock('src/ts/storage/blockStore', () => ({ BlockSetGateError: class BlockSetGateError extends Error { }, retireGeneration: vi.fn() }))
vi.mock('src/ts/storage/mainFileRename', () => ({ finishMainFileRename: vi.fn() }))
vi.mock('src/ts/storage/pageBlockOwner', () => ({ getPageBlockOwner: vi.fn() }))
vi.mock('src/ts/storage/pageStorageMode', () => ({ getPageStorageMode: vi.fn(), pendingConvertedFrom: vi.fn(), setPageStorageMode: vi.fn() }))
vi.mock('src/ts/stores.svelte', () => ({ DBState: { db: undefined } }))
vi.mock('src/ts/process/coldstorage.svelte', () => ({ readColdStorageItem: vi.fn() }))
vi.mock('src/ts/storage/characterTreeRepair', () => ({ repairCharacterTree: vi.fn(), summarizeRepair: vi.fn() }))

//#endregion

import { RisuSaveEncoder, encodeRisuSaveCompressionStream, encodeRisuSaveLegacy } from '../risuSave'
import type { toSaveType } from '../risuSave'
import { writeRisuSaveV0 } from '../risuSaveV0'
import { SaveParkError } from '../saveHold'
import { buildRestoreSet } from '../../drive/restoreReplace'
import { language } from 'src/lang'
import type { Database } from '../database.svelte'

// The literal marker, not an import of the leaf: the rows below mean the same on a build that has no leaf.
const MARKER_KEY = '\uEF02moduleStub'

beforeEach(() => {
    store.clear()
    vi.spyOn(console, 'log').mockImplementation(() => { })
    vi.spyOn(console, 'warn').mockImplementation(() => { })
})

afterEach(() => {
    vi.restoreAllMocks()
})

type Entry = Record<string, unknown>

const stubModule = (): Entry => ({ id: 'stub-id-1', name: 'Stub Module Name', description: '', [MARKER_KEY]: 1 })
const fullModule = (): Entry => ({ id: 'full-id-1', name: 'Full Module', description: '', lorebook: [], regex: [], trigger: [] })

function character(chaId: string, name = `name ${chaId}`): Entry {
    return { chaId, type: 'character', name, chats: [{ message: [{ role: 'char', data: 'hi' }] }] }
}

function tree(modules: unknown, characters: Entry[] = [character('cha-a'), character('cha-b')]): Database {
    return {
        formatversion: 5,
        botPresets: [{ name: 'preset one' }],
        modules,
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters,
    } as unknown as Database
}

function nothingMarked(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

async function expectRefusal(run: () => unknown): Promise<SaveParkError> {
    let caught: unknown
    try {
        await run()
    } catch (error) {
        caught = error
    }
    expect(caught).toBeInstanceOf(SaveParkError)
    const refusal = caught as SaveParkError
    expect(refusal.what).toBe('modules')
    expect(refusal.message).toContain('Stub Module Name')
    expect(refusal.message).toContain('stub-id-1')
    return refusal
}

describe('RisuSaveEncoder.init', () => {
    test('refuses a database holding a stub, before any block is built', async () => {
        const encoder = new RisuSaveEncoder()
        await expectRefusal(() => encoder.init(tree([fullModule(), stubModule()]), { compression: false }))
        expect(encoder.snapshotLayout()).toBeNull()
    })

    test('a database without stubs is encoded', async () => {
        const encoder = new RisuSaveEncoder()
        await encoder.init(tree([fullModule()]), { compression: false })
        expect(encoder.snapshotLayout()).not.toBeNull()
    })
})

describe('RisuSaveEncoder.set', () => {
    async function readyEncoder(db: Database): Promise<RisuSaveEncoder> {
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        await encoder.set(db, nothingMarked())
        return encoder
    }

    function layoutText(encoder: RisuSaveEncoder): string {
        const layout = encoder.snapshotLayout()
        if (layout === null) {
            throw new Error('no layout')
        }
        return layout.keys.map((key, index) => `${key}:${Buffer.from(layout.blocks[index]).toString('base64')}`).join('|')
    }

    test('refuses a stub injected after init, leaving the layout and the marks as they were', async () => {
        const modules: unknown[] = [fullModule()]
        const db = tree(modules)
        const encoder = await readyEncoder(db)
        const before = layoutText(encoder)
        // A character change that set() would write before it reached the modules list.
        ;(db.characters[0] as unknown as Entry).name = 'renamed after init'
        modules.push(stubModule())
        const toSave = { ...nothingMarked(), character: ['cha-a'], modules: true }
        await expectRefusal(() => encoder.set(db, toSave))
        expect(layoutText(encoder)).toBe(before)
        expect(toSave.character).toEqual(['cha-a'])
    })

    test('refuses with the modules block not marked', async () => {
        const modules: unknown[] = [fullModule()]
        const db = tree(modules)
        const encoder = await readyEncoder(db)
        modules.push(stubModule())
        await expectRefusal(() => encoder.set(db, nothingMarked()))
    })

    test('refuses a stub that is held through a $state proxy', async () => {
        const db = tree([fullModule()])
        const encoder = await readyEncoder(db)
        const live = $state(tree([fullModule(), stubModule()]))
        await expectRefusal(() => encoder.set(live as Database, { ...nothingMarked(), modules: true }))
    })

    test('a pass without stubs still writes', async () => {
        const db = tree([fullModule()])
        const encoder = await readyEncoder(db)
        await encoder.set(db, { ...nothingMarked(), modules: true })
        expect(encoder.snapshotLayout()).not.toBeNull()
    })
})

describe('encodeRisuSaveLegacy and encodeRisuSaveCompressionStream', () => {
    test('encodeRisuSaveLegacy refuses a stub', async () => {
        await expectRefusal(() => encodeRisuSaveLegacy({ modules: [stubModule()] }))
        await expectRefusal(() => encodeRisuSaveLegacy({ modules: [stubModule()] }, 'compression'))
    })

    test('encodeRisuSaveCompressionStream refuses a stub', async () => {
        await expectRefusal(() => encodeRisuSaveCompressionStream({ modules: [stubModule()] }))
    })

    test('guard: an empty tree and absent modules are encoded', () => {
        expect(() => encodeRisuSaveLegacy({})).not.toThrow()
        expect(() => encodeRisuSaveLegacy({ modules: undefined })).not.toThrow()
        expect(() => encodeRisuSaveLegacy({ modules: [fullModule()] })).not.toThrow()
    })
})

describe('writeRisuSaveV0', () => {
    test('throws for a stub and returns nothing', async () => {
        let result: unknown
        await expectRefusal(() => {
            result = writeRisuSaveV0(tree([stubModule()]), {})
        })
        expect(result).toBeUndefined()
    })

    test('guard: a tree without stubs is written', () => {
        expect(writeRisuSaveV0(tree([fullModule()]), {})).toBeInstanceOf(Uint8Array)
    })
})

describe('buildRestoreSet', () => {
    test('a tree holding a stub is refused with the generic modules wording', async () => {
        const built = await buildRestoreSet(tree([stubModule()]))
        expect(built).toEqual({ refusal: language.restoreRefusedUnsavable(language.saveBlockLabel('modules')) })
    })

    test('guard: a tree without stubs builds a set', async () => {
        const built = await buildRestoreSet(tree([fullModule()]))
        expect('set' in built).toBe(true)
    })
})
