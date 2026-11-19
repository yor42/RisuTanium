import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'
import {
    assemble,
    breakDataChecksum,
    parseBlocks,
    removeBlock,
    retypeBlock,
} from './risuSaveBlockFile'

// `decodeRisuSaveReporting` is the lenient decode of `decodeRisuSave` plus the list of what the file's own blocks could
// not give. Recording never changes what is installed: a block the block cache stands in for is in the tree and is not
// listed; a block nothing stands in for is left out of the tree and listed once under its block name. Files are built by
// the real encoder, the cache entries by the helper that mirrors what upstream builds leave behind.

const { cacheStore, remoteStore } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    remoteStore: new Map<string, Uint8Array>(),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                cacheStore.set(key, value)
            }),
            removeItem: vi.fn(async (key: string) => {
                cacheStore.delete(key)
            }),
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
            getDatabase: vi.fn(() => ({})),
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

import { RisuSaveEncoder, decodeRisuSave, decodeRisuSaveReporting, encodeRisuSaveLegacy } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'
import { cacheEntriesOf } from './risuSaveCacheFixture'
import { withRemoteCharacters } from './remoteFileFixture'

beforeEach(() => {
    cacheStore.clear()
    remoteStore.clear()
})

//#region fixtures

function makeToSave(): toSaveType {
    return {
        character: [],
        chat: [],
        botPreset: false,
        modules: false,
        loadouts: false,
        plugins: false,
        pluginCustomStorage: false,
    }
}

interface Fixture {
    file: Uint8Array
    ids: string[]
}

/** A producer-built block file of three characters, a preset, modules, loadouts, plugins and plugin storage. The block cache holds one entry per block when `cached` is set. */
async function buildFile(options: { cached?: boolean, remote?: boolean } = {}): Promise<Fixture> {
    const ids = ['rep-a', 'rep-b', 'rep-c']
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'Preset' }],
        modules: [{ id: 'module-1', name: 'Module' }],
        loadouts: [{ id: 'loadout-1' }],
        plugins: [{ name: 'Plugin' }],
        pluginCustomStorage: { stored: 1 },
        someSetting: 'setting',
        characters: ids.map((chaId) => ({ chaId, type: 'character', name: `Character ${chaId}`, chats: [] })),
    } as unknown as Database
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, makeToSave())
    const encoded = encoder.encode()
    expect(encoded).not.toBeNull()
    let file: Uint8Array = new Uint8Array(encoded!)
    if (options.remote === true) {
        file = await withRemoteCharacters(file, ids, (key, bytes) => { remoteStore.set(key, bytes) })
    }
    if (options.cached === true) {
        for (const [key, entry] of cacheEntriesOf(file)) {
            cacheStore.set(key, entry)
        }
    }
    return { file, ids }
}

function characterIds(db: Database): string[] {
    return (db.characters ?? []).map((character) => String(character.chaId))
}

function kindsOf(omitted: ReadonlyMap<string, { kind: string }>): Record<string, string> {
    return Object.fromEntries([...omitted].map(([name, block]) => [name, block.kind]))
}

//#endregion

describe('decodeRisuSaveReporting on a file the decoder can read whole', () => {
    test('new contract: an intact file lists nothing and reads what decodeRisuSave reads', async () => {
        const { file } = await buildFile()

        const reported = await decodeRisuSaveReporting(file)

        expect(reported.omitted.size).toBe(0)
        expect(reported.db).toEqual(await decodeRisuSave(file))
    })

    test('new contract: a legacy msgpack save lists nothing', async () => {
        const bytes = encodeRisuSaveLegacy({ characters: [], botPresets: [] } as unknown as Database)

        const reported = await decodeRisuSaveReporting(bytes)

        expect(reported.omitted.size).toBe(0)
        expect(reported.db).toEqual(await decodeRisuSave(bytes))
    })
})

