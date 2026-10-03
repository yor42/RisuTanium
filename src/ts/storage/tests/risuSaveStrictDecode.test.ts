import { describe, test, expect, vi, beforeEach } from 'vitest'
import * as fflate from 'fflate'
import type { ForageLike } from './forageBackedStore'

// Strict decoding is for callers that must not act on a partial reading of a
// save file: every block the file promises has to be present and intact, and
// nothing may be answered from the IndexedDB block cache or from a legacy
// format. The default decode stays lenient for every other caller.
//
// Platform boundaries mocked here: the IndexedDB block cache (localforage),
// the shared storage the remote blocks live in (`forageStorage`), the live
// database flag that enables remote saving, and the platform flags.

const { cacheStore, remoteStore, remoteFlag } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    remoteStore: new Map<string, Uint8Array>(),
    remoteFlag: { enabled: false },
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

import { RisuSaveEncoder, decodeRisuSave } from '../risuSave'
import type { toSaveType } from '../risuSave'
import type { Database } from '../database.svelte'

beforeEach(() => {
    cacheStore.clear()
    remoteStore.clear()
    remoteFlag.enabled = false
})

//#region file-level helpers: parse, rewrite and reassemble the block container

const FILE_HEADER_LENGTH = 9 // "RISUSAVE" plus the format version byte

interface RawBlock {
    type: number
    compression: number
    name: string
    payload: Uint8Array
    /** The data checksum as stored in the parsed file; absent on a block built by hand. */
    storedDataChecksum?: number
}

const crcTable = (() => {
    const table = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
        let c = n
        for (let k = 0; k < 8; k++) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
        }
        table[n] = c
    }
    return table
})()

function crc32(data: Uint8Array): number {
    let crc = 0xffffffff
    for (let i = 0; i < data.length; i++) {
        crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
    }
    return (crc ^ 0xffffffff) >>> 0
}

function u32le(value: number): Uint8Array {
    const out = new Uint8Array(4)
    new DataView(out.buffer).setUint32(0, value, true)
    return out
}

function readU32le(data: Uint8Array, offset: number): number {
    return new DataView(data.buffer, data.byteOffset + offset, 4).getUint32(0, true)
}

function parseBlocks(file: Uint8Array): RawBlock[] {
    const blocks: RawBlock[] = []
    let offset = FILE_HEADER_LENGTH
    while (offset < file.length) {
        const type = file[offset]
        const compression = file[offset + 1]
        const nameLength = file[offset + 2]
        const name = new TextDecoder().decode(file.subarray(offset + 3, offset + 3 + nameLength))
        offset += 3 + nameLength
        const length = readU32le(file, offset)
        offset += 4 + 4 // length field, then the header checksum
        const payload = file.slice(offset, offset + length)
        const storedDataChecksum = readU32le(file, offset + length)
        offset += length + 4 // payload, then the data checksum
        blocks.push({ type, compression, name, payload, storedDataChecksum })
    }
    return blocks
}

function serializeBlock(
    block: RawBlock,
    options: { breakDataChecksum?: boolean; keepStoredDataChecksum?: boolean } = {},
): Uint8Array {
    const nameBytes = new TextEncoder().encode(block.name)
    const header = new Uint8Array(3 + nameBytes.length + 4)
    header.set([block.type, block.compression, nameBytes.length], 0)
    header.set(nameBytes, 3)
    header.set(u32le(block.payload.length), 3 + nameBytes.length)
    const dataChecksum = options.keepStoredDataChecksum
        ? block.storedDataChecksum!
        : (crc32(block.payload) ^ (options.breakDataChecksum ? 0xffffffff : 0)) >>> 0
    const out = new Uint8Array(header.length + 4 + block.payload.length + 4)
    out.set(header, 0)
    out.set(u32le(crc32(header)), header.length)
    out.set(block.payload, header.length + 4)
    out.set(u32le(dataChecksum), header.length + 4 + block.payload.length)
    return out
}

