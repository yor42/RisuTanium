import { describe, test, expect, vi, beforeEach } from 'vitest'
import * as fflate from 'fflate'
import type { GzipOptions } from 'fflate'
import type { ForageLike } from './forageBackedStore'

// `writeRisuSaveV0` writes the `.bin` database entry of a tree that carries upstream's
// SaveKV namespaces, in upstream's block format. The expected bytes are framed here by
// hand and the blocks are read back by a parser in this file; the fork's own decoder is
// used only for the equality control. `guard:` tests pin behaviour that must stay true;
// the others pin the writer's contract.
//
// Platform boundaries mocked here: the IndexedDB block cache (localforage), the shared
// storage remote blocks live in (`forageStorage`), the platform flags, and fflate's
// `gzipSync`, which can be told to return a fixed result once (for the length refusal).

const { cacheStore, remoteStore, gzipBox } = vi.hoisted(() => ({
    cacheStore: new Map<string, unknown>(),
    remoteStore: new Map<string, Uint8Array>(),
    gzipBox: { forced: null as Uint8Array | null },
}))

vi.mock('fflate', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fflate')>()
    return {
        ...actual,
        gzipSync: (data: Uint8Array, options?: GzipOptions) => {
            const forced = gzipBox.forced
            if (forced !== null) {
                gzipBox.forced = null
                return forced
            }
            return actual.gzipSync(data, options)
        },
    }
})

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

import { decodeRisuSave, encodeRisuSaveLegacy } from '../risuSave'
import { writeRisuSaveV0 } from '../risuSaveV0'

beforeEach(() => {
    cacheStore.clear()
    remoteStore.clear()
    gzipBox.forced = null
})

//#region independent reader of the block format

const encoder = new TextEncoder()
const decoder = new TextDecoder()

interface ParsedBlock {
    type: number
    compression: number
    name: string
    /** The block's bytes exactly as they sit in the file, header fields included. */
    bytes: Uint8Array
    json: unknown
}

function parse(file: Uint8Array): ParsedBlock[] {
    expect(Array.from(file.subarray(0, 9))).toEqual([...encoder.encode('RISUSAVE'), 0])
    const view = new DataView(file.buffer, file.byteOffset, file.byteLength)
    const blocks: ParsedBlock[] = []
    let offset = 9
    while (offset < file.length) {
        const start = offset
        const type = file[offset]
        const compression = file[offset + 1]
        const nameLength = file[offset + 2]
        const name = decoder.decode(file.subarray(offset + 3, offset + 3 + nameLength))
        const dataLength = view.getUint32(offset + 3 + nameLength, true)
        const dataStart = offset + 3 + nameLength + 4
        const data = file.subarray(dataStart, dataStart + dataLength)
        offset = dataStart + dataLength
        const raw = compression === 1 ? fflate.gunzipSync(data) : data
        blocks.push({ type, compression, name, bytes: file.subarray(start, offset), json: JSON.parse(decoder.decode(raw)) })
    }
    expect(offset).toBe(file.length)
    return blocks
}

function names(blocks: ParsedBlock[]): string[] {
    return blocks.map((block) => block.name)
}

function block(blocks: ParsedBlock[], name: string): ParsedBlock {
    const found = blocks.find((candidate) => candidate.name === name)
    if (found === undefined) {
        throw new Error(`no block named ${name}`)
    }
    return found
}

function directoryOf(blocks: ParsedBlock[]): string[] {
    return (blocks[blocks.length - 1].json as { __directory: string[] }).__directory
}

//#endregion

//#region fixtures

function character(chaId: string, extra: Record<string, unknown> = {}) {
    return { type: 'character', chaId, name: `Name ${chaId}`, chatPage: 0, chats: [{ id: `chat-${chaId}`, name: 'Chat', message: [{ role: 'char', data: 'hello', time: 1 }] }], ...extra }
}

const NS_ALPHA = {
    version: 1,
    entries: [
        { k: 'zeta', v: { list: [1, { deep: null }, 'x'], flag: true } },
        { k: '0', v: 'zero' },
        { k: '한글키🙂', v: null },
    ],
}
const NS_OTHER = { version: 1, entries: [{ k: 'k', v: [false] }] }

function fullTree() {
    return {
        formatversion: 5,
        someSetting: 'kept',
        botPresetsId: 0,
        characters: [character('cha-1'), character('cha-2')],
        botPresets: [{ name: 'Preset', id: 'preset-1', temperature: 80 }],
        modules: [{ id: 'module-1', name: 'Module' }],
        loadouts: [{ id: 'loadout-1' }],
        plugins: [{ name: 'plugin-1' }],
        pluginCustomStorage: { a: 1 },
    }
}

//#endregion

