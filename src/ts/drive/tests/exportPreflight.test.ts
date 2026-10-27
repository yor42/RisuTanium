/**
 * The asset list and the pre-flight of an export (`src/ts/drive/exportPreflight.ts`). New-behaviour tests for CHORE-375
 * stage B; the refusals through the real export entry points are in `characterCards.exportLarge.test.ts`.
 * Synthetic data; the Tauri size reader, the Node server and the browser store are mocked at their seams, so nothing
 * here proves native behaviour.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import type { character } from 'src/ts/storage/database.svelte'
import type { RisuModule } from 'src/ts/process/modules'

const env = vi.hoisted(() => ({
    isNodeServer: false,
    desktop: false,
    sizes: new Map<string, number>(),
    nodeStore: null as unknown,
    notices: [] as string[],
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return env.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock('src/ts/globalApi.svelte', () => ({
    pieceStoreOrNull: vi.fn(async () => env.nodeStore),
}))

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStoreKind: vi.fn(async () => 'tauri'),
}))

vi.mock(import('src/ts/storage/tauriByteTransport'), async (importOriginal) => ({
    ...await importOriginal(),
    isDesktopTransport: () => env.desktop,
    transportKind: () => 'web',
    readRangedPieces: async function* () { throw new Error('the pre-check never reads pieces') },
    statStoredSize: async (key: string) => {
        const size = env.sizes.get(key)
        if (size === undefined) {
            throw new Error('size unknown')
        }
        return size
    },
}) as unknown as typeof import('src/ts/storage/tauriByteTransport'))

vi.mock(import('src/ts/alert'), () => ({
    alertNormalWait: vi.fn(async (msg: string) => { env.notices.push(msg) }),
}) as unknown as typeof import('src/ts/alert'))

vi.mock(import('src/ts/util'), () => ({
    isKnownUri: (uri: string) => uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('ccdefault:') || uri.startsWith('embeded://'),
}) as unknown as typeof import('src/ts/util'))

import {
    CHARX_HEADROOM_MARGIN,
    LARGE_EXPORT_ASSET_BYTES,
    ZIP_SENTINEL,
    estimateCharxBytes,
    listExportAssets,
    listModuleAssets,
    preflightExport,
    refuseExport,
    type ExportAssetEntry,
} from '../exportPreflight'

const MIB = 1024 * 1024
const GIB = 1024 * MIB
const key = (name: string) => `assets/${name}.bin`

function entry(name: string, index = 0, portrait = false): ExportAssetEntry {
    return { index, key: key(name), name, portrait }
}

/** A Blob that reports a size and holds no bytes. */
class SizedBlob extends Blob {
    constructor(private readonly reported: number) { super([]) }
    get size() { return this.reported }
}

type Source = 'tauri' | 'web' | 'node'

function storeFor(source: Source): () => Promise<ByteStore | null> {
    env.desktop = source === 'tauri'
    env.isNodeServer = source === 'node'
    env.nodeStore = source === 'node'
        ? {
            read: vi.fn(),
            piecesRecorded: () => true,
            readPieces: async (name: string) => {
                const size = env.sizes.get(name)
                return size === undefined ? null : { total: size, version: null, pieces: (async function* () { yield new Uint8Array(1) })() }
            },
        }
        : null
    const store = {
        read: vi.fn(async () => ({ bytes: null })),
        readValue: async (name: string) => {
            const size = env.sizes.get(name)
            return size === undefined ? null : new SizedBlob(size)
        },
    } as unknown as ByteStore
    return async () => store
}

beforeEach(() => {
    env.isNodeServer = false
    env.desktop = false
    env.sizes.clear()
    env.nodeStore = null
    env.notices.length = 0
})