function assemble(
    file: Uint8Array,
    blocks: RawBlock[],
    options: { breakDataChecksumOf?: string; keepStoredDataChecksumOf?: string } = {},
): Uint8Array {
    const parts = blocks.map((block) =>
        serializeBlock(block, {
            breakDataChecksum: block.name === options.breakDataChecksumOf,
            keepStoredDataChecksum: block.name === options.keepStoredDataChecksumOf,
        }),
    )
    const total = FILE_HEADER_LENGTH + parts.reduce((sum, part) => sum + part.length, 0)
    const out = new Uint8Array(total)
    out.set(file.subarray(0, FILE_HEADER_LENGTH), 0)
    let offset = FILE_HEADER_LENGTH
    for (const part of parts) {
        out.set(part, offset)
        offset += part.length
    }
    return out
}

function replacePayload(file: Uint8Array, name: string, payload: Uint8Array, compression = 0): Uint8Array {
    const blocks = parseBlocks(file)
    const target = blocks.find((block) => block.name === name)
    expect(target, `block ${name} is present`).toBeTruthy()
    target!.payload = payload
    target!.compression = compression
    return assemble(file, blocks)
}

function breakDataChecksum(file: Uint8Array, name: string): Uint8Array {
    const blocks = parseBlocks(file)
    expect(blocks.some((block) => block.name === name), `block ${name} is present`).toBe(true)
    return assemble(file, blocks, { breakDataChecksumOf: name })
}

/** Replaces a block's payload while leaving the data checksum the file stored for the old payload. */
function replacePayloadKeepingChecksum(file: Uint8Array, name: string, payload: Uint8Array): Uint8Array {
    const blocks = parseBlocks(file)
    const target = blocks.find((block) => block.name === name)
    expect(target, `block ${name} is present`).toBeTruthy()
    target!.payload = payload
    target!.compression = 0
    return assemble(file, blocks, { keepStoredDataChecksumOf: name })
}

function retypeBlock(file: Uint8Array, name: string, type: number): Uint8Array {
    const blocks = parseBlocks(file)
    const target = blocks.find((block) => block.name === name)
    expect(target, `block ${name} is present`).toBeTruthy()
    target!.type = type
    return assemble(file, blocks)
}

function removeBlock(file: Uint8Array, name: string): Uint8Array {
    const blocks = parseBlocks(file)
    const remaining = blocks.filter((block) => block.name !== name)
    expect(remaining.length).toBe(blocks.length - 1)
    return assemble(file, remaining)
}

//#endregion

//#region fixture builders

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
    firstId: string
    secondId: string
}

interface FixtureOptions {
    remote?: boolean
    compression?: boolean
    /**
     * The profile's plugin storage; `'absent'` leaves the field off the
     * database, as for a profile that never used plugin storage. Defaults to
     * an empty object.
     */
    pluginCustomStorage?: 'absent' | Record<string, unknown>
    /**
     * Which encoder passes write the file. `'init'` encodes once without a
     * block directory; `'set'` adds the pass that writes the directory;
     * `'set-marked'` does the same while marking plugin storage as changed.
     */
    passes?: 'init' | 'set' | 'set-marked'
}

/**
 * Encodes a two-character database. The remote-block store keys embed a hash
 * of the content, and the encoder remembers which remote files this page load
 * already wrote, so every fixture uses ids and content no other fixture in
 * this file has used.
 */
async function buildFixture(options: FixtureOptions = {}): Promise<Fixture> {
    const n = ++fixtureCounter
    const firstId = `strict-a-${n}`
    const secondId = `strict-b-${n}`
    const db = {
        formatversion: 5,
        botPresets: [],
        botPresetsId: 0,
        modules: [],
        loadouts: [],
        plugins: [],
        characters: [
            { chaId: firstId, type: 'character', name: `First ${n}`, chats: [] },
            { chaId: secondId, type: 'character', name: `Second ${n}`, chats: [] },
        ],
    } as unknown as Database
    if (options.pluginCustomStorage !== 'absent') {
        db.pluginCustomStorage = options.pluginCustomStorage ?? {}
    }

    remoteFlag.enabled = options.remote === true
    const encoder = new RisuSaveEncoder()
    await encoder.init(db, {
        compression: options.compression ?? false,
        skipRemoteSavingOnCharacters: false,
    })
    // set() is what writes the root block's block directory.
    const passes = options.passes ?? 'set'
    if (passes !== 'init') {
        await encoder.set(db, { ...makeToSave(), pluginCustomStorage: passes === 'set-marked' })
    }
    remoteFlag.enabled = false
    const encoded = encoder.encode()
    expect(encoded).not.toBeNull()
    return { file: new Uint8Array(encoded!), firstId, secondId }
}

