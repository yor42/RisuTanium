/**
 * `decodeLegacyLenient`: the user-chosen "convert without these" decode. Strict
 * decoding stays the default and still rejects the same file; the lenient path
 * leaves out each block it cannot use and names it, a character by its `chaId`.
 *
 * Platform boundaries mocked as in the salvage tests: the IndexedDB block cache
 * (localforage), the shared storage the remote blocks live in and the platform
 * flags. A file whose characters live in remote blocks is built by
 * `withRemoteCharacters`.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ForageLike } from 'src/ts/storage/tests/forageBackedStore'

const { cacheStore, remoteStore } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    remoteStore: new Map<string, Uint8Array>(),
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => { cacheStore.set(key, value) }),
            removeItem: vi.fn(async (key: string) => { cacheStore.delete(key) }),
        }),
    },
}))
vi.mock(import('src/ts/globalApi.svelte'), () => ({
    forageStorage: {
        keys: vi.fn(async () => Array.from(remoteStore.keys())),
        getItem: vi.fn(async (key: string) => remoteStore.get(key) ?? null),
        setItem: vi.fn(async (key: string, value: Uint8Array) => { remoteStore.set(key, value) }),
        removeItem: vi.fn(async (key: string) => { remoteStore.delete(key) }),
    },
}) as unknown as typeof import('src/ts/globalApi.svelte'))
vi.mock(import('src/ts/storage/store/appStore'), async () => {
    const { appStoreModuleOver } = await import('src/ts/storage/tests/appStoreMock')
    const { forageStorage } = await import('src/ts/globalApi.svelte')
    return appStoreModuleOver(() => forageStorage as unknown as ForageLike) as unknown as typeof import('src/ts/storage/store/appStore')
})
vi.mock(import('src/ts/storage/database.svelte'), () => ({
    getDatabase: vi.fn(() => ({})),
    presetTemplate: { name: 'test-preset' },
}) as unknown as typeof import('src/ts/storage/database.svelte'))
vi.mock(import('src/ts/platform'), () => ({ isTauri: false, isNodeServer: true }))
vi.mock('@tauri-apps/plugin-fs', () => ({
    writeFile: vi.fn(), exists: vi.fn(async () => false), mkdir: vi.fn(), readFile: vi.fn(), BaseDirectory: { AppData: 0 },
}))

import { RisuSaveEncoder, decodeRisuSave, encodeRisuSaveLegacy, type toSaveType } from 'src/ts/storage/risuSave'
import type { Database } from 'src/ts/storage/database.svelte'
import { decodeLegacyLenient, LegacyDecodeError } from 'src/ts/storage/store2/legacy/lenient'
import { collectLegacyColdKeys } from 'src/ts/storage/store2/legacy/walk'
import { withRemoteCharacters } from '../remoteFileFixture'
import { readerOver } from './legacyFixtures'

beforeEach(() => {
    cacheStore.clear()
    remoteStore.clear()
})

function makeToSave(): toSaveType {
    return { character: [], chat: [], botPreset: false, modules: false, loadouts: false, plugins: false, pluginCustomStorage: false }
}

const IDS = ['lenient-0', 'lenient-1', 'lenient-2']

/** A block-format file of three characters that live in remote blocks. */
async function remoteFile(): Promise<Uint8Array> {
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: [{ name: 'Preset' }],
        modules: [],
        loadouts: [],
        plugins: [],
        pluginCustomStorage: {},
        characters: IDS.map((chaId, index) => ({ chaId, type: 'character', name: `Character ${index}`, chats: [] })),
    } as unknown as Database
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false })
    await encoder.set(db, makeToSave())
    const file = new Uint8Array(encoder.encode()!)
    return withRemoteCharacters(file, IDS, (key, bytes) => { remoteStore.set(key, bytes) })
}

function dropRemoteOf(chaId: string): void {
    remoteStore.delete(Array.from(remoteStore.keys()).find(key => key.includes(chaId))!)
}

function characterIds(db: Database): string[] {
    return (db.characters ?? []).map(character => String(character.chaId))
}