describe('framing', () => {
    test('an empty tree is the header, a config block and a root block, byte for byte', () => {
        const out = writeRisuSaveV0({}, {})

        const configGzip = fflate.gzipSync(encoder.encode('{"version":1}'), { mtime: 0 })
        const rootJson = encoder.encode('{"__directory":["config"]}')
        const u32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
        const expected = Uint8Array.from([
            ...encoder.encode('RISUSAVE'), 0,
            0, 1, 6, ...encoder.encode('config'), ...u32(configGzip.length), ...configGzip,
            1, 0, 4, ...encoder.encode('root'), ...u32(rootJson.length), ...rootJson,
        ])
        expect(Array.from(out)).toEqual(Array.from(expected))
        // The gzip header time is zero, so the bytes do not depend on the clock.
        expect(Array.from(configGzip.subarray(4, 8))).toEqual([0, 0, 0, 0])
    })

    test('blocks come in upstream order, root last and uncompressed, the others gzip with their types', () => {
        const blocks = parse(writeRisuSaveV0(fullTree(), { 'ns-a': NS_ALPHA, 'ns-b': NS_OTHER }))

        expect(names(blocks)).toEqual(['preset', 'modules', 'loadouts', 'plugins', 'pluginStorage', 'cha-1', 'cha-2', 'kv:ns-a', 'kv:ns-b', 'config', 'root'])
        expect(blocks.map((b) => b.type)).toEqual([4, 5, 10, 9, 11, 2, 2, 12, 12, 0, 1])
        expect(blocks.map((b) => b.compression)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0])
        expect(block(blocks, 'config').json).toEqual({ version: 1 })
    })

    test('kv content is written verbatim, namespaces in insertion order, entry order kept', () => {
        const blocks = parse(writeRisuSaveV0({}, { 'ns-b': NS_OTHER, 'ns-a': NS_ALPHA }))

        expect(names(blocks)).toEqual(['kv:ns-b', 'kv:ns-a', 'config', 'root'])
        expect(block(blocks, 'kv:ns-a').json).toEqual(NS_ALPHA)
        expect((block(blocks, 'kv:ns-a').json as typeof NS_ALPHA).entries.map((e) => e.k)).toEqual(['zeta', '0', '한글키🙂'])
    })

    test('a __proto__ namespace is written as its own block (an own key, not the prototype)', () => {
        const kv: Record<string, unknown> = {}
        Object.defineProperty(kv, '__proto__', { value: NS_OTHER, enumerable: true, writable: true, configurable: true })
        const blocks = parse(writeRisuSaveV0({}, kv))

        expect(names(blocks)).toEqual(['kv:__proto__', 'config', 'root'])
        expect(block(blocks, 'kv:__proto__').json).toEqual(NS_OTHER)
    })

    test('the root keeps every key but the six that have their own blocks, and lists exactly the blocks written', () => {
        const blocks = parse(writeRisuSaveV0(fullTree(), { 'ns-a': NS_ALPHA }))
        const root = blocks[blocks.length - 1].json as Record<string, unknown>

        expect(Object.keys(root)).toEqual(['formatversion', 'someSetting', 'botPresetsId', '__directory'])
        const written = names(blocks.slice(0, -1))
        expect(directoryOf(blocks)).toEqual(written)
        expect(new Set(directoryOf(blocks))).toEqual(new Set(written))
        expect(directoryOf(blocks)).not.toContain('root')
    })

    test('an absent or null list gets no block and no directory entry', () => {
        const blocks = parse(writeRisuSaveV0({ formatversion: 5, characters: [character('only')], botPresets: null, modules: undefined }, {}))

        expect(names(blocks)).toEqual(['only', 'config', 'root'])
        expect(directoryOf(blocks)).toEqual(['only', 'config'])
        for (const parsed of blocks) {
            expect(parsed.json).not.toBeNull()
        }
    })

    test('guard: a repeated chaId is written as every block the list holds and listed once', () => {
        const blocks = parse(writeRisuSaveV0({ characters: [character('dup', { name: 'first' }), character('dup', { name: 'second' }), character('other')] }, {}))

        expect(names(blocks)).toEqual(['dup', 'dup', 'other', 'config', 'root'])
        expect(blocks.slice(0, 2).map((b) => (b.json as { name: string }).name)).toEqual(['first', 'second'])
        expect(directoryOf(blocks)).toEqual(['dup', 'other', 'config'])
    })

    test('a usable numeric chaId is written as the block named by its text form and stays a number in the character', async () => {
        const out = writeRisuSaveV0({ characters: [{ ...character('x'), chaId: 5 }, { ...character('y'), chaId: -2.5 }] }, { 'ns-a': NS_OTHER })
        const blocks = parse(out)

        expect(names(blocks)).toEqual(['5', '-2.5', 'kv:ns-a', 'config', 'root'])
        expect((block(blocks, '5').json as { chaId: unknown }).chaId).toBe(5)
        expect(directoryOf(blocks)).toEqual(['5', '-2.5', 'kv:ns-a', 'config'])
        const decoded = await decodeRisuSave(out, { strict: true })
        expect(decoded.characters.map((c) => c.chaId)).toEqual([5, -2.5])
    })

    test('a numeric chaId and the same text as a string are two blocks listed once', () => {
        const blocks = parse(writeRisuSaveV0({ characters: [{ ...character('x'), chaId: 5 }, character('5')] }, {}))

        expect(names(blocks)).toEqual(['5', '5', 'config', 'root'])
        expect(directoryOf(blocks)).toEqual(['5', 'config'])
    })

    test('guard: two runs over equal input give identical bytes', () => {
        const first = writeRisuSaveV0(fullTree(), { 'ns-a': NS_ALPHA, 'ns-b': NS_OTHER })
        const second = writeRisuSaveV0(fullTree(), { 'ns-a': NS_ALPHA, 'ns-b': NS_OTHER })
        expect(Array.from(first)).toEqual(Array.from(second))
    })
})