/** The four ways a file can be short of what it promises; each yields bytes and the id of the affected character. */
const damagedFileBuilders: Record<string, () => Promise<{ file: Uint8Array; affectedId: string }>> = {
    'a non-root block fails its data checksum': async () => {
        const { file, firstId } = await buildFixture()
        return { file: breakDataChecksum(file, firstId), affectedId: firstId }
    },
    'a non-root block does not parse as JSON': async () => {
        const { file, firstId } = await buildFixture()
        const notJson = new TextEncoder().encode('{"chaId": not json')
        return { file: replacePayload(file, firstId, notJson), affectedId: firstId }
    },
    'a remote block names a file that is missing': async () => {
        const { file, firstId } = await buildFixture({ remote: true })
        const remoteKeys = Array.from(remoteStore.keys()).filter((key) => key.includes(firstId))
        expect(remoteKeys.length).toBe(1)
        remoteStore.delete(remoteKeys[0])
        return { file, affectedId: firstId }
    },
    'a block has a type this reader does not know': async () => {
        const { file, firstId } = await buildFixture()
        return { file: retypeBlock(file, firstId, 99), affectedId: firstId }
    },
    'a remote pointer has a version this reader does not know': async () => {
        const { file, firstId } = await buildFixture({ remote: true })
        const pointer = parseBlocks(file).find((block) => block.name === firstId)
        expect(pointer, 'the remote pointer block is present').toBeTruthy()
        const info = JSON.parse(new TextDecoder().decode(pointer!.payload)) as { v: number }
        expect(info.v).toBe(2)
        const unknownVersion = new TextEncoder().encode(JSON.stringify({ ...info, v: 3 }))
        return { file: replacePayload(file, firstId, unknownVersion), affectedId: firstId }
    },
    'a directory entry is absent from the file and only the block cache holds it': async () => {
        const { file, firstId } = await buildFixture()
        expect(cacheStore.has(`risuSaveBlock_${firstId}`)).toBe(true)
        return { file: removeBlock(file, firstId), affectedId: firstId }
    },
}

//#endregion

function characterIds(decoded: Database): string[] {
    return (decoded.characters ?? []).map((character) => character.chaId as string)
}

/**
 * Collects every promise rejection nobody handled while it is listening. A
 * decompression failure surfaces on the stream's writer promise, which only
 * shows up as an unhandled rejection a few ticks after the decode returns, so
 * `stop()` waits before reporting.
 */
function watchUnhandledRejections() {
    const seen: unknown[] = []
    const listener = (reason: unknown) => { seen.push(reason) }
    process.on('unhandledRejection', listener)
    return {
        async stop(): Promise<unknown[]> {
            await new Promise((resolve) => setTimeout(resolve, 50))
            process.off('unhandledRejection', listener)
            return seen
        },
    }
}

/** A file whose first character block is flagged compressed but holds bytes that are not gzip data, with valid checksums. */
async function buildFileWithUndecompressibleBlock(): Promise<Uint8Array> {
    const { file, firstId } = await buildFixture()
    const notGzip = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    return replacePayload(file, firstId, notGzip, 1)
}