describe('decodeRisuSaveReporting records what the file could not give', () => {
    test('new contract: a damaged character nothing stands in for is left out and listed by block name as a character', async () => {
        const { file, ids } = await buildFile()
        const damaged = breakDataChecksum(file, ids[1])

        const reported = await decodeRisuSaveReporting(damaged)

        expect(kindsOf(reported.omitted)).toEqual({ [ids[1]]: 'character' })
        expect(characterIds(reported.db)).toEqual([ids[0], ids[2]])
    })

    test('new contract: a damaged PLUGINS block and a damaged character are listed with their kinds', async () => {
        const { file, ids } = await buildFile()
        const damaged = breakDataChecksum(breakDataChecksum(file, 'plugins'), ids[0])

        const reported = await decodeRisuSaveReporting(damaged)

        expect(kindsOf(reported.omitted)).toEqual({ plugins: 'plugins', [ids[0]]: 'character' })
        expect(reported.db.plugins).toBeUndefined()
    })

    test('new contract: a block the directory names but the file lacks is listed', async () => {
        const { file, ids } = await buildFile()

        const reported = await decodeRisuSaveReporting(removeBlock(file, ids[2]))

        expect(kindsOf(reported.omitted)).toEqual({ [ids[2]]: 'character' })
        expect(characterIds(reported.db)).toEqual([ids[0], ids[1]])
    })

    test('new contract: a block of a type this reader does not know is listed as other', async () => {
        const { file, ids } = await buildFile()

        const reported = await decodeRisuSaveReporting(retypeBlock(file, ids[0], 200))

        expect(kindsOf(reported.omitted)).toEqual({ [ids[0]]: 'other' })
    })

    test('new contract: a remote pointer whose file is gone is listed under the pointer block as a character', async () => {
        const { file, ids } = await buildFile({ remote: true })
        remoteStore.clear()

        const reported = await decodeRisuSaveReporting(file)

        expect(Object.values(kindsOf(reported.omitted))).toEqual(ids.map(() => 'character'))
        expect(characterIds(reported.db)).toEqual([])
    })

    test('new contract: a damaged block the directory does not name is still listed (robustness edge, not producer-shaped)', async () => {
        const { file, ids } = await buildFile()
        const blocks = parseBlocks(file)
        const root = blocks.find((block) => block.name === 'root')!
        const rootData = JSON.parse(new TextDecoder().decode(root.payload)) as { __directory: string[] }
        rootData.__directory = rootData.__directory.filter((name) => name !== ids[1])
        root.payload = new TextEncoder().encode(JSON.stringify(rootData))
        root.compression = 0
        root.storedDataChecksum = undefined
        const unnamed = breakDataChecksum(assemble(file, blocks), ids[1])

        const reported = await decodeRisuSaveReporting(unnamed)

        expect(kindsOf(reported.omitted)).toEqual({ [ids[1]]: 'character' })
    })
})

describe('decodeRisuSaveReporting and the block cache', () => {
    test('guard: a damaged block the cache answers is in the tree, as decodeRisuSave installs it, and is not listed', async () => {
        const { file, ids } = await buildFile({ cached: true })
        const damaged = breakDataChecksum(breakDataChecksum(file, ids[1]), 'plugins')

        const plain = await decodeRisuSave(damaged)
        const reported = await decodeRisuSaveReporting(damaged)

        expect(reported.omitted.size).toBe(0)
        expect(characterIds(reported.db)).toEqual(characterIds(plain))
        expect(new Set(characterIds(reported.db))).toEqual(new Set(ids))
        expect(reported.db.plugins).toEqual([{ name: 'Plugin' }])
        expect(reported.db).toEqual(plain)
    })

    test('guard: a block missing from the file and answered by the cache is in the tree and is not listed', async () => {
        const { file, ids } = await buildFile({ cached: true })
        const missing = removeBlock(file, ids[2])

        const reported = await decodeRisuSaveReporting(missing)

        expect(reported.omitted.size).toBe(0)
        expect(new Set(characterIds(reported.db))).toEqual(new Set(ids))
        expect(reported.db).toEqual(await decodeRisuSave(missing))
    })

    test('guard: with no cache entry the tree equals decodeRisuSave and the same block is listed', async () => {
        const { file, ids } = await buildFile()
        const damaged = breakDataChecksum(file, ids[1])

        const reported = await decodeRisuSaveReporting(damaged)

        expect(reported.db).toEqual(await decodeRisuSave(damaged))
        expect(characterIds(reported.db)).toEqual([ids[0], ids[2]])
        expect(reported.omitted.has(ids[1])).toBe(true)
    })
})
