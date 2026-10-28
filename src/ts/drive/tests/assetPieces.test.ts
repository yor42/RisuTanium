/**
 * The export-side asset piece source (`src/ts/drive/assetPieces.ts`). New-behaviour tests for the wrapper added
 * with CHORE-375: `exportAssetPieceSource`, `openExportAssetPieces` and `assetStoredSize`. The moved sources keep
 * their coverage in the backup export tests. Synthetic data; the Tauri reader, the Node server and the browser
 * store are mocked at their seams, so nothing here proves native behaviour.
 */
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'

const env = vi.hoisted(() => ({
    isNodeServer: false,
    desktop: false,
    transport: 'web' as 'web' | 'android',
    storeKind: 'tauri' as string,
    nodeStore: null as unknown,
    ranged: vi.fn(),
    stat: vi.fn(),
}))

vi.mock(import('src/ts/platform'), () => ({
    isTauri: false,
    get isNodeServer() { return env.isNodeServer },
}) as unknown as typeof import('src/ts/platform'))

vi.mock('src/ts/globalApi.svelte', () => ({
    pieceStoreOrNull: vi.fn(async () => env.nodeStore),
}))

vi.mock('src/ts/storage/store/appStore', () => ({
    getAppStoreKind: vi.fn(async () => env.storeKind),
}))

vi.mock('src/ts/storage/tauriByteTransport', () => ({
    isDesktopTransport: () => env.desktop,
    transportKind: () => env.transport,
    readRangedPieces: (...args: unknown[]) => env.ranged(...args),
    statStoredSize: (key: string) => env.stat(key),
}))

import {
    ANDROID_PIECE_SOURCE,
    DESKTOP_PIECE_SOURCE,
    ExportAssetMissingError,
    assetStoredSize,
    exportAssetPieceSource,
    openExportAssetPieces,
    type ExportAssetSource,
} from '../assetPieces'
import { ExportReadError, type ReadPiece } from '../inlayBackupExport'

function piece(text: string, total: number): ReadPiece {
    return { bytes: new TextEncoder().encode(text), total }
}

/** A generator over `items` that records whether it was closed before finishing. */
function trackedPieces(items: ReadPiece[]) {
    const state = { closed: false }
    async function* gen(): AsyncGenerator<ReadPiece, void, undefined> {
        try {
            for (const item of items) {
                yield item
            }
        } finally {
            state.closed = true
        }
    }
    return { state, gen }
}

function bareStore(extra: Partial<ByteStore> = {}): ByteStore {
    return { read: vi.fn(async () => ({ bytes: null })), ...extra } as unknown as ByteStore
}

function nodeStoreOf(readPieces: NonNullable<ByteStore['readPieces']>): ByteStore {
    return bareStore({ readPieces, piecesRecorded: () => true })
}

beforeEach(() => {
    env.isNodeServer = false
    env.desktop = false
    env.transport = 'web'
    env.storeKind = 'tauri'
    env.nodeStore = null
    env.ranged.mockReset()
    env.stat.mockReset()
})

describe('exportAssetPieceSource (new behaviour)', () => {
    test('the desktop files store wins over Node and web', async () => {
        env.desktop = true
        env.isNodeServer = true
        env.nodeStore = nodeStoreOf(vi.fn())
        const store = bareStore({ readValue: vi.fn() })
        const source = await exportAssetPieceSource(store)
        expect(source?.kind).toBe('tauri')
        expect(source?.pieces).toBe(DESKTOP_PIECE_SOURCE)
        expect(source?.store).toBe(store)
    })

    test('Android files store uses the Android source', async () => {
        env.transport = 'android'
        const source = await exportAssetPieceSource(bareStore())
        expect(source?.kind).toBe('tauri')
        expect(source?.pieces).toBe(ANDROID_PIECE_SOURCE)
    })

    test('a Node page whose server takes pieces wins over web', async () => {
        env.isNodeServer = true
        env.nodeStore = nodeStoreOf(vi.fn())
        const source = await exportAssetPieceSource(bareStore({ readValue: vi.fn() }))
        expect(source?.kind).toBe('node')
        expect(source?.pieces.node).toBe(true)
    })

    test('a store with readValue is the web source; one without is null', async () => {
        const web = await exportAssetPieceSource(bareStore({ readValue: vi.fn() }))
        expect(web?.kind).toBe('web')
        expect(web?.pieces.node).toBe(false)
        expect(await exportAssetPieceSource(bareStore())).toBeNull()
    })
})