describe('a compressed non-root block whose payload cannot be decompressed', () => {
    test('strict decoding rejects and leaves no unhandled rejection behind', async () => {
        const file = await buildFileWithUndecompressibleBlock()
        const watch = watchUnhandledRejections()
        let outcome: unknown = 'resolved'
        try {
            outcome = await decodeRisuSave(file, { strict: true }).then(() => 'resolved', (error: unknown) => error)
        } finally {
            const unhandled = await watch.stop()
            expect(unhandled).toEqual([])
        }
        expect(outcome).toBeInstanceOf(Error)
    })

    test('default decoding resolves and leaves no unhandled rejection behind', async () => {
        const file = await buildFileWithUndecompressibleBlock()
        const watch = watchUnhandledRejections()
        let decoded: Database | null = null
        try {
            decoded = await decodeRisuSave(file)
        } finally {
            const unhandled = await watch.stop()
            expect(unhandled).toEqual([])
        }
        expect(Array.isArray(decoded?.botPresets)).toBe(true)
    })
})

describe('strict decoding of a RisuSave file', () => {
    describe.each(Object.entries(damagedFileBuilders))('when %s', (_label, build) => {
        test('strict decoding rejects', async () => {
            const { file } = await build()
            await expect(decodeRisuSave(file, { strict: true })).rejects.toThrow()
        })

        test('guard: default decoding of the same bytes still resolves', async () => {
            const { file } = await build()
            const decoded = await decodeRisuSave(file)
            expect(decoded).toBeTruthy()
            expect(Array.isArray(decoded.botPresets)).toBe(true)
        })
    })

    test('guard: default decoding answers a directory entry missing from the file out of the block cache', async () => {
        const { file, affectedId } = await damagedFileBuilders[
            'a directory entry is absent from the file and only the block cache holds it'
        ]()
        const decoded = await decodeRisuSave(file)
        expect(characterIds(decoded)).toContain(affectedId)
    })

    test('guard: default decoding replaces a block that fails its data checksum with the block cache copy', async () => {
        const { file, affectedId } = await damagedFileBuilders['a non-root block fails its data checksum']()
        const decoded = await decodeRisuSave(file)
        expect(characterIds(decoded)).toContain(affectedId)
        expect(characterIds(decoded).length).toBe(2)
    })

    test('guard: default decoding skips a block that does not parse as JSON and keeps the others', async () => {
        const { file, affectedId } = await damagedFileBuilders['a non-root block does not parse as JSON']()
        const decoded = await decodeRisuSave(file)
        expect(characterIds(decoded)).not.toContain(affectedId)
        expect(characterIds(decoded).length).toBe(1)
    })

    test('guard: strict decoding of an intact file equals default decoding', async () => {
        const { file, firstId, secondId } = await buildFixture()
        const lenient = await decodeRisuSave(file)
        const strict = await decodeRisuSave(file, { strict: true })
        expect(characterIds(strict).sort()).toEqual([firstId, secondId].sort())
        expect(strict).toEqual(lenient)
    })

    test('guard: strict decoding of an intact file whose blocks are compressed equals default decoding', async () => {
        const { file } = await buildFixture({ compression: true })
        const lenient = await decodeRisuSave(file)
        const strict = await decodeRisuSave(file, { strict: true })
        expect(characterIds(strict).length).toBe(2)
        expect(strict).toEqual(lenient)
    })

    test('guard: strict decoding of an intact file whose characters live in remote blocks equals default decoding', async () => {
        const { file, firstId, secondId } = await buildFixture({ remote: true })
        expect(remoteStore.size).toBe(2)
        const lenient = await decodeRisuSave(file)
        const strict = await decodeRisuSave(file, { strict: true })
        expect(characterIds(strict).sort()).toEqual([firstId, secondId].sort())
        expect(strict).toEqual(lenient)
    })

    describe('bytes that are not a RisuSave file', () => {
        function gzippedJson(): Uint8Array {
            return fflate.gzipSync(new TextEncoder().encode(JSON.stringify({ notARisuSave: true })))
        }

        test('strict decoding rejects instead of falling back to a legacy format', async () => {
            await expect(decodeRisuSave(gzippedJson(), { strict: true })).rejects.toThrow()
        })

        test('guard: default decoding of the same bytes still resolves through the legacy fallback', async () => {
            const decoded = await decodeRisuSave(gzippedJson())
            expect((decoded as unknown as { notARisuSave: boolean }).notARisuSave).toBe(true)
        })
    })
})

//#region plugin storage that was never written

