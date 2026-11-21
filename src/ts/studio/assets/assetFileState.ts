// Whether the file an asset row names is still in the page's byte store. A replay of a Studio step puts rows back only
// over files that are known to be there, so the answer has three states and anything the store cannot confirm reads
// `unknown`, which refuses the replay: a row is never put back over bytes that might be gone.
//
// The reader is only asked about paths under `assets/`: replay never passes it any other row path, which is put back
// as it was (MC-1833).

import type { ExportAssetSource } from '../../drive/assetPieces'
import type { PieceOpener, ReadPiece } from '../../drive/inlayBackupExport'
import type { ByteStore } from '../../storage/store/contract'

export type AssetFileState = 'present' | 'gone' | 'unknown'

export interface AssetFileReader {
    stateOf(path: string): Promise<AssetFileState>
    // How many paths may be asked at once: one read at a time when each answer is a whole `read`, eight where the
    // answer comes from metadata or a first piece.
    concurrency: number
}

type FirstPiece = { pieces: AsyncGenerator<ReadPiece, void, undefined>; first: IteratorResult<ReadPiece, void> } | null

// The calls the reader makes into the storage layer. The default loads them when a reader is opened, so a page that
// never replays an asset step imports none of them.
export interface AssetFileReaderDeps {
    getStore(): Promise<ByteStore | null>
    sourceOf(store: ByteStore): Promise<ExportAssetSource | null>
    // The size of an app-files-store key; rejects with the command's error when the file call fails.
    statSize(key: string): Promise<number>
    // The store's own absence rule: the file call says "missing" and `exists` agrees.
    confirmedAbsent(error: unknown, key: string): Promise<boolean>
    openFirstPiece(open: PieceOpener, key: string): Promise<FirstPiece>
}

async function productionDeps(): Promise<AssetFileReaderDeps> {
    const [preflight, pieces, transport, files, inlay] = await Promise.all([
        import('../../drive/exportPreflight'),
        import('../../drive/assetPieces'),
        import('../../storage/tauriByteTransport'),
        import('../../storage/store/tauriFilesStore'),
        import('../../drive/inlayBackupExport'),
    ])
    return {
        getStore: preflight.appStoreOrNull,
        sourceOf: pieces.exportAssetPieceSource,
        statSize: transport.statStoredSize,
        confirmedAbsent: files.confirmedAbsent,
        openFirstPiece: inlay.openFirstPiece,
    }
}

// Reads `path` through the store's whole-value `read`: no bytes means no value.
async function stateByRead(store: ByteStore, path: string): Promise<AssetFileState> {
    try {
        const { bytes } = await store.read(path)
        return bytes === null ? 'gone' : 'present'
    } catch {
        return 'unknown'
    }
}

async function stateOfNodeKey(deps: AssetFileReaderDeps, source: ExportAssetSource, path: string): Promise<AssetFileState> {
    try {
        const opened = await deps.openFirstPiece(source.pieces.open, path)
        // A key the store refuses for its shape is not an answer.
        if (opened === null) {
            return 'unknown'
        }
        try {
            return opened.first.done === true ? 'gone' : 'present'
        } finally {
            await opened.pieces.return(undefined).catch(() => { })
        }
    } catch {
        return 'unknown'
    }
}

async function stateOfTauriKey(deps: AssetFileReaderDeps, path: string): Promise<AssetFileState> {
    try {
        await deps.statSize(path)
        return 'present'
    } catch (error) {
        return (await deps.confirmedAbsent(error, path)) ? 'gone' : 'unknown'
    }
}

/**
 * Resolves the store once and returns a reader over it. It rejects when the page has no byte store to ask, which the
 * caller treats as unanswered. `stateOf` never rejects: a failed read is `unknown`.
 */
export async function openAssetFileReader(deps?: AssetFileReaderDeps): Promise<AssetFileReader> {
    const calls = deps ?? (await productionDeps())
    const store = await calls.getStore()
    if (store === null) {
        throw new Error('The page has no byte store to check files in')
    }
    const source = await calls.sourceOf(store)
    return {
        concurrency: source === null ? 1 : 8,
        stateOf(path) {
            if (source === null) {
                return stateByRead(store, path)
            }
            if (source.kind === 'tauri') {
                return stateOfTauriKey(calls, path)
            }
            return stateOfNodeKey(calls, source, path)
        },
    }
}
