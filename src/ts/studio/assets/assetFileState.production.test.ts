// The file reader a page opens with no injected calls reads through the store's own functions: a size stat on the app's
// files store and the store's own absence rule. Each module the production calls come from is replaced by a double that
// keeps the module's other names, so the wiring (which function answers which question) is what the rows observe: a
// stat that resolves is `present`, and a stat that rejects is `gone` only when the store's absence rule says so.
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ExportAssetSource } from 'src/ts/drive/assetPieces'
import type { ByteStore } from 'src/ts/storage/store/contract'
import { openAssetFileReader } from './assetFileState'

const h = vi.hoisted(() => ({
    statStoredSize: vi.fn(),
    confirmedAbsent: vi.fn(),
}))

// The page's stores are not under test; the modules below reach them through their imports.
vi.mock('src/ts/stores.svelte', async () => {
    const { writable } = await import('svelte/store')
    return { DBState: { db: {} }, selIdState: { selId: 0 }, MobileGUI: writable(false), settingsOpen: writable(false) }
})

const store = {} as ByteStore

vi.mock('src/ts/drive/exportPreflight', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/drive/exportPreflight')>()),
    appStoreOrNull: async () => store,
}))

vi.mock('src/ts/drive/assetPieces', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/drive/assetPieces')>()),
    exportAssetPieceSource: async (): Promise<ExportAssetSource> => ({ kind: 'tauri', pieces: { open: async function* () {}, node: false }, store }),
}))

vi.mock('src/ts/storage/tauriByteTransport', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/tauriByteTransport')>()),
    statStoredSize: h.statStoredSize,
}))

vi.mock('src/ts/storage/store/tauriFilesStore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('src/ts/storage/store/tauriFilesStore')>()),
    confirmedAbsent: h.confirmedAbsent,
}))

const PATH = 'assets/grin.png'
const FAILURE = new Error('stat failed')

// The reader opens through dynamic imports of heavy modules, and each `importOriginal` above loads one of them for real.
// Opening it once here puts that cold import in a hook with its own, longer timeout, so a loaded machine cannot spend a
// test's time on it. It asks no stat, so no row observes it.
beforeAll(async () => {
    await openAssetFileReader()
}, 180_000)

beforeEach(() => {
    h.statStoredSize.mockReset()
    h.confirmedAbsent.mockReset()
})

describe('the production file reader on the app files store', () => {
    test('a resolving size stat reads present and asks nobody about absence', async () => {
        h.statStoredSize.mockResolvedValue(12)
        const reader = await openAssetFileReader()

        expect(reader.concurrency).toBe(8)
        expect(await reader.stateOf(PATH)).toBe('present')
        expect(h.statStoredSize).toHaveBeenCalledWith(PATH)
        expect(h.confirmedAbsent).not.toHaveBeenCalled()
    })

    test('a failed stat that the store does not confirm as absent reads unknown, with the error and the path asked', async () => {
        h.statStoredSize.mockRejectedValue(FAILURE)
        h.confirmedAbsent.mockResolvedValue(false)
        const reader = await openAssetFileReader()

        expect(await reader.stateOf(PATH)).toBe('unknown')
        expect(h.confirmedAbsent).toHaveBeenCalledWith(FAILURE, PATH)
    })

    test('a failed stat that the store confirms as absent reads gone', async () => {
        h.statStoredSize.mockRejectedValue(FAILURE)
        h.confirmedAbsent.mockResolvedValue(true)
        const reader = await openAssetFileReader()

        expect(await reader.stateOf(PATH)).toBe('gone')
        expect(h.confirmedAbsent).toHaveBeenCalledWith(FAILURE, PATH)
    })
})