const EMPTY = new Uint8Array(0)
const BLOCK_TYPE = { ROOT: 1, CHARACTER_WITH_CHAT: 2, PLUGIN_STORAGE: 11 } as const

function text(value: string): Uint8Array {
    return new TextEncoder().encode(value)
}

function hasPluginStorage(decoded: Database): boolean {
    return 'pluginCustomStorage' in decoded
}

/** Encoder pass and compression combinations that each write the plugin storage block of a profile that never used it. */
type EncoderPasses = NonNullable<FixtureOptions['passes']>
const NEVER_WRITTEN_SHAPES: ReadonlyArray<[string, EncoderPasses, boolean]> = [
    ['one encoder pass, uncompressed', 'init', false],
    ['one encoder pass, compressed', 'init', true],
    ['a directory pass, uncompressed', 'set', false],
    ['a directory pass, compressed', 'set', true],
    ['a directory pass marking plugin storage, uncompressed', 'set-marked', false],
    ['a directory pass marking plugin storage, compressed', 'set-marked', true],
]

describe('a profile that never used plugin storage', () => {
    describe.each(NEVER_WRITTEN_SHAPES)('written as %s', (_label, passes, compression) => {
        test('REPRODUCER: strict decoding resolves to what default decoding reads, with the plugin storage field absent', async () => {
            const { file, firstId, secondId } = await buildFixture({ pluginCustomStorage: 'absent', passes, compression })
            const block = parseBlocks(file).find((candidate) => candidate.name === 'pluginStorage')
            expect(block, 'the encoder writes a pluginStorage block').toBeTruthy()

            const strict = await decodeRisuSave(file, { strict: true })
            const lenient = await decodeRisuSave(file)

            expect(hasPluginStorage(strict)).toBe(false)
            expect(hasPluginStorage(lenient)).toBe(false)
            expect(characterIds(strict).sort()).toEqual([firstId, secondId].sort())
            expect(strict).toEqual(lenient)
        })
    })

    test('REPRODUCER: strict decoding resolves when the compressed block decompresses to empty content', async () => {
        const { file } = await buildFixture({ pluginCustomStorage: 'absent', compression: true })
        const block = parseBlocks(file).find((candidate) => candidate.name === 'pluginStorage')!
        expect(block.compression).toBe(1)
        expect(fflate.gunzipSync(block.payload).length).toBe(0)
        await expect(decodeRisuSave(file, { strict: true })).resolves.toBeTruthy()
    })
})

describe('plugin storage that is written, removed and written again', () => {
    test('REPRODUCER: strict decoding follows the field back to absent and then to new content', async () => {
        const n = ++fixtureCounter
        const db = {
            formatversion: 5,
            botPresets: [],
            botPresetsId: 0,
            modules: [],
            loadouts: [],
            plugins: [],
            pluginCustomStorage: { a: 1 } as Record<string, unknown> | undefined,
            characters: [{ chaId: `strict-origin-${n}`, type: 'character', name: `Origin ${n}`, chats: [] }],
        } as unknown as Database
        const encoder = new RisuSaveEncoder()
        await encoder.init(db, { compression: false, skipRemoteSavingOnCharacters: false })
        await encoder.set(db, makeToSave())
        const snapshot = () => new Uint8Array(encoder.encode()!)

        const withContent = await decodeRisuSave(snapshot(), { strict: true })
        expect(withContent.pluginCustomStorage).toEqual({ a: 1 })

        delete (db as { pluginCustomStorage?: unknown }).pluginCustomStorage
        await encoder.set(db, { ...makeToSave(), pluginCustomStorage: true })
        const removed = snapshot()
        const removedStrict = await decodeRisuSave(removed, { strict: true })
        expect(hasPluginStorage(removedStrict)).toBe(false)
        expect(removedStrict).toEqual(await decodeRisuSave(removed))

        ;(db as { pluginCustomStorage?: unknown }).pluginCustomStorage = { b: 2 }
        await encoder.set(db, { ...makeToSave(), pluginCustomStorage: true })
        const rewritten = await decodeRisuSave(snapshot(), { strict: true })
        expect(rewritten.pluginCustomStorage).toEqual({ b: 2 })

        delete (db as { pluginCustomStorage?: unknown }).pluginCustomStorage
        await encoder.set(db, { ...makeToSave(), pluginCustomStorage: true })
        const removedAgain = await decodeRisuSave(snapshot(), { strict: true })
        expect(hasPluginStorage(removedAgain)).toBe(false)
    })
})