describe('openExportAssetPieces (new behaviour)', () => {
    test('tauri: first piece and the rest generator', async () => {
        const { gen } = trackedPieces([piece('ab', 4), piece('cd', 4)])
        const source: ExportAssetSource = { kind: 'tauri', pieces: { open: () => gen(), node: false }, store: bareStore() }
        const { first, rest } = await openExportAssetPieces('assets/a', source)
        expect(first.total).toBe(4)
        expect(new TextDecoder().decode(first.bytes)).toBe('ab')
        const next = await rest.next()
        expect(next.done).toBe(false)
        expect(new TextDecoder().decode(next.done === true ? undefined : next.value.bytes)).toBe('cd')
        expect((await rest.next()).done).toBe(true)
    })

    test('tauri: the identity the files store reported with the first piece is returned; ReadPiece itself is unchanged', async () => {
        const withIdentity = { ...piece('ab', 2), offset: 0, identity: '00ff10' }
        const { gen } = trackedPieces([withIdentity])
        const source: ExportAssetSource = { kind: 'tauri', pieces: { open: () => gen(), node: false }, store: bareStore() }
        const opened = await openExportAssetPieces('assets/a', source)
        expect(opened.identity).toBe('00ff10')
        expect(opened.first).toBe(withIdentity)
    })

    test('a source that reports no identity (web, node) returns none, so two opens compare equal', async () => {
        for (const kind of ['web', 'node'] as const) {
            const { gen } = trackedPieces([piece('ab', 2)])
            const source: ExportAssetSource = { kind, pieces: { open: () => gen(), node: kind === 'node' }, store: bareStore() }
            expect((await openExportAssetPieces('assets/a', source)).identity).toBeUndefined()
        }
    })

    test('a piece whose identity is not a string is not taken for one', async () => {
        const { gen } = trackedPieces([{ ...piece('ab', 2), identity: 7 } as unknown as ReadPiece])
        const source: ExportAssetSource = { kind: 'tauri', pieces: { open: () => gen(), node: false }, store: bareStore() }
        expect((await openExportAssetPieces('assets/a', source)).identity).toBeUndefined()
    })

    test('web: a missing first piece throws ExportAssetMissingError and closes the generator', async () => {
        const { gen, state } = trackedPieces([])
        const source: ExportAssetSource = { kind: 'web', pieces: { open: () => gen(), node: false }, store: bareStore() }
        await expect(openExportAssetPieces('assets/a', source)).rejects.toBeInstanceOf(ExportAssetMissingError)
        expect(state.closed).toBe(true)
    })

    test('a first piece that rejects throws ExportAssetMissingError naming the key', async () => {
        const source: ExportAssetSource = {
            kind: 'tauri',
            pieces: { open: async function* () { throw new Error('os error 2') }, node: false },
            store: bareStore(),
        }
        const error = await openExportAssetPieces('assets/gone', source).catch((e: unknown) => e)
        expect(error).toBeInstanceOf(ExportAssetMissingError)
        expect((error as ExportAssetMissingError).key).toBe('assets/gone')
    })

    test('node: a first range that fails once is re-sent', async () => {
        let attempts = 0
        const source: ExportAssetSource = {
            kind: 'node',
            pieces: {
                node: true,
                open: async function* () {
                    attempts++
                    if (attempts === 1) {
                        throw new Error('network')
                    }
                    yield piece('xy', 2)
                },
            },
            store: bareStore(),
        }
        const { first } = await openExportAssetPieces('assets/n', source)
        expect(attempts).toBe(2)
        expect(first.total).toBe(2)
    })

    test('node: a first range that fails twice throws ExportReadError, not a skip', async () => {
        const source: ExportAssetSource = {
            kind: 'node',
            pieces: { node: true, open: async function* () { throw new Error('network') } },
            store: bareStore(),
        }
        await expect(openExportAssetPieces('assets/n', source)).rejects.toBeInstanceOf(ExportReadError)
    })

    test('node: an absent key and a key refused for its shape both throw ExportAssetMissingError', async () => {
        const absent = trackedPieces([])
        const absentSource: ExportAssetSource = { kind: 'node', pieces: { node: true, open: () => absent.gen() }, store: bareStore() }
        await expect(openExportAssetPieces('assets/n', absentSource)).rejects.toBeInstanceOf(ExportAssetMissingError)
        expect(absent.state.closed).toBe(true)
        const refused: ExportAssetSource = {
            kind: 'node',
            pieces: { node: true, open: async function* () { throw new StoreInvalidKeyError('assets/bad', 'refused') } },
            store: bareStore(),
        }
        await expect(openExportAssetPieces('assets/bad', refused)).rejects.toBeInstanceOf(ExportAssetMissingError)
    })
})