describe('new behaviour: lenient decode with named skips', () => {
    test('a missing remotes/ file leaves one character out, names it and keeps the others', async () => {
        const file = await remoteFile()
        dropRemoteOf(IDS[1])

        const { tree, skipped } = await decodeLegacyLenient(file)

        expect(characterIds(tree)).toEqual([IDS[0], IDS[2]])
        expect(skipped).toEqual([expect.objectContaining({ name: IDS[1], kind: 'character' })])
    })

    test('every skipped character is named, not only the first', async () => {
        const file = await remoteFile()
        dropRemoteOf(IDS[0])
        dropRemoteOf(IDS[2])

        const { tree, skipped } = await decodeLegacyLenient(file)

        expect(characterIds(tree)).toEqual([IDS[1]])
        expect(skipped.filter(entry => entry.kind === 'character').map(entry => entry.name).sort()).toEqual([IDS[0], IDS[2]])
    })

    test('an intact file skips nothing', async () => {
        const { tree, skipped } = await decodeLegacyLenient(await remoteFile())

        expect(characterIds(tree)).toEqual(IDS)
        expect(skipped).toEqual([])
    })

    test('a block the file lacks is named even where the block cache holds a copy (the cache is not consulted)', async () => {
        const file = await remoteFile()
        const intact = await decodeRisuSave(file, { strict: true }) as Database
        dropRemoteOf(IDS[1])
        cacheStore.set(`risuSaveBlock_${IDS[1]}`, { type: 1, name: IDS[1], data: JSON.stringify(intact.characters[1]) })

        const { skipped } = await decodeLegacyLenient(file)

        expect(skipped.map(entry => entry.name)).toEqual([IDS[1]])
    })

    test('a block-format save with no characters is accepted (the encoder writes no list for it)', async () => {
        const db = { formatversion: 5, botPresetsId: 0, botPresets: [{ name: 'Preset' }], modules: [], loadouts: [], plugins: [], pluginCustomStorage: {}, characters: [] } as unknown as Database
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false })
        await encoder.set(db, makeToSave())

        const { tree, skipped } = await decodeLegacyLenient(new Uint8Array(encoder.encode()!))

        expect(tree.characters ?? []).toEqual([])
        expect(skipped).toEqual([])
    })

    test('a msgpack-format save has no blocks to leave out and decodes whole', async () => {
        const { tree, skipped } = await decodeLegacyLenient(encodeRisuSaveLegacy({ characters: [] }, 'noCompression'))

        expect(tree.characters).toEqual([])
        expect(skipped).toEqual([])
    })

    test.each(['noCompression', 'compression'] as const)('a msgpack-format save whose botPresets is not a list names the presets as skipped (%s)', async (compression) => {
        const { skipped } = await decodeLegacyLenient(encodeRisuSaveLegacy({ characters: [], botPresets: { a: { name: 'a' } } }, compression))

        expect(skipped.map(entry => entry.kind)).toEqual(['presets'])
    })

    test.each(['noCompression', 'compression'] as const)('every shape the codec refuses is named once per kind, and each skipped character slot on its own (%s)', async (compression) => {
        const chat = (message: unknown) => ({ id: 'c', name: 'c', note: '', localLore: [], message })
        const save = {
            characters: [
                { chaId: 'a', chats: 'x' }, { chaId: 'b', chats: [5, chat([1])] }, 5, { chaId: 'c', chats: [chat('x')] }, null,
            ],
            botPresets: [1, { name: 'p' }],
            modules: 'x',
            loadouts: { a: 1 },
            plugins: [5],
            pluginV2: 'x',
            pluginCustomStorage: [],
        }

        const { skipped } = await decodeLegacyLenient(encodeRisuSaveLegacy(save, compression))

        expect(skipped.map(entry => entry.kind)).toEqual(['presets', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'chats', 'character', 'character'])
    })

    test.each(['noCompression', 'compression'] as const)('a msgpack-format save with a missing or null botPresets names nothing (%s)', async (compression) => {
        for (const save of [{ characters: [] }, { characters: [], botPresets: null }]) {
            const { skipped } = await decodeLegacyLenient(encodeRisuSaveLegacy(save, compression))

            expect(skipped).toEqual([])
        }
    })
})

describe('new behaviour: a result that is not a database is refused', () => {
    test('header-less bytes that the older decoders read as a bare string are refused with a typed error', async () => {
        const bytes = Uint8Array.from([0xab, ...new TextEncoder().encode('a'.repeat(11))])

        await expect(decodeLegacyLenient(bytes)).rejects.toBeInstanceOf(LegacyDecodeError)
    })

    test('a msgpack map without a characters list is refused', async () => {
        await expect(decodeLegacyLenient(encodeRisuSaveLegacy({ x: 1 }, 'noCompression'))).rejects.toBeInstanceOf(LegacyDecodeError)
    })
})

describe('guard: strict decoding stays the default and rejects what the lenient path leaves out', () => {
    test('the strict decode rejects the same file, and the walk fed that decode rejects (no deletion on a partial tree)', async () => {
        const file = await remoteFile()
        dropRemoteOf(IDS[1])

        await expect(decodeRisuSave(file, { strict: true })).rejects.toThrow()
        async function* strictTrees(): AsyncGenerator<Database> {
            yield await decodeRisuSave(file, { strict: true }) as Database
        }
        await expect(collectLegacyColdKeys(strictTrees(), readerOver(new Map()))).rejects.toThrow()
    })
})