describe('plugin storage content that is not valid', () => {
    test('guard: strict decoding rejects a pluginStorage payload of the text "undefined"', async () => {
        const { file } = await buildFixture()
        const damaged = replacePayload(file, 'pluginStorage', text('undefined'))
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/JSON/)
    })

    test('guard: strict decoding rejects a truncated pluginStorage payload', async () => {
        const { file } = await buildFixture()
        const damaged = replacePayload(file, 'pluginStorage', text('{"a"'))
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/JSON/)
    })

    test('guard: strict decoding rejects a compressed pluginStorage payload whose content is truncated', async () => {
        const { file } = await buildFixture({ compression: true })
        const damaged = replacePayload(file, 'pluginStorage', fflate.gzipSync(text('{"a"')), 1)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/JSON/)
    })

    test('guard: strict decoding rejects an empty pluginStorage block whose data checksum is broken', async () => {
        const { file } = await buildFixture({ pluginCustomStorage: 'absent' })
        const damaged = breakDataChecksum(file, 'pluginStorage')
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/checksum/i)
    })

    test('guard: strict decoding rejects a pluginStorage block whose content was emptied and whose stale checksum was kept', async () => {
        const { file } = await buildFixture({ pluginCustomStorage: { a: 1 } })
        const emptied = replacePayloadKeepingChecksum(file, 'pluginStorage', EMPTY)
        await expect(decodeRisuSave(emptied, { strict: true })).rejects.toThrow(/checksum/i)
    })

    test.each([
        ['an empty profile', 'absent' as const],
        ['a profile with plugin storage', {} as Record<string, unknown>],
    ])('guard: strict decoding rejects a file whose directory lists pluginStorage but whose blocks lack it, for %s', async (_label, pluginCustomStorage) => {
        const { file } = await buildFixture({ pluginCustomStorage })
        const damaged = removeBlock(file, 'pluginStorage')
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/pluginStorage/)
    })

    test('guard: strict decoding reads a stored null as null', async () => {
        const { file } = await buildFixture()
        const stored = replacePayload(file, 'pluginStorage', text('null'))
        const strict = await decodeRisuSave(stored, { strict: true })
        expect(strict.pluginCustomStorage).toBeNull()
        expect((await decodeRisuSave(stored)).pluginCustomStorage).toBeNull()
    })

    test('guard: strict decoding reads stored content unchanged', async () => {
        const { file } = await buildFixture({ pluginCustomStorage: { a: 1, _coldplugin: { key: 'unit' } } })
        const strict = await decodeRisuSave(file, { strict: true })
        expect(strict.pluginCustomStorage).toEqual({ a: 1, _coldplugin: { key: 'unit' } })
    })
})

describe('empty content in every other block of a file', () => {
    // Emptiness is only tolerated for the plugin storage block: each of these
    // blocks is required to hold parseable JSON when a caller reads strictly.
    const NAMED_BLOCKS = ['root', 'preset', 'modules', 'loadouts', 'plugins'] as const

    test.each(NAMED_BLOCKS)('guard: strict decoding rejects an empty %s block even when plugin storage is intact', async (name) => {
        const { file } = await buildFixture()
        const damaged = replacePayload(file, name, EMPTY)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/JSON/)
    })

    test('guard: strict decoding rejects an empty character block even when plugin storage is intact', async () => {
        const { file, firstId } = await buildFixture()
        const damaged = replacePayload(file, firstId, EMPTY)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/JSON/)
    })

    test('guard: strict decoding rejects an empty character block even when plugin storage is empty', async () => {
        const { file, firstId } = await buildFixture({ pluginCustomStorage: 'absent' })
        const damaged = replacePayload(file, firstId, EMPTY)
        await expect(decodeRisuSave(damaged, { strict: true })).rejects.toThrow(/JSON/)
    })
})