describe('assetStoredSize (new behaviour)', () => {
    test('no source is unknown', async () => {
        expect(await assetStoredSize('assets/a', null)).toBeNull()
    })

    test('tauri answers from statStoredSize, and an error is unknown', async () => {
        const source: ExportAssetSource = { kind: 'tauri', pieces: DESKTOP_PIECE_SOURCE, store: bareStore() }
        env.stat.mockResolvedValueOnce(123)
        expect(await assetStoredSize('assets/a', source)).toBe(123)
        expect(env.stat).toHaveBeenCalledWith('assets/a')
        env.stat.mockRejectedValueOnce(new Error('os error 2'))
        expect(await assetStoredSize('assets/a', source)).toBeNull()
    })

    test('web: a Blob gives its size and bytes their length, without reading a piece', async () => {
        const readValue = vi.fn(async (key: string) => key === 'assets/blob' ? new Blob([new Uint8Array(70)]) : key === 'assets/bytes' ? new Uint8Array(9) : null)
        const open = vi.fn()
        const source: ExportAssetSource = { kind: 'web', pieces: { open, node: false }, store: bareStore({ readValue }) }
        expect(await assetStoredSize('assets/blob', source)).toBe(70)
        expect(await assetStoredSize('assets/bytes', source)).toBe(9)
        expect(await assetStoredSize('assets/none', source)).toBeNull()
        expect(open).not.toHaveBeenCalled()
    })

    test('web: a readValue error is unknown', async () => {
        const readValue = vi.fn(async () => { throw new Error('idb') })
        const source: ExportAssetSource = { kind: 'web', pieces: { open: vi.fn(), node: false }, store: bareStore({ readValue }) }
        expect(await assetStoredSize('assets/a', source)).toBeNull()
    })

    test('node: the first piece total, and the generator is closed', async () => {
        const { gen, state } = trackedPieces([piece('ab', 99), piece('cd', 99)])
        const source: ExportAssetSource = { kind: 'node', pieces: { node: true, open: () => gen() }, store: bareStore() }
        expect(await assetStoredSize('assets/n', source)).toBe(99)
        expect(state.closed).toBe(true)
    })

    test('node: an absent key and a failing first range are unknown', async () => {
        const absent: ExportAssetSource = { kind: 'node', pieces: { node: true, open: () => trackedPieces([]).gen() }, store: bareStore() }
        expect(await assetStoredSize('assets/n', absent)).toBeNull()
        const failing: ExportAssetSource = {
            kind: 'node',
            pieces: { node: true, open: async function* () { throw new Error('network') } },
            store: bareStore(),
        }
        expect(await assetStoredSize('assets/n', failing)).toBeNull()
    })
})