describe('listExportAssets (new behaviour)', () => {
    const v3 = [
        { uri: 'https://example.invalid/a.png', name: 'remote' },
        { uri: key('one'), name: 'first' },
        { uri: 'ccdefault:', name: 'main' },
        { uri: 'embeded://assets/icon/image/x.png', name: 'embedded' },
        { uri: key('two'), name: '' },
    ]
    const char = { image: key('portrait') } as unknown as character

    test('v3 charx lists in card order, skips known URIs and maps ccdefault: to the portrait', () => {
        expect(listExportAssets(char, 'v3', 'charx', v3)).toEqual([
            { index: 1, key: key('one'), name: 'first', portrait: false },
            { index: 2, key: key('portrait'), name: 'main', portrait: true },
            { index: 4, key: key('two'), name: 'asset_5', portrait: false },
        ])
    })

    test('v3 png leaves ccdefault: out, as the PNG loop does', () => {
        expect(listExportAssets(char, 'v3', 'png', v3).map((e) => e.index)).toEqual([1, 4])
    })

    test('v2 lists the vits files only, and only in vits mode', () => {
        const withVits = { vits: { files: { 'a.wav': key('a'), 'b.wav': key('b') } }, ttsMode: 'vits' } as unknown as character
        expect(listExportAssets(withVits, 'v2', 'png', v3).map((e) => [e.index, e.key, e.name])).toEqual([
            [0, key('a'), 'a.wav'],
            [1, key('b'), 'b.wav'],
        ])
        expect(listExportAssets({ ...withVits, ttsMode: 'other' } as unknown as character, 'v2', 'png')).toEqual([])
    })

    test('a module lists its assets in order, naming an unnamed one by position', () => {
        const module = { assets: [['song', key('s'), 'mp3'], ['', key('t'), 'png']] } as unknown as RisuModule
        expect(listModuleAssets(module)).toEqual([
            { index: 0, key: key('s'), name: 'song', portrait: false },
            { index: 1, key: key('t'), name: 'asset_2', portrait: false },
        ])
        expect(listModuleAssets({} as RisuModule)).toEqual([])
    })
})

describe('preflightExport sizes (new behaviour)', () => {
    for (const source of ['tauri', 'web', 'node'] as Source[]) {
        test(`${source}: exactly 64 MiB is not large and one byte more is`, async () => {
            const getStore = storeFor(source)
            env.sizes.set(key('edge'), LARGE_EXPORT_ASSET_BYTES)
            expect(await preflightExport([entry('edge')], 'png', getStore)).toEqual({ kind: 'ok', large: new Map() })
            env.sizes.set(key('edge'), LARGE_EXPORT_ASSET_BYTES + 1)
            expect(await preflightExport([entry('edge')], 'png', getStore)).toEqual({ kind: 'refuse-large', names: ['edge'] })
        })
    }

    test('an unknown size is not large, in every format', async () => {
        const getStore = storeFor('tauri')
        for (const format of ['png', 'json', 'risum', 'realm', 'charx'] as const) {
            expect((await preflightExport([entry('missing')], format, getStore)).kind).toBe('ok')
        }
    })

    test('a large asset is refused outside CharX and carried as a size inside it', async () => {
        const getStore = storeFor('tauri')
        env.sizes.set(key('big'), 70 * MIB)
        for (const format of ['png', 'json', 'risum', 'realm'] as const) {
            expect(await preflightExport([entry('big')], format, getStore)).toEqual({ kind: 'refuse-large', names: ['big'] })
        }
        expect(await preflightExport([entry('big')], 'charx', getStore)).toEqual({ kind: 'ok', large: new Map([[key('big'), 70 * MIB]]) })
    })

    test('names are listed once each, in list order', async () => {
        const getStore = storeFor('tauri')
        env.sizes.set(key('b'), 70 * MIB)
        env.sizes.set(key('a'), 80 * MIB)
        const result = await preflightExport([entry('b', 0), entry('a', 1), entry('b', 2)], 'png', getStore)
        expect(result).toEqual({ kind: 'refuse-large', names: ['b', 'a'] })
    })

    test('the portrait and a key outside assets/ are never sized', async () => {
        const getStore = vi.fn(async () => null)
        const result = await preflightExport([entry('p', 0, true), { index: 1, key: 'user/file.png', name: 'u', portrait: false }], 'png', getStore)
        expect(result.kind).toBe('ok')
        expect(getStore).not.toHaveBeenCalled()
    })

    test('a page whose store cannot be selected sizes nothing', async () => {
        env.sizes.set(key('big'), 70 * MIB)
        expect((await preflightExport([entry('big')], 'png', async () => null)).kind).toBe('ok')
    })
})