describe('a version-0 RisuSave file in the upstream encoder\'s block framing', () => {
    const VERSION_0_HEADER = new Uint8Array([...text('RISUSAVE'), 0])

    /** Upstream's block layout has no checksums: [type][compression][nameLength][name][length u32][payload]. */
    function buildVersion0File(blocks: Array<Pick<RawBlock, 'type' | 'compression' | 'name' | 'payload'>>): Uint8Array {
        const parts = blocks.map((block) => {
            const nameBytes = text(block.name)
            const out = new Uint8Array(3 + nameBytes.length + 4 + block.payload.length)
            out.set([block.type, block.compression, nameBytes.length], 0)
            out.set(nameBytes, 3)
            out.set(u32le(block.payload.length), 3 + nameBytes.length)
            out.set(block.payload, 3 + nameBytes.length + 4)
            return out
        })
        const out = new Uint8Array(VERSION_0_HEADER.length + parts.reduce((sum, part) => sum + part.length, 0))
        out.set(VERSION_0_HEADER, 0)
        let offset = VERSION_0_HEADER.length
        for (const part of parts) {
            out.set(part, offset)
            offset += part.length
        }
        return out
    }

    function minimalVersion0File(pluginStoragePayload: Uint8Array): Uint8Array {
        const root = { formatversion: 5, botPresetsId: 0, __directory: ['upstream-cha', 'pluginStorage'] }
        const character = { chaId: 'upstream-cha', type: 'character', name: 'Upstream', chats: [] }
        return buildVersion0File([
            { type: BLOCK_TYPE.ROOT, compression: 0, name: 'root', payload: text(JSON.stringify(root)) },
            { type: BLOCK_TYPE.CHARACTER_WITH_CHAT, compression: 0, name: 'upstream-cha', payload: text(JSON.stringify(character)) },
            { type: BLOCK_TYPE.PLUGIN_STORAGE, compression: 0, name: 'pluginStorage', payload: pluginStoragePayload },
        ])
    }

    test('guard: the hand-built layout is a readable version-0 file whose plugin storage content decodes in strict', async () => {
        const file = minimalVersion0File(text('{"a":1}'))
        expect(file[8]).toBe(0)
        const strict = await decodeRisuSave(file, { strict: true })
        expect(characterIds(strict)).toEqual(['upstream-cha'])
        expect(strict.pluginCustomStorage).toEqual({ a: 1 })
    })

    test('guard: strict decoding of the hand-built layout rejects truncated plugin storage content', async () => {
        const file = minimalVersion0File(text('{"a"'))
        await expect(decodeRisuSave(file, { strict: true })).rejects.toThrow(/JSON/)
    })

    test('REPRODUCER: strict decoding resolves with the plugin storage field absent when the block is empty', async () => {
        const file = minimalVersion0File(EMPTY)
        const strict = await decodeRisuSave(file, { strict: true })
        expect(characterIds(strict)).toEqual(['upstream-cha'])
        expect(hasPluginStorage(strict)).toBe(false)
        expect(hasPluginStorage(await decodeRisuSave(file))).toBe(false)
    })

    test('REPRODUCER: strict decoding resolves with the plugin storage field absent for a real-encoder file rewritten as version 0', async () => {
        const { file, firstId, secondId } = await buildFixture({ pluginCustomStorage: 'absent' })
        const version0 = buildVersion0File(parseBlocks(file))
        expect(version0[8]).toBe(0)
        const strict = await decodeRisuSave(version0, { strict: true })
        expect(characterIds(strict).sort()).toEqual([firstId, secondId].sort())
        expect(hasPluginStorage(strict)).toBe(false)
    })

    test('guard: a real-encoder file with plugin storage content rewritten as version 0 decodes in strict', async () => {
        const { file } = await buildFixture({ pluginCustomStorage: { a: 1 } })
        const strict = await decodeRisuSave(buildVersion0File(parseBlocks(file)), { strict: true })
        expect(strict.pluginCustomStorage).toEqual({ a: 1 })
    })
})

//#endregion
