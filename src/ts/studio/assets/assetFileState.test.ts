// The reader of file states over each store: the app's files store (answered by a size stat and the store's own absence
// rule), the Node server (its first piece) and a store with no piece source (`read`). Only a file the store itself says is absent reads `gone`; every failure and every
// doubt reads `unknown`.
import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExportAssetSource } from 'src/ts/drive/assetPieces'
import { openFirstPiece, type ReadPiece } from 'src/ts/drive/inlayBackupExport'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { StoreInvalidKeyError } from 'src/ts/storage/store/errors'
import { confirmedAbsent } from 'src/ts/storage/store/tauriFilesStore'
import { openAssetFileReader, type AssetFileReaderDeps } from './assetFileState'

const h = vi.hoisted(() => ({ exists: vi.fn() }))

// The files store module reaches the page stores through its imports; their module-level effects are not under test.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: {} }, selIdState: { selId: 0 }, MobileGUI: writable(false), settingsOpen: writable(false) }
})

// The store's own absence rule asks `appFsExists`; everything else of the module stays real.
vi.mock('src/ts/storage/appFs', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/appFs')>()),
    appFsExists: h.exists,
}))

const PATH = 'assets/grin.png'
const MISSING = new Error('No such file or directory (os error 2)')

function storeWith(parts: Partial<ByteStore>): ByteStore {
    return parts as ByteStore
}

function depsFor(source: ExportAssetSource | null, store: ByteStore, over: Partial<AssetFileReaderDeps> = {}): AssetFileReaderDeps {
    return {
        getStore: async () => store,
        sourceOf: async () => source,
        statSize: async () => 1,
        confirmedAbsent,
        openFirstPiece: async () => null,
        ...over,
    }
}

function sourceOf(kind: ExportAssetSource['kind'], store: ByteStore): ExportAssetSource {
    return { kind, pieces: { open: async function* () {}, node: kind === 'node' }, store }
}

beforeEach(() => {
    h.exists.mockReset()
})

describe('the reader of file states', () => {
    test('a page with no byte store has no reader to open', async () => {
        await expect(openAssetFileReader(depsFor(null, storeWith({}), { getStore: async () => null }))).rejects.toThrow()
    })

    describe('on a store with no piece source', () => {
        test.each([
            ['no value is gone', { bytes: null, version: null }, 'gone'],
            ['a value is present', { bytes: new Uint8Array(1), version: null }, 'present'],
        ] as const)('%s', async (_name, result, expected) => {
            const reader = await openAssetFileReader(depsFor(null, storeWith({ read: async () => result })))
            expect(reader.concurrency).toBe(1)
            expect(await reader.stateOf(PATH)).toBe(expected)
        })

        test('a read that throws is unknown', async () => {
            const reader = await openAssetFileReader(depsFor(null, storeWith({ read: async () => { throw new Error('denied') } })))
            expect(await reader.stateOf(PATH)).toBe('unknown')
        })
    })

    describe('on the app files store', () => {
        async function tauriReader(statSize: () => Promise<number>) {
            const store = storeWith({})
            return openAssetFileReader(depsFor(sourceOf('tauri', store), store, { statSize }))
        }

        test('a stat that answers is present, and eight files are asked at once', async () => {
            const reader = await tauriReader(async () => 5)
            expect(reader.concurrency).toBe(8)
            expect(await reader.stateOf(PATH)).toBe('present')
            expect(h.exists).not.toHaveBeenCalled()
        })

        test('a missing-file error is gone only when the file call and exists agree', async () => {
            h.exists.mockResolvedValue(false)
            const reader = await tauriReader(async () => { throw MISSING })
            expect(await reader.stateOf(PATH)).toBe('gone')
            expect(h.exists).toHaveBeenCalledWith(PATH)
        })

        test('a missing-file error while exists says the file is there is unknown', async () => {
            h.exists.mockResolvedValue(true)
            const reader = await tauriReader(async () => { throw MISSING })
            expect(await reader.stateOf(PATH)).toBe('unknown')
        })

        test('a missing-file error while exists itself fails is unknown', async () => {
            h.exists.mockRejectedValue(new Error('exists failed'))
            const reader = await tauriReader(async () => { throw MISSING })
            expect(await reader.stateOf(PATH)).toBe('unknown')
        })

        test('any other error is unknown and exists is never asked', async () => {
            const reader = await tauriReader(async () => { throw new Error('Permission denied (os error 13)') })
            expect(await reader.stateOf(PATH)).toBe('unknown')
            expect(h.exists).not.toHaveBeenCalled()
        })
    })

    describe('on the Node store', () => {
        const piece: ReadPiece = { bytes: new Uint8Array(1), total: 1 }

        async function openedWith(pieces: AsyncGenerator<ReadPiece, void, undefined>) {
            return { pieces, first: await pieces.next() }
        }

        async function* onePiece(): AsyncGenerator<ReadPiece, void, undefined> {
            yield piece
        }

        async function* noPiece(): AsyncGenerator<ReadPiece, void, undefined> {}

        async function nodeReader(openFirstPiece: AssetFileReaderDeps['openFirstPiece']) {
            const store = storeWith({})
            return openAssetFileReader(depsFor(sourceOf('node', store), store, { openFirstPiece }))
        }

        test('a first piece is present and the generator is closed', async () => {
            const pieces = onePiece()
            const closed = vi.spyOn(pieces, 'return')
            const reader = await nodeReader(async () => openedWith(pieces))
            expect(reader.concurrency).toBe(8)
            expect(await reader.stateOf(PATH)).toBe('present')
            expect(closed).toHaveBeenCalled()
        })

        test('no first piece is gone', async () => {
            const reader = await nodeReader(async () => openedWith(noPiece()))
            expect(await reader.stateOf(PATH)).toBe('gone')
        })

        test('a key the store refuses for its shape is unknown, never gone', async () => {
            async function* refusing(): AsyncGenerator<ReadPiece, void, undefined> {
                throw new StoreInvalidKeyError(PATH, 'refused')
            }
            const store = storeWith({})
            const source: ExportAssetSource = { kind: 'node', pieces: { open: () => refusing(), node: true }, store }
            // The real first-piece opener resolves null for this error: the key is not an answer.
            const reader = await openAssetFileReader(depsFor(source, store, { openFirstPiece }))
            expect(await reader.stateOf(PATH)).toBe('unknown')
        })

        test('a read that fails is unknown', async () => {
            const reader = await nodeReader(async () => { throw new Error('network') })
            expect(await reader.stateOf(PATH)).toBe('unknown')
        })
    })
})