describe('CharX estimate (new behaviour)', () => {
    test('one entry costs its size, a type-only x_meta and the archive framing', () => {
        const sizes = new Map([[key('e'), 100 * MIB]])
        const total = estimateCharxBytes([entry('e')], sizes, {})
        const dataBytes = 100 * MIB
        const framing = (nameBytes: number, data: number) => 30 + 16 + 46 + 2 * nameBytes + 5 * Math.ceil(data / 65536)
        const expected = 22
            + framing(9, 0) + framing(12, 0)
            + dataBytes + framing(40 + 1 + 8 + 17, dataBytes)
            + 32 + framing(7 + 1 + 8 + 5, 32)
        expect(total).toBe(expected)
    })

    test('a small asset is counted with the codec allowance and a large one at its stored size', () => {
        const small = estimateCharxBytes([entry('s')], new Map([[key('s'), 1000]]), {})
        const empty = estimateCharxBytes([entry('s')], new Map(), {})
        expect(small - empty).toBeGreaterThan(1000)
        const large = estimateCharxBytes([entry('l')], new Map([[key('l'), 100 * MIB]]), {})
        const largeEmpty = estimateCharxBytes([entry('l')], new Map(), {})
        expect(large - largeEmpty).toBeLessThan(100 * MIB + 2 * 1024 * 1024)
        expect(large - largeEmpty).toBeGreaterThanOrEqual(100 * MIB)
    })

    test('the portrait is counted once per occurrence, and the jpeg prefix on top', () => {
        const none = estimateCharxBytes([entry('p', 0, true)], new Map(), { portraitBytes: 0 })
        const one = estimateCharxBytes([entry('p', 0, true)], new Map(), { portraitBytes: 1000 })
        const two = estimateCharxBytes([entry('p', 0, true), entry('p', 1, true)], new Map(), { portraitBytes: 1000 })
        // the portrait's bytes plus one stored block's framing
        expect(one - none).toBe(1000 + 5)
        expect(two - one).toBeGreaterThanOrEqual(1000)
        const withPrefix = estimateCharxBytes([entry('p', 0, true)], new Map(), { portraitBytes: 1000, jpegPrefixBytes: 1000 })
        expect(withPrefix - one).toBe(1000)
    })

    test('the same key listed twice is counted twice', async () => {
        const getStore = storeFor('tauri')
        env.sizes.set(key('v'), Math.floor(1.4 * GIB))
        const entries = (n: number) => Array.from({ length: n }, (_, i) => entry('v', i))
        expect((await preflightExport(entries(2), 'charx', getStore)).kind).toBe('ok')
        expect((await preflightExport(entries(3), 'charx', getStore)).kind).toBe('refuse-total')
    })

    test('the refusal is at the sentinel minus the margin, not before', async () => {
        const getStore = storeFor('tauri')
        const limit = ZIP_SENTINEL - CHARX_HEADROOM_MARGIN
        const estimateOf = (size: number) => estimateCharxBytes([entry('v')], new Map([[key('v'), size]]), {})
        // the largest size whose estimate is still below the limit
        let low = 0
        let high = ZIP_SENTINEL
        while (low < high) {
            const middle = Math.ceil((low + high) / 2)
            if (estimateOf(middle) < limit) {
                low = middle
            } else {
                high = middle - 1
            }
        }
        expect(estimateOf(low)).toBeLessThan(limit)
        expect(estimateOf(low + 1)).toBeGreaterThanOrEqual(limit)
        env.sizes.set(key('v'), low)
        expect((await preflightExport([entry('v')], 'charx', getStore)).kind).toBe('ok')
        env.sizes.set(key('v'), low + 1)
        expect(await preflightExport([entry('v')], 'charx', getStore)).toEqual({ kind: 'refuse-total', total: estimateOf(low + 1) })
    })
})

describe('refuseExport (new behaviour)', () => {
    test('an ok result shows nothing and is not a refusal', async () => {
        expect(await refuseExport({ kind: 'ok', large: new Map() })).toBe(false)
        expect(env.notices).toEqual([])
    })

    test('each refusal shows one notice and is a refusal; Realm wording does not suggest CharX', async () => {
        expect(await refuseExport({ kind: 'refuse-large', names: ['Big Video'] })).toBe(true)
        expect(await refuseExport({ kind: 'refuse-large', names: ['Big Video'] }, true)).toBe(true)
        expect(await refuseExport({ kind: 'refuse-total', total: 5 * GIB })).toBe(true)
        expect(env.notices).toHaveLength(3)
        expect(env.notices[0]).toMatch(/CharX/)
        expect(env.notices[1]).not.toMatch(/CharX/)
        expect(env.notices[2]).toContain('5.00 GiB')
    })
})