describe('refusals', () => {
    test('a name of 255 bytes is written and 256 bytes throws, for characters and for namespaces', () => {
        const fits = 'é'.repeat(127) + 'a'
        const tooLong = 'é'.repeat(128)
        expect(encoder.encode(fits).length).toBe(255)
        expect(encoder.encode(tooLong).length).toBe(256)

        expect(names(parse(writeRisuSaveV0({ characters: [character(fits)] }, {})))).toContain(fits)
        expect(() => writeRisuSaveV0({ characters: [character(tooLong)] }, {})).toThrow(/name/)

        const nsFits = 'é'.repeat(124) + 'abcd'
        expect(encoder.encode('kv:' + nsFits).length).toBe(255)
        expect(names(parse(writeRisuSaveV0({}, { [nsFits]: NS_OTHER })))).toContain('kv:' + nsFits)
        expect(() => writeRisuSaveV0({}, { [nsFits + 'x']: NS_OTHER })).toThrow(/name/)
    })

    test('data that does not fit four bytes throws instead of wrapping the length', () => {
        const oversize = new Uint8Array(4)
        Object.defineProperty(oversize, 'length', { value: 0x100000000 })
        gzipBox.forced = oversize

        expect(() => writeRisuSaveV0({ modules: [{ id: 'm' }] }, {})).toThrow(/data length/)
    })

    test('a name used by two kinds of block throws', () => {
        expect(() => writeRisuSaveV0({ characters: [character('kv:x')] }, { x: NS_OTHER })).toThrow(/both/)
        expect(() => writeRisuSaveV0({ characters: [character('preset')], botPresets: [{ id: 'p' }] }, {})).toThrow(/both/)
        expect(() => writeRisuSaveV0({ characters: [character('config')] }, {})).toThrow(/both/)
        expect(() => writeRisuSaveV0({ characters: [character('root')] }, {})).toThrow(/root/)
    })

    test('a character without an id and a value JSON cannot encode throw', () => {
        expect(() => writeRisuSaveV0({ characters: [{ name: 'no id' }] }, {})).toThrow(/usable id/)
        for (const chaId of [0, NaN, Infinity, true, {}, '', null]) {
            expect(() => writeRisuSaveV0({ characters: [{ chaId }] }, {})).toThrow(/usable id/)
        }
        expect(() => writeRisuSaveV0({}, { bad: undefined })).toThrow(/JSON/)
    })
})

describe('equality control', () => {
    const KV = { 'ns-a': NS_ALPHA, 'ns-b': NS_OTHER }

    test('the fork\'s strict decode of the block file equals the decode of the msgpack encoding, apart from the kv field', async () => {
        const tree = fullTree()
        const fromBlocks = await decodeRisuSave(writeRisuSaveV0(tree, KV), { strict: true })
        const fromMsgpack = await decodeRisuSave(encodeRisuSaveLegacy({ ...fullTree(), account: undefined }, 'compression'))

        const { upstreamKvBlocks, ...rest } = fromBlocks as typeof fromBlocks & { upstreamKvBlocks?: unknown }
        expect(upstreamKvBlocks).toEqual(KV)
        expect(Object.keys(upstreamKvBlocks as object)).toEqual(['ns-a', 'ns-b'])
        expect(rest).toEqual(fromMsgpack)
        expect(rest.characters.map((c) => c.chaId)).toEqual(['cha-1', 'cha-2'])
    })

    test('guard: the decoded tree differs when the written content differs', async () => {
        const fromBlocks = await decodeRisuSave(writeRisuSaveV0({ ...fullTree(), someSetting: 'changed' }, KV), { strict: true })
        const fromMsgpack = await decodeRisuSave(encodeRisuSaveLegacy(fullTree(), 'compression'))
        const { upstreamKvBlocks: _kv, ...rest } = fromBlocks as typeof fromBlocks & { upstreamKvBlocks?: unknown }
        expect(rest).not.toEqual(fromMsgpack)
    })
})
