import { describe, test, expect, vi, beforeEach } from 'vitest'
import type { ForageLike } from './forageBackedStore'
import {
    assemble,
    breakDataChecksum,
    directoryOf,
    parseBlocks,
    removeBlock,
    replacePayload,
    retypeBlock,
    FILE_HEADER_LENGTH,
} from './risuSaveBlockFile'

// `salvageRisuSave` reads the intact part of a block-format save: it throws on
// root, framing and version damage as the strict decoder does, never consults
// the IndexedDB block cache, and lists every block it could not use under its
// block name. The default and strict decoders are untouched by it.
//
// Platform boundaries mocked here: the IndexedDB block cache (localforage), the
// shared storage the remote blocks live in (`forageStorage`), the live database
// flag that enables remote saving, and the platform flags. Tests titled `guard:`
// pin behaviour that must be preserved and pass before and after the change. A
// test of `salvageRisuSave` exercises an API that did not exist before. A test
// of the encoder's cache option exercises an option that did not exist before,
// so the encoder ignores it in an earlier build.

const { cacheStore, cacheWrites, remoteStore, remoteFlag } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    cacheWrites: [] as string[],
    remoteStore: new Map<string, Uint8Array>(),
    remoteFlag: { enabled: false },
}))

vi.mock('localforage', () => ({
    default: {
        createInstance: () => ({
            getItem: vi.fn(async (key: string) => cacheStore.get(key) ?? null),
            setItem: vi.fn(async (key: string, value: unknown) => {
                cacheWrites.push(key)
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
            getDatabase: vi.fn(() => ({ enableRemoteSaving: remoteFlag.enabled })),
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

import { RisuSaveEncoder, decodeRisuSave, salvageRisuSave, RisuSaveType } from '../risuSave'
import type { toSaveType, SalvageOmittedKind } from '../risuSave'
import type { Database } from '../database.svelte'

beforeEach(() => {
    cacheStore.clear()
    cacheWrites.length = 0
    remoteStore.clear()
    remoteFlag.enabled = false
})

//#region fixtures

let fixtureCounter = 0

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

interface FixtureOptions {
    remote?: boolean
    /** How many characters the file holds. Defaults to 3. */
    characters?: number
    /** Leaves the preset, module, loadout, plugin and plugin storage content empty. */
    emptyKinds?: boolean
}

/** Encodes a database with a block directory (init plus set). Ids and content are unique to each call. */
async function buildFile(options: FixtureOptions = {}): Promise<Fixture> {
    const n = ++fixtureCounter
    const count = options.characters ?? 3
    const ids = Array.from({ length: count }, (_, index) => `salv-${n}-${index}`)
    const db = {
        formatversion: 5,
        botPresetsId: 0,
        botPresets: options.emptyKinds ? [] : [{ name: `Preset ${n}` }],
        modules: options.emptyKinds ? [] : [{ id: `module-${n}`, name: `Module ${n}` }],
        loadouts: options.emptyKinds ? [] : [{ id: `loadout-${n}` }],
        plugins: options.emptyKinds ? [] : [{ name: `Plugin ${n}` }],
        pluginCustomStorage: options.emptyKinds ? {} : { stored: n },
        someSetting: `setting-${n}`,
        characters: ids.map((chaId, index) => ({ chaId, type: 'character', name: `Character ${n}-${index}`, chats: [] })),
    } as unknown as Database

    remoteFlag.enabled = options.remote === true
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, { compression: false, skipRemoteSavingOnCharacters: false })
    await encoder.set(db, makeToSave())
    remoteFlag.enabled = false
    const encoded = encoder.encode()
    expect(encoded).not.toBeNull()
    return { file: new Uint8Array(encoded!), ids }
}

function characterIds(db: Database): string[] {
    return (db.characters ?? []).map((character) => String(character.chaId))
}

function snapshotOf<T>(store: Map<string, T>): Array<[string, T]> {
    return Array.from(store.entries()).map(([key, value]) => [key, structuredClone(value)])
}

function text(value: string): Uint8Array {
    return new TextEncoder().encode(value)
}

//#endregion

describe('salvageRisuSave on an intact file', () => {
    test('lists nothing and reads what the strict decoder reads', async () => {
        const { file } = await buildFile()

        const { db, omitted } = await salvageRisuSave(file)

        expect(Array.from(omitted.keys())).toEqual([])
        expect(db).toEqual(await decodeRisuSave(file, { strict: true }))
    })

    test('reads a file whose characters live in remote blocks, and leaves the stores as they were', async () => {
        const { file, ids } = await buildFile({ remote: true })
        expect(remoteStore.size).toBe(ids.length)
        const remotesBefore = snapshotOf(remoteStore)
        const cacheBefore = snapshotOf(cacheStore)
        cacheWrites.length = 0

        const { db, omitted } = await salvageRisuSave(file)

        expect(characterIds(db)).toEqual(ids)
        expect(omitted.size).toBe(0)
        expect(snapshotOf(remoteStore)).toEqual(remotesBefore)
        expect(snapshotOf(cacheStore)).toEqual(cacheBefore)
        expect(cacheWrites).toEqual([])
    })

    test('keeps the characters in file order', async () => {
        const { file, ids } = await buildFile({ characters: 5 })

        const { db } = await salvageRisuSave(file)

        expect(characterIds(db)).toEqual(ids)
    })
})

describe('salvageRisuSave leaves out one damaged character and keeps the rest', () => {
    const damagedCharacter: Array<[string, (fixture: Fixture) => Promise<Uint8Array> | Uint8Array]> = [
        ['its data checksum fails', ({ file, ids }) => breakDataChecksum(file, ids[1])],
        ['its content does not parse as JSON', ({ file, ids }) => replacePayload(file, ids[1], text('{"chaId": not json'))],
        ['its content is empty', ({ file, ids }) => replacePayload(file, ids[1], new Uint8Array(0))],
        ['the directory lists it and the file has no such block', ({ file, ids }) => removeBlock(file, ids[1])],
    ]

    test.each(damagedCharacter)('when %s: it is listed once as a character and the others load in order', async (_label, damage) => {
        const fixture = await buildFile()
        const damaged = await damage(fixture)

        const { db, omitted } = await salvageRisuSave(damaged)

        expect(characterIds(db)).toEqual([fixture.ids[0], fixture.ids[2]])
        expect(Array.from(omitted.keys())).toEqual([fixture.ids[1]])
        expect(omitted.get(fixture.ids[1])?.kind).toBe('character')
        expect(db.botPresets?.length).toBeGreaterThan(0)
        expect(db.modules).toBeTruthy()
    })

    // New-behaviour test: a file written by init alone has no block directory, so only the scan of the file's own blocks can list the damaged one.
    test('when the file has no block directory and its data checksum fails: it is listed once as a character and the others load', async () => {
        const n = ++fixtureCounter
        const ids = [`nodir-${n}-0`, `nodir-${n}-1`, `nodir-${n}-2`]
        const db = {
            formatversion: 5,
            botPresetsId: 0,
            botPresets: [{ name: `Preset ${n}` }],
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: ids.map((chaId) => ({ chaId, type: 'character', name: `Character ${chaId}`, chats: [] })),
        } as unknown as Database
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false, skipRemoteSavingOnCharacters: false, writeBlockCache: false })
        const file = new Uint8Array(encoder.encode()!)
        expect(directoryOf(file)).toEqual([])

        const { db: salvaged, omitted } = await salvageRisuSave(breakDataChecksum(file, ids[1]))

        expect(characterIds(salvaged)).toEqual([ids[0], ids[2]])
        expect(Array.from(omitted.keys())).toEqual([ids[1]])
        expect(omitted.get(ids[1])?.kind).toBe('character')
    })

    test('when its remote file is missing: it is listed as a character and the others load', async () => {
        const { file, ids } = await buildFile({ remote: true })
        remoteStore.delete(Array.from(remoteStore.keys()).find((key) => key.includes(ids[1]))!)

        const { db, omitted } = await salvageRisuSave(file)

        expect(characterIds(db)).toEqual([ids[0], ids[2]])
        expect(Array.from(omitted.keys())).toEqual([ids[1]])
        expect(omitted.get(ids[1])?.kind).toBe('character')
    })

    test('when its remote file does not parse as JSON: it is listed as a character and the others load', async () => {
        const { file, ids } = await buildFile({ remote: true })
        remoteStore.set(Array.from(remoteStore.keys()).find((key) => key.includes(ids[1]))!, text('{"chaId": not json'))

        const { db, omitted } = await salvageRisuSave(file)

        expect(characterIds(db)).toEqual([ids[0], ids[2]])
        expect(Array.from(omitted.keys())).toEqual([ids[1]])
        expect(omitted.get(ids[1])?.kind).toBe('character')
    })

    test('when its remote pointer has a version this reader does not know: it is listed as a character and the others load', async () => {
        const { file, ids } = await buildFile({ remote: true })
        const pointer = parseBlocks(file).find((block) => block.name === ids[1])!
        const info = JSON.parse(new TextDecoder().decode(pointer.payload)) as { v: number }
        const damaged = replacePayload(file, ids[1], text(JSON.stringify({ ...info, v: 3 })))

        const { db, omitted } = await salvageRisuSave(damaged)

        expect(characterIds(db)).toEqual([ids[0], ids[2]])
        expect(Array.from(omitted.keys())).toEqual([ids[1]])
        expect(omitted.get(ids[1])?.kind).toBe('character')
    })

    test('when the block has a type this reader does not know: it is listed as an unreadable part', async () => {
        const { file, ids } = await buildFile()

        const { db, omitted } = await salvageRisuSave(retypeBlock(file, ids[1], 99))

        expect(characterIds(db)).toEqual([ids[0], ids[2]])
        expect(Array.from(omitted.keys())).toEqual([ids[1]])
        expect(omitted.get(ids[1])?.kind).toBe('other')
    })

    test('a damaged block that the directory also lists is keyed once, under its block name', async () => {
        const { file, ids } = await buildFile()
        expect(directoryOf(file)).toContain(ids[1])

        const { omitted } = await salvageRisuSave(breakDataChecksum(file, ids[1]))

        expect(omitted.size).toBe(1)
        expect(omitted.has(ids[1])).toBe(true)
    })

    test('several damaged characters are each listed once and the order of the rest holds', async () => {
        const { file, ids } = await buildFile({ characters: 5 })
        const damaged = removeBlock(breakDataChecksum(file, ids[0]), ids[3])

        const { db, omitted } = await salvageRisuSave(damaged)

        expect(characterIds(db)).toEqual([ids[1], ids[2], ids[4]])
        expect(Array.from(omitted.keys()).sort()).toEqual([ids[0], ids[3]].sort())
    })
})

describe('salvageRisuSave never takes a block from the block cache', () => {
    test('a newer cached copy of a damaged character is not used', async () => {
        const { file, ids } = await buildFile()
        const damaged = breakDataChecksum(file, ids[1])
        cacheStore.set(`risuSaveBlock_${ids[1]}`, {
            type: RisuSaveType.CHARACTER_WITH_CHAT,
            name: ids[1],
            data: JSON.stringify({ chaId: ids[1], type: 'character', name: 'Newer copy from the cache', chats: [] }),
        })
        // The default decode does take it, which is what makes the check below mean something.
        expect(characterIds(await decodeRisuSave(damaged))).toContain(ids[1])

        const { db, omitted } = await salvageRisuSave(damaged)

        expect(characterIds(db)).toEqual([ids[0], ids[2]])
        expect(JSON.stringify(db)).not.toContain('Newer copy from the cache')
        expect(omitted.has(ids[1])).toBe(true)
    })

    test('a directory entry that only the cache holds is not used', async () => {
        const { file, ids } = await buildFile()
        const withoutBlock = removeBlock(file, ids[1])
        expect(cacheStore.has(`risuSaveBlock_${ids[1]}`)).toBe(true)
        expect(characterIds(await decodeRisuSave(withoutBlock))).toContain(ids[1])

        const { db, omitted } = await salvageRisuSave(withoutBlock)

        expect(characterIds(db)).toEqual([ids[0], ids[2]])
        expect(omitted.has(ids[1])).toBe(true)
    })

    test('a damaged kind block is not replaced by a cached copy', async () => {
        const { file } = await buildFile()
        cacheStore.set('risuSaveBlock_modules', {
            type: RisuSaveType.MODULES,
            name: 'modules',
            data: JSON.stringify([{ id: 'from-cache' }]),
        })

        const { db, omitted } = await salvageRisuSave(breakDataChecksum(file, 'modules'))

        expect(db.modules).toBeUndefined()
        expect(omitted.get('modules')?.kind).toBe('modules')
    })

    test('reads and writes nothing in the cache or the remote store', async () => {
        const { file, ids } = await buildFile({ remote: true })
        const damaged = breakDataChecksum(removeBlock(file, ids[2]), 'plugins')
        const cacheBefore = snapshotOf(cacheStore)
        const remotesBefore = snapshotOf(remoteStore)
        cacheWrites.length = 0

        await salvageRisuSave(damaged)

        expect(cacheWrites).toEqual([])
        expect(snapshotOf(cacheStore)).toEqual(cacheBefore)
        expect(snapshotOf(remoteStore)).toEqual(remotesBefore)
    })
})

describe('salvageRisuSave names the kind of every block it leaves out', () => {
    const kindCases: Array<[string, string, SalvageOmittedKind]> = [
        ['presets', 'preset', 'presets'],
        ['modules', 'modules', 'modules'],
        ['loadouts', 'loadouts', 'loadouts'],
        ['plugins', 'plugins', 'plugins'],
        ['plugin storage', 'pluginStorage', 'pluginStorage'],
        ['the config block', 'config', 'ignored'],
    ]

    test.each(kindCases)('a damaged %s block is listed under its block name as %s and the characters all load', async (_label, blockName, kind) => {
        const { file, ids } = await buildFile()

        const { db, omitted } = await salvageRisuSave(breakDataChecksum(file, blockName))

        expect(Array.from(omitted.keys())).toEqual([blockName])
        expect(omitted.get(blockName)?.kind).toBe(kind)
        expect(characterIds(db)).toEqual(ids)
    })

    test.each(kindCases)('a missing %s block that the directory lists is listed as %s', async (_label, blockName, kind) => {
        const { file, ids } = await buildFile()

        const { db, omitted } = await salvageRisuSave(removeBlock(file, blockName))

        expect(Array.from(omitted.keys())).toEqual([blockName])
        expect(omitted.get(blockName)?.kind).toBe(kind)
        expect(characterIds(db)).toEqual(ids)
    })

    test('a damaged presets block gives the template preset', async () => {
        const { file } = await buildFile()

        const { db } = await salvageRisuSave(breakDataChecksum(file, 'preset'))

        expect(db.botPresets).toEqual([{ name: 'test-preset' }])
        expect(db.botPresetsId).toBe(0)
    })

    test('a damaged modules, loadouts or plugins block leaves that field absent and the others intact', async () => {
        const { file } = await buildFile()
        const intact = await decodeRisuSave(file, { strict: true })

        const { db } = await salvageRisuSave(breakDataChecksum(breakDataChecksum(breakDataChecksum(file, 'modules'), 'loadouts'), 'plugins'))

        expect('modules' in db).toBe(false)
        expect('loadouts' in db).toBe(false)
        expect('plugins' in db).toBe(false)
        expect(db.botPresets).toEqual(intact.botPresets)
        expect(db.pluginCustomStorage).toEqual(intact.pluginCustomStorage)
        expect((db as unknown as { someSetting: string }).someSetting).toBe((intact as unknown as { someSetting: string }).someSetting)
    })

    test('a damaged plugin storage block leaves the field absent', async () => {
        const { file } = await buildFile()

        const { db } = await salvageRisuSave(breakDataChecksum(file, 'pluginStorage'))

        expect('pluginCustomStorage' in db).toBe(false)
    })

    test('a damaged config block alone still lets the file decode in every other respect', async () => {
        const { file } = await buildFile()

        const { db, omitted } = await salvageRisuSave(breakDataChecksum(file, 'config'))

        expect(Array.from(omitted.entries()).map(([name, block]) => [name, block.kind])).toEqual([['config', 'ignored']])
        expect(db).toEqual(await decodeRisuSave(file, { strict: true }))
    })

    test('a block of the unknown type 99 that is not a character is listed as an unreadable part', async () => {
        const { file } = await buildFile()

        const { omitted } = await salvageRisuSave(retypeBlock(file, 'modules', 99))

        expect(omitted.get('modules')?.kind).toBe('other')
    })

    test('every omitted entry carries a reason for diagnostics', async () => {
        const { file, ids } = await buildFile()

        const { omitted } = await salvageRisuSave(breakDataChecksum(removeBlock(file, ids[2]), ids[0]))

        for (const block of omitted.values()) {
            expect(block.reason.length).toBeGreaterThan(0)
        }
    })
})

describe('salvageRisuSave refuses what it cannot rebuild around', () => {
    test('a root block whose content does not parse as JSON', async () => {
        const { file } = await buildFile()

        await expect(salvageRisuSave(replacePayload(file, 'root', text('{"formatversion": not json')))).rejects.toThrow()
    })

    test('a root block that fails its data checksum', async () => {
        const { file } = await buildFile()

        await expect(salvageRisuSave(breakDataChecksum(file, 'root'))).rejects.toThrow()
    })

    test('a file without a root block', async () => {
        const { file } = await buildFile()
        const withoutRoot = assemble(file, parseBlocks(file).filter((block) => block.name !== 'root'))

        await expect(salvageRisuSave(withoutRoot)).rejects.toThrow()
    })

    test('a block header whose checksum fails', async () => {
        const { file } = await buildFile()
        const damaged = new Uint8Array(file)
        damaged[FILE_HEADER_LENGTH + 3] ^= 0xff

        await expect(salvageRisuSave(damaged)).rejects.toThrow()
    })

    test('a file cut short inside a block', async () => {
        const { file } = await buildFile()

        await expect(salvageRisuSave(file.slice(0, file.length - 8))).rejects.toThrow()
    })

    test('a format version byte this reader does not know', async () => {
        const { file } = await buildFile()
        const damaged = new Uint8Array(file)
        damaged[8] = 7

        await expect(salvageRisuSave(damaged)).rejects.toThrow()
    })

    test('bytes that are not a RisuSave file, with no fallback to a legacy format', async () => {
        await expect(salvageRisuSave(text('{"notARisuSave": true}'))).rejects.toThrow()
    })
})

describe('the strict and default decoders are unchanged', () => {
    // What the default decoder keeps of the two characters of each damaged file.
    const damagedFileOutcomes: Array<[string, (fixture: Fixture) => Promise<Uint8Array> | Uint8Array, boolean]> = [
        ['a non-root block fails its data checksum, and the cache holds it', ({ file, ids }) => breakDataChecksum(file, ids[0]), true],
        ['a non-root block does not parse as JSON', ({ file, ids }) => replacePayload(file, ids[0], text('{"chaId": not json')), false],
        ['a block has a type this reader does not know', ({ file, ids }) => retypeBlock(file, ids[0], 99), false],
        ['a directory entry is absent from the file and only the cache holds it', ({ file, ids }) => removeBlock(file, ids[0]), true],
    ]

    test.each(damagedFileOutcomes)('guard: when %s, strict decoding rejects and default decoding resolves', async (_label, damage, cacheRestores) => {
        const fixture = await buildFile({ characters: 2 })
        const damaged = await damage(fixture)

        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow()
        const lenient = await decodeRisuSave(damaged)

        expect(characterIds(lenient).sort()).toEqual((cacheRestores ? fixture.ids : [fixture.ids[1]]).slice().sort())
        expect(Array.isArray(lenient.botPresets)).toBe(true)
    })

    test('guard: when a remote file is missing, strict decoding rejects and default decoding keeps the other character', async () => {
        const fixture = await buildFile({ characters: 2, remote: true })
        remoteStore.delete(Array.from(remoteStore.keys()).find((key) => key.includes(fixture.ids[0]))!)

        await expect(decodeRisuSave(fixture.file, { strict: true })).rejects.toThrow()
        expect(characterIds(await decodeRisuSave(fixture.file))).toEqual([fixture.ids[1]])
    })

    test('salvaging a file first leaves the default decode result and the cache as they were', async () => {
        const fixture = await buildFile({ characters: 2 })
        const damaged = breakDataChecksum(removeBlock(fixture.file, 'modules'), fixture.ids[0])
        const before = await decodeRisuSave(damaged)
        const cacheBefore = snapshotOf(cacheStore)

        await salvageRisuSave(damaged)

        expect(await decodeRisuSave(damaged)).toEqual(before)
        expect(snapshotOf(cacheStore)).toEqual(cacheBefore)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow()
    })
})

describe('the encoder option that writes no block cache', () => {
    async function encodeWith(writeBlockCache: boolean | undefined) {
        const n = ++fixtureCounter
        const db = {
            formatversion: 5,
            botPresetsId: 0,
            botPresets: [{ name: `Preset ${n}` }],
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: {},
            characters: [{ chaId: `nocache-${n}`, type: 'character', name: `Character ${n}`, chats: [] }],
        } as unknown as Database
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false, skipRemoteSavingOnCharacters: false, ...(writeBlockCache === undefined ? {} : { writeBlockCache }) })
        await encoder.set(db, makeToSave())
        return { bytes: new Uint8Array(encoder.encode()!), id: `nocache-${n}` }
    }

    test('writes no block cache entry and changes none, through init and set', async () => {
        cacheStore.set('risuSaveBlock_modules', { type: RisuSaveType.MODULES, name: 'modules', data: 'STALE' })
        const before = snapshotOf(cacheStore)
        cacheWrites.length = 0

        await encodeWith(false)

        expect(cacheWrites).toEqual([])
        expect(snapshotOf(cacheStore)).toEqual(before)
    })

    test('guard: the file it produces decodes strictly and has the blocks the default setting produces', async () => {
        const without = await encodeWith(false)
        const withCache = await encodeWith(true)

        const strictWithout = await decodeRisuSave(without.bytes, { strict: true })
        const strictWith = await decodeRisuSave(withCache.bytes, { strict: true })

        expect(characterIds(strictWithout)).toEqual([without.id])
        expect(strictWithout.botPresets?.length).toBe(strictWith.botPresets?.length)
        expect(parseBlocks(without.bytes).map((block) => block.name).filter((name) => name !== without.id))
            .toEqual(parseBlocks(withCache.bytes).map((block) => block.name).filter((name) => name !== withCache.id))
    })

    test('guard: by default the encoder records every block it writes in the block cache', async () => {
        cacheWrites.length = 0

        const { id } = await encodeWith(undefined)

        expect(cacheWrites).toContain(`risuSaveBlock_${id}`)
        expect(cacheWrites).toContain('risuSaveBlock_root')
        expect(cacheWrites).toContain('risuSaveBlock_modules')
    })
})
